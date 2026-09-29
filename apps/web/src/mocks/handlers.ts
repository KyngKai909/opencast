// Every mock endpoint, for the one Mock Service Worker (`npm run dev:mock`): the endpoints more
// than one area answers, once (overlaps.ts), then each area's own (viewer/mocks, control/mocks,
// desk/mocks, one file per area of each). The first handler to match a request answers it.

import type { HttpHandler } from "msw";
import { handlers as controlHandlers } from "../control/mocks/handlers";
import { handlers as deskHandlers } from "../desk/mocks/handlers";
import { handlers as viewerHandlers } from "../viewer/mocks/handlers";
import { overlapHandlers } from "./overlaps";

export const handlers: HttpHandler[] = [...new Set<HttpHandler>([...overlapHandlers, ...viewerHandlers, ...controlHandlers, ...deskHandlers])];
