// One command stream for TV mode, whichever input it comes from (the TV's remote, a phone over
// Cast, the iPhone bridge). With the picture showing, the player takes channel, numbers, OK and
// the rest; what it doesn't own (guide, menu, presets, Back with nothing to clear) opens the
// overlays. With an overlay up, the arrows move focus, OK chooses, Back closes, and channel keys
// still change channel underneath (the picture keeps playing).
//
// Screens can take commands first with a layer (useCommandLayer): the presets strip takes 1 to 6,
// the guide takes CH to page and numbers to jump, the off-air screen and the reminder card take
// the arrows and OK on the picture. The newest active layer goes first; returning true means
// handled, anything else falls through to the routing below.

import { useEffect, useRef } from "react";
import type { Command, CommandSource, PlayerEngine } from "@opencast/player";
import { moveFocus, pressFocused } from "./focus";

export type LayerHandler = (c: Command, source?: CommandSource) => boolean | void;

export interface LayerOptions {
  /** Whether the layer is up (default true). */
  active?: boolean;
  /**
   * How the remote's keys read while this layer is up, on the picture: "overlay" makes the arrows
   * move focus (the layer then turns ▲ ▼ into channel changes itself if it wants them). Default:
   * the page's own ("picture" on /, "overlay" elsewhere).
   */
  keys?: "picture" | "overlay";
}

interface Layer {
  handle: { current: LayerHandler };
  keys?: "picture" | "overlay";
}

const layers: Layer[] = [];

/** Take commands before the default routing while `active`. */
export function useCommandLayer(handle: LayerHandler, o: LayerOptions = {}) {
  const ref = useRef(handle);
  ref.current = handle;
  const active = o.active ?? true;
  useEffect(() => {
    if (!active) return;
    const layer: Layer = { handle: ref, keys: o.keys };
    layers.push(layer);
    return () => {
      const i = layers.indexOf(layer);
      if (i >= 0) layers.splice(i, 1);
    };
  }, [active, o.keys]);
}

/** Test helper: drop every layer. */
export function clearLayers() {
  layers.length = 0;
}

export interface Ui {
  /** Where TV mode is: "/" is the picture; anything else is an overlay (or first launch). */
  path(): string;
  go(path: string, o?: { replace?: boolean }): void;
  /** Close the overlay: back to where it opened from (history), or the picture. */
  close(): void;
}

const OVERLAY_OF: Partial<Record<Command["type"], string>> = { guide: "/guide", menu: "/menu", presets: "/presets" };

/** Commands with the picture showing that the engine passed on (onCommand). */
export function onPictureCommand(c: Command, ui: Ui, engine: PlayerEngine, source?: CommandSource) {
  const to = OVERLAY_OF[c.type];
  if (to) return ui.go(to);
  switch (c.type) {
    case "back":
      // Back on the picture: the last channel.
      return engine.handle({ type: "last" }, source);
    case "focus":
      // A phone sending arrows while the picture shows: they mean what the remote's arrows mean.
      if (c.dir === "up" || c.dir === "down") return engine.handle({ type: "channel", dir: c.dir }, source);
      return ui.go(c.dir === "left" ? "/presets" : "/menu");
  }
}

/** Every command, from every input. */
export function dispatch(c: Command, source: CommandSource | undefined, ui: Ui, engine: PlayerEngine) {
  for (let i = layers.length - 1; i >= 0; i--) if (layers[i]!.handle.current(c, source) === true) return;
  const path = ui.path();
  if (path === "/") return engine.handle(c, source);
  switch (c.type) {
    case "focus":
      return moveFocus(c.dir);
    case "select":
      pressFocused();
      return;
    case "back":
      return ui.close();
    case "guide":
    case "menu":
    case "presets": {
      // The same key again closes its overlay; another opens in its place.
      const to = OVERLAY_OF[c.type]!;
      return path.startsWith(to) ? ui.close() : ui.go(to, { replace: true });
    }
    case "info":
    case "digit":
    case "dot":
      // Numbers belong to the overlay (a layer takes them); without one they do nothing.
      return;
    default:
      // Channel, tune, presets by number, pause, sleep: the player, underneath the overlay.
      return engine.handle(c, source);
  }
}

/** The keyboard adapter's context: arrows change channel on the picture, move focus elsewhere. */
export function contextFor(path: string): "picture" | "overlay" {
  for (let i = layers.length - 1; i >= 0; i--) if (layers[i]!.keys) return layers[i]!.keys!;
  return path === "/" ? "picture" : "overlay";
}
