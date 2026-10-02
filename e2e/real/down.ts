// Stops a run left behind (an interrupted real:up or test run): the API stops, the database goes.
import { stopRun } from "./run.js";

await stopRun();
console.log("Stopped.");
