import Foundation
import Capacitor
import GoogleCast

/// Opencast's Cast namespace channel: text (JSON) in both directions.
final class OpencastCastChannel: GCKCastChannel {
    var onText: ((String) -> Void)?

    override func didReceiveTextMessage(_ message: String) {
        onText?(message)
    }
}

/// The Google Cast sender for the web view (`OpencastCast`): finds Chromecasts that can run
/// Opencast's receiver, starts a session with one, and carries messages on
/// urn:x-cast:org.useopencast.tv. The web side is apps/viewer/src/native/nativeCastSender.ts.
///
/// The Cast SDK comes from Google's Swift package (github.com/googlecast/google-cast-ios-sdk,
/// GoogleCastDynamic). Info.plist has the local network usage line and the Bonjour services for
/// the receiver application (`_<app id>._googlecast._tcp`).
@objc(OpencastCastPlugin)
public class OpencastCastPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "OpencastCastPlugin"
    public let jsName = "OpencastCast"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setUp", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startDiscovery", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopDiscovery", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sendMessage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endSession", returnType: CAPPluginReturnPromise)
    ]

    static let namespace = "urn:x-cast:org.useopencast.tv"

    private var appId: String?
    private var channel: OpencastCastChannel?
    private weak var channelSession: GCKCastSession?
    /// The startSession call waiting for the SDK to say the session started (or didn't).
    private var pendingStart: CAPPluginCall?

    private var context: GCKCastContext? {
        appId == nil ? nil : GCKCastContext.sharedInstance()
    }

    // MARK: - Calls

    /// Sets up the Cast SDK once, with the receiver application id the web build has (VITE_CAST_APP_ID).
    @objc func setUp(_ call: CAPPluginCall) {
        let requested = (call.getString("appId") ?? "").trimmingCharacters(in: .whitespaces)
        DispatchQueue.main.async {
            if self.appId == nil {
                // The app id in Info.plist (OpencastCastAppId) must match: its Bonjour entry is what iOS lets the SDK look for.
                let fromPlist = Bundle.main.object(forInfoDictionaryKey: "OpencastCastAppId") as? String ?? ""
                let id = requested.isEmpty ? fromPlist : requested
                guard !id.isEmpty else {
                    call.resolve(["available": false])
                    return
                }
                if !fromPlist.isEmpty && fromPlist != id {
                    CAPLog.print("⚡️ OpencastCast: VITE_CAST_APP_ID (\(id)) isn't Info.plist's OpencastCastAppId (\(fromPlist)). Run `npm run build:native` again.")
                }
                let options = GCKCastOptions(discoveryCriteria: GCKDiscoveryCriteria(applicationID: id))
                // There's no Cast button: "Watch on" is the app's own list, so discovery starts when it opens.
                options.startDiscoveryAfterFirstTapOnCastButton = false
                options.physicalVolumeButtonsWillControlDeviceVolume = true
                GCKCastContext.setSharedInstanceWith(options)
                let ctx = GCKCastContext.sharedInstance()
                ctx.discoveryManager.add(self)
                ctx.sessionManager.add(self)
                self.appId = id
            }
            call.resolve(["available": requested.isEmpty || requested == self.appId])
        }
    }

    /// Starts looking (the first time, iOS asks for local network access) and says what's found now.
    @objc func startDiscovery(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let ctx = self.context else {
                call.reject("Cast isn't set up.")
                return
            }
            ctx.discoveryManager.passiveScan = false
            ctx.discoveryManager.startDiscovery()
            call.resolve(["devices": self.devices()])
        }
    }

    @objc func stopDiscovery(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.context?.discoveryManager.stopDiscovery()
            call.resolve()
        }
    }

    @objc func startSession(_ call: CAPPluginCall) {
        guard let deviceId = call.getString("deviceId") else {
            call.reject("No TV was given.")
            return
        }
        DispatchQueue.main.async {
            guard let ctx = self.context else {
                call.reject("Cast isn't set up.")
                return
            }
            // Already casting to this TV: carry on with that session.
            if let session = ctx.sessionManager.currentCastSession, session.device.deviceID == deviceId, session.connectionState == .connected {
                self.attach(session)
                call.resolve(["device": self.describe(session.device)])
                return
            }
            guard let device = ctx.discoveryManager.device(withUniqueID: deviceId) else {
                call.reject("That TV isn't on the network now.")
                return
            }
            self.pendingStart?.reject("Another cast started.")
            self.pendingStart = call
            if !ctx.sessionManager.startSession(with: device) {
                self.pendingStart = nil
                call.reject("Casting didn't start.")
            }
        }
    }

    @objc func sendMessage(_ call: CAPPluginCall) {
        let message = call.getString("message") ?? ""
        DispatchQueue.main.async {
            guard let channel = self.channel, channel.isConnected else {
                call.reject("Not casting.")
                return
            }
            if channel.sendTextMessage(message, error: nil) {
                call.resolve()
            } else {
                call.reject("The TV didn't take the message.")
            }
        }
    }

    @objc func endSession(_ call: CAPPluginCall) {
        let stopCasting = call.getBool("stopCasting") ?? true
        DispatchQueue.main.async {
            self.detach()
            self.context?.sessionManager.endSessionAndStopCasting(stopCasting)
            call.resolve()
        }
    }

    // MARK: - Sessions and devices

    private func describe(_ device: GCKDevice) -> [String: Any] {
        ["id": device.deviceID, "name": device.friendlyName ?? device.modelName ?? "A TV with Chromecast"]
    }

    private func devices() -> [[String: Any]] {
        guard let dm = context?.discoveryManager else { return [] }
        return (0..<dm.deviceCount).map { describe(dm.device(at: $0)) }
    }

    private func attach(_ session: GCKCastSession) {
        if channelSession === session, channel != nil { return }
        detach()
        let channel = OpencastCastChannel(namespace: OpencastCastPlugin.namespace)
        channel.onText = { [weak self] text in
            self?.notifyListeners("message", data: ["namespace": OpencastCastPlugin.namespace, "message": text])
        }
        session.add(channel)
        self.channel = channel
        channelSession = session
    }

    private func detach() {
        if let channel = channel {
            channelSession?.remove(channel)
        }
        channel = nil
        channelSession = nil
    }

    // Listener methods carry their Objective-C selectors, so each is sure to match the SDK's
    // optional protocol requirement (a near-miss Swift name would compile and never be called).

    @objc(didUpdateDeviceList)
    public func didUpdateDeviceList() {
        notifyListeners("devicesChanged", data: ["devices": devices()])
    }

    @objc(sessionManager:didStartSession:)
    public func sessionManager(_ sessionManager: GCKSessionManager, started session: GCKSession) {
        guard let cast = session as? GCKCastSession else { return }
        attach(cast)
        pendingStart?.resolve(["device": describe(cast.device)])
        pendingStart = nil
    }

    @objc(sessionManager:didResumeSession:)
    public func sessionManager(_ sessionManager: GCKSessionManager, resumed session: GCKSession) {
        guard let cast = session as? GCKCastSession else { return }
        attach(cast)
    }

    @objc(sessionManager:didFailToStartSession:withError:)
    public func sessionManager(_ sessionManager: GCKSessionManager, failedToStart session: GCKSession, error: Error) {
        pendingStart?.reject("Casting didn't start.", nil, error)
        pendingStart = nil
    }

    @objc(sessionManager:didEndSession:withError:)
    public func sessionManager(_ sessionManager: GCKSessionManager, ended session: GCKSession, error: Error?) {
        let wasOurs = channelSession === session
        if wasOurs { detach() }
        if let pending = pendingStart {
            pending.reject("Casting didn't start.")
            pendingStart = nil
        }
        if wasOurs {
            var data: [String: Any] = [:]
            if let error = error { data["error"] = error.localizedDescription }
            notifyListeners("sessionEnded", data: data)
        }
    }
}

extension OpencastCastPlugin: GCKDiscoveryManagerListener, GCKSessionManagerListener {}
