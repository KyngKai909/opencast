import UIKit
import Capacitor

/// The app's web view controller: Capacitor's, plus Opencast's own plugins. Their code is in this
/// target rather than in npm packages, so `cap sync` doesn't find them; they're registered here.
/// The web side reaches them by name (apps/viewer/src/native/plugins.ts).
class OpencastBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(OpencastCastPlugin())
        bridge?.registerPluginInstance(OpencastMirrorPlugin())
        bridge?.registerPluginInstance(OpencastNowPlayingPlugin())
    }
}
