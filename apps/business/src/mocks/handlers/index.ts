// Every mock handler, one file per area (see each file's header for who owns it). The first
// handler to match a request answers it.

import { accountsHandlers } from "./accounts";
import { dealsHandlers } from "./deals";
import { moneyHandlers } from "./money";
import { resultsHandlers } from "./results";
import { settingsHandlers } from "./settings";
import { spotsHandlers } from "./spots";

export const handlers = [...accountsHandlers, ...moneyHandlers, ...spotsHandlers, ...resultsHandlers, ...dealsHandlers, ...settingsHandlers];
