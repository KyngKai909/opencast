// library: items, folders, programs. The Live and programming area owns this file.

import { http } from "msw";
import { libraryApi } from "@opencast/contracts";
import { getDb } from "../db";
import { needsUser, path, reply } from "../respond";

export const libraryHandlers = [
  http.get(path(libraryApi.getLibrary), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const lib = getDb().library;
    const items = lib.items.filter((i) => i.stationId === String(params.stationId));
    return reply(libraryApi.getLibrary.response, {
      items,
      folders: lib.folders,
      programs: lib.programs.filter((pr) => pr.station.id === String(params.stationId)),
      needsAttention: { rightsToConfirm: items.filter((i) => !i.rights).length, preparing: items.filter((i) => i.status === "preparing").length },
      importedFromLinks: items.filter((i) => i.source === "link").length
    });
  })
];
