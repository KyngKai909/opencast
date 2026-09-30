// Direct uploads (contracts of 2026-09-30, follow-up Phase 4): the mock's parts, resume and
// "Checking" come from @opencast/ui/upload/mock; what each file becomes is decided here, with the
// work this mock's old form endpoints do (library upload, replace file, relay background, a
// production order's delivery), so an upload makes exactly what those mocks make. A caption file
// marks the item's captions as uploaded.

import { HttpResponse } from "msw";
import { mockUploadHandlers } from "@opencast/ui/upload/mock";
import { getDb, saveDb } from "../db";
import { fail, needsUser } from "../respond";
import { mockLibraryUpload, mockReplaceFile } from "./library";
import { roleOn } from "./log";
import { mockSetRelayBackground } from "./relayBackground";
import { mockDeliverOrder } from "./spots";

export const uploadHandlers = mockUploadHandlers({
  who: (request) => needsUser(request),
  fail: (status, code, message) => fail(status, code, message),
  check(request, purpose) {
    if (purpose.kind !== "library_item" && purpose.kind !== "relay_background") return null;
    const r = roleOn(request, purpose.stationId, ["owner", "operator"]);
    if (r instanceof Response) return r;
    if (purpose.kind === "relay_background" && r.station.ident.band !== "radio") return fail(409, "not_radio", "Backgrounds are for radio stations' relays. A TV station relays its own picture.");
    return null;
  },
  async finish(purpose, file, request) {
    switch (purpose.kind) {
      case "library_item": {
        const f = purpose.fields ?? {};
        const res = mockLibraryUpload(request, purpose.stationId, file, { title: f.title, code: f.code, folderId: f.folderId });
        const item = res.ok ? ((await res.clone().json()) as { id: string }) : null;
        return { res, state: "preparing", result: item ? { itemId: item.id, stationId: purpose.stationId } : null };
      }
      case "library_replace":
        return { res: mockReplaceFile(request, purpose.itemId, file), state: "preparing", result: { itemId: purpose.itemId } };
      case "caption": {
        const item = getDb().library.items.find((i) => i.id === purpose.itemId);
        if (!item) return { res: fail(404, "not_found", "That item wasn't found."), state: "done", result: null };
        item.captions = "uploaded";
        saveDb();
        return { res: HttpResponse.json({ ok: true }), state: "done", result: { itemId: purpose.itemId } };
      }
      case "relay_background":
        return { res: mockSetRelayBackground(request, purpose.stationId, file), state: "preparing", result: { stationId: purpose.stationId } };
      case "order_file":
        if (purpose.role === "brief") return { res: fail(404, "not_found", "Briefs are the business's."), state: "done", result: null };
        return { res: mockDeliverOrder(request, purpose.orderId), state: "preparing", result: { orderId: purpose.orderId } };
      case "spot_file":
        return { res: fail(404, "not_found", "Spots are uploaded in the business app."), state: "done", result: null };
    }
  }
});
