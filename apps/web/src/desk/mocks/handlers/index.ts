// Every mock handler, one file per area. The first handler to match a request answers it.
import { accountsHandlers } from "./accounts";
import { analyticsHandlers } from "./analytics";
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
import { licencesHandlers } from "./licences";
import { deskInviteHandlers } from "../../../mocks/invites";

export const handlers = [...analyticsHandlers, ...accountsHandlers, ...boardHandlers, ...creatorHandlers, ...listedHandlers, ...heldHandlers, ...settingsHandlers, ...storageHandlers, ...shelfHandlers, ...licencesHandlers, ...sponsorsHandlers, ...claimsHandlers, ...reservedHandlers, ...deskInviteHandlers, ...mockHandlers];
