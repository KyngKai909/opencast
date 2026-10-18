// What Home's parts share: the station the hero is tuned to, and how far the hero has been
// scrolled. The hero, the wall, the guide, the station cells and the sign-off all read it.
import { STATIONS, NOW_PLAYING } from "../../data/stations";

export const S = STATIONS;
export const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

export const state = {
  /** Index into STATIONS. */
  cur: STATIONS.indexOf(NOW_PLAYING),
  /** True while the screen is switching (noise up, lower third hidden). */
  changing: false,
  /** Hero scroll progress, 0 to 1. */
  heroP: 0,
  /** The wall's reveal, 0 to 1 (eased). */
  wallE: 0,
  /** Whether the hero's screen is on screen. */
  heroVis: true
};
