// Every mock handler, one file per area. The first handler to match a request answers it.
import { accountsHandlers } from "./accounts";
import { boardHandlers } from "./board";
import { creatorHandlers } from "./creators";
import { heldHandlers } from "./held";
import { listedHandlers } from "./listed";
import { mockHandlers } from "./mock";
import { settingsHandlers } from "./settings";
import { shelfHandlers } from "./shelf";

export const handlers = [...accountsHandlers, ...boardHandlers, ...creatorHandlers, ...listedHandlers, ...heldHandlers, ...settingsHandlers, ...shelfHandlers, ...mockHandlers];
