import Foundation
import AVFoundation
import MediaPlayer
import Capacitor

/// Lock-screen controls (`OpencastNowPlaying`): the station and what's on in Now Playing, with next
/// and previous track as channel up and down, and pause and play. Each press goes to the web side
/// as an `action` event (apps/web/src/viewer/native/lockScreen.ts turns it into the player's command).
///
/// iOS shows these only for the app that's playing sound (the Now Playing app), and only while the
/// app can keep playing with the phone locked (UIBackgroundModes audio, and the audio session's
/// playback category, set here). While casting the phone is quiet, so expect no lock-screen
/// controls on an iPhone then (inventory raise 15).
@objc(OpencastNowPlayingPlugin)
public class OpencastNowPlayingPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "OpencastNowPlayingPlugin"
    public let jsName = "OpencastNowPlaying"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise)
    ]

    private var targets: [(MPRemoteCommand, Any)] = []

    override public func load() {
        // A TV station: plays with the ring switch on silent, and keeps playing when the phone locks.
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback, options: [])
    }

    @objc func update(_ call: CAPPluginCall) {
        let title = call.getString("title") ?? "Opencast"
        let subtitle = call.getString("subtitle")
        let playing = call.getBool("playing") ?? false
        DispatchQueue.main.async {
            self.enable()
            var info: [String: Any] = [
                MPMediaItemPropertyTitle: title,
                MPNowPlayingInfoPropertyIsLiveStream: true,
                MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.video.rawValue,
                MPNowPlayingInfoPropertyPlaybackRate: playing ? 1.0 : 0.0
            ]
            if let subtitle = subtitle { info[MPMediaItemPropertyArtist] = subtitle }
            MPNowPlayingInfoCenter.default().nowPlayingInfo = info
            call.resolve()
        }
    }

    @objc func clear(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.disable()
            MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
            call.resolve()
        }
    }

    private func enable() {
        guard targets.isEmpty else { return }
        let center = MPRemoteCommandCenter.shared()
        let actions: [(MPRemoteCommand, String)] = [
            (center.nextTrackCommand, "next"),
            (center.previousTrackCommand, "previous"),
            (center.playCommand, "play"),
            (center.pauseCommand, "pause"),
            (center.togglePlayPauseCommand, "toggle")
        ]
        for (command, action) in actions {
            command.isEnabled = true
            let target = command.addTarget { [weak self] _ in
                self?.notifyListeners("action", data: ["action": action])
                return .success
            }
            targets.append((command, target))
        }
        // Live: nothing to seek or skip through.
        center.skipForwardCommand.isEnabled = false
        center.skipBackwardCommand.isEnabled = false
        center.changePlaybackPositionCommand.isEnabled = false
        center.seekForwardCommand.isEnabled = false
        center.seekBackwardCommand.isEnabled = false
    }

    private func disable() {
        for (command, target) in targets {
            command.removeTarget(target)
            command.isEnabled = false
        }
        targets = []
    }
}
