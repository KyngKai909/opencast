// Direct uploads (contracts of 2026-09-30, follow-up Phase 4): the mock's parts, resume and
// "Checking" come from @opencast/ui/upload/mock; what each file becomes is decided here, with the
// work this mock's old form endpoints do (a spot's file and its checks, a file for a brief), so an
// upload makes exactly what those mocks make.

import { mockUploadHandlers } from "@opencast/ui/upload/mock";
import { fail, needsUser } from "../respond";
import { mockAttachBriefFile } from "./deals";
import { mockUploadSpotFile } from "./spots";

export const uploadHandlers = mockUploadHandlers({
  who: (request) => needsUser(request),
  fail: (status, code, message) => fail(status, code, message),
  async finish(purpose, file, request) {
    switch (purpose.kind) {
      case "spot_file":
        return { res: mockUploadSpotFile(request, purpose.spotId, file, purpose.scaleToFit ?? false), state: "preparing", result: { spotId: purpose.spotId } };
      case "order_file":
        if (purpose.role === "delivery") return { res: fail(403, "forbidden", "The station that makes it delivers it."), state: "done", result: null };
        return { res: mockAttachBriefFile(request, purpose.orderId, file), state: "done", result: { orderId: purpose.orderId } };
      default:
        return { res: fail(404, "not_found", "That's uploaded in master control."), state: "done", result: null };
    }
  }
});
