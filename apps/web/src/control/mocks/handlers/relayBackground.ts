// A radio station's relay background (stations, contracts of 2026-09-29): upload, replace, remove.
// Kept in memory only (the picture is the browser's own object URL): "preparing" for a moment,
// then ready. TV stations are refused, as the API refuses them.

import { http, type HttpHandler } from "msw";
import { stationsApi, type RelayBackground } from "@opencast/contracts";
import { fail, path, reply } from "../respond";
import { roleOn } from "./log";

const backgrounds = new Map<string, RelayBackground>();
const PREPARING_MS = 1_500;

function current(stationId: string): RelayBackground | null {
  const bg = backgrounds.get(stationId);
  if (bg?.status === "preparing" && Date.now() - Date.parse(bg.updatedAt) > PREPARING_MS) bg.status = "ready";
  return bg ?? null;
}

/** Setting a background (the form endpoint's work, and a direct upload's once its parts are in). */
export function mockSetRelayBackground(request: Request, id: string, file: File | null): Response {
  const r = roleOn(request, id, ["owner", "operator"]);
  if (r instanceof Response) return r;
  if (r.station.ident.band !== "radio") return fail(409, "not_radio", "Backgrounds are for radio stations' relays. A TV station relays its own picture.");
  if (!file) return fail(400, "bad_request", "Choose an image, a GIF or a short video.");
  const kind = file.type === "image/gif" ? "gif" : file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : null;
  if (!kind) return fail(422, "wrong_file_type", "Use a PNG, JPEG or WebP image, a GIF, or an MP4, MOV or WebM video.");
  let url = "";
  try {
    url = URL.createObjectURL(file);
  } catch {
    // No object URLs (tests).
  }
  const bg: RelayBackground = {
    kind,
    fileName: file.name,
    status: "preparing",
    error: null,
    loopUrl: kind === "video" ? url : null,
    stillUrl: kind === "video" ? null : url,
    width: 1280,
    height: 720,
    durationMs: kind === "image" ? 2_000 : kind === "gif" ? 2_400 : 12_000,
    updatedAt: new Date().toISOString()
  };
  backgrounds.set(id, bg);
  return reply(stationsApi.setRelayBackground.response, bg);
}

export const relayBackgroundHandlers: HttpHandler[] = [
  http.get(path(stationsApi.getRelayBackground), ({ request, params }) => {
    const id = String(params.stationId);
    const r = roleOn(request, id, ["owner", "operator"]);
    if (r instanceof Response) return r;
    return reply(stationsApi.getRelayBackground.response, { background: current(id) });
  }),

  http.put(path(stationsApi.setRelayBackground), async ({ request, params }) => {
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    return mockSetRelayBackground(request, String(params.stationId), file instanceof File ? file : null);
  }),

  http.delete(path(stationsApi.removeRelayBackground), ({ request, params }) => {
    const id = String(params.stationId);
    const r = roleOn(request, id, ["owner", "operator"]);
    if (r instanceof Response) return r;
    backgrounds.delete(id);
    return reply(stationsApi.removeRelayBackground.response, { ok: true });
  })
];
