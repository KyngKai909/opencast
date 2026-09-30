// Changing channel: every timing and level the effect uses, in one place (follow-up Phase 5, from
// docs/reference/viewer/opencast-tuning.html, "Timing and rules"). The engine, the static's
// painter, the React layer and the tests all read these; the CSS gets them as custom properties
// (tuningStyle), so nothing below is repeated anywhere else.

// ---------- The static (video) ----------

/** Static runs at least this long, even when the next channel is already there. */
export const MIN_STATIC_MS = 300;
/** Without a first frame by now, the program's name and "Tuning in" appear over the static. */
export const TUNING_IN_MS = 800;
/** Without a first frame by now, it's the Stand by screen with the colour bars: a signal problem. */
export const STANDBY_MS = 8000;
/** The static clears in one roll, top to bottom, when the first frame is on screen. */
export const ROLL_MS = 160;
/** Then the banner slides in (the reference's .24s cubic-bezier(.2,.7,.2,1)). */
export const BANNER_SLIDE_MS = 240;
export const BANNER_SLIDE_EASING = "cubic-bezier(.2,.7,.2,1)";

/** Grain: 2 px, redrawn 24 times a second. */
export const GRAIN_PX = 2;
export const GRAIN_FPS = 24;
/**
 * Grain levels (8-bit sRGB, the reference's): each grain is v, v + 2, v + 10 (a grey on the
 * navy ground), v spread evenly within ±GRAIN_AMPLITUDE of GRAIN_BASE.
 */
export const GRAIN_BASE = 46;
export const GRAIN_AMPLITUDE = 18;
export const GRAIN_TINT: readonly [number, number, number] = [0, 2, 10];
/** Every grain's relative luminance stays within this of the ground's (the screen colour). */
export const GRAIN_GROUND_TOLERANCE = 0.15;
/** The screen's ground on both themes (--screen), which the static is checked against. */
export const SCREEN_GROUNDS: readonly string[] = ["#0A1124", "#0F1830"];

// ---------- Reduced motion ----------

/** Reduced motion: no grain; the old picture dims and the new one crossfades in this long. */
export const CROSSFADE_MS = 200;
/** How far the old picture dims (to this opacity) while the next one loads, with reduced motion. */
export const CROSSFADE_DIM = 0.35;

// ---------- The radio band ----------

/** The needle travels the real distance between the frequencies in this long, eased in and out. */
export const SWEEP_MS = 400;
/** The needle's easing (the reference's). */
export const SWEEP_EASING: readonly [number, number, number, number] = [0.45, 0, 0.2, 1];
/** The band the needle moves along (FM). */
export const BAND_MIN_MHZ = 88;
export const BAND_MAX_MHZ = 108;

// ---------- Tuning sound ----------

/** A soft hiss while changing channel (radio band by default; video when "Tuning sound" is on). */
export const HISS_MS = 250;
/** Its peak gain, well below a program's level (about -26 dB), and its envelope. */
export const HISS_GAIN = 0.05;
export const HISS_ATTACK_MS = 20;
export const HISS_RELEASE_MS = 120;
/** Band-passed noise, centred here (Hz), a soft "shh" rather than a harsh white noise. */
export const HISS_CENTRE_HZ = 3000;
export const HISS_Q = 0.7;

// ---------- Photosensitivity (WCAG 2.3.1), a hard limit ----------

/** A full-screen change in relative luminance of this much or more counts as a flash transition. */
export const FLASH_THRESHOLD = 0.1;
/** No more than this many such changes... */
export const FLASH_MAX_CHANGES = 3;
/** ...in any window this long. */
export const FLASH_WINDOW_MS = 1000;
/**
 * The guard that keeps it so: the static (or the reduced-motion dim) clears at most once in this
 * long. A press can bring the static up at any moment, but only after a clear, so any second holds
 * at most one clear and the two presses around it: three changes (see photosensitivity.test.ts).
 */
export const CLEAR_GAP_MS = 1000;

// ---------- Repeated presses and loading ----------

/**
 * Repeated presses: the first press of a change loads at once; each press after it cancels what's
 * loading, and the channel loads once the presses have stopped for this long, so only the channel
 * the viewer lands on loads.
 */
export const LAND_MS = 180;
/** A load that failed (the playlist, the network, play()) is tried again after this, doubling... */
export const RETRY_FIRST_MS = 2000;
/** ...up to this. */
export const RETRY_MAX_MS = 30_000;
/** At Stand by, a picture that still hasn't come this long after its load started is loaded afresh. */
export const REBUILD_AFTER_MS = 20_000;

/** All of it, for the CSS: custom properties on the player (`style={tuningStyle}`). */
export const tuningStyle: Record<string, string> = {
  "--oc-tune-roll": `${ROLL_MS}ms`,
  "--oc-tune-fade": `${CROSSFADE_MS}ms`,
  "--oc-tune-dim": String(CROSSFADE_DIM),
  "--oc-tune-sweep": `${SWEEP_MS}ms`,
  "--oc-tune-sweep-ease": `cubic-bezier(${SWEEP_EASING.join(",")})`,
  "--oc-banner-slide": `${BANNER_SLIDE_MS}ms`,
  "--oc-banner-slide-ease": BANNER_SLIDE_EASING
};
