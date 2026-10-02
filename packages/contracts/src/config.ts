// The apps' public configuration (added 2026-09-29, follow-up Phase 1): switches the viewer apps
// read at start, set in the rules registry (Network desk, Settings, Rules), so a feature can be
// turned on without a deploy.

import { z } from "zod";
import { endpoint } from "./core.js";

export const AppConfig = z.object({
  features: z.object({
    /** The "Not for me" control in the viewer's player (`features.not_for_me`, off by default). */
    notForMe: z.boolean()
  })
});
export type AppConfig = z.infer<typeof AppConfig>;

export const configApi = {
  getConfig: endpoint({
    method: "GET",
    path: "/config",
    auth: "public",
    summary: "The viewer apps' switches (features on or off), from the rules registry",
    response: AppConfig
  })
};
