// Programming Phase 2: what the upload guess makes of real file names. Reads every library item's
// original file name (and title) and prints the season, episode and part `guessEpisode` would give.
// Read-only: nothing is written. It reads only columns from before migration 0062, so it runs on a
// database with or without it.
//
//   DATABASE_URL=postgres://… npm run demo:episode-guesses -w @opencast/api
//   … -- --programs        programs only (the type the guess applies to at upload)
//   … -- --limit 500       at most this many (default 2,000), newest first

import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { createDb, schema } from "@opencast/db";
import { guessEpisode } from "@opencast/domain";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const A = schema.assets;
const { db, pool } = createDb(process.env.DATABASE_URL ?? "postgres://opencast:opencast@localhost:54329/opencast");
try {
  const rows = await db
    .select({ file: A.originalFilename, title: A.title, code: A.code })
    .from(A)
    .where(and(isNotNull(A.originalFilename), isNull(A.archivedAt), ...(process.argv.includes("--programs") ? [eq(A.code, "PGM")] : [])))
    .orderBy(desc(A.createdAt))
    .limit(Number(arg("--limit") ?? 2000));
  const show = (s: number | null, e: number | null, of: string | null, p: number | null) =>
    [s ? `S${s}` : "", e ? `E${e}` : "", of ? ` part ${p ?? "?"} of “${of}”` : ""].join("").trim() || "–";
  let guessed = 0;
  for (const r of rows) {
    const g = guessEpisode(r.file!, r.title);
    const said = show(g.seasonNumber, g.episodeNumber, g.partOf, g.partNumber);
    if (said !== "–") guessed++;
    console.log(`${r.code.padEnd(4)} ${said.padEnd(36)} ${r.file}${r.title !== r.file!.replace(/\.[^.]+$/, "") ? `  (title “${r.title}”)` : ""}`);
  }
  console.log(`\n${rows.length} file names, ${guessed} with a guess.`);
} finally {
  await pool.end();
}
