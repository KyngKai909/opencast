// Every mock endpoint, one file per area of the app.
import { dialHandlers } from "./dial";
import { guideHandlers } from "./guide";
import { meHandlers } from "./me";
import { remoteHandlers } from "./remote";
import { searchHandlers } from "./search";
import { signInHandlers } from "./signIn";
import { stationHandlers } from "./station";
import { tvGuideHandlers } from "./tvGuide";
import { watchingHandlers } from "./watching";

// Area handlers first, so an area can answer a proposed endpoint before the shared ones.
export const handlers = [...watchingHandlers, ...tvGuideHandlers, ...signInHandlers, ...remoteHandlers, ...dialHandlers, ...guideHandlers, ...stationHandlers, ...searchHandlers, ...meHandlers];
