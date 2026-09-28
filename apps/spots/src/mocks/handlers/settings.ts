// the business profile (getBusiness, updateBusiness, locations), the team, notification prefs,
// connections, closing the account. The Settings area owns this file.

import { http, type HttpHandler } from "msw";
import { spotsApi } from "@opencast/contracts";
import { BusinessX } from "../../api/ext";
import { roleOn } from "../access";
import { dbBusiness } from "../db";
import { LOGOS } from "../fixtures/businesses";
import { fail, needsUser, path, reply } from "../respond";

export const settingsHandlers: HttpHandler[] = [
  http.get(path(spotsApi.getBusiness), ({ request, params }) => {
    const p = needsUser(request);
    if (p instanceof Response) return p;
    const id = String(params.businessId);
    const r = roleOn(id, p, "see");
    if (r instanceof Response) return r;
    const b = dbBusiness(id);
    if (!b) return fail(404, "not_found", "That business wasn't found.");
    return reply(BusinessX, { ...b, logoMark: LOGOS[id] });
  })
];
