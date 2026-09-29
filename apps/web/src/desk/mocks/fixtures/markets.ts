// The desk's markets, the one mock world's (the viewer's market list has the same ids): the Inland
// Empire (every frame), High Desert (a few stations), Los Angeles (open on the viewer's list, but
// nothing on the desk's board yet).
import type { Market } from "@opencast/contracts";
import { U } from "./ids";

export const IE: Market = { id: U(90001), slug: "inland-empire", name: "Inland Empire", timezone: "America/Los_Angeles", open: true };
export const LA: Market = { id: U(90002), slug: "los-angeles", name: "Los Angeles", timezone: "America/Los_Angeles", open: true };
export const HD: Market = { id: U(90003), slug: "high-desert", name: "High Desert", timezone: "America/Los_Angeles", open: true };

export const MARKETS: Market[] = [IE, HD, LA];
