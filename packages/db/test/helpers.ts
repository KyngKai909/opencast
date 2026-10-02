import pg from "pg";
import { expect } from "vitest";

export { freshDatabase } from "../src/testing.js";

/**
 * Runs a test inside a transaction that's always rolled back. Deferred checks
 * (balanced entries, funded holds) are forced with `check()`.
 */
export async function inTransaction(pool: pg.Pool, fn: (tx: Tx) => Promise<void>) {
  const client = await pool.connect();
  await client.query("BEGIN");
  try {
    await fn(new Tx(client));
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
}

export class Tx {
  private savepoint = 0;
  constructor(readonly client: pg.PoolClient) {}

  async one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
    const result = await this.client.query(sql, params);
    return result.rows[0] as T;
  }

  async run(sql: string, params: unknown[] = []) {
    await this.client.query(sql, params);
  }

  /** Fires every deferred constraint trigger now. */
  async check() {
    await this.client.query("SET CONSTRAINTS ALL IMMEDIATE");
    await this.client.query("SET CONSTRAINTS ALL DEFERRED");
  }

  /** Expects the statements to fail with a message matching `pattern`, and undoes them. */
  async rejects(pattern: RegExp, fn: () => Promise<unknown>) {
    const name = `sp_${++this.savepoint}`;
    await this.client.query(`SAVEPOINT ${name}`);
    let error: unknown;
    try {
      await fn();
    } catch (caught) {
      error = caught;
    }
    await this.client.query(`ROLLBACK TO SAVEPOINT ${name}`);
    expect(error, `expected failure matching ${pattern}`).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(pattern);
  }

  /** Runs statements that must succeed (including deferred checks), then undoes them. */
  async accepts(fn: () => Promise<unknown>) {
    const name = `sp_${++this.savepoint}`;
    await this.client.query(`SAVEPOINT ${name}`);
    await fn();
    await this.check();
    await this.client.query(`ROLLBACK TO SAVEPOINT ${name}`);
  }
}

// Fixtures ------------------------------------------------------------------

export async function market(tx: Tx, slug = "inland-empire") {
  return tx.one<{ id: string }>(`INSERT INTO network.markets (slug, name) VALUES ($1, $2) RETURNING id`, [
    slug,
    slug
  ]);
}

export async function station(
  tx: Tx,
  fields: { callSign?: string | null; kind?: string; name?: string; signedOn?: boolean } = {}
) {
  return tx.one<{ id: string }>(
    `INSERT INTO broadcast.stations (kind, call_sign, name, first_signed_on_at, status)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      fields.kind ?? "station",
      fields.callSign ?? null,
      fields.name ?? "Test station",
      fields.signedOn ? new Date() : null,
      fields.signedOn ? "on_air" : "setting_up"
    ]
  );
}

export async function channel(tx: Tx, stationId: string, marketId: string, band: "tv" | "radio", tenths: number) {
  return tx.one<{ id: string }>(
    `INSERT INTO broadcast.channels (station_id, market_id, band, tenths) VALUES ($1, $2, $3, $4) RETURNING id`,
    [stationId, marketId, band, tenths]
  );
}

export async function asset(tx: Tx, stationId: string, fields: { source?: string; programId?: string; creatorWorkId?: string } = {}) {
  return tx.one<{ id: string }>(
    `INSERT INTO broadcast.assets (station_id, program_id, title, code, source, source_url, creator_work_id, media_kind, duration_ms)
     VALUES ($1, $2, 'Episode', 'PGM', $3, $4, $5, 'video', 1800000) RETURNING id`,
    [
      stationId,
      fields.programId ?? null,
      fields.source ?? "upload",
      fields.source === "link" ? "https://example.com/v" : null,
      fields.creatorWorkId ?? null
    ]
  );
}

export async function account(
  tx: Tx,
  kind: string,
  owner: { advertiserId?: string; stationId?: string; userId?: string; label?: string } = {}
) {
  return tx.one<{ id: string }>(
    `INSERT INTO ledger.accounts (kind, advertiser_id, station_id, user_id, label) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [kind, owner.advertiserId ?? null, owner.stationId ?? null, owner.userId ?? null, owner.label ?? null]
  );
}

/** A balanced entry: postings are [accountId, amountMicros, holdId?]. */
export async function entry(tx: Tx, kind: string, postings: Array<[string, number, string?]>) {
  const { id } = await tx.one<{ id: string }>(`INSERT INTO ledger.entries (kind) VALUES ($1) RETURNING id`, [kind]);
  for (const [accountId, amount, holdId] of postings) {
    await tx.run(`INSERT INTO ledger.postings (entry_id, account_id, amount_micros, hold_id) VALUES ($1, $2, $3, $4)`, [
      id,
      accountId,
      amount,
      holdId ?? null
    ]);
  }
  return id;
}

export async function user(tx: Tx) {
  return tx.one<{ id: string }>(`INSERT INTO accounts.users (display_name) VALUES ('Kai') RETURNING id`);
}

export async function advertiser(tx: Tx) {
  return tx.one<{ id: string }>(
    `INSERT INTO spots.advertisers (name, category, customers_where) VALUES ('Orange Street Coffee', 'Coffee and food', 'location') RETURNING id`
  );
}
