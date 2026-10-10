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

// Both play for as long as the change's cover is up (the static, or the radio band's needle and
// waiting), from the press until the picture or sound arrives, then fade. Well below a program's
// level, and only with "Tuning sound" on for the band (see hiss.ts).

/** It never runs longer than this after the latest press (a channel slow to load goes quiet). */
export const TUNING_SOUND_MAX_MS = 3000;
export const TUNING_SOUND_ATTACK_MS = 40;
/** The fade as the picture arrives (the static's roll is 160 ms; this runs a little past it). */
export const TUNING_SOUND_RELEASE_MS = 250;

/**
 * The TV band's tuning sound (2026-10-06, the user's pick "C. Old TV set"): a deep hiss for as long
 * as the static is up, with a soft low thump as the channel clicks over and a faint mains hum under
 * it. Gains are the player's volume times these, in the balance the user heard them.
 */
export const SET_NOISE_GAIN = 0.075;
/** The hiss: noise between these (Hz), deep rather than bright. */
export const SET_LOWPASS_HZ = 1600;
export const SET_HIGHPASS_HZ = 90;
/** The thump: a sine falling from FROM to TO Hz, gone in THUMP_MS. */
export const SET_THUMP_GAIN = 0.125;
export const SET_THUMP_FROM_HZ = 110;
export const SET_THUMP_TO_HZ = 45;
export const SET_THUMP_MS = 180;
/** The hum: 60 Hz mains, its low harmonics only. */
export const SET_HUM_GAIN = 0.00875;
export const SET_HUM_HZ = 60;
export const SET_HUM_LOWPASS_HZ = 240;

/**
 * The radio band's (2026-10-06, the user's pick "R2. Dial sweep", a little deeper): hiss through a
 * band that rises as the needle travels and settles lower while the station comes in, with faint
 * whistles as the needle passes other stations.
 */
export const DIAL_NOISE_GAIN = 0.108;
export const DIAL_Q = 0.9;
/** The band's centre (Hz): from, at the needle's stop (SWEEP_MS), and settled DIAL_SETTLE_MS later. */
export const DIAL_FROM_HZ = 400;
export const DIAL_PEAK_HZ = 1400;
export const DIAL_REST_HZ = 650;
export const DIAL_SETTLE_MS = 500;
/** The whistles: a tone falling from about 1-1.8 kHz to 250-450 Hz, each this long, this soft. */
export const DIAL_WHISTLE_GAIN = 0.0104;
export const DIAL_WHISTLE_MS = 180;
/** When they start, after the press (on the needle's way). */
export const DIAL_WHISTLES_AT_MS: readonly number[] = [80, 260];

/**
 * The clicks (2026-10-06, the user's ask: cues that it's changing and that the station landed): a
 * short burst of noise through a band, falling away in about CLICK_MS. "Landed" plays on both bands
 * as the picture or sound arrives (not on Stand by); the radio band also clicks softly on the press
 * (the TV band has its thump).
 */
export const CLICK_MS = 10;
export const CLICK_LANDED_GAIN = 0.146;
export const CLICK_PRESS_GAIN = 0.07;
/** The click's band (Hz): brighter on the radio band, rounder on the TV band. */
export const CLICK_DIAL_HZ = 2200;
export const CLICK_SET_HZ = 1500;
export const CLICK_Q = 2;

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
/**
 * A239, direct mode in the native apps: an external stream link's own address, fetched with the
 * device's networking, gets this long for its first frame (or fails sooner) before the player falls
 * back to the row's listed address (the relay's, or the same address through the web view) at once.
 * Half of STANDBY_MS, so the fallback has the other half before Stand by, which stays at 8 s.
 */
export const DIRECT_FIRST_FRAME_MS = 4000;

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
