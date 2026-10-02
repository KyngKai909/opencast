package org.useopencast.tv;

import android.view.KeyEvent;

/**
 * The remote's keys MainActivity takes from the WebView and sends to TV mode instead (the page
 * turns each into the key name packages/player's keyboard adapter maps; see src/native/keys.ts,
 * which lists the same KEYCODE_ names and is tested against this file). The D-pad's arrows aren't
 * here: the WebView delivers them as ArrowUp and the rest by itself.
 */
final class TvKeys {

    private TvKeys() {}

    static final int[] FORWARDED = {
        // Back is TV mode's Back (hold it for the menu), not the Activity's.
        KeyEvent.KEYCODE_BACK,
        // OK, from the D-pad's centre and from remotes and keyboards that send Enter.
        KeyEvent.KEYCODE_DPAD_CENTER,
        KeyEvent.KEYCODE_ENTER,
        KeyEvent.KEYCODE_NUMPAD_ENTER,
        // The TV's own keys, where the remote has them.
        KeyEvent.KEYCODE_CHANNEL_UP,
        KeyEvent.KEYCODE_CHANNEL_DOWN,
        KeyEvent.KEYCODE_PAGE_UP,
        KeyEvent.KEYCODE_PAGE_DOWN,
        KeyEvent.KEYCODE_GUIDE,
        KeyEvent.KEYCODE_INFO,
        KeyEvent.KEYCODE_MENU,
        KeyEvent.KEYCODE_LAST_CHANNEL,
        // Media keys (Fire TV's remote has play/pause, rewind and fast forward).
        KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE,
        KeyEvent.KEYCODE_MEDIA_PLAY,
        KeyEvent.KEYCODE_MEDIA_PAUSE,
        KeyEvent.KEYCODE_MEDIA_NEXT,
        KeyEvent.KEYCODE_MEDIA_PREVIOUS,
        KeyEvent.KEYCODE_MEDIA_REWIND,
        KeyEvent.KEYCODE_MEDIA_FAST_FORWARD,
        // Numbers and the dot (or dash) for tuning by number.
        KeyEvent.KEYCODE_0,
        KeyEvent.KEYCODE_1,
        KeyEvent.KEYCODE_2,
        KeyEvent.KEYCODE_3,
        KeyEvent.KEYCODE_4,
        KeyEvent.KEYCODE_5,
        KeyEvent.KEYCODE_6,
        KeyEvent.KEYCODE_7,
        KeyEvent.KEYCODE_8,
        KeyEvent.KEYCODE_9,
        KeyEvent.KEYCODE_NUMPAD_0,
        KeyEvent.KEYCODE_NUMPAD_1,
        KeyEvent.KEYCODE_NUMPAD_2,
        KeyEvent.KEYCODE_NUMPAD_3,
        KeyEvent.KEYCODE_NUMPAD_4,
        KeyEvent.KEYCODE_NUMPAD_5,
        KeyEvent.KEYCODE_NUMPAD_6,
        KeyEvent.KEYCODE_NUMPAD_7,
        KeyEvent.KEYCODE_NUMPAD_8,
        KeyEvent.KEYCODE_NUMPAD_9,
        KeyEvent.KEYCODE_PERIOD,
        KeyEvent.KEYCODE_NUMPAD_DOT,
        KeyEvent.KEYCODE_MINUS
    };

    static boolean forwards(int keyCode) {
        for (int code : FORWARDED) {
            if (code == keyCode) return true;
        }
        return false;
    }
}
