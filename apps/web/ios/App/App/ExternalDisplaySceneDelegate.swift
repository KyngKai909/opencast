import UIKit

/// Where the iPhone's external display (Screen Mirroring to an AirPlay TV, or the Simulator's
/// I/O → External Displays) arrives. iOS gives a connected display its own scene, with the role
/// `.windowExternalDisplayNonInteractive` (AppDelegate picks this delegate for it). Until the app
/// puts a window on that scene, iOS mirrors the phone's screen; OpencastMirrorPlugin puts TV mode there.
class ExternalDisplaySceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        OpencastMirrorCenter.shared.sceneConnected(windowScene)
    }

    func sceneDidDisconnect(_ scene: UIScene) {
        guard let windowScene = scene as? UIWindowScene else { return }
        window = nil
        OpencastMirrorCenter.shared.sceneDisconnected(windowScene)
    }
}

/// Between external display scenes and the plugin: a display can connect before the web view has
/// loaded the plugin (mirroring was already on when the app opened), so the center keeps it.
final class OpencastMirrorCenter {
    static let shared = OpencastMirrorCenter()

    weak var plugin: OpencastMirrorPlugin?
    private(set) var scene: UIWindowScene?

    func sceneConnected(_ scene: UIWindowScene) {
        self.scene = scene
        plugin?.displayAvailable(scene)
    }

    func sceneDisconnected(_ scene: UIWindowScene) {
        guard self.scene === scene else { return }
        self.scene = nil
        plugin?.displayGone(scene)
    }
}
