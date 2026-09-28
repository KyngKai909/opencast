// Every mock handler. One file per area; each area adds its own file here.

import { accountsHandlers } from "./accounts";
import { libraryHandlers } from "./library";
import { logHandlers } from "./log";
import { spotsHandlers } from "./spots";
import { stationsHandlers } from "./stations";

export const handlers = [...accountsHandlers, ...stationsHandlers, ...logHandlers, ...libraryHandlers, ...spotsHandlers];
