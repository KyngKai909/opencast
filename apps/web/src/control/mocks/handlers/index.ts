// Every mock handler, one file per area (see each file's header for who owns it). The first
// handler to match a request answers it.

import { accountHandlers } from "./account";
import { accountsHandlers } from "./accounts";
import { earningsHandlers } from "./earnings";
import { libraryHandlers } from "./library";
import { liveHandlers } from "./live";
import { logHandlers } from "./log";
import { marketHandlers } from "./market";
import { onairHandlers } from "./onair";
import { relayBackgroundHandlers } from "./relayBackground";
import { spotsHandlers } from "./spots";
import { stationHandlers } from "./station";
import { stationsHandlers } from "./stations";
import { templateHandlers } from "./templates";

export const handlers = [
  ...accountsHandlers,
  ...stationsHandlers,
  ...onairHandlers,
  ...templateHandlers,
  ...logHandlers,
  ...liveHandlers,
  ...libraryHandlers,
  ...marketHandlers,
  ...spotsHandlers,
  ...earningsHandlers,
  ...accountHandlers,
  ...stationHandlers,
  ...relayBackgroundHandlers
];
