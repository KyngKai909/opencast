package org.useopencast.viewer

import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.lang.ref.WeakReference

/**
 * Lock-screen controls (`OpencastNowPlaying`): a MediaSession with the station and what's on, and
 * its notification, with previous and next as channel down and up, and pause and play. Each press
 * goes to the web side as an `action` event (apps/web/src/viewer/native/lockScreen.ts turns it into the
 * player's command). This works while casting too: the phone's player follows the TV, and a
 * channel press here tunes the phone, which tunes the TV.
 *
 * Android 13 and later draw the controls from the session itself; older versions use the
 * notification's buttons, which come back through ActionReceiver.
 */
@CapacitorPlugin(name = "OpencastNowPlaying")
class OpencastNowPlayingPlugin : Plugin() {
    private var session: MediaSessionCompat? = null

    override fun load() {
        current = WeakReference(this)
    }

    @PluginMethod
    fun update(call: PluginCall) {
        val title = call.getString("title") ?: "Opencast"
        val subtitle = call.getString("subtitle")
        val playing = call.getBoolean("playing", false) ?: false
        bridge.executeOnMainThread {
            val s = session ?: createSession().also { session = it }
            s.setMetadata(
                MediaMetadataCompat.Builder()
                    .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
                    .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, subtitle)
                    .build()
            )
            s.setPlaybackState(
                PlaybackStateCompat.Builder()
                    .setActions(
                        PlaybackStateCompat.ACTION_PLAY or PlaybackStateCompat.ACTION_PAUSE or
                            PlaybackStateCompat.ACTION_PLAY_PAUSE or PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
                            PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
                    )
                    .setState(
                        if (playing) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED,
                        PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN,
                        if (playing) 1f else 0f
                    )
                    .build()
            )
            s.isActive = true
            showNotification(s, title, subtitle, playing)
            call.resolve()
        }
    }

    @PluginMethod
    fun clear(call: PluginCall) {
        bridge.executeOnMainThread {
            release()
            call.resolve()
        }
    }

    override fun handleOnDestroy() {
        release()
    }

    fun press(action: String) {
        notifyListeners("action", JSObject().put("action", action))
    }

    private fun release() {
        session?.isActive = false
        session?.release()
        session = null
        NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
    }

    private fun createSession(): MediaSessionCompat =
        MediaSessionCompat(context, "Opencast").apply {
            setCallback(object : MediaSessionCompat.Callback() {
                override fun onPlay() = press("play")
                override fun onPause() = press("pause")
                override fun onSkipToNext() = press("next")
                override fun onSkipToPrevious() = press("previous")
            })
        }

    private fun actionIntent(action: String, code: Int): PendingIntent =
        PendingIntent.getBroadcast(
            context,
            code,
            Intent(context, ActionReceiver::class.java).setAction(ACTION_PREFIX + action),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

    // A media session's notification shows without the notification permission (Android 13 and later).
    @SuppressLint("MissingPermission", "NotificationPermission")
    private fun showNotification(s: MediaSessionCompat, title: String, subtitle: String?, playing: Boolean) {
        val manager = NotificationManagerCompat.from(context)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Now playing", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "The station on now, with channel up, down and pause."
                    setShowBadge(false)
                }
            )
        }
        val open = context.packageManager.getLaunchIntentForPackage(context.packageName)?.let {
            PendingIntent.getActivity(context, 0, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_opencast)
            .setContentTitle(title)
            .setContentText(subtitle)
            .setContentIntent(open)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .addAction(android.R.drawable.ic_media_previous, "Channel down", actionIntent("previous", 1))
            .addAction(
                if (playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
                if (playing) "Pause" else "Play",
                actionIntent(if (playing) "pause" else "play", 2)
            )
            .addAction(android.R.drawable.ic_media_next, "Channel up", actionIntent("next", 3))
            .setStyle(
                androidx.media.app.NotificationCompat.MediaStyle()
                    .setMediaSession(s.sessionToken)
                    .setShowActionsInCompactView(0, 1, 2)
            )
            .build()
        try {
            manager.notify(NOTIFICATION_ID, notification)
        } catch (_: SecurityException) {
            // Notifications turned off for the app: the session still answers headset buttons.
        }
    }

    /** The notification's buttons (before Android 13), passed to the plugin. */
    class ActionReceiver : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val action = intent.action?.removePrefix(ACTION_PREFIX) ?: return
            current?.get()?.press(action)
        }
    }

    companion object {
        private const val CHANNEL_ID = "opencast_now_playing"
        private const val NOTIFICATION_ID = 0x0C45
        private const val ACTION_PREFIX = "org.useopencast.viewer.NOW_PLAYING."
        private var current: WeakReference<OpencastNowPlayingPlugin>? = null
    }
}
