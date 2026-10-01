package org.useopencast.direct;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * A239: tells the page that this app plays external stream links directly (its being registered is
 * the "the app supports it" the player checks), and where: the path, with this launch's token, that
 * DirectStreams answers. The activity implements {@link DirectStreams.Host}.
 */
@CapacitorPlugin(name = "OpencastDirect")
public class OpencastDirectPlugin extends Plugin {

    /** The version of direct mode's path and headers, should they ever change. */
    static final int VERSION = 1;

    @PluginMethod
    public void info(PluginCall call) {
        if (!(getActivity() instanceof DirectStreams.Host)) {
            call.reject("Direct mode isn't set up in this app");
            return;
        }
        DirectStreams streams = ((DirectStreams.Host) getActivity()).directStreams();
        JSObject info = new JSObject();
        info.put("version", VERSION);
        info.put("path", streams.basePath());
        info.put("userAgent", streams.userAgent());
        call.resolve(info);
    }
}
