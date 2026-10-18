// Zod compiles object parsers with `new Function` when it can, and finds out whether it can by
// trying. The site's CSP has no 'unsafe-eval', so the try is a CSP violation on every page that
// parses (Lighthouse's best practices count it). Jitless parsing is plenty fast for a form.
// Imported first by every module that builds or uses a schema.
import { config } from "zod";

config({ jitless: true });
