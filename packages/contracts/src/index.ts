import { z } from "zod";

// Request and response schemas shared by the apps and the API. Owned by the
// platform prompt; the apps prompt reads these and never edits them. Changes to
// a published shape go in docs/contracts-changelog.md as a new version or field.

export const HealthResponse = z.object({
  ok: z.literal(true),
  service: z.string(),
  at: z.string()
});
export type HealthResponse = z.infer<typeof HealthResponse>;
