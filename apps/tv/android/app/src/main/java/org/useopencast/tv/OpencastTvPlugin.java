package org.useopencast.tv;

import android.content.pm.PackageManager;
import android.os.Build;
import android.view.KeyEvent;
import android.view.WindowManager;
import androidx.appcompat.app.AppCompatActivity;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * TV mode's side of the Android TV and Fire TV app (src/native/plugin.ts): the remote's keys to
 * the page, what kind of TV this is (for registerTv and About this TV), keeping the screen on
 * while the picture plays, and going back to the TV's home screen.
 */
@CapacitorPlugin(name = "OpencastTv")
public class OpencastTvPlugin extends Plugin {

    /** The Google TV home screen; its being installed is what tells Google TV from Android TV. */
    static final String GOOGLE_TV_LAUNCHER = "com.google.android.apps.tv.launcherx";

    /** Whether the page listens for keys yet (until it does, keys go to the WebView as usual). */
    boolean listening() {
        return hasListeners("key");
    }

    /**
     * A key from the remote, to the page: pressed ("down", with repeats while held) or let go
     * ("up"; `canceled` when the system took the press, so it mustn't act).
     */
    void sendKey(KeyEvent event) {
        String type;
        if (event.getAction() == KeyEvent.ACTION_DOWN) {
            type = "down";
        } else if (event.getAction() == KeyEvent.ACTION_UP) {
            type = "up";
        } else {
            return;
        }
        JSObject key = new JSObject();
        key.put("type", type);
        key.put("code", event.getKeyCode());
        key.put("repeat", event.getRepeatCount() > 0);
        key.put("canceled", event.isCanceled());
        notifyListeners("key", key);
    }

    /** What kind of TV this is. The page decides fire_tv / google_tv / android_tv from these facts. */
    @PluginMethod
    public void getInfo(PluginCall call) {
        PackageManager pm = getContext().getPackageManager();
        JSObject info = new JSObject();
        info.put("manufacturer", Build.MANUFACTURER);
        info.put("model", Build.MODEL);
        info.put("fireTv", pm.hasSystemFeature("amazon.hardware.fire_tv"));
        info.put("googleTv", isInstalled(pm, GOOGLE_TV_LAUNCHER));
        info.put("leanback", pm.hasSystemFeature(PackageManager.FEATURE_LEANBACK));
        call.resolve(info);
    }

    /** On while the picture plays; off when it's paused, off air or stopped by the sleep timer. */
    @PluginMethod
    public void setKeepScreenOn(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        final AppCompatActivity activity = getActivity();
        activity.runOnUiThread(() -> {
            if (on) {
                activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            } else {
                activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            }
            call.resolve();
        });
    }

    /**
     * Back to the TV's home screen: Back on the picture with nothing to go back to, and the sleep
     * timer's end ("It stops Opencast, not the TV"). The activity finishes, so the picture, the
     * phone relay and every timer stop with it; the next launch starts fresh on the last channel.
     */
    @PluginMethod
    public void exitToHome(PluginCall call) {
        final AppCompatActivity activity = getActivity();
        activity.runOnUiThread(() -> {
            activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            call.resolve();
            activity.finish();
        });
    }

    private static boolean isInstalled(PackageManager pm, String packageName) {
        try {
            pm.getPackageInfo(packageName, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }
}
