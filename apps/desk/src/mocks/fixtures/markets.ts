// The desk's markets: the Inland Empire (every frame), High Desert (a few stations), Los Angeles
// (not open yet, nothing on it).
import type { Market } from "@opencast/contracts";
import { U } from "./ids";

export const IE: Market = { id: U(1), slug: "inland-empire", name: "Inland Empire", timezone: "America/Los_Angeles", open: true };
export const HD: Market = { id: U(2), slug: "high-desert", name: "High Desert", timezone: "America/Los_Angeles", open: true };
export const LA: Market = { id: U(3), slug: "los-angeles", name: "Los Angeles", timezone: "America/Los_Angeles", open: false };

export const MARKETS: Market[] = [IE, HD, LA];
