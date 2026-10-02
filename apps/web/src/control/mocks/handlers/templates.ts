// Day templates and off air hours (G8, G9): "Repeat this day" as a template (list, one, make,
// change, stop) and the station's off air hours, owners and operators only. The log reads both
// (handlers/log.ts); the rules and generation are in ../schedule.ts. The On air area owns this file.

import { http } from "msw";
import { logApi } from "@opencast/contracts";
import { getDb, saveDb } from "../db";
import { saveOnAirState } from "../fixtures/onair";
import { fail, path, reply } from "../respond";
import { createTemplate, offAirHoursOf, removeTemplate, templateById, templatesOf, templateView, TemplateInputError, updateTemplate } from "../schedule";
import { roleOn } from "./log";

const uuid = () => crypto.randomUUID();

function inputError(e: unknown) {
  if (e instanceof TemplateInputError) return fail(400, "bad_request", e.message, e.fields);
  throw e;
}

function saveAll() {
  saveDb();
  saveOnAirState();
}

export const templateHandlers = [
  http.get(path(logApi.listTemplates), ({ request, params }) => {
    const r = roleOn(request, String(params.stationId), ["owner", "operator"]);
    if (r instanceof Response) return r;
    const templates = templatesOf(r.station.ident.id)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(templateView);
    return reply(logApi.listTemplates.response, { templates });
  }),

  http.get(path(logApi.getTemplate), ({ request, params }) => {
    const r = roleOn(request, String(params.stationId), ["owner", "operator"]);
    if (r instanceof Response) return r;
    const t = templateById(r.station.ident.id, String(params.templateId));
    if (!t) return fail(404, "not_found", "That template wasn't found.");
    return reply(logApi.getTemplate.response, templateView(t));
  }),

  http.post(path(logApi.createTemplate), async ({ request, params }) => {
    const r = roleOn(request, String(params.stationId), ["owner", "operator"]);
    if (r instanceof Response) return r;
    const body = logApi.createTemplate.body!.safeParse(await request.json().catch(() => null));
    if (!body.success) return fail(400, "bad_request", "Say which day and how it repeats.");
    try {
      const made = createTemplate(r.station.ident.id, { ...body.data, until: body.data.until ?? null });
      saveAll();
      return reply(logApi.createTemplate.response, { template: templateView(made.template), generated: made.generated }, 201);
    } catch (e) {
      return inputError(e);
    }
  }),

  http.patch(path(logApi.updateTemplate), async ({ request, params }) => {
    const r = roleOn(request, String(params.stationId), ["owner", "operator"]);
    if (r instanceof Response) return r;
    const t = templateById(r.station.ident.id, String(params.templateId));
    if (!t) return fail(404, "not_found", "That template wasn't found.");
    const body = logApi.updateTemplate.body!.safeParse(await request.json().catch(() => null));
    if (!body.success) return fail(400, "bad_request", "That change isn't complete.");
    // `entries` (a template edited entry by entry) has no screen yet; the mock takes a day's log (`fromDay`).
    if (body.data.entries) return fail(400, "bad_request", "Change the template from a day's log.", { entries: "Not in the mock" });
    try {
      const generated = updateTemplate(t, body.data);
      saveAll();
      return reply(logApi.updateTemplate.response, { template: templateView(t), generated });
    } catch (e) {
      return inputError(e);
    }
  }),

  http.delete(path(logApi.removeTemplate), ({ request, params }) => {
    const r = roleOn(request, String(params.stationId), ["owner", "operator"]);
    if (r instanceof Response) return r;
    const t = templateById(r.station.ident.id, String(params.templateId));
    if (!t) return fail(404, "not_found", "That template wasn't found.");
    const removed = removeTemplate(t);
    saveAll();
    return reply(logApi.removeTemplate.response, { removed });
  }),

  http.get(path(logApi.getOffAirHours), ({ request, params }) => {
    const r = roleOn(request, String(params.stationId), ["owner", "operator"]);
    if (r instanceof Response) return r;
    return reply(logApi.getOffAirHours.response, offAirHoursOf(r.station.ident.id));
  }),

  http.put(path(logApi.setOffAirHours), async ({ request, params }) => {
    const r = roleOn(request, String(params.stationId), ["owner", "operator"]);
    if (r instanceof Response) return r;
    const body = logApi.setOffAirHours.body!.safeParse(await request.json().catch(() => null));
    if (!body.success) return fail(400, "bad_request", "Up to seven rules, each with its days and two times.");
    const id = r.station.ident.id;
    const same = body.data.rules.findIndex((x) => x.signOffAt === x.backAt);
    if (same >= 0) return fail(400, "bad_request", "Sign off and back on can't be the same time.", { [`rules.${same}.backAt`]: "Same as sign off" });
    const db = getDb();
    db.offAirRules = [...db.offAirRules.filter((x) => x.stationId !== id), ...body.data.rules.map((x) => ({ id: uuid(), stationId: id, days: [...new Set(x.days)].sort(), signOffAt: x.signOffAt, backAt: x.backAt }))];
    saveDb();
    return reply(logApi.setOffAirHours.response, offAirHoursOf(id));
  })
];
