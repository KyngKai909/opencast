package org.useopencast.viewer

import androidx.core.content.ContextCompat
import androidx.mediarouter.media.MediaRouteSelector
import androidx.mediarouter.media.MediaRouter
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.android.gms.cast.CastDevice
import com.google.android.gms.cast.CastMediaControlIntent
import com.google.android.gms.cast.framework.CastContext
import com.google.android.gms.cast.framework.CastSession
import com.google.android.gms.cast.framework.SessionManagerListener

/**
 * The Google Cast sender for the web view (`OpencastCast`): finds Chromecasts and Google TVs that
 * can run Opencast's receiver (MediaRouter with the receiver's Cast category), starts a session
 * with one, and carries messages on urn:x-cast:org.useopencast.tv. The web side is
 * apps/web/src/viewer/native/nativeCastSender.ts; the receiver id comes from CastOptionsProvider.
 */
@CapacitorPlugin(name = "OpencastCast")
class OpencastCastPlugin : Plugin() {
    private var castContext: CastContext? = null
    private var router: MediaRouter? = null
    private var selector: MediaRouteSelector? = null
    private var appId: String? = null
    private var session: CastSession? = null
    private var discovering = false

    /** The startSession call waiting for the framework to say the session started (or didn't). */
    private var pendingStart: PluginCall? = null

    private val routerCallback = object : MediaRouter.Callback() {
        override fun onRouteAdded(router: MediaRouter, route: MediaRouter.RouteInfo) = devicesChanged()
        override fun onRouteRemoved(router: MediaRouter, route: MediaRouter.RouteInfo) = devicesChanged()
        override fun onRouteChanged(router: MediaRouter, route: MediaRouter.RouteInfo) = devicesChanged()
    }

    private val sessionListener = object : SessionManagerListener<CastSession> {
        override fun onSessionStarting(session: CastSession) {}

        override fun onSessionStarted(session: CastSession, sessionId: String) {
            attach(session)
            pendingStart?.resolve(JSObject().put("device", describe(session.castDevice)))
            pendingStart = null
        }

        override fun onSessionStartFailed(session: CastSession, error: Int) {
            pendingStart?.reject("Casting didn't start.")
            pendingStart = null
        }

        override fun onSessionEnding(session: CastSession) {}

        override fun onSessionEnded(session: CastSession, error: Int) {
            val ours = session == this@OpencastCastPlugin.session
            if (ours) detach()
            pendingStart?.reject("Casting didn't start.")
            pendingStart = null
            if (ours) notifyListeners("sessionEnded", JSObject())
        }

        override fun onSessionResuming(session: CastSession, sessionId: String) {}

        override fun onSessionResumed(session: CastSession, wasSuspended: Boolean) = attach(session)

        override fun onSessionResumeFailed(session: CastSession, error: Int) {}

        override fun onSessionSuspended(session: CastSession, reason: Int) {}
    }

    /** Sets up the Cast framework once; `available` is false without Google Play services or a receiver id. */
    @PluginMethod
    fun setUp(call: PluginCall) {
        val requested = call.getString("appId")?.trim().orEmpty()
        bridge.executeOnMainThread {
            if (castContext != null) {
                call.resolve(JSObject().put("available", requested.isEmpty() || requested == appId))
                return@executeOnMainThread
            }
            val configured = context.getString(R.string.opencast_cast_app_id)
            if (configured.isEmpty()) {
                call.resolve(JSObject().put("available", false))
                return@executeOnMainThread
            }
            CastContext.getSharedInstance(context, ContextCompat.getMainExecutor(context))
                .addOnSuccessListener { ctx ->
                    castContext = ctx
                    appId = configured
                    router = MediaRouter.getInstance(context)
                    selector = MediaRouteSelector.Builder()
                        .addControlCategory(CastMediaControlIntent.categoryForCast(configured))
                        .build()
                    ctx.sessionManager.addSessionManagerListener(sessionListener, CastSession::class.java)
                    ctx.sessionManager.currentCastSession?.let { attach(it) }
                    call.resolve(JSObject().put("available", requested.isEmpty() || requested == configured))
                }
                .addOnFailureListener { call.resolve(JSObject().put("available", false)) }
        }
    }

    @PluginMethod
    fun startDiscovery(call: PluginCall) {
        bridge.executeOnMainThread {
            val r = router
            val s = selector
            if (r == null || s == null) {
                call.reject("Cast isn't set up.")
                return@executeOnMainThread
            }
            if (!discovering) {
                r.addCallback(s, routerCallback, MediaRouter.CALLBACK_FLAG_REQUEST_DISCOVERY)
                discovering = true
            }
            call.resolve(JSObject().put("devices", devices()))
        }
    }

    @PluginMethod
    fun stopDiscovery(call: PluginCall) {
        bridge.executeOnMainThread {
            if (discovering) router?.removeCallback(routerCallback)
            discovering = false
            call.resolve()
        }
    }

    @PluginMethod
    fun startSession(call: PluginCall) {
        val deviceId = call.getString("deviceId")
        if (deviceId == null) {
            call.reject("No TV was given.")
            return
        }
        bridge.executeOnMainThread {
            val r = router
            val ctx = castContext
            if (r == null || ctx == null) {
                call.reject("Cast isn't set up.")
                return@executeOnMainThread
            }
            val route = castRoutes().firstOrNull { it.id == deviceId }
            if (route == null) {
                call.reject("That TV isn't on the network now.")
                return@executeOnMainThread
            }
            // Already casting to this TV: carry on with that session.
            val current = ctx.sessionManager.currentCastSession
            val device = CastDevice.getFromBundle(route.extras)
            if (current != null && current.isConnected && device != null && current.castDevice?.deviceId == device.deviceId) {
                attach(current)
                call.resolve(JSObject().put("device", describe(current.castDevice, route.id)))
                return@executeOnMainThread
            }
            pendingStart?.reject("Another cast started.")
            pendingStart = call
            // Selecting the route is what starts a Cast session: the framework watches MediaRouter.
            r.selectRoute(route)
        }
    }

    @PluginMethod
    fun sendMessage(call: PluginCall) {
        val namespace = call.getString("namespace") ?: NAMESPACE
        val message = call.getString("message").orEmpty()
        bridge.executeOnMainThread {
            val s = session
            if (s == null || !s.isConnected) {
                call.reject("Not casting.")
                return@executeOnMainThread
            }
            s.sendMessage(namespace, message).setResultCallback { status ->
                if (status.isSuccess) call.resolve() else call.reject("The TV didn't take the message.")
            }
        }
    }

    @PluginMethod
    fun endSession(call: PluginCall) {
        val stopCasting = call.getBoolean("stopCasting", true) ?: true
        bridge.executeOnMainThread {
            detach()
            castContext?.sessionManager?.endCurrentSession(stopCasting)
            call.resolve()
        }
    }

    override fun handleOnDestroy() {
        if (discovering) router?.removeCallback(routerCallback)
        castContext?.sessionManager?.removeSessionManagerListener(sessionListener, CastSession::class.java)
        detach()
    }

    private fun castRoutes(): List<MediaRouter.RouteInfo> {
        val r = router ?: return emptyList()
        val s = selector ?: return emptyList()
        // The Cast category already leaves out the phone itself and Bluetooth speakers.
        return r.routes.filter { !it.isDefault && it.isEnabled && it.matchesSelector(s) }
    }

    /** A TV as the web side lists it. The id is the route's, which is what startSession selects. */
    private fun describe(device: CastDevice?, id: String? = null): JSObject {
        val routeId = id ?: castRoutes().firstOrNull { CastDevice.getFromBundle(it.extras)?.deviceId == device?.deviceId }?.id
        return JSObject()
            .put("id", routeId ?: device?.deviceId ?: "")
            .put("name", device?.friendlyName ?: "A TV with Chromecast")
    }

    private fun devices(): JSArray {
        val list = JSArray()
        castRoutes().forEach { list.put(JSObject().put("id", it.id).put("name", it.name)) }
        return list
    }

    private fun devicesChanged() {
        notifyListeners("devicesChanged", JSObject().put("devices", devices()))
    }

    private fun attach(s: CastSession) {
        if (session == s) return
        detach()
        try {
            s.setMessageReceivedCallbacks(NAMESPACE) { _, namespace, message ->
                notifyListeners("message", JSObject().put("namespace", namespace).put("message", message))
            }
            session = s
        } catch (e: Exception) {
            session = null
        }
    }

    private fun detach() {
        try {
            session?.removeMessageReceivedCallbacks(NAMESPACE)
        } catch (_: Exception) {
        }
        session = null
    }

    companion object {
        const val NAMESPACE = "urn:x-cast:org.useopencast.tv"
    }
}
