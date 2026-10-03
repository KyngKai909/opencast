// Programming blocks (A244, 2026-10-02; Build B of design-bumpers-blocks): the block itself, a
// named and branded grouping of a station's programs and library items ("Late Crate Nights"). The
// library owns the block and its items (intros `OPN`, outros `CLS`, IDs `SID` and bumpers `BMP`
// with `program_block_id`); where it airs (spans on a date's log, blocks in a day template) is the
// log's, and how it airs is playout's.
//
// Syndication readiness (the market is later): `owner_station_id` makes the block and `station_id`
// airs it, the same for every block made now. A carrier's copy (`source_block_id`) reads its name,
// description, colour and logo through to the maker's block wherever its own are null (`refs`).

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { schema } from "@opencast/db";
import { isValidStationColour } from "@opencast/domain";
import type { BumperSequences, ProgramBlock } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import type { UploadedFile } from "../../http.js";
import { badRequest, conflict, HttpError, notFound, refused } from "../../errors.js";
import { publicUrl } from "../../lib/url.js";
import { sequenceProblems, sequencesOf, type BumperSequences as Sequences } from "../playout/engine/sequence.js";
import type { Content } from "./content.js";

const PB = schema.programBlocks;
const A = schema.assets;

type BlockRow = typeof PB.$inferSelect;

/** What other modules need to know about a block (playout, the log, the guide). A carried copy's look reads through to the maker's. */
export interface BlockRef {
  id: string;
  stationId: string;
  ownerStationId: string;
  sourceBlockId: string | null;
  name: string;
  description: string | null;
  colour: string | null;
  logoContentId: string | null;
  /** Absolute, or the API's own path made absolute. */
  logoUrl: string | null;
  bug: "station" | "logo" | "off";
  intro: boolean;
  outro: boolean;
  /** Its own bumper order, or null (the station's). */
  sequences: Sequences | null;
  reskin: "owner_only" | "carrier_may_reskin";
  archived: boolean;
}

export interface BlockFieldsInput {
  name?: string;
  description?: string | null;
  colour?: string | null;
  bug?: "station" | "logo" | "off";
  intro?: boolean;
  outro?: boolean;
  sequences?: BumperSequences | null;
  removeLogo?: boolean;
}

export interface BlockOps {
  list(stationId: string): Promise<ProgramBlock[]>;
  get(stationId: string, blockId: string): Promise<ProgramBlock>;
  create(stationId: string, input: BlockFieldsInput & { name: string }): Promise<ProgramBlock>;
  update(stationId: string, blockId: string, input: BlockFieldsInput): Promise<ProgramBlock>;
  uploadLogo(stationId: string, blockId: string, file: UploadedFile | null): Promise<ProgramBlock>;
  archive(stationId: string, blockId: string, takeOffLog: boolean): Promise<{ ok: true; removed: number; kept: number }>;
  /** By id (archived included), a carried copy's look read through to the maker's. */
  refs(ids: string[]): Promise<Map<string, BlockRef>>;
  /** A station's blocks (archived left out). */
  forStation(stationId: string): Promise<BlockRef[]>;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function createBlockOps(ctx: ModuleContext, content: Content): BlockOps {
  const { deps, services } = ctx;
  const { db } = deps;

  async function row(stationId: string, blockId: string): Promise<BlockRow> {
    const [found] = await db.select().from(PB).where(and(eq(PB.id, blockId), eq(PB.stationId, stationId)));
    if (!found) throw notFound("That block");
    return found;
  }

  async function toRefs(rows: BlockRow[]): Promise<BlockRef[]> {
    const sources = rows.map((r) => r.sourceBlockId).filter((v): v is string => Boolean(v));
    const makers = sources.length ? new Map((await db.select().from(PB).where(inArray(PB.id, sources))).map((m) => [m.id, m])) : new Map<string, BlockRow>();
    return Promise.all(
      rows.map(async (r) => {
        const maker = r.sourceBlockId ? makers.get(r.sourceBlockId) : undefined;
        const logo = r.logoContentId ?? maker?.logoContentId ?? null;
        return {
          id: r.id,
          stationId: r.stationId,
          ownerStationId: r.ownerStationId,
          sourceBlockId: r.sourceBlockId,
          name: r.name || maker?.name || "Block",
          description: r.description ?? maker?.description ?? null,
          colour: r.colour ?? maker?.colour ?? null,
          logoContentId: logo,
          logoUrl: logo ? publicUrl(deps, await content.url(logo)) : null,
          bug: r.bug,
          intro: r.intro,
          outro: r.outro,
          sequences: r.sequences ? sequencesOf(r.sequences) : null,
          reskin: maker?.reskin ?? r.reskin,
          archived: r.archivedAt !== null
        };
      })
    );
  }

  async function views(stationId: string, rows: BlockRow[], withPlacements = false): Promise<ProgramBlock[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [refs, items, owners, schedules] = await Promise.all([
      toRefs(rows),
      db
        .select({ id: A.id, title: A.title, code: A.code, durationMs: A.durationMs, blockId: A.programBlockId, role: A.bumperRole })
        .from(A)
        .where(and(inArray(A.programBlockId, ids), isNull(A.archivedAt)))
        .orderBy(asc(A.createdAt), asc(A.id)),
      services.stations.idents([...new Set(rows.map((r) => r.ownerStationId))]),
      services.log.blockSchedules(stationId, ids, withPlacements)
    ]);
    return rows.map((r, i) => {
      const ref = refs[i];
      const mine = items.filter((it) => it.blockId === r.id);
      const item = (it: (typeof mine)[number]) => ({ id: it.id, title: it.title, durationMs: it.durationMs });
      const bumpers = { into_break: 0, out_of_break: 0, up_next: 0, any: 0 };
      for (const it of mine) if (it.code === "BMP") bumpers[(it.role as keyof typeof bumpers | null) ?? "any"]++;
      const schedule = schedules.get(r.id);
      return {
        id: r.id,
        stationId: r.stationId,
        name: ref.name,
        description: ref.description,
        colour: ref.colour,
        logoUrl: ref.logoUrl,
        bug: r.bug,
        intro: r.intro,
        outro: r.outro,
        sequences: ref.sequences,
        owner: owners.get(r.ownerStationId)!,
        carried: r.sourceBlockId !== null,
        reskin: ref.reskin,
        items: { intro: mine.filter((it) => it.code === "OPN").map(item), outro: mine.filter((it) => it.code === "CLS").map(item), id: mine.filter((it) => it.code === "SID").map(item), bumpers },
        schedule: { label: schedule?.label ?? null, next: schedule?.next ?? null },
        ...(withPlacements && schedule?.onLog ? { onLog: schedule.onLog } : {}),
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString()
      };
    });
  }

  /** The fields as columns, checked. */
  function columns(input: BlockFieldsInput): Partial<typeof PB.$inferInsert> {
    const out: Partial<typeof PB.$inferInsert> = {};
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name || name.length > 60) throw badRequest("Name it, in 60 characters at most.", { name: "1 to 60 characters" });
      out.name = name;
    }
    if (input.description !== undefined) out.description = input.description?.trim() || null;
    if (input.colour !== undefined) {
      if (input.colour && !isValidStationColour(input.colour)) throw badRequest("That colour doesn't hold 4.5:1 against white. Choose a darker one.", { colour: "Needs 4.5:1" });
      out.colour = input.colour;
    }
    if (input.bug !== undefined) out.bug = input.bug;
    if (input.intro !== undefined) out.intro = input.intro;
    if (input.outro !== undefined) out.outro = input.outro;
    if (input.sequences !== undefined) {
      if (input.sequences) {
        const problems = sequenceProblems(input.sequences as never);
        if (problems) throw badRequest("Each bumper role can be in a position once, four at most. Say how many programs with “After every N programs”.", Object.fromEntries(Object.entries(problems).map(([k, v]) => [k.replace("bumperSequences", "sequences"), v])));
      }
      out.sequences = input.sequences ? sequencesOf(input.sequences as never) : null;
    }
    if (input.removeLogo) out.logoContentId = null;
    return out;
  }

  /** A name the station already uses (its blocks still on, archived ones aside). */
  async function nameTaken(stationId: string, name: string, except?: string) {
    const rows = await db
      .select({ id: PB.id })
      .from(PB)
      .where(and(eq(PB.stationId, stationId), isNull(PB.archivedAt), sql`lower(${PB.name}) = lower(${name})`));
    return rows.some((r) => r.id !== except);
  }

  const ops: BlockOps = {
    async list(stationId) {
      const rows = await db
        .select()
        .from(PB)
        .where(and(eq(PB.stationId, stationId), isNull(PB.archivedAt)))
        .orderBy(asc(PB.createdAt));
      return views(stationId, rows);
    },

    async get(stationId, blockId) {
      const found = await row(stationId, blockId);
      if (found.archivedAt) throw notFound("That block");
      return (await views(stationId, [found], true))[0];
    },

    async create(stationId, input) {
      const set = columns(input);
      if (await nameTaken(stationId, set.name!)) throw conflict("block_name_taken", `You already have a block called ${set.name}.`);
      const now = deps.clock.now();
      const [created] = await db
        .insert(PB)
        .values({ ...set, name: set.name!, stationId, ownerStationId: stationId, createdAt: now, updatedAt: now })
        .returning();
      return (await views(stationId, [created], true))[0];
    },

    async update(stationId, blockId, input) {
      const current = await row(stationId, blockId);
      if (current.archivedAt) throw notFound("That block");
      const set = columns(input);
      if (set.name && (await nameTaken(stationId, set.name, blockId))) throw conflict("block_name_taken", `You already have a block called ${set.name}.`);
      if (Object.keys(set).length) {
        await db.update(PB).set({ ...set, updatedAt: deps.clock.now() }).where(eq(PB.id, blockId));
        if (input.removeLogo && current.logoContentId) await content.releaseOne(current.logoContentId, "block_logo", blockId);
        // What airs from now looks different: an on-air station reads it again.
        await services.playout.replan(stationId).catch(() => undefined);
      }
      return (await views(stationId, [await row(stationId, blockId)], true))[0];
    },

    async uploadLogo(stationId, blockId, file) {
      const current = await row(stationId, blockId);
      if (current.archivedAt) throw notFound("That block");
      if (!file) throw badRequest("Choose the logo.", { file: "Required" });
      const meta = await sharp(file.path)
        .metadata()
        .catch(() => null);
      if (!meta || !meta.width || !meta.height || !["png", "jpeg", "webp"].includes(meta.format ?? "")) throw refused("not_an_image", "Choose a PNG, JPEG or WebP image.");
      if (Math.min(meta.width, meta.height) < 128) throw refused("logo_size", "The logo has to be at least 128 pixels on its short side.");
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencast-block-logo-"));
      try {
        const out = path.join(dir, "logo.png");
        // A bug-sized mark: kept whole, at most 512 pixels, transparency kept.
        await sharp(file.path).resize(512, 512, { fit: "inside", withoutEnlargement: true }).png().toFile(out);
        const stored = await content.store(out, { storageClass: "standard", contentType: "image/png" });
        await db.transaction(async (tx) => {
          await content.addRef(tx, stored.cid, "block_logo", blockId);
          await tx.update(PB).set({ logoContentId: stored.cid, updatedAt: deps.clock.now() }).where(eq(PB.id, blockId));
        });
        // The old one goes unless something else points at it.
        if (current.logoContentId && current.logoContentId !== stored.cid) await content.releaseOne(current.logoContentId, "block_logo", blockId);
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
      await services.playout.replan(stationId).catch(() => undefined);
      return (await views(stationId, [await row(stationId, blockId)], true))[0];
    },

    async archive(stationId, blockId, takeOffLog) {
      const current = await row(stationId, blockId);
      if (current.archivedAt) throw notFound("That block");
      const ahead = await services.log.blockSpansAhead(stationId, blockId);
      if (ahead > 0 && !takeOffLog) {
        throw new HttpError(409, "block_on_log", `${current.name} is on the log ${plural(ahead, "more time")}. Take it off the log first.`);
      }
      const { removed, kept } = ahead > 0 || takeOffLog ? await services.log.takeBlockOffLog(stationId, blockId) : { removed: 0, kept: 0 };
      await db.update(PB).set({ archivedAt: deps.clock.now(), updatedAt: deps.clock.now() }).where(eq(PB.id, blockId));
      return { ok: true as const, removed, kept };
    },

    async refs(ids) {
      if (!ids.length) return new Map();
      const rows = await db.select().from(PB).where(inArray(PB.id, [...new Set(ids)]));
      return new Map((await toRefs(rows)).map((r) => [r.id, r]));
    },

    async forStation(stationId) {
      const rows = await db
        .select()
        .from(PB)
        .where(and(eq(PB.stationId, stationId), isNull(PB.archivedAt)))
        .orderBy(asc(PB.createdAt));
      return toRefs(rows);
    }
  };
  return ops;
}
