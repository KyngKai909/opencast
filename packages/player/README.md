# @opencast/player

The one HLS player for the viewer app, TV mode and the Cast receiver.

## Changing channel

Built from `docs/reference/viewer/opencast-tuning.html` (follow-up Phase 5). Every timing and level
is in one file, `src/tuning/constants.ts`; the CSS gets them as custom properties (`tuningStyle`).

- `src/tuning/change.ts`: the timing state machine. Static for at least 300 ms and until the first
  frame, "Tuning in" after 800 ms, Stand by after 8 s (whatever kept the picture from coming), one
  160 ms roll, then the banner. Reduced motion is a 200 ms dim and crossfade; the radio band sweeps
  the needle over the real distance in 400 ms.
- `src/tuning/grain.ts`: the static. One field of grain values per picture size (half of them above
  the base, half below by the same amounts, so its average is exact), shown each frame at a random
  wrapped offset with four `drawImage` blits, 24 times a second: every frame holds exactly the same
  values, so its average brightness never changes. No per-frame allocation or per-pixel work.
- `src/tuning/hiss.ts`: the tuning sound, Web Audio band-passed noise with an envelope, 250 ms, only
  when the band's "Tuning sound" is on, someone has interacted, and the player isn't muted.
- The engine (`src/engine/PlayerEngine.ts`) mutes the old picture under the static, loads only the
  channel the viewer lands on (a press while the static is up cancels what's loading and waits
  180 ms for the presses to stop), and never waits on `play()`: a failed or stalled load is tried
  again, and Stand by at 8 s says so. The Deck's old 15 s first-frame timeout isn't used by tuning.

### The photosensitivity test (`src/tuning/photosensitivity.test.ts`)

The rule (WCAG 2.3.1, a hard limit): no full-screen brightness change larger than 10% more than 3
times a second.

1. **The static's frames.** The painter's field for a 1920 × 1080 picture (960 × 540 grains of
   2 px) is composed on the CPU with exactly the blits the canvas draws, for 10 seconds at 24 frames
   a second. Each frame's average relative luminance (WCAG's formula) must be the same to within
   1e-9; every grain must be within 0.15 of the ground's luminance on both grounds; and the series
   must have no transitions at all.
2. **The whole screen over time.** The real engine, with fake media whose first frames arrive after
   a chosen delay, is driven with the worst presses: holding the button (a press every 50 ms),
   presses every 150 to 1200 ms, random presses and bursts, slow pictures, reduced motion, and a
   change that reaches Stand by and comes back. Every picture is white, as far from the static and
   the dim as a picture can be, so every cover and every clear counts. The screen's average
   luminance is sampled every 10 ms from what the player draws (the picture, the static's average,
   the roll's progress, the dim and crossfade, Stand by).
3. **Counting** (`src/tuning/flash.ts`): a transition is a change of at least 0.1 in relative
   luminance from the last extreme, opposite in direction to the one before it (a slow change counts
   the same as a sudden one; wobbles under 0.1 never count). No one-second window may hold more
   than 3. That's stricter than WCAG, which allows three flashes (six changes) and ignores pairs
   whose darker side is above 0.80.

What keeps it so is the guard in `change.ts`: the static clears at most once a second
(`CLEAR_GAP_MS`). A press can bring the static up at any moment, but only after a clear, so any
second holds at most one clear and the two presses around it. With the guard set to 0, 13 of the
test's cases fail; the detector also has to catch a 4 Hz strobe.
