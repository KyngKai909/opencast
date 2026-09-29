package org.useopencast.viewer;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Opencast's own plugins live in this app, not in npm packages, so `cap sync` doesn't
        // register them: they're registered here, before the bridge starts.
        registerPlugin(OpencastCastPlugin.class);
        registerPlugin(OpencastNowPlayingPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
