import { blocksApi, libraryApi as api } from "@opencast/contracts";
import type { ModuleContext } from "../../context.js";
import type { RouteRegistrar } from "../../http.js";
import { notFound } from "../../errors.js";
import { FORM_FILE_MAX_BYTES, FORM_FILE_TOO_BIG, LOGO_MAX_BYTES, LOGO_TOO_BIG } from "../../formUploads.js";

export function libraryRoutes(r: RouteRegistrar, { services }: ModuleContext) {
  const { library, accounts } = services;
  const staff = ["owner", "operator"] as const;
  const canEditStation = (user: Parameters<typeof accounts.requireStation>[0], stationId: string) =>
    accounts.requireStation(user, stationId, [...staff]);

  // A244: programming blocks.
  r.handle(blocksApi.listBlocks, async ({ user, params }) => {
    await canEditStation(user, params.stationId);
    return { blocks: await library.blocks.list(params.stationId) };
  });
  r.handle(blocksApi.getBlock, async ({ user, params }) => {
    await canEditStation(user, params.stationId);
    return library.blocks.get(params.stationId, params.blockId);
  });
  r.handle(blocksApi.createBlock, async ({ user, params, body }) => {
    await canEditStation(user, params.stationId);
    return library.blocks.create(params.stationId, body);
  });
  r.handle(blocksApi.updateBlock, async ({ user, params, body }) => {
    await canEditStation(user, params.stationId);
    return library.blocks.update(params.stationId, params.blockId, body);
  });
  r.handle(blocksApi.uploadBlockLogo, ({ params, file }) => library.blocks.uploadLogo(params.stationId, params.blockId, file), {
    maxBytes: LOGO_MAX_BYTES,
    tooBig: LOGO_TOO_BIG,
    authorize: ({ user, params }) => canEditStation(user, params.stationId)
  });
  r.handle(blocksApi.archiveBlock, async ({ user, params, query }) => {
    await canEditStation(user, params.stationId);
    return library.blocks.archive(params.stationId, params.blockId, Boolean(query.takeOffLog));
  });

  r.handle(api.getLibrary, async ({ user, params, query }) => {
    await canEditStation(user, params.stationId);
    // The generated station ID (added 2026-09-29), while the station has none of its own that can air.
    const [view, generatedStationId] = await Promise.all([library.library(params.stationId, query), services.playout.generatedStationId(params.stationId)]);
    return { ...view, generatedStationId };
  });
  r.handle(api.upload, ({ params, body, file }) => library.upload(params.stationId, file!, body), {
    maxBytes: FORM_FILE_MAX_BYTES,
    tooBig: FORM_FILE_TOO_BIG,
    // The item's fields, its break points one field each, and a caption file's text (up to
    // 1,048,576 characters: 4 MiB of UTF-8 at most).
    fields: 100,
    fieldBytes: 4 * 1024 ** 2,
    authorize: ({ user, params }) => canEditStation(user, params.stationId)
  });
  r.handle(api.importLinks, async ({ user, params, body }) => {
    await canEditStation(user, params.stationId);
    return library.importLinks(params.stationId, body);
  });
  r.handle(api.getImport, async ({ user, params }) => {
    await canEditStation(user, params.stationId);
    return library.importJob(params.stationId, params.jobId);
  });
  r.handle(api.getItem, async ({ user, params }) => {
    await canEditStation(user, await library.stationOfItem(params.itemId));
    return library.item(params.itemId);
  });
  r.handle(api.updateItem, async ({ user, params, body }) => {
    await canEditStation(user, await library.stationOfItem(params.itemId));
    return library.updateItem(params.itemId, body);
  });
  r.handle(api.deleteItem, async ({ user, params }) => {
    await canEditStation(user, await library.stationOfItem(params.itemId));
    await library.archiveItem(params.itemId);
    return { ok: true as const };
  });
  r.handle(api.exportToIpfs, async ({ user, params }) => {
    // The owner's call alone: it can't be taken back.
    await accounts.requireStation(user, await library.stationOfItem(params.itemId), ["owner"]);
    return library.exportToIpfs(params.itemId);
  });
  r.handle(api.confirmRights, async ({ user, params, body }) => {
    await canEditStation(user, await library.stationOfItem(params.itemId));
    return library.confirmRights(user, params.itemId, body);
  });

  r.handle(api.createFolder, async ({ user, params, body }) => {
    await canEditStation(user, params.stationId);
    return library.createFolder(params.stationId, body);
  });
  r.handle(api.updateFolder, async ({ user, params, body }) => {
    await canEditStation(user, await library.stationOfFolder(params.folderId));
    return library.updateFolder(params.folderId, body);
  });
  r.handle(api.deleteFolder, async ({ user, params }) => {
    await canEditStation(user, await library.stationOfFolder(params.folderId));
    await library.deleteFolder(params.folderId);
    return { ok: true as const };
  });

  r.handle(api.createProgram, async ({ user, params, body }) => {
    await canEditStation(user, params.stationId);
    return library.createProgram(params.stationId, body);
  });
  r.handle(api.updateProgram, async ({ user, params, body }) => {
    await canEditStation(user, await library.stationOfProgram(params.programId));
    return library.updateProgram(params.programId, body);
  });
  // L5: an item's history.
  r.handle(api.getItemHistory, async ({ user, params }) => {
    await canEditStation(user, await library.stationOfItem(params.itemId));
    return library.history(params.itemId);
  });
  // L6: replace the file.
  r.handle(api.replaceFile, ({ params, file }) => library.replaceFile(params.itemId, file), {
    maxBytes: FORM_FILE_MAX_BYTES,
    tooBig: FORM_FILE_TOO_BIG,
    authorize: async ({ user, params }) => canEditStation(user, await library.stationOfItem(params.itemId))
  });
  // L7: captions on a program, and an item's caption track.
  r.handle(api.updateProgramCaptions, async ({ user, params, body }) => {
    await canEditStation(user, await library.stationOfProgram(params.programId));
    return library.setProgramCaptions(params.programId, body);
  });
  r.handle(api.getCaptionTrack, async ({ user, params }) => {
    await canEditStation(user, await library.stationOfItem(params.itemId));
    return library.captionTrack(params.itemId);
  });
  r.handle(api.putCaptionTrack, async ({ user, params, body }) => {
    await canEditStation(user, await library.stationOfItem(params.itemId));
    return library.putCaptionTrack(params.itemId, user.id, body);
  });
  r.handle(api.removeCaptionTrack, async ({ user, params }) => {
    await canEditStation(user, await library.stationOfItem(params.itemId));
    await library.removeCaptionTrack(params.itemId);
    return { ok: true as const };
  });

  r.handle(api.getProgram, async ({ user, params }) => {
    const program = await library.program(params.programId);
    // Nothing is public until the station signs on; its own team can look before that.
    if (!(await services.stations.isPublic(program.station.id))) {
      if (!user || !(await accounts.stationRole(user, program.station.id))) throw notFound("That program");
    }
    const [episodes, upcoming, format] = await Promise.all([library.episodes(params.programId), services.log.upcomingForProgram(params.programId, 10), library.format(params.programId)]);
    const idents = await services.stations.idents(upcoming.map((u) => u.stationId));
    return {
      ...program,
      format,
      episodes: episodes.map((e) => ({ id: e.id, title: e.title, episodeNumber: e.episodeNumber, durationMs: e.durationMs })),
      upcoming: upcoming.flatMap((u) => {
        const station = idents.get(u.stationId);
        return station ? [{ logEntryId: u.id, startsAt: u.startsAt, station }] : [];
      })
    };
  });
}
