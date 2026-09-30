// Migration 0027: the rules registry starts from the values in effect before it, the old tables
// still reach it, and the database holds the catalog's and the signers' two-person lines.
import { afterAll, beforeAll, describe, it, expect } from "vitest";
import type pg from "pg";
import { freshDatabase, inTransaction, market, station, user, type Tx } from "./helpers.js";

let pool: pg.Pool;
let drop: () => Promise<void>;

beforeAll(async () => {
  ({ pool, drop } = await freshDatabase());
}, 60_000);

afterAll(async () => {
  await drop();
});

const test = (name: string, fn: (tx: Tx) => Promise<void>) => it(name, () => inTransaction(pool, fn));
const CID = "bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy";

async function item(tx: Tx, state = "checking") {
  const s = await station(tx, { kind: "catalog", name: "Opencast catalog" });
  const program = await tx.one<{ id: string }>(`INSERT INTO broadcast.programs (station_id, title) VALUES ($1, 'Cartoons') RETURNING id`, [s.id]);
  await tx.run(`INSERT INTO broadcast.contents (cid, bytes, content_type, storage_class, store) VALUES ($1, 10, 'video/mp4', 'infrequent', 'local') ON CONFLICT DO NOTHING`, [CID]);
  const series = await tx.one<{ id: string }>(`INSERT INTO catalog.shelf_series (title, station_id, program_id, rights_basis) VALUES ('Cartoons', $1, $2, 'mixed') RETURNING id`, [s.id, program.id]);
  const a = await user(tx);
  const b = await user(tx);
  const row = await tx.one<{ id: string }>(
    `INSERT INTO catalog.shelf_items (series_id, title, source, content_id, state, first_checked_by, second_checked_by)
     VALUES ($1, 'River Rhythms', '1929, original print', $2, $3, $4, $5) RETURNING id`,
    [series.id, CID, state, state === "checking" ? null : a.id, state === "passed" ? b.id : null]
  );
  const episode = await tx.one<{ id: string }>(`INSERT INTO catalog.shelf_episodes (series_id, number) VALUES ($1, 1) RETURNING id`, [series.id]);
  return { itemId: row.id, episodeId: episode.id, first: a.id, second: b.id };
}

describe("the rules registry", () => {
  test("starts with every rule's value in effect before it", async (tx) => {
    const rows = await tx.client.query(`SELECT key, value FROM network.rules ORDER BY key`);
    const byKey = Object.fromEntries(rows.rows.map((r: { key: string; value: unknown }) => [r.key, r.value]));
    // 15 from 0027; the hold and the refused names from 0029 (reserved call signs); radio live and
    // the grace period from 0033 (pay-as-you-go), which also gives three prices their first set version.
    expect(Object.keys(byKey)).toHaveLength(19);
    expect(byKey["billing.grace"]).toEqual({ days: 14, warnDaysBefore: 3 });
    expect(byKey["call_signs.hold"]).toEqual({ days: 120, reminderDays: 14 });
    expect(byKey["call_signs.refused"]).toMatchObject({ refuseKwFourLetters: true, denylist: ["ALERT", "EAS", "SOS"] });
    expect(byKey["shares.opencast"]).toEqual({ spotBps: 0, pledgeBps: 0, productionBps: 0 });
    expect(byKey["rights.claim_dates"]).toEqual({ answerDays: 14, counterNoticeBusinessDays: 10 });
    expect(byKey["numbering.channels"]).toEqual({ tv: { firstMajor: 2, lastMajor: 69 }, radio: { firstTenths: 882, lastTenths: 1078 } });
  });

  test("keeps a write to ledger.revenue_config or trust.policy as a new version", async (tx) => {
    await tx.run(`INSERT INTO ledger.revenue_config (effective_from, opencast_spot_share_bps) VALUES ('2026-12-01', 1500)`);
    const share = await tx.one<{ value: { spotBps: number }; effective_from: Date }>(`SELECT value, effective_from FROM network.rules WHERE key = 'shares.opencast' ORDER BY effective_from DESC LIMIT 1`);
    expect(share.value.spotBps).toBe(1500);
    expect(share.effective_from.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    await tx.run(`UPDATE trust.policy SET upheld_per_year_to_pause_offers = 2 WHERE id = 1`);
    const limit = await tx.one<{ value: { upheldIn12Months: number } }>(`SELECT value FROM network.rules WHERE key = 'rights.repeat_limit' ORDER BY effective_from DESC, created_at DESC LIMIT 1`);
    expect(limit.value.upheldIn12Months).toBe(2);
  });

  test("takes only keys that look like keys", async (tx) => {
    await tx.rejects(/rule_key_format/, () => tx.run(`INSERT INTO network.rules (key, value, effective_from) VALUES ('Prices', '1', now())`));
  });
});

describe("the catalog's two-person check", () => {
  test("never lets the first checker do the second", async (tx) => {
    const { itemId, first } = await item(tx, "second_check");
    await tx.rejects(/second_check_is_someone_else/, () => tx.run(`UPDATE catalog.shelf_items SET second_checked_by = $1 WHERE id = $2`, [first, itemId]));
    await tx.rejects(/passed_has_both_checks/, () => tx.run(`UPDATE catalog.shelf_items SET state = 'passed' WHERE id = $1`, [itemId]));
  });

  test("puts only passed items in episodes", async (tx) => {
    const draft = await item(tx, "checking");
    await tx.rejects(/shelf_item_not_passed/, () => tx.run(`INSERT INTO catalog.shelf_episode_items (episode_id, item_id, position) VALUES ($1, $2, 1)`, [draft.episodeId, draft.itemId]));
    const ok = await item(tx, "passed");
    await tx.accepts(async () => {
      await tx.run(`INSERT INTO catalog.shelf_episode_items (episode_id, item_id, position) VALUES ($1, $2, 1)`, [ok.episodeId, ok.itemId]);
      // Failing later takes it out (no position), which is allowed.
      await tx.run(`UPDATE catalog.shelf_items SET state = 'failed' WHERE id = $1`, [ok.itemId]);
      await tx.run(`UPDATE catalog.shelf_episode_items SET removed_at = now(), position = NULL WHERE item_id = $1`, [ok.itemId]);
    });
  });
});

describe("escrow signer changes", () => {
  test("are never approved by whoever proposed them, or anyone not named", async (tx) => {
    const a = await user(tx);
    const b = await user(tx);
    const c = await user(tx);
    const p = await tx.one<{ id: string }>(
      `INSERT INTO network.signer_proposals (kind, new_address, signers_after, threshold_after, proposed_by, approvers)
       VALUES ('add', '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65', '["0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65"]', 1, $1, $2) RETURNING id`,
      [a.id, JSON.stringify([b.id])]
    );
    await tx.rejects(/signer_self_approval/, () => tx.run(`INSERT INTO network.signer_approvals (proposal_id, admin_id, decision) VALUES ($1, $2, 'approve')`, [p.id, a.id]));
    await tx.rejects(/signer_not_approver/, () => tx.run(`INSERT INTO network.signer_approvals (proposal_id, admin_id, decision) VALUES ($1, $2, 'approve')`, [p.id, c.id]));
    await tx.accepts(() => tx.run(`INSERT INTO network.signer_approvals (proposal_id, admin_id, decision) VALUES ($1, $2, 'approve')`, [p.id, b.id]));
  });

  test("keep the threshold within the keys", async (tx) => {
    const a = await user(tx);
    await tx.rejects(/signer_threshold_after/, () =>
      tx.run(`INSERT INTO network.signer_proposals (kind, threshold, signers_after, threshold_after, proposed_by, approvers) VALUES ('threshold', 3, '["0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65"]', 3, $1, '[]')`, [a.id])
    );
  });
});

describe("desk roles", () => {
  test("give a market lead a market, and nobody else one", async (tx) => {
    const m = await market(tx);
    const u = await user(tx);
    await tx.rejects(/market_lead_has_market/, () => tx.run(`INSERT INTO network.desk_roles (user_id, role) VALUES ($1, 'market_lead')`, [u.id]));
    await tx.rejects(/market_lead_has_market/, () => tx.run(`INSERT INTO network.desk_roles (user_id, role, market_id) VALUES ($1, 'rights_reviewer', $2)`, [u.id, m.id]));
    await tx.run(`INSERT INTO network.desk_roles (user_id, role) VALUES ($1, 'rights_reviewer')`, [u.id]);
    await tx.rejects(/desk_roles_one_active/, () => tx.run(`INSERT INTO network.desk_roles (user_id, role) VALUES ($1, 'rights_reviewer')`, [u.id]));
  });
});
