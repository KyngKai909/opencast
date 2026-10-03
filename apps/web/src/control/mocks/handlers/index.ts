// Every mock handler, one file per area (see each file's header for who owns it). The first
// handler to match a request answers it.

import { accountHandlers } from "./account";
import { blockHandlers } from "./blocks";
import { accountsHandlers } from "./accounts";
import { earningsHandlers } from "./earnings";
import { libraryHandlers } from "./library";
import { liveHandlers } from "./live";
import { logHandlers } from "./log";
import { marketHandlers } from "./market";
import { onairHandlers } from "./onair";
import { platformHandlers } from "./platforms";
import { relayBackgroundHandlers } from "./relayBackground";
import { relayHandlers } from "./relay";
import { spotsHandlers } from "./spots";
import { stationHandlers } from "./station";
import { stationsHandlers } from "./stations";
import { templateHandlers } from "./templates";
import { uploadHandlers } from "./uploads";

export const handlers = [
  ...accountsHandlers,
  ...stationsHandlers,
  ...onairHandlers,
  ...templateHandlers,
  ...logHandlers,
  ...liveHandlers,
  ...libraryHandlers,
  ...blockHandlers,
  ...marketHandlers,
  ...spotsHandlers,
  ...earningsHandlers,
  ...accountHandlers,
  ...stationHandlers,
  ...relayBackgroundHandlers,
  ...relayHandlers,
  ...platformHandlers,
  ...uploadHandlers
];
