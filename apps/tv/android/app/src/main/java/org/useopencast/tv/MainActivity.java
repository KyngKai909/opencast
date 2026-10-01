package org.useopencast.tv;

import android.content.pm.ApplicationInfo;
import android.os.Bundle;
import android.view.KeyEvent;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;
import org.useopencast.direct.DirectStreams;
import org.useopencast.direct.DirectWebViewClient;
import org.useopencast.direct.OpencastDirectPlugin;

/**
 * TV mode, full screen, driven by the remote. The WebView gets the D-pad's arrows by itself; the
 * TV's own keys (Back, OK, channel, guide, info, menu, last, media, numbers) go to the page
 * through OpencastTvPlugin, down and up, so OK and Back can be held. Nothing else here decides
 * what a key does: packages/player's keyboard adapter does, as in a browser.
 *
 * <p>A239, direct mode: external stations' stream links are fetched with the TV's own networking
 * (packages/player/native/android, DirectStreams), at a path the web view client answers; the
 * OpencastDirect plugin tells the page where.
 */
public class MainActivity extends BridgeActivity implements DirectStreams.Host {

    private DirectStreams direct;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Local addresses (the dev server's mock streams) only in debug builds.
        direct = new DirectStreams("Opencast TV (Android)", (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        registerPlugin(OpencastTvPlugin.class);
        registerPlugin(OpencastDirectPlugin.class);
        super.onCreate(savedInstanceState);
        DirectWebViewClient.install(bridge, direct);
        hideSystemBars();
    }

    @Override
    public DirectStreams directStreams() {
        return direct;
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (TvKeys.forwards(event.getKeyCode())) {
            OpencastTvPlugin tv = tvPlugin();
            if (tv != null && tv.listening()) {
                tv.sendKey(event);
                return true;
            }
        }
        return super.dispatchKeyEvent(event);
    }

    private OpencastTvPlugin tvPlugin() {
        if (bridge == null) return null;
        PluginHandle handle = bridge.getPlugin("OpencastTv");
        return handle == null ? null : (OpencastTvPlugin) handle.getInstance();
    }

    /** No status or navigation bar over the picture (most TVs have none; some Android builds do). */
    private void hideSystemBars() {
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        bars.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        bars.hide(WindowInsetsCompat.Type.systemBars());
    }
}
