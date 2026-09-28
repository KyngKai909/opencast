// Every mock handler, one file per area (see each file's header for who owns it). The first
// handler to match a request answers it.

import { accountsHandlers } from "./accounts";
import { earningsHandlers } from "./earnings";
import { libraryHandlers } from "./library";
import { liveHandlers } from "./live";
import { logHandlers } from "./log";
import { marketHandlers } from "./market";
import { onairHandlers } from "./onair";
import { spotsHandlers } from "./spots";
import { stationHandlers } from "./station";
import { stationsHandlers } from "./stations";

export const handlers = [
  ...accountsHandlers,
  ...stationsHandlers,
  ...onairHandlers,
  ...logHandlers,
  ...liveHandlers,
  ...libraryHandlers,
  ...marketHandlers,
  ...spotsHandlers,
  ...earningsHandlers,
  ...stationHandlers
];
