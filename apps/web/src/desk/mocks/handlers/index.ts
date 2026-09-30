// Every mock handler, one file per area. The first handler to match a request answers it.
import { accountsHandlers } from "./accounts";
import { boardHandlers } from "./board";
import { claimsHandlers } from "./claims";
import { creatorHandlers } from "./creators";
import { heldHandlers } from "./held";
import { listedHandlers } from "./listed";
import { mockHandlers } from "./mock";
import { reservedHandlers } from "./reserved";
import { settingsHandlers } from "./settings";
import { shelfHandlers } from "./shelf";
import { sponsorsHandlers } from "./sponsors";
import { storageHandlers } from "./storage";

export const handlers = [...accountsHandlers, ...boardHandlers, ...creatorHandlers, ...listedHandlers, ...heldHandlers, ...settingsHandlers, ...storageHandlers, ...shelfHandlers, ...sponsorsHandlers, ...claimsHandlers, ...reservedHandlers, ...mockHandlers];
