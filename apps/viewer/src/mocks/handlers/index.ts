// Every mock endpoint, one file per area of the app.
import { dialHandlers } from "./dial";
import { guideHandlers } from "./guide";
import { meHandlers } from "./me";
import { searchHandlers } from "./search";
import { stationHandlers } from "./station";

export const handlers = [...dialHandlers, ...guideHandlers, ...stationHandlers, ...searchHandlers, ...meHandlers];
