// BEAT's library (live-listings 04.1; master-control LIB): 34 items. Late Crate (15), Crate
// Sessions (3, one imported from a link with its rights still to confirm), Crate Talk (6),
// Spots and IDs (4), Bumpers (2), one recording not in a folder, and (A242, 2026-10-02) its
// closer, off-air card (a picture) and opener, not in a folder.

import type { Folder, LibraryItem, Program } from "@opencast/contracts";
import { BEAT, LAB, uid } from "./stations";
import { MIN, SEC, at } from "./time";

const ms = (m: number, s = 0) => m * MIN + s * SEC;
let n = 0;
const itemId = () => uid(300000 + ++n);

export const FOLDERS = {
  lateCrate: uid(290001),
  crateSessions: uid(290002),
  crateTalk: uid(290003),
  spotsIds: uid(290004),
  bumpers: uid(290005)
};

export const PROGRAM_IDS = {
  lateCrate: uid(280001),
  crateSession: uid(280002),
  crateTalk: uid(280003),
  beatTapeLive: uid(280004),
  // The studio Inland Sound Lab's programs (market 04.1).
  crateDiggers: uid(280301),
  studioNotes: uid(280302),
  loops: uid(280303),
  // Carried programs BEAT airs (their makers' programs).
  saturdayReel: uid(280101),
  slowHours: uid(280102)
};

function item(o: Partial<LibraryItem> & Pick<LibraryItem, "title" | "code">): LibraryItem {
  const ready = (o.status ?? "ready") === "ready";
  return {
    id: itemId(),
    stationId: BEAT.id,
    programId: null,
    folderId: null,
    episodeNumber: null,
    episodeDescription: null,
    source: "upload",
    sourceUrl: null,
    mediaKind: "video",
    durationMs: null,
    status: "ready",
    prepProgress: null,
    picture: ready ? { width: 1280, height: 720 } : null,
    loudnessLufs: ready ? -24 : null,
    captions: o.code === "PGM" ? "generated" : "none",
    originalFilename: null,
    rights: { basis: "made_it", confirmedBy: "Kai M.", confirmedAt: at("-20 12:00"), note: null },
    offerable: true,
    breakPointsMs: [],
    storage: ready ? { contentId: `bafy${String(n).padStart(4, "0")}3xq7`, bytes: 420_000_000, sharedWith: 0, locked: false, ipfs: null } : null,
    createdAt: at("-10 12:00"),
    ...o
  };
}

const LENGTHS = [28, 29, 27, 29, 28, 30, 28, 29, 27, 28, 29, 28, 29, 28, 29];
const lateCrate = LENGTHS.map((m, i) =>
  item({
    title: `Late Crate, ep. ${i + 1}`,
    code: "PGM",
    programId: PROGRAM_IDS.lateCrate,
    folderId: FOLDERS.lateCrate,
    episodeNumber: i + 1,
    episodeDescription: i === 14 ? "Tonight's crate: Inland Empire soul 45s, flipped live." : null,
    durationMs: i === 13 ? ms(28, 30) : i === 14 ? ms(29, 10) : ms(m, 10),
    breakPointsMs: [ms(14)],
    createdAt: at(`-${(15 - i) * 7} 12:00`),
    originalFilename: `late-crate-${String(i + 1).padStart(2, "0")}.mp4`
  })
);
// Episode 15 was uploaded September 24 (04.1: "Program, 29:10. Uploaded September 24.").
lateCrate[14].createdAt = at("-2 14:00");
lateCrate[14].storage = { contentId: "bafy2q8…3xq7", bytes: 612_000_000, sharedWith: 1, locked: false, ipfs: null };

const crateSessions = [
  item({ title: "Crate Session 01", code: "PGM", programId: PROGRAM_IDS.crateSession, folderId: FOLDERS.crateSessions, episodeNumber: 1, durationMs: ms(118, 30), breakPointsMs: [ms(30), ms(60), ms(90)] }),
  item({ title: "Crate Session 02", code: "PGM", programId: PROGRAM_IDS.crateSession, folderId: FOLDERS.crateSessions, episodeNumber: 2, durationMs: ms(119, 40), breakPointsMs: [ms(30), ms(60), ms(90)] }),
  // Imported from a link: rights to confirm before it can air (A.3), and never offerable.
  item({ title: "Crate Session 03", code: "PGM", programId: PROGRAM_IDS.crateSession, folderId: FOLDERS.crateSessions, episodeNumber: 3, durationMs: ms(58, 40), source: "link", sourceUrl: "https://archive.org/details/crate-session-03", rights: null, offerable: false })
];

const crateTalk = [1, 2, 3, 4, 5, 6].map((i) =>
  item({ title: `Crate Talk, ep. ${i}`, code: "PGM", programId: PROGRAM_IDS.crateTalk, folderId: FOLDERS.crateTalk, episodeNumber: i, durationMs: ms(44, 20), mediaKind: i > 4 ? "audio" : "video", picture: i > 4 ? null : { width: 1280, height: 720 } })
);

const spotsIds = [
  item({ title: "BEAT station ID", code: "SID", folderId: FOLDERS.spotsIds, durationMs: ms(0, 5), createdAt: at("12:00") }),
  item({ title: "BEAT station ID, night", code: "SID", folderId: FOLDERS.spotsIds, durationMs: ms(0, 5) }),
  item({ title: "Made possible by members", code: "UND", folderId: FOLDERS.spotsIds, durationMs: ms(0, 15), createdAt: at("12:00") }),
  item({ title: "Redlands Hardware, underwriting", code: "UND", folderId: FOLDERS.spotsIds, durationMs: ms(0, 15) })
];

const bumpers = [
  item({ title: "Beat Tape Live, trailer", code: "BMP", folderId: FOLDERS.bumpers, durationMs: ms(0, 10), createdAt: at("12:00") }),
  item({ title: "Back to the reel", code: "BMP", folderId: FOLDERS.bumpers, durationMs: ms(0, 10), createdAt: at("12:00") })
];

const loose = [item({ title: "Beat Tape Live, September 19", code: "PGM", programId: PROGRAM_IDS.beatTapeLive, durationMs: ms(57), createdAt: at("-7 22:00") })];

// A242: what airs when BEAT signs off and back on. `code` is the old code apps built before read.
const identity = [
  item({ title: "BEAT goodnight", code: "SID", identCode: "CLS", durationMs: ms(0, 8), createdAt: at("-3 12:00"), originalFilename: "beat-goodnight.mp4" }),
  item({ title: "BEAT test card", code: "OPEN", identCode: "OFF", still: true, durationMs: null, picture: { width: 1920, height: 1080 }, loudnessLufs: null, createdAt: at("-3 12:00"), originalFilename: "beat-test-card.png" }),
  item({ title: "BEAT sign-on", code: "SID", identCode: "OPN", durationMs: ms(0, 6), createdAt: at("-3 12:00"), originalFilename: "beat-sign-on.mp4" })
];

// Inland Sound Lab's library: 18 items across its three programs (market 04.1: "Library 18").
const lab = [
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => item({ stationId: LAB.id, title: `Crate Diggers Radio Hour, ep. ${i}`, code: "PGM", programId: PROGRAM_IDS.crateDiggers, episodeNumber: i, durationMs: ms(58, 30), mediaKind: "audio", picture: null, breakPointsMs: [ms(29)], rights: { basis: "made_it", confirmedBy: "Sam T.", confirmedAt: at("-90 12:00"), note: null } })),
  ...[1, 2, 3, 4, 5, 6].map((i) => item({ stationId: LAB.id, title: `Studio Notes, ep. ${i}`, code: "PGM", programId: PROGRAM_IDS.studioNotes, episodeNumber: i, durationMs: ms(28, 40), rights: { basis: "made_it", confirmedBy: "Sam T.", confirmedAt: at("-40 12:00"), note: null } })),
  ...[1, 2, 3, 4].map((i) => item({ stationId: LAB.id, title: `Loops for Late Nights, ep. ${i}`, code: "PGM", programId: PROGRAM_IDS.loops, episodeNumber: i, durationMs: ms(59, 50), mediaKind: "audio", picture: null, rights: { basis: "made_it", confirmedBy: "Sam T.", confirmedAt: at("-75 12:00"), note: null } }))
];

export function seedLibrary(): { items: LibraryItem[]; folders: Folder[]; programs: Program[] } {
  const items = [...lateCrate, ...crateSessions, ...crateTalk, ...spotsIds, ...bumpers, ...loose, ...identity, ...lab].map((i) => structuredClone(i));
  const count = (f: string) => items.filter((i) => i.folderId === f).length;
  const folders: Folder[] = [
    { id: FOLDERS.lateCrate, name: "Late Crate", parentFolderId: null, itemCount: count(FOLDERS.lateCrate) },
    { id: FOLDERS.crateSessions, name: "Crate Sessions", parentFolderId: null, itemCount: count(FOLDERS.crateSessions) },
    { id: FOLDERS.crateTalk, name: "Crate Talk", parentFolderId: null, itemCount: count(FOLDERS.crateTalk) },
    { id: FOLDERS.spotsIds, name: "Spots and IDs", parentFolderId: null, itemCount: count(FOLDERS.spotsIds) },
    { id: FOLDERS.bumpers, name: "Bumpers", parentFolderId: null, itemCount: count(FOLDERS.bumpers) }
  ];
  const program = (id: string, title: string, o: Partial<Program> = {}): Program => ({
    id,
    station: BEAT,
    title,
    description: null,
    category: "Music",
    advisory: "none",
    live: false,
    attribution: null,
    rightsNote: null,
    episodeCount: items.filter((i) => i.programId === id).length,
    listingStatus: "complete",
    ...o
  });
  const programs: Program[] = [
    program(PROGRAM_IDS.lateCrate, "Late Crate", { description: "One producer, one crate of records, one hour." }),
    program(PROGRAM_IDS.crateSession, "Crate Session", { description: "Sessions from the Inland Beat library." }),
    program(PROGRAM_IDS.crateTalk, "Crate Talk", { description: "Producers talk through a record, live.", live: true, listingStatus: "needs_description" }),
    program(PROGRAM_IDS.beatTapeLive, "Beat Tape Live", { description: "Producers play unreleased tapes and talk through how they were made. Live from the Redlands studio.", live: true }),
    program(PROGRAM_IDS.crateDiggers, "Crate Diggers Radio Hour", { station: LAB, description: "Producers dig through a crate of records, one hour at a time." }),
    program(PROGRAM_IDS.studioNotes, "Studio Notes", { station: LAB, description: "Short visits to producers' home studios." }),
    program(PROGRAM_IDS.loops, "Loops for Late Nights", { station: LAB, description: "Long, slow loops for the small hours." })
  ];
  return { items, folders, programs };
}

