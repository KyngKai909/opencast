import UIKit
import WebKit
import AVFoundation
import Capacitor

/// Mirroring to an AirPlay TV (`OpencastMirror`, tv-update 02). When Screen Mirroring connects, iOS
/// gives the TV its own scene (ExternalDisplaySceneDelegate); this puts a second web view there
/// with TV mode (`/tv/index.html?mirror&device=&market=&station=`, the bridge input), so the TV
/// shows TV mode full screen while the phone shows the remote. The web side is
/// apps/web/src/viewer/cast/mirroring.ts.
///
/// - Phone to TV: `send` posts `{opencast: "command", command}` in the TV's web view, which TV
///   mode's bridge input takes (packages/player/src/input/bridge.ts).
/// - TV to phone: TV mode posts `{opencast: "state", state}` to its own window; a script added here
///   forwards it, and the phone gets a `state` event.
/// - Events: `displayConnected {tvName}`, `displayDisconnected {reason, at}` ("locked": the phone
///   locked and mirroring stopped, told when the app is back in front; "ended": Screen Mirroring
///   was turned off), `battery {level, charging}` while connected.
///
/// TV mode's files: the copy inside the app (`build:native` puts apps/tv's build in dist/tv), served
/// by Capacitor's own scheme handler, so it's the same origin and version as the phone's app and
/// works with no TV host. `configure({tvUrl})` points it at a URL instead (live reload).
@objc(OpencastMirrorPlugin)
public class OpencastMirrorPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "OpencastMirrorPlugin"
    public let jsName = "OpencastMirror"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "configure", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "knownTvs", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "send", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]

    private static let knownKey = "opencast.mirror.knownTvs"
    private static let phoneHandler = "opencastPhone"
    /// TV mode's state messages, forwarded to the phone.
    private static let relayScript = """
    window.addEventListener("message", function (e) {
      if (e.source !== window) return;
      var d = e.data;
      if (d && d.opencast === "state" && d.state && d.state.type === "state") {
        window.webkit.messageHandlers.\(phoneHandler).postMessage(d.state);
      }
    });
    """

    private struct Config {
        var device: String?
        var marketSlug: String?
        var stationId: String?
        var tvUrl: String?
    }

    private var config = Config()
    /// The web side has said who and what at least once: TV mode can open on the phone's station.
    private var configured = false
    private var scene: UIWindowScene?
    private var window: UIWindow?
    private var tvView: WKWebView?
    /// The web side was told the TV is showing TV mode (and not told since that it stopped).
    private var announced = false
    /// Stop was pressed on the phone: leave the TV mirroring the phone until the display connects again.
    private var stoppedByPhone = false
    private var backgroundedAt: Date?
    /// The display went away while the app was in the background: most likely the phone locked.
    private var lostWhileAway: Date?
    private var observers: [NSObjectProtocol] = []

    override public func load() {
        OpencastMirrorCenter.shared.plugin = self
        let nc = NotificationCenter.default
        observers = [
            nc.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
                self?.backgroundedAt = Date()
            },
            nc.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
                self?.cameBack()
            },
            nc.addObserver(forName: UIDevice.batteryLevelDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
                self?.sendBattery()
            },
            nc.addObserver(forName: UIDevice.batteryStateDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
                self?.sendBattery()
            }
        ]
        DispatchQueue.main.async {
            if let waiting = OpencastMirrorCenter.shared.scene { self.displayAvailable(waiting) }
        }
    }

    deinit {
        observers.forEach { NotificationCenter.default.removeObserver($0) }
    }

    // MARK: - Calls

    @objc func configure(_ call: CAPPluginCall) {
        let next = Config(
            device: call.getString("device"),
            marketSlug: call.getString("marketSlug"),
            stationId: call.getString("stationId"),
            tvUrl: call.getString("tvUrl")
        )
        DispatchQueue.main.async {
            self.config = next
            self.configured = true
            self.showIfReady()
            call.resolve()
        }
    }

    @objc func knownTvs(_ call: CAPPluginCall) {
        call.resolve(["names": UserDefaults.standard.stringArray(forKey: OpencastMirrorPlugin.knownKey) ?? []])
    }

    @objc func send(_ call: CAPPluginCall) {
        guard let command = call.getObject("command") else {
            call.reject("No command was given.")
            return
        }
        guard let data = try? JSONSerialization.data(withJSONObject: ["opencast": "command", "command": command]),
              let json = String(data: data, encoding: .utf8) else {
            call.reject("The command isn't JSON.")
            return
        }
        DispatchQueue.main.async {
            // Posted to TV mode's own window, so its bridge input sees its own origin.
            self.tvView?.evaluateJavaScript("window.postMessage(\(json), \"*\");", completionHandler: nil)
            call.resolve()
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.stoppedByPhone = true
            self.tearDown()
            self.announced = false
            call.resolve()
        }
    }

    // MARK: - The external display

    func displayAvailable(_ scene: UIWindowScene) {
        self.scene = scene
        stoppedByPhone = false
        showIfReady()
    }

    func displayGone(_ scene: UIWindowScene) {
        guard self.scene === scene else { return }
        self.scene = nil
        tearDown()
        guard announced else { return }
        if let away = backgroundedAt {
            // Decided when the app is in front again (cameBack): the display may come straight back.
            lostWhileAway = away
        } else {
            announceDisconnected(reason: "ended", at: Date())
        }
    }

    private func cameBack() {
        backgroundedAt = nil
        showIfReady()
        guard let lost = lostWhileAway else { return }
        // Give a display that was only away while the app was (the home screen) a moment to return.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
            guard let self = self, self.lostWhileAway == lost else { return }
            self.lostWhileAway = nil
            if self.scene == nil { self.announceDisconnected(reason: "locked", at: lost) }
        }
    }

    private func showIfReady() {
        guard let scene = scene, window == nil, configured, !stoppedByPhone,
              UIApplication.shared.applicationState == .active,
              let url = tvURL() else { return }

        let web = WKWebViewConfiguration()
        web.allowsInlineMediaPlayback = true
        web.mediaTypesRequiringUserActionForPlayback = []
        // The picture is already on the TV.
        web.allowsAirPlayForMediaPlayback = false
        // The app's own files, as the phone's web view gets them (capacitor://localhost/tv/...).
        if let scheme = bridge?.config.localURL.scheme,
           let handler = bridge?.webView?.configuration.urlSchemeHandler(forURLScheme: scheme) {
            web.setURLSchemeHandler(handler, forURLScheme: scheme)
        }
        let content = WKUserContentController()
        content.add(WeakScriptHandler(self), name: OpencastMirrorPlugin.phoneHandler)
        content.addUserScript(WKUserScript(source: OpencastMirrorPlugin.relayScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        web.userContentController = content

        let view = WKWebView(frame: scene.coordinateSpace.bounds, configuration: web)
        let ground = UIColor(red: 0x0F / 255, green: 0x18 / 255, blue: 0x30 / 255, alpha: 1)
        view.isOpaque = true
        view.backgroundColor = ground
        view.scrollView.backgroundColor = ground
        view.scrollView.isScrollEnabled = false
        view.scrollView.contentInsetAdjustmentBehavior = .never
        #if DEBUG
        if #available(iOS 16.4, *) { view.isInspectable = true }
        #endif

        let controller = UIViewController()
        controller.view = view
        let window = UIWindow(windowScene: scene)
        window.rootViewController = controller
        window.isHidden = false
        (scene.delegate as? ExternalDisplaySceneDelegate)?.window = window
        self.window = window
        tvView = view
        view.load(URLRequest(url: url))

        UIDevice.current.isBatteryMonitoringEnabled = true
        if !announced {
            announced = true
            var data: [String: Any] = [:]
            if let name = airPlayName() {
                remember(name)
                data["tvName"] = name
            }
            notifyListeners("displayConnected", data: data)
        }
        sendBattery()
    }

    private func tearDown() {
        tvView?.configuration.userContentController.removeScriptMessageHandler(forName: OpencastMirrorPlugin.phoneHandler)
        tvView?.stopLoading()
        tvView = nil
        window?.isHidden = true
        if let scene = window?.windowScene { (scene.delegate as? ExternalDisplaySceneDelegate)?.window = nil }
        window = nil
        UIDevice.current.isBatteryMonitoringEnabled = false
    }

    private func announceDisconnected(reason: String, at: Date) {
        announced = false
        notifyListeners("displayDisconnected", data: ["reason": reason, "at": (at.timeIntervalSince1970 * 1000).rounded()])
    }

    private func tvURL() -> URL? {
        let base: URL?
        if let s = config.tvUrl, !s.isEmpty {
            base = URL(string: s)
        } else {
            base = bridge?.config.localURL.appendingPathComponent("tv/index.html")
        }
        guard let b = base, var parts = URLComponents(url: b, resolvingAgainstBaseURL: false) else { return nil }
        var items = [URLQueryItem(name: "mirror", value: nil)]
        if let d = config.device { items.append(URLQueryItem(name: "device", value: d)) }
        if let m = config.marketSlug { items.append(URLQueryItem(name: "market", value: m)) }
        if let s = config.stationId { items.append(URLQueryItem(name: "station", value: s)) }
        parts.queryItems = items
        return parts.url
    }

    /// The AirPlay route's name ("Bedroom TV"); none on the Simulator's external display.
    private func airPlayName() -> String? {
        AVAudioSession.sharedInstance().currentRoute.outputs.first { $0.portType == .airPlay }?.portName
    }

    private func remember(_ name: String) {
        var names = UserDefaults.standard.stringArray(forKey: OpencastMirrorPlugin.knownKey) ?? []
        names.removeAll { $0 == name }
        names.append(name)
        UserDefaults.standard.set(Array(names.suffix(10)), forKey: OpencastMirrorPlugin.knownKey)
    }

    private func sendBattery() {
        guard window != nil else { return }
        let device = UIDevice.current
        // -1 when unknown (the Simulator): the web side drops it.
        let charging = device.batteryState == .charging || device.batteryState == .full
        notifyListeners("battery", data: ["level": Double(device.batteryLevel), "charging": charging])
    }

    fileprivate func received(_ message: WKScriptMessage) {
        guard message.name == OpencastMirrorPlugin.phoneHandler, let state = message.body as? [String: Any] else { return }
        notifyListeners("state", data: state)
    }
}

/// WKUserContentController keeps its handlers strongly; this keeps the plugin weakly.
private final class WeakScriptHandler: NSObject, WKScriptMessageHandler {
    private weak var plugin: OpencastMirrorPlugin?

    init(_ plugin: OpencastMirrorPlugin) {
        self.plugin = plugin
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        plugin?.received(message)
    }
}
