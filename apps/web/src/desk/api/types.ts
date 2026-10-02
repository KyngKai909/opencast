// Named parts of the contract's network types, as the desk passes them around. Everything here is
// the contract's own shape (@opencast/contracts); the desk's proposed fields all landed on
// 2026-09-28 (docs/contracts-changelog.md), so there's no extension left to keep.

import type { HeldEarnings, MarketBoard, Recipe, RecipeBreakRule } from "@opencast/contracts";
import type { z } from "zod";

/** A channel on the board. */
export type BoardSlot = MarketBoard["slots"][number];
/** A block of a recipe's day. */
export type RecipeBlock = Recipe["blocks"][number];
/** A station holding money for its creator. */
export type HeldStation = HeldEarnings["stations"][number];
/** A recipe's break rule, typed (N6: `Recipe.breakRule` read with `RecipeBreakRule`). */
export type BreakRule = z.infer<typeof RecipeBreakRule>;
