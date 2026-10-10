// Programming Phase 6: network licences and each one's monthly minutes. Anyone on the desk reads
// them; rights reviewers and admins make and change them, as in the API.
import { http, type HttpHandler } from "msw";
import { licencesApi, outletsWithOpencast, type NetworkLicenceInput } from "@opencast/contracts";
import { now } from "../../../lib/clock";
import { checkInput, licencesDb, licencesView, licenceView, minutesCsv, minutesView, nextLicenceId, saveLicences } from "../licencesDb";
import { bodyOf, fail, lacks, needsDesk, path, reply } from "../respond";

const find = (id: string) => licencesDb().licences.find((l) => l.id === id);
const monthOf = (url: string) => new URL(url).searchParams.get("month") ?? now().toISOString().slice(0, 7);

export const licencesHandlers: HttpHandler[] = [
  http.get(path(licencesApi.listLicences), ({ request }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    return reply(licencesApi.listLicences.response, licencesView());
  }),

  http.get(path(licencesApi.getLicence), ({ request, params }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    const l = find(String(params.licenceId));
    if (!l) return fail(404, "not_found", "That licence wasn't found.");
    return reply(licencesApi.getLicence.response, licenceView(l));
  }),

  http.post(path(licencesApi.createLicence), async ({ request }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    const no = lacks(p, "rights");
    if (no) return no;
    const body = await bodyOf<NetworkLicenceInput>(request);
    if (!body?.licensor?.trim()) return fail(400, "bad_request", "Check the form: say who licenses it.", { licensor: "Required" });
    const wrong = checkInput(body);
    if (wrong) return fail(400, "bad_request", wrong.message, wrong.fields);
    const l = {
      id: nextLicenceId(),
      licensor: body.licensor.trim(),
      name: body.name?.trim() || null,
      outlets: outletsWithOpencast(body.outlets),
      worldwide: body.worldwide,
      countries: body.worldwide ? [] : [...new Set(body.countries)],
      startsOn: body.startsOn,
      endsOn: body.endsOn,
      deal: body.deal,
      notes: body.notes?.trim() || null,
      programIds: body.programIds ?? [],
      itemIds: body.itemIds ?? [],
      updatedAt: now().toISOString()
    };
    licencesDb().licences.push(l);
    saveLicences();
    return reply(licencesApi.createLicence.response, licenceView(l), 201);
  }),

  http.patch(path(licencesApi.updateLicence), async ({ request, params }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    const no = lacks(p, "rights");
    if (no) return no;
    const l = find(String(params.licenceId));
    if (!l) return fail(404, "not_found", "That licence wasn't found.");
    const body = (await bodyOf<Partial<NetworkLicenceInput>>(request)) ?? {};
    const merged = { startsOn: body.startsOn ?? l.startsOn, endsOn: body.endsOn ?? l.endsOn, worldwide: body.worldwide ?? l.worldwide, countries: body.countries ?? l.countries };
    const wrong = checkInput(merged);
    if (wrong) return fail(400, "bad_request", wrong.message, wrong.fields);
    Object.assign(l, {
      ...(body.licensor !== undefined ? { licensor: body.licensor.trim() } : {}),
      ...(body.name !== undefined ? { name: body.name?.trim() || null } : {}),
      ...(body.outlets !== undefined ? { outlets: outletsWithOpencast(body.outlets) } : {}),
      ...(body.deal ? { deal: body.deal } : {}),
      ...(body.notes !== undefined ? { notes: body.notes?.trim() || null } : {}),
      ...(body.programIds !== undefined ? { programIds: body.programIds } : {}),
      ...(body.itemIds !== undefined ? { itemIds: body.itemIds } : {}),
      ...merged,
      countries: merged.worldwide ? [] : [...new Set(merged.countries)],
      updatedAt: now().toISOString()
    });
    saveLicences();
    return reply(licencesApi.updateLicence.response, licenceView(l));
  }),

  http.get(path(licencesApi.licenceMinutes), ({ request, params }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    const l = find(String(params.licenceId));
    if (!l) return fail(404, "not_found", "That licence wasn't found.");
    return reply(licencesApi.licenceMinutes.response, minutesView(l, monthOf(request.url)));
  }),

  http.get(path(licencesApi.licenceMinutesCsv), ({ request, params }) => {
    const p = needsDesk(request);
    if (p instanceof Response) return p;
    const l = find(String(params.licenceId));
    if (!l) return fail(404, "not_found", "That licence wasn't found.");
    return reply(licencesApi.licenceMinutesCsv.response, minutesCsv(minutesView(l, monthOf(request.url))));
  })
];
