// The swipe's feel (swipe home 08, "Gesture and rules"), as numbers and pure functions: the drag
// follows the finger 1:1 to 60% of the screen and then a third as far; a release past 20% of the
// screen, or a flick faster than 0.5 px per ms, snaps in 240 ms easing out; under that it springs
// back in 280 ms with a slight overshoot. At the detent (from the presets into the dial, and the
// wrap) the drag goes half as far for the same finger movement and needs 35%. Reduced motion keeps
// the drag; the snap is a 200 ms crossfade.

/** The drag follows the finger 1:1 up to this share of the screen... */
export const RUBBER_FROM = 0.6;
/** ...then this much as far (rubber band). */
export const RUBBER_RATE = 1 / 3;
/** A release past this share of the screen changes channel. */
export const SNAP_SHARE = 0.2;
/** Or a flick faster than this, in px per ms, in the drag's direction. */
export const FLICK_PX_MS = 0.5;
export const SNAP_MS = 240;
export const SNAP_EASE = "cubic-bezier(.2,.7,.2,1)";
/** Under the threshold it returns, with a slight overshoot. */
export const SPRING_MS = 280;
export const SPRING_EASE = "cubic-bezier(.34,1.35,.64,1)";
/** The detent: half the drag distance for the same finger movement... */
export const DETENT_RATE = 0.5;
/** ...a 35% threshold... */
export const DETENT_SHARE = 0.35;
/** ...and a harder flick (the reference's demo). */
export const DETENT_FLICK_PX_MS = 0.9;
/** Reduced motion: the snap is a crossfade this long (the player's own CROSSFADE_MS). */
export const FADE_MS = 200;
/** A touch that moves less than this is a tap. */
export const TAP_SLOP_PX = 6;
/** Movement before the gesture decides it's up and down (a swipe) or sideways (nothing). */
export const AXIS_PX = 8;
/** Velocity is measured over the last this many ms of the drag. */
export const VELOCITY_WINDOW_MS = 80;
/** Landscape: the buttons and position line fade this long after the last tap. */
export const CHROME_HIDE_MS = 3000;
/** After the snap, the corner number stays this long (then the banner as usual). */
export const OSD_MS = 1200;

export type SwipeDir = "next" | "prev";

/** The finger moving up brings the next station up from below; down, the previous from above. */
export function directionOf(dy: number): SwipeDir {
  return dy < 0 ? "next" : "prev";
}

/** Up and down is the swipe; sideways does nothing, which keeps the picture from accidental changes. */
export function axisOf(dx: number, dy: number): "y" | "x" | null {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < AXIS_PX) return null;
  return Math.abs(dy) >= Math.abs(dx) ? "y" : "x";
}

/** Where the picture is for a finger that has moved `dy`: 1:1, then a third as far past 60%; half that at the detent. */
export function dragOffset(dy: number, height: number, detent: boolean): number {
  const a = Math.abs(dy) * (detent ? DETENT_RATE : 1);
  const lim = height * RUBBER_FROM;
  const v = a > lim ? lim + (a - lim) * RUBBER_RATE : a;
  return dy < 0 ? -v : v;
}

/**
 * Let go: snap to the next station, or spring back. `offset` is where the picture is (dragOffset),
 * `velocity` the finger's speed in px per ms (negative is up), both signed the same way.
 */
export function releaseAction(o: { offset: number; velocity: number; height: number; detent: boolean }): "snap" | "back" {
  if (!o.offset || !o.height) return "back";
  const threshold = (o.detent ? DETENT_SHARE : SNAP_SHARE) * o.height;
  if (Math.abs(o.offset) > threshold) return "snap";
  const flick = o.detent ? DETENT_FLICK_PX_MS : FLICK_PX_MS;
  return Math.abs(o.velocity) > flick && Math.sign(o.velocity) === Math.sign(o.offset) ? "snap" : "back";
}

export interface Sample {
  y: number;
  t: number;
}

/** The finger's speed at the end of the drag, px per ms, over the last VELOCITY_WINDOW_MS. */
export function velocityOf(samples: readonly Sample[]): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1]!;
  let first = samples[samples.length - 2]!;
  for (let i = samples.length - 2; i >= 0; i--) {
    if (last.t - samples[i]!.t > VELOCITY_WINDOW_MS) break;
    first = samples[i]!;
  }
  const dt = last.t - first.t;
  return dt > 0 ? (last.y - first.y) / dt : 0;
}

/**
 * Where the detent's label sits, from the top of the screen: on the seam between the two pictures
 * (the incoming one starts a screen below, or above, the picture's offset), a little inside it.
 */
export function seamAt(offset: number, height: number, dir: SwipeDir): number {
  return dir === "next" ? height + offset : offset;
}

/** On the phone remote's now strip (no picture moves there): this far, or a flick, changes the TV's channel. */
export const REMOTE_SWIPE_PX = 40;

/** A swipe on the remote: next or previous, or nothing (short, slow or sideways). */
export function remoteSwipe(dx: number, dy: number, velocity: number): SwipeDir | null {
  if (axisOf(dx, dy) !== "y") return null;
  if (Math.abs(dy) < REMOTE_SWIPE_PX && Math.abs(velocity) <= FLICK_PX_MS) return null;
  return directionOf(dy);
}
