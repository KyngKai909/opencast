package org.useopencast.viewer;

import android.content.pm.ApplicationInfo;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import org.useopencast.direct.DirectStreams;
import org.useopencast.direct.DirectWebViewClient;
import org.useopencast.direct.OpencastDirectPlugin;

/**
 * The Opencast app on Android. A239, direct mode: external stations' stream links are fetched with
 * the phone's own networking (packages/player/native/android, DirectStreams), at a path the web view
 * client answers; the OpencastDirect plugin tells the page where.
 */
public class MainActivity extends BridgeActivity implements DirectStreams.Host {

    private DirectStreams direct;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local addresses (a dev server's mock streams) only in debug builds.
        direct = new DirectStreams("Opencast (Android)", (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        // Opencast's own plugins live in this app, not in npm packages, so `cap sync` doesn't
        // register them: they're registered here, before the bridge starts.
        registerPlugin(OpencastCastPlugin.class);
        registerPlugin(OpencastNowPlayingPlugin.class);
        registerPlugin(OpencastDirectPlugin.class);
        super.onCreate(savedInstanceState);
        DirectWebViewClient.install(bridge, direct);
    }

    @Override
    public DirectStreams directStreams() {
        return direct;
    }
}
