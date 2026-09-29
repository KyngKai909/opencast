// Every mock endpoint, one file per area of the app.
import { dialHandlers } from "./dial";
import { guideHandlers } from "./guide";
import { meHandlers } from "./me";
import { permissionHandlers } from "./permission";
import { searchHandlers } from "./search";
import { stationHandlers } from "./station";
import { tvHandlers } from "./tvs";

export const handlers = [...dialHandlers, ...guideHandlers, ...stationHandlers, ...searchHandlers, ...meHandlers, ...permissionHandlers];
// TVs on the account and the remote relay's pairing (B2).
handlers.push(...tvHandlers);
