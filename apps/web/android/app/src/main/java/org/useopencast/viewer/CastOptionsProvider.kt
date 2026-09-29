package org.useopencast.viewer

import android.content.Context
import com.google.android.gms.cast.CastMediaControlIntent
import com.google.android.gms.cast.framework.CastOptions
import com.google.android.gms.cast.framework.OptionsProvider
import com.google.android.gms.cast.framework.SessionProvider

/**
 * The Cast framework's options (named in AndroidManifest.xml): Opencast's receiver application,
 * from res/values/opencast.xml, which `npm run build:native` writes from VITE_CAST_APP_ID.
 */
class CastOptionsProvider : OptionsProvider {
    override fun getCastOptions(context: Context): CastOptions {
        // Empty until the receiver is registered: the framework needs some id, and the plugin
        // reports Cast as unavailable anyway.
        val appId = context.getString(R.string.opencast_cast_app_id)
            .ifEmpty { CastMediaControlIntent.DEFAULT_MEDIA_RECEIVER_APPLICATION_ID }
        return CastOptions.Builder()
            .setReceiverApplicationId(appId)
            .build()
    }

    override fun getAdditionalSessionProviders(context: Context): List<SessionProvider>? = null
}
