# Native builds

Three builds wrap the web apps with Capacitor 8:

- the Opencast app on iPhone;
- the Opencast app on Android;
- TV mode on Android TV and Fire TV.

A fourth packages TV mode without Capacitor, as a Tizen web app for Samsung TVs (see
[TV mode on Samsung TVs (Tizen)](#tv-mode-on-samsung-tvs-tizen)).

The Opencast app is `apps/web`: the viewer at `/`, master control at `/control` and Network desk at
`/desk`, with one sign-in. The phone apps wrap all of it, so creators get master control on their
phones too (going live from the phone included); viewers never download master control or the desk,
which load only when opened. The app id stays the viewer's, `org.useopencast.viewer`: the native
projects' packages (`org.useopencast.viewer`) and any store records keep it. Changing it to
`org.useopencast.app` means renaming the Android package folders and the Xcode bundle id together,
before anything is submitted.

Nothing has been submitted to any store. Each section below covers:

- what the build needs to ship;
- the exact commands;
- the STOP demo.

**Toolchains everywhere:** Node 22 or later. Capacitor 8 needs Xcode 26.0 or later and Android Studio 2025.2.1 or later. Android Studio brings its own JDK 21.

**Never build `apps/web/android` and `apps/tv/android` at the same time.** Both compile the shared `node_modules/@capacitor/android` and `@capacitor/app`, and those modules keep their build folders inside `node_modules`. Two Gradle runs at once overwrite each other's output. The failures look like "cannot access Bridge" or a missing `R-def.txt`. Build one project, then the other.

## The Opencast app on iPhone and Android

The Opencast app's web build (`apps/web`) runs in a Capacitor WebView, from the files bundled into the app, with three plugins of its own:

- **Casting to Chromecast** (both platforms), so an iPhone can cast too. Safari can't.
- **Mirroring to an AirPlay TV** (iPhone only): TV mode appears on the external display.
- **Lock-screen controls** (both platforms): channel up, channel down, and pause.

### What's where

| File | What it does |
|---|---|
| `apps/web/capacitor.config.ts` | App id `org.useopencast.viewer`, name "Opencast", `webDir: "dist"`, the dark ground behind the WebView. `CAP_SERVER_URL` switches on live reload (below). |
| `scripts/build-native.mjs` (`npm run build:native`) | Checks the env, builds the Opencast app, builds TV mode into `dist/tv/` for the iPhone, writes the Cast receiver id for Xcode and Gradle, then runs `cap sync`. |
| `scripts/native-art.mjs` (`npm run native:art`) | Draws the app icons and launch screens from the PWA's mark (`public/icons/icon.svg`), in the PWA icon's colours. The PWA's icons stop at 512 px and the App Store needs 1024 px. |
| `src/viewer/native/platform.ts` | `isNative()` and `hasPlugin(name)`. Every native path asks these, so the web build behaves as before. |
| `src/viewer/native/plugins.ts` | The three plugins' TypeScript interfaces (`registerPlugin`). |
| `src/viewer/native/nativeCastSender.ts` | The Cast sender for both apps, over the `OpencastCast` plugin. `senderFor` chooses it when the app has the plugin (`src/viewer/cast/sender.ts`). It uses the same messages and namespace as the web sender. Unlike the web sender, it lists TVs by name. |
| `src/viewer/cast/mirroring.ts` | The mirroring seam. `nativeMirroring()` turns the `OpencastMirror` plugin's events into the status that CastSync and the remote already read (guide, remote while mirroring, "Mirroring stopped", battery line). Keep-awake comes from `@capacitor-community/keep-awake`. |
| `src/viewer/native/haptics.ts` | The swipe home's haptic tick (A245): a light impact from `@capacitor/haptics` (an npm plugin, registered by `cap sync` like `@capacitor/app` and `@capacitor/device`) when the drag crosses the detent and on the snap; `navigator.vibrate` in browsers that have it (Android's); nothing in iPhone browsers, or with reduced motion. Next and previous on the lock screen follow the swipe's order (presets, then the dial) in the apps. |
| `src/viewer/native/lockScreen.ts` | Turns lock-screen presses into player commands: next and previous are channel up and down, and pause, play and toggle map to themselves. `PlayerRoot` uses it in place of the web's Media Session when the app has the plugin, and keeps the lock screen showing the station and what's on. |
| `ios/App/App/OpencastBridgeViewController.swift` | Capacitor's view controller, which registers the three plugins. They live in the app target, not in npm packages, so `cap sync` doesn't find them. |
| `ios/App/App/OpencastCastPlugin.swift` | `OpencastCast` for iOS: the Google Cast iOS SDK. |
| `ios/App/App/OpencastMirrorPlugin.swift`, `ExternalDisplaySceneDelegate.swift` | `OpencastMirror`: the external display's scene and a second WKWebView showing TV mode. |
| `ios/App/App/OpencastNowPlayingPlugin.swift` | `OpencastNowPlaying` for iOS: Now Playing and `MPRemoteCommandCenter`. |
| `android/app/src/main/java/org/useopencast/viewer/OpencastCastPlugin.kt`, `CastOptionsProvider.kt` | `OpencastCast` for Android: `play-services-cast-framework` with MediaRouter discovery. |
| `android/app/src/main/java/org/useopencast/viewer/OpencastNowPlayingPlugin.kt` | `OpencastNowPlaying` for Android: a MediaSession and its notification. |
| `android/app/src/main/java/org/useopencast/viewer/MainActivity.java` | Registers the Android plugins, and puts direct mode (A239) in front of Capacitor's web view client. |
| `src/viewer/native/direct.ts`, `packages/player/native/android/…` | Direct mode (A239, Android only): external stream links fetched with the phone's own networking. See [Direct mode](#direct-mode-external-stream-links-a239). |

### The env, and where the app's files come from

`build:native` reads Vite's env for the mode: `.env`, `.env.local`, `.env.[mode]`, then the shell's `VITE_` variables. It refuses to build when something is missing.

| Variable | Needed | Notes |
|---|---|---|
| `VITE_API_BASE` | Yes | Baked into the bundle. Must be `https://` for a phone. The iOS Simulator can reach this computer's `localhost`. The Android emulator reaches it as `10.0.2.2`. The API must allow CORS from the apps' origins: `capacitor://localhost` (iOS) and `https://localhost` (Android). |
| `VITE_PRIVY_APP_ID` | Yes, to sign in | Add `capacitor://localhost` and `https://localhost` to the Privy app's allowed origins. See open question 1. |
| `VITE_CAST_APP_ID` | For Chromecast | Also written to `ios/opencast.xcconfig` (Info.plist's Bonjour entry needs it at build time) and to `android/app/src/main/res/values/opencast.xml` (the Cast framework's options provider). Without it, "Watch on" offers no Chromecasts. TV apps (through the relay) and AirPlay mirroring still work. |
| `VITE_MIRROR_TV` | No | `bundled` (default) or `url`. With `url`, the external display loads TV mode from `VITE_TV_URL` instead of the app's own copy. Use it with live reload. |
| `VITE_MOCK` | Must be unset | dev:mock needs a service worker, and the apps' WebViews don't have one: WKWebView allows service workers only for app-bound domains. |

**TV mode for the external display comes bundled.** `build:native ios` builds `apps/tv` with base `/tv/` into `dist/tv/`. The mirror plugin loads `capacitor://localhost/tv/index.html?mirror&device=…&market=…&station=…` through Capacitor's own scheme handler. The other choice was loading TV mode from its web URL. Bundling is better for four reasons:

- TV mode is always the same version as the remote talking to it.
- It opens with no network round trip and no dependence on a TV host being up.
- It's the same origin, so no CORS or allowed-origin setup.
- App Review sees the code it reviews. Guideline 2.5.2 is wary of code loaded later.

It costs about 1.8 MB in the iPhone app. The Android viewer doesn't mirror, so `build:native android` skips it.

**Live reload** (development only; `build:native` refuses to run while it's set):

```sh
npm run dev -w @opencast/web                                       # the Vite dev server, port 5173
CAP_SERVER_URL=http://192.168.1.20:5173 npx cap sync ios           # this Mac's LAN address; the Simulator can use http://localhost:5173
# then Run from Xcode. For the external display, also run TV mode (npm run dev -w @opencast/tv)
# and start the Opencast app with VITE_MIRROR_TV=url VITE_TV_URL=http://192.168.1.20:5175
```

Run `npx cap sync` again without `CAP_SERVER_URL` before any real build.

### The Opencast app on iPhone (iOS)

**Toolchain:**

- Xcode 26 or later. The Simulator runtime for iOS 26 or later is enough.
- The deployment target is **iOS 16.0**. Google's Cast SDK 4.8.6 needs 16, and the external display's scene role, `.windowExternalDisplayNonInteractive`, is iOS 16 too. `cap sync` writes `CapApp-SPM` with `.iOS(.v16)` to match.

**Packages:**

- Swift Package Manager only; there is no CocoaPods.
- `CapApp-SPM` is Capacitor's generated package.
- **`https://github.com/googlecast/google-cast-ios-sdk`** is Google's official package, product `GoogleCastDynamic`, up to the next minor from 4.8.6. It's added to the App target in `project.pbxproj`. Xcode downloads it on first open. Use the dynamic product, not the static one: the static one can't carry the SDK's resource bundles through SPM.

**Bundle id and signing:**

- Bundle id: `org.useopencast.viewer`.
- Signing is Automatic. Set the team in Xcode (Signing & Capabilities) or pass `DEVELOPMENT_TEAM`.
- Register the id in the Apple Developer account, then create the App Store Connect record with the same id.

**Capabilities and entitlements:**

- **Background Modes → Audio**: Info.plist `UIBackgroundModes = [audio]`. Lock-screen controls need it, because iOS only shows them for an app that keeps playing when the phone locks. App Review will expect sound to keep playing in the background: a TV station's audio does.
- **Local network:** not an entitlement. It's Info.plist `NSLocalNetworkUsageDescription` and `NSBonjourServices` (`_googlecast._tcp`, `_<app id>._googlecast._tcp`). No multicast entitlement is needed for Cast discovery.
- **External display:** no entitlement. It's the scene configuration: `UIWindowSceneSessionRoleExternalDisplayNonInteractive` → `ExternalDisplaySceneDelegate` in Info.plist, and the same choice in `AppDelegate.application(_:configurationForConnecting:options:)`.
- There is no `.entitlements` file. Nothing here needs one.

**Info.plist entries added:**

| Key | Value |
|---|---|
| `NSLocalNetworkUsageDescription` | "Opencast looks for TVs with Chromecast on your Wi-Fi so you can watch on them." |
| `NSBonjourServices` | `_googlecast._tcp`, `_$(OPENCAST_CAST_APP_ID)._googlecast._tcp` |
| `OpencastCastAppId` | `$(OPENCAST_CAST_APP_ID)`. The plugin warns if the web build's id differs. |
| `UIBackgroundModes` | `audio` |
| `ITSAppUsesNonExemptEncryption` | `false` (HTTPS only), so App Store Connect stops asking at every upload |
| `UIApplicationSceneManifest` | Adds the external display role |
| `UIRequiredDeviceCapabilities` | `arm64` (the template said `armv7`) |

`OPENCAST_CAST_APP_ID` comes from `ios/opencast.xcconfig`: the Debug build includes it from `debug.xcconfig`, and it's the Release base configuration.

**Build and run:**

```sh
cd apps/web
npm run build:native -- ios                    # or: npm run build:native -- ios --mode staging
npx cap open ios                               # Xcode: pick a Simulator or a phone, then Run
# or without opening Xcode:
npx cap run ios --target "<simulator UDID>"    # xcrun simctl list devices
# an archive for App Store Connect (in Xcode: Product → Archive → Distribute App)
```

### The Opencast app on Android

**Toolchain:**

- Android Studio 2025.2.1 or later, with its JDK 21.
- Android Gradle Plugin 8.13 and the Gradle 8.14.3 wrapper.
- **Kotlin 2.3.21**, added for the plugins: `kotlinVersion` in `android/build.gradle`, with `jvmToolchain(21)`.
- Levels: `minSdkVersion 24`, `compileSdkVersion` and `targetSdkVersion` 36 (the Capacitor template's values in `android/variables.gradle`).

**Dependencies added** (in `android/variables.gradle`):

- `com.google.android.gms:play-services-cast-framework:22.3.1`
- `androidx.mediarouter:mediarouter:1.8.1`
- `androidx.media:media:1.7.1`. Version 1.8 deprecates `MediaSessionCompat` in favour of Media3; moving to Media3 is later work.

**App id:** `org.useopencast.viewer` (namespace too).

**Manifest entries added:**

- The Cast options provider meta-data, `com.google.android.gms.cast.framework.OPTIONS_PROVIDER_CLASS_NAME` → `CastOptionsProvider`.
- The now-playing notification's action receiver (not exported).
- `networkSecurityConfig="@xml/network_security_config"` (A239): cleartext permitted, for direct mode's native fetches of http stream links. The web view stays https only (mixed content is never allowed).
- Permissions:
  - `ACCESS_NETWORK_STATE` and `ACCESS_WIFI_STATE`, which the Cast framework needs; its own manifest adds them too.
  - `POST_NOTIFICATIONS`. A media session's notification shows without asking on Android 13 and later; the permission is declared so lint's check passes. The app never asks for it.

**Signing:**

- A debug build signs with the debug key.
- For Play, create an upload key (`keytool -genkeypair -v -keystore opencast-viewer-upload.jks -alias opencast-viewer -keyalg RSA -keysize 4096 -validity 10000`) and keep it out of git.
- Add a `signingConfigs.release` block that reads its path and passwords from `~/.gradle/gradle.properties`.
- Use Play App Signing.

**Compiled here:**

- `./gradlew assembleDebug` succeeds.
- `./gradlew :app:lintDebug` reports 0 errors. The warnings are the template's own: unused resources, splash densities, `uses-permission` after `application`.
- It has never run on a device or an emulator.

**Build and run:**

```sh
cd apps/web
npm run build:native -- android
cd android
./gradlew assembleDebug                       # app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/debug/app-debug.apk
./gradlew bundleRelease                       # the .aab for Play, once signing is set up
# or: npx cap open android, then Run in Android Studio
```

### The plugins

**`OpencastCast`** (iOS and Android). Its calls:

- `setUp({appId})`
- `startDiscovery()` → `{devices}`
- `stopDiscovery()`
- `startSession({deviceId})` → `{device}`
- `sendMessage({namespace, message})`
- `endSession({stopCasting})`

Its events:

- `devicesChanged {devices}`
- `message {namespace, message}`: JSON text on `urn:x-cast:org.useopencast.tv`
- `sessionEnded {error?}`

How it works:

- **iOS:** `GCKCastContext` with discovery for the receiver's app id. `startDiscoveryAfterFirstTapOnCastButton = false`, because there's no Cast button: "Watch on" is the app's own list, and discovery starts when it opens. That's also when iOS asks for local network access.
- **Android:** `CastContext` (the options provider gives the receiver id) and MediaRouter with the receiver's Cast category. Selecting a route starts the session.
- **Both:** the plugin sends and receives text on the namespace; `nativeCastSender` does the rest:
  - the "session" introduction;
  - `receiver-ready`, which makes it introduce the phone again;
  - `session-ended`.

**`OpencastMirror`** (iOS only). Its calls:

- `configure({device, marketSlug, stationId, tvUrl})`: CastSync sends it whenever these change.
- `knownTvs()`: AirPlay route names seen before, kept in UserDefaults.
- `send({command})`
- `stop()`

Its events:

- `displayConnected {tvName}`
- `displayDisconnected {reason: "locked" | "ended", at}`
- `battery {level, charging}`
- `state {…}`

How it works:

- **Connecting.** When Screen Mirroring connects, iOS gives the TV its own scene. The plugin puts a window there with a WKWebView loading TV mode. Until the app does that, iOS just mirrors the phone. If the display connects while Control Center is still open, TV mode waits until the app is in front again.
- **Commands** go to TV mode as `window.postMessage({opencast: "command", command}, "*")` in the TV's own window, which is what TV mode's bridge input listens for.
- **The phone's name** comes from the account, never from `UIDevice.name`. `mirrorDeviceName("Kai M.")` is "Kai's iPhone". Signed out, the name is left off, and TV mode says "Mirrored from an iPhone".
- **The TV's name** is the AirPlay audio route's port name. The Simulator has none, so the name comes from the guide's TV.
- **"Locked":**
  - An app can't observe the lock itself, so the plugin infers it.
  - If the display goes away while the app is in the background, the phone most likely locked, since Screen Mirroring stops at the lock. A trip to the home screen keeps the display.
  - The plugin decides 1.5 seconds after the app is in front again. If the display hasn't come back, it sends `displayDisconnected {reason: "locked", at: <when the app left the front>}`, and the phone shows "Mirroring stopped".
  - A display that goes away while the app is in front is `ended`, and the phone just goes back to itself.
- **Battery.** UIDevice battery monitoring runs while the TV shows TV mode. Readings go out at the start and on every change. iOS reports 5% steps, and the estimate in `mirroring.ts` needs five minutes of falling readings, so the line shows nothing at first (raise 16).
- **Keeping the screen on.** `keepAwake` is on while mirroring.
- **State back to the phone:**
  - A script in the TV's web view forwards `window.postMessage({opencast: "state", state: {type: "state", …}})` from TV mode to the phone as the `state` event.
  - **TV mode doesn't post that yet**; it's a request for `apps/tv`, as a small addition in mirror mode.
  - Until then, the remote while mirroring draws from the phone's own state, as dev:mock's stand-in does.

**`OpencastNowPlaying`** (iOS and Android). Its calls:

- `update({title, subtitle, playing})`, where the title is "BEAT 12.1" and the subtitle is what's on
- `clear()`

Its event:

- `action {action: "next" | "previous" | "play" | "pause" | "toggle"}`

How it works on iOS:

- Now Playing info (live, no scrubbing) and `MPRemoteCommandCenter` targets.
- The audio session is set to `.playback` / `.moviePlayback`, so the sound ignores the ring switch and keeps playing when the phone locks.

How it works on Android:

- A `MediaSessionCompat` with a MediaStyle notification: channel down, pause or play, channel up.
- Android 13 and later draw the controls from the session. Older versions use the notification's buttons, which come back through `ActionReceiver`.

**What works while casting (inventory raise 15).** The phone's player follows the TV, muted. A channel press on the lock screen tunes the phone, and CastSync sends that tune to the TV. So:

- **Android:** works while casting, from the notification and the lock screen.
- **iPhone: expect no lock-screen controls while casting.** iOS shows them only for the app that's playing sound, and the phone is silent while a TV plays. While the phone itself plays, they work. While mirroring, the sound comes from TV mode's web view, so what the lock screen shows follows the phone's player, not the TV.

### Store listing, and privacy (both stores)

**Listing:**

- Name "Opencast". Category Entertainment.
- A description in the house voice. Support and marketing URLs, and a privacy policy URL, which is required.
- Screenshots:
  - App Store: 6.9-inch iPhone. iPad screenshots too if iPad stays on; `TARGETED_DEVICE_FAMILY` is `1,2`. See open question 4.
  - Play: phone screenshots and a 1024×500 feature graphic.
- Age rating questionnaire (App Store) and IARC (Play). Station content is live and unscripted, so answer for user-generated or live content.
- **Content rights** (App Store): the app streams other parties' content (stations, carried programs, listed city streams). Say so, and keep the station agreements ready.
- **Play testing:** a new personal Play developer account must run a closed test with 12 testers for 14 days before production.

**Privacy.** This is a draft for the App Store privacy labels and Play's data safety form. Confirm it against the API's actual data before filling either in.

| Data | Collected when | Linked to the person | Used for |
|---|---|---|---|
| Email address (Privy sign-in) | Signed in | Yes | Account |
| User ID | Signed in | Yes | Account, presets, reminders |
| Coarse location: the ZIP typed for the market, and the market | Always | Yes when signed in | Choosing the market's dial |
| Product interaction (the audience heartbeat: station, platform, a session id) | While watching | No (session id only) | Analytics for stations. Viewers never see numbers. |
| Purchases (pledges, through Stripe) | When pledging | Yes | Payments. The card is handled by Stripe. |
| Contacts, photos, precise location, health, browsing history | Never | | |

- Tracking: **none**; no data is shared with data brokers or used for ads.
- Local network access is not "data collected".
- The Cast SDK's own collection is Google's, declared in the SDK's privacy manifest. After the first archive, check Xcode's privacy report (Organizer → Generate Privacy Report) and add what it lists to the labels.

### The Cast receiver application

1. Register at the Google Cast SDK Developer Console (https://cast.google.com/publish). It's a one-time US$5 fee.
2. Add a **Custom Receiver**. Its URL is TV mode's `receiver.html` over HTTPS, for example the staging TV build's. The console gives an application id, 8 characters.
3. Put the id in `VITE_CAST_APP_ID` for the viewer (web and apps) and for TV mode. `build:native` copies it into Xcode and Gradle.
4. Until the receiver is published, only **registered test devices** can load it:
   - Add each Chromecast or Google TV by serial number in the console.
   - Reboot the device about 15 minutes later.
   - Also enable "Send this Chromecast's serial number when checking for updates" on it.
5. Publish the receiver when the apps ship.

### Compiled or not: what to check first

| Files | State | Check first |
|---|---|---|
| `ios/App/App/*.swift` (the 5 new files, and the edits to `AppDelegate.swift` and `SceneDelegate.swift`) | **Never built.** Parsed, then type-checked with `swiftc` against Mac Catalyst's UIKit, WebKit, AVFoundation and MediaPlayer (the only iOS-flavoured SDK without Xcode). Capacitor and GoogleCast were replaced by hand-written stubs of their APIs. | **(1)** In Xcode, that `GoogleCastDynamic` resolves and `import GoogleCast` finds it. **(2)** The Cast listener methods: they carry explicit Objective-C selectors (`sessionManager:didStartSession:`…), so check they're called. **(3)** That the external display gets its own scene with `UIApplicationSupportsMultipleScenes` false; if it doesn't, set it to true. **(4)** That sharing Capacitor's scheme handler with the second WKWebView serves `/tv/…`. **(5)** Whether WebKit's own Now Playing (the `<video>` element) fights the plugin's; if it does, drop `OpencastNowPlaying` on iOS and let `lockScreenInput()` fall back to the web's Media Session. |
| `ios/App/App.xcodeproj/project.pbxproj`, `Info.plist`, `opencast.xcconfig`, `Main.storyboard` | Edited by hand. `plutil -lint` passes, and a script checked that every object reference resolves. | That Xcode opens it without "damaged project", and that Release picks up `opencast.xcconfig`. |
| `android/…/*.kt`, `MainActivity.java`, the manifest and Gradle files | **Compiled** (`assembleDebug`) and lint-clean. Never run. | On a device with Google Play services: discovery lists the TV, `selectRoute` starts a Cast session, and messages arrive. The notification's buttons on Android 12 and earlier. |
| `src/viewer/native/*.ts`, `src/viewer/cast/mirroring.ts`, `sender.ts` | Type-checked, tested with Vitest (`nativeCastSender.test.ts`, `mirroring.native.test.ts`, `lockScreen.test.ts`, `sender.test.ts`), built. The web build carries no native code beyond `@capacitor/core`'s `isNativePlatform`: the Cast sender and plugin interfaces are their own chunks, loaded only in the apps. | |

### The STOP demo

**1. The viewer on an iOS Simulator, casting.**

1. Build against an API the Simulator can reach, for example `VITE_API_BASE=https://<staging API> npm run build:native -- ios`. The API must allow CORS from `capacitor://localhost`.
2. `npx cap open ios`. Pick an iPhone Simulator and Run.
3. Tune in to a station, then tap the cast button to open **Watch on**.

- **With a Chromecast or Google TV** (a registered test device, with the receiver above). The Simulator uses this Mac's network, so it can find the TV on the same Wi-Fi:
  1. Allow local network access when asked.
  2. "Living room TV, Chromecast" appears. Choose Cast.
  3. The phone switches to the remote. CH ▲ changes the channel on the TV, and the TV's chip says "Playing from Kai's phone".
- **With no Chromecast:** the Cast SDK has no pretend TV, and dev:mock's mock receiver can't be reached from the Simulator. It talks over a BroadcastChannel inside one browser, and the app's WebView can't run dev:mock at all, because it has no service worker. What the Simulator can show without hardware:
  - the same phone remote driving TV mode through the relay (the "Opencast app" row). Use TV mode on the Android TV emulator (demo 3) or in a desktop browser, on the same API.
  - the native sender itself, shown by its tests over a mocked plugin (`npx vitest run src/viewer/native`).

  See open question 2.

**2. The external display on the Simulator.**

1. `npm run build:native -- ios` (bundles TV mode), then Run on an iPhone Simulator. Sign in if you want the chip to read "Mirrored from Kai's iPhone".
2. Tune in to a station.
3. In the Simulator, choose **I/O → External Displays → 1920×1080**. A window opens for the "TV". It shows TV mode on the phone's station, with "Mirrored from …" in the hint row. The phone switches to the remote by itself ("Mirroring to the TV").
4. Press CH ▲ and ▼, PLAY and Last on the phone: TV mode follows. The screen doesn't dim.
5. To see "Mirroring stopped":
   1. Choose **Device → Home** (the app goes to the background).
   2. Choose **I/O → External Displays → Disabled**.
   3. Open Opencast again. After a moment it shows "Mirroring stopped", with the time it left.
   4. Turn the external display back on: it goes back to the remote.

   Locking the Simulator doesn't end its external display the way Screen Mirroring ends at a real lock, so this stands in for it.
6. The battery line doesn't appear on the Simulator, because it reports no battery level. On a phone it appears after about five minutes of mirroring.

**3. TV mode on an Android TV emulator:** see the TV mode section below.

### Open questions (viewer apps)

1. **Privy inside the apps.**
   - Privy's web SDK in a WebView needs the apps' origins (`capacitor://localhost`, `https://localhost`) allowed.
   - Google and Apple OAuth refuse to sign in inside embedded WebViews. Email codes and passkeys work.
   - Decide:
     - email and passkeys only in the apps, or
     - Privy's native flow through the system browser, with a deep link back.
2. **"Casting to a mock receiver" on the Simulator.** A real Chromecast is the only way to show the Cast plugin itself (demo 1). Without hardware, the options are:
   - accept the relay to TV mode as the Simulator demo;
   - build a mock path for the apps. This would take:
     - `msw`'s interceptors in place of the service worker in native dev:mock (its `msw/native` entry is blocked for browsers, so it needs an alias);
     - TV mode's `receiver.html` loaded in the app's own external-display web view, so the BroadcastChannel is shared.

   That's a day's work, and it's untestable until Xcode is here.
3. **TV mode's state back to the phone while mirroring.** It needs a few lines in `apps/tv` mirror mode: `window.postMessage({opencast: "state", state}, location.origin)` whenever the player's state changes. Until then, the remote shows the phone's own state.
4. **iPad.**
   - The template targets iPhone and iPad.
   - The viewer isn't designed for iPad widths, and iPad needs its own screenshots.
   - Recommend iPhone only (`TARGETED_DEVICE_FAMILY = 1`) for the first release.
5. **Background audio policy.** `UIBackgroundModes audio` keeps sound playing when the phone locks. That's what lock-screen controls need, and what a station's audio listener expects. But the phone's player is muted while casting or mirroring, and App Review may object to background audio that is silent. If it does, drop audio from the background while a TV plays.

## TV mode on Android TV and Fire TV

TV mode's web build (`apps/tv`, the `index` entry) in a Capacitor 8 WebView, as one TV-only APK for Android TV, Google TV and Fire TV. Nothing has been submitted to a store.

**Never compiled here.** The Java, Gradle and manifest files were written by hand on a Mac without a finished Gradle run. When a build is possible, check these first:

1. `android/app/src/main/java/org/useopencast/tv/MainActivity.java`, `OpencastTvPlugin.java` and `TvKeys.java` (the only hand-written Java).
2. `android/app/src/main/AndroidManifest.xml`: the `tools:targetApi` attribute and `android:enableOnBackInvokedCallback`; the manifest merge with the debug manifest in `src/debug`.
3. `android/app/src/main/res/values/styles.xml`: `windowSplashScreenBackground` on `Theme.SplashScreen`.
4. `android/app/build.gradle`: the `signingConfigs` block.

The TypeScript half (`src/native/`) is tested with Vitest. A test also checks that `TvKeys.java` forwards exactly the keys `src/native/keys.ts` maps.

### What's where

| File | What it does |
|---|---|
| `apps/tv/capacitor.config.ts` | App id `org.useopencast.tv`, name "Opencast", `webDir: "dist"`, the dark ground behind the WebView, and the App plugin's back handler switched off. `TV_DEV_SERVER` points a debug build at a dev server. |
| `android/` | The Capacitor Android project (`npx cap add android`, then edited by hand). |
| `MainActivity.java` | Full screen with no system bars. Takes the TV's own keys from the WebView and sends them to the page through the plugin, as key down and key up. |
| `OpencastTvPlugin.java` | The `OpencastTv` plugin with four jobs: send the `key` events, answer `getInfo()` (what kind of TV this is), handle `setKeepScreenOn({ on })` (`FLAG_KEEP_SCREEN_ON`), and run `exitToHome()` (clears the flag, then finishes the activity). |
| `TvKeys.java` | The key codes that are forwarded. |
| `src/native/keys.ts` | Maps Android key codes to the `KeyboardEvent`s that `packages/player/src/input/keyboard.ts` already maps, and dispatches them on the focused element. |
| `src/native/platform.ts` | Chooses `fire_tv`, `google_tv` or `android_tv` for `registerTv` and for "This TV" in About this TV. |
| `src/native/lifecycle.ts`, `AndroidTv.tsx` | Keep the screen on while the picture plays, exit when the sleep timer ends, and pause in the background. |
| `scripts/android-art.mjs` | Draws the banner, the splash screens and the launcher icons from the brand (`npm run android:art`). |
| `src/native/direct.ts`, `packages/player/native/android/…`, `res/xml/network_security_config.xml` | Direct mode (A239): external stream links fetched with the TV's own networking. See [Direct mode](#direct-mode-external-stream-links-a239). |

### SDK levels and toolchain

- `minSdkVersion 24` (Capacitor 8's floor), `compileSdkVersion`/`targetSdkVersion 36`, Java 21, Android Gradle Plugin 8.13, Gradle 8.14.3 (wrapper). These are the Capacitor template's values in `android/variables.gradle`.
- **What that covers:**
  - Android TV 7.0 and later.
  - Every Google TV.
  - Fire OS 6 (API 25) and later, such as the Fire TV Stick 4K, Lite and Cube, and Fire TV Edition sets.
  - **Not covered:** Fire OS 5 devices (API 22: the first Fire TV Sticks and boxes). Capacitor 8 can't go below 24.
- **The WebView:**
  - Android TV and Google TV update Android System WebView through Play.
  - Fire TV uses Amazon's own Chromium WebView, which Fire OS updates.
  - hls.js needs Media Source Extensions, which both have.

### Building

1. Set the production env in `apps/tv/.env.production` (git-ignored) or in the shell:
   - `VITE_API_BASE`: must be `https://…`: the page is `https://localhost` and mixed content is never allowed (cleartext is permitted since A239, for direct mode's native fetches only in practice).
   - `VITE_VIEWER_URL`: where "sign in on your phone" points.

   Leave `VITE_MOCK` unset. **An empty `VITE_API_BASE` makes the app call `https://localhost/v1`, its own origin.**
2. The API must allow CORS from the app's origin, `https://localhost` (Capacitor's Android scheme).
3. `npm run build:android -w @opencast/tv` runs `tsc`, `vite build --mode production`, then `cap sync android`. The `receiver.html` entry is copied too, but the app never loads it.
4. Build the APK:
   ```sh
   export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home ANDROID_HOME=$HOME/Library/Android/sdk
   cd apps/tv/android
   ./gradlew assembleDebug      # app/build/outputs/apk/debug/app-debug.apk
   ./gradlew bundleRelease      # app/build/outputs/bundle/release/app-release.aab (signed if keystore.properties exists)
   ./gradlew --stop
   ```
   `android/local.properties` (`sdk.dir=…`) is git-ignored. So is `capacitor-cordova-android-plugins/`, which `cap sync` regenerates, so run `cap sync` before Gradle on a fresh clone.
5. **Debugging:** debug builds have WebView debugging on. Open `chrome://inspect` on the Mac with the device on adb.

### Signing

- Create an upload key once and keep it out of the repo:
  ```sh
  keytool -genkeypair -v -keystore opencast-tv-upload.jks -alias opencast-tv -keyalg RSA -keysize 4096 -validity 10000
  ```
- Put it in `apps/tv/android/keystore.properties` with `storeFile`, `storePassword`, `keyAlias` and `keyPassword`. That file, `*.jks` and `*.keystore` are git-ignored. `app/build.gradle` signs release builds only when the file exists.
- **Google Play:** use Play App Signing. Upload the `.aab` signed with the upload key; Google holds the app signing key.
- **Amazon Appstore:** upload an APK or AAB. Amazon re-signs apps with its own certificate, so a Fire TV install and a sideloaded APK of the same version can't update each other.
- The TV's identity (`registerTv`'s device token) lives in the WebView's storage. `android:allowBackup="false"` keeps it from being restored onto another TV.

### The manifest: what Google Play and the Amazon Appstore check

| Entry | Why |
|---|---|
| `uses-feature android.software.leanback required="true"` | A TV-only app. Play lists it only for TVs, and the Amazon Appstore only for Fire TV (not Fire tablets). If one APK should also install on phones, set this to `false`, and the phone build would need its own launcher activity. The viewer app is the phone app, so TV-only is the choice here. |
| `uses-feature android.hardware.touchscreen required="false"` | TVs have no touchscreen. Play rejects TV apps that require one, and Amazon filters them out of Fire TV. |
| `LEANBACK_LAUNCHER` category on `MainActivity` | Required for Android TV and Google TV's app row. |
| `LAUNCHER` category beside it | For Fire TV's Your Apps and for sideloaded installs. |
| `android:banner="@drawable/banner"` (application and activity) | The 320×180 home-screen banner, required by Play for TV. It's the lockup on the dark ground, `res/drawable-xhdpi/banner.png`. |
| `screenOrientation="landscape"`, `windowFullscreen`, bars hidden in `MainActivity` | No status bar and no portrait. |
| `hardwareAccelerated="true"` | Video in the WebView (the default since API 14; stated anyway). |
| `networkSecurityConfig="@xml/network_security_config"` | Cleartext permitted (A239): direct mode fetches http stream links natively. The web view itself stays https only (its page is `https://localhost` and mixed content is never allowed). Debug builds use `src/debug/res/xml/dev_server_cleartext.xml` instead (the same, naming the dev server's hosts). Before A239 this was `usesCleartextTraffic="false"`. |
| `enableOnBackInvokedCallback="false"` | With target SDK 36, Android 16 would take Back for predictive back and never deliver `KEYCODE_BACK`. TV mode needs it as a key (press and hold). |
| `<queries><package com.google.android.apps.tv.launcherx/>` | Package visibility, so the app can see whether Google TV's home screen is installed. |
| No other permissions or features | Only `INTERNET`. No camera, microphone, location or Google Play Services, which Fire TV doesn't have. Direct mode's OkHttp needs nothing more. |

**Store checks the app already meets:**
- Everything works with the D-pad and OK.
- Back never traps the user: it closes overlays, and on the picture it's the last channel, or it leaves the app when there's none.
- The app doesn't try to catch Home.
- Playback pauses when the app leaves the screen.

**Still needed for a listing:**
- **Play:** TV screenshots (1920×1080), the 1280×720 TV banner graphic, opting in to the Android TV release form factor, a content rating and a privacy policy.
- **Amazon:** the Appstore's Fire TV image set (icons, background and screenshots, at the sizes the console asks for), device targeting set to Fire TV only, and Amazon's TV app test criteria (Back from the app's top level exits; Menu is optional).

### The remote

The WebView delivers the D-pad's arrows as `ArrowUp`, `ArrowDown`, `ArrowLeft` and `ArrowRight` without help. The TV's own keys don't arrive reliably, and Back would go to the Activity instead. `MainActivity.dispatchKeyEvent` takes the keys below, but only once the page listens: until then they go to the WebView as usual. It sends each press, repeat and release to the page. `keys.ts` dispatches each one as the `KeyboardEvent` that `keyboard.ts` maps, so the Android app, a TV browser and a computer's keyboard share one key handler. That includes holding OK and Back, which act on release or after 500 ms.

| Android key | Page key (keyCode) | Command |
|---|---|---|
| `BACK` | `GoBack` (461) | Picture: last channel, or **leave the app when there's no last channel**. Overlay: close. Hold: menu. |
| `DPAD_CENTER`, `ENTER`, `NUMPAD_ENTER` | `Enter` (13) | OK. Hold: OK with `hold` (replace a full preset slot; on the picture while behind live, Back to live). |
| `CHANNEL_UP` / `CHANNEL_DOWN` | `ChannelUp` / `ChannelDown` (427/428) | Channel up and down; pages the guide. |
| `PAGE_UP` / `PAGE_DOWN` | `PageUp` / `PageDown` | Channel up and down. |
| `GUIDE` | `Guide` (458) | Guide. |
| `INFO` | `Info` (457) | Banner or details. |
| `MENU` (Fire TV's ≡) | `ContextMenu` | Menu rail. |
| `LAST_CHANNEL` | `MediaLast` | Last channel. |
| `MEDIA_PLAY_PAUSE`, `MEDIA_PLAY`, `MEDIA_PAUSE` | `MediaPlayPause`, `MediaPlay`, `MediaPause` | Pause and play. |
| `MEDIA_NEXT` / `MEDIA_PREVIOUS` | `ChannelUp` / `ChannelDown` | Channel, as on the lock screen. |
| `MEDIA_REWIND` / `MEDIA_FAST_FORWARD` (Fire TV's ⏪ ⏩) | `MediaRewind` / `MediaFastForward` | ⏪: nothing yet (open question). ⏩: Back to live, on the picture. Both taken so Android's media session doesn't act on them. |
| `0`–`9`, `NUMPAD_0`–`9` | `0`–`9` | Tune by number. |
| `PERIOD`, `NUMPAD_DOT`, `MINUS` | `.` | The dot. A US remote's dash for "12-1" is the dot too. |

When the system cancels a key-up (it took the long press), the page lets go of the key without acting.

**What each remote has:**
- **Basic remotes** (Chromecast with Google TV's remote, most Android TV remotes): D-pad, OK, Back, Home, volume and app shortcuts. No numbers, channel, guide, info or menu keys. On those remotes:
  - Presets are ◀ on the picture.
  - The guide is ▶, or OK twice.
  - The menu is **holding Back**.
  - Tuning by number isn't available.
- **Fire TV remotes:** these add Menu (≡), play/pause, ⏪ and ⏩. Recent Alexa Voice Remotes also have a live-TV "Guide" button. Check on a device that it arrives as `KEYCODE_GUIDE`.
- **TV-maker remotes** (Sony, TCL, Hisense, the Fire TV Edition sets) usually send channel, number, info and guide keys.
- **Home** never reaches an app on Android TV or Fire TV (inventory raise 10). Leaving with Home pauses the picture, and coming back returns to live.

### What kind of TV, for registerTv and About this TV

`OpencastTvPlugin.getInfo()` reports `manufacturer`, `model`, `fireTv` (the system feature `amazon.hardware.fire_tv`), `googleTv` (Google TV's home screen, `com.google.android.apps.tv.launcherx`, is installed) and `leanback`. `platformFromNative` decides:

1. **`fire_tv`:** the Amazon feature, maker "Amazon", or a model starting "AFT" (which covers Fire TV Edition sets made by others).
2. **`google_tv`:** otherwise, when Google TV's home screen is installed.
3. **`android_tv`:** everything else.

`main.tsx` asks once at start, before the TV registers. `ensureRegistered` then uses the answer instead of the user agent's guess, and About this TV reads "Opencast app on Fire TV". In a browser nothing changes.

`Settings.tsx` now asks Capacitor whether it's the app. `window.Capacitor` exists in a browser too, once `@capacitor/core` is bundled.

### Playback, the screen and the sleep timer

- **Autoplay:** hls.js plays HLS through MSE in the WebView. Capacitor's `Bridge.initWebView` already calls `setMediaPlaybackRequiresUserGesture(false)`, so the picture starts without a press.
- **Audio focus:** the WebView asks for audio focus when a media element plays. Check on a device that another app's audio pauses Opencast, and that Opencast pauses for it.
- **Keeping the screen on:** `FLAG_KEEP_SCREEN_ON` is set while the player is playing, tuning or showing a listed station's player. It's cleared when the picture is paused, off air, erroring or stopped, so the TV's screen saver can come back.
- **Sleep timer:** when it ends, `engine.stop()` stops the picture. The app then clears the flag and finishes the activity, which returns to the TV's home screen. The phone relay and every timer stop with it ("It stops Opencast, not the TV"), and the next launch starts fresh on the last channel. The "Stopped" screen is only for TV browsers now.
- **Background:** the app pauses what's playing when it leaves the screen (Capacitor's `appStateChange`, on `onStop`). When it comes back it returns to live, unless it was already paused before leaving. Radio doesn't play on behind the home screen; that would need a foreground service and a media session.

### Direct mode: external stream links (A239)

The user decided (A239) that the native apps play external stations' stream links with the device's own networking, as VLC does. Both Android apps have it: this TV app and the Opencast app on Android. The iPhone app doesn't yet (below). docs/stream-relay.md has what it plays that browsers can't.

**How it works.**

1. The dial row's `playback` carries `sourceUrl` (the source's own address) beside `url` (what browsers play: the same address, or the relay's).
2. The app registers the `OpencastDirect` plugin. Its `info()` answers `{ version: 1, path: "/_opencast/direct/<token>", userAgent }`, the token random per launch. Its being there is how the page knows the app has direct mode (`src/native/direct.ts`, `nativeDirect()`; the phone app's is `src/viewer/native/direct.ts`).
3. The player loads that row's HLS through an hls.js loader (packages/player `engine/direct.ts`) that fetches `<path>?u=<address>` on the app's own origin: every playlist, segment, key and subtitle of that row, wherever they point.
4. `DirectWebViewClient` (Capacitor's web view client with one path in front; also the service worker client, for dev:mock) answers that path from `shouldInterceptRequest`: `DirectStreams` checks the token, `DirectFetcher` fetches the address with OkHttp, and the body streams straight through to the web view, with `X-Opencast-Url` naming the address after redirects. Any other request, the API's included, goes to Capacitor as before.
5. On an error, or no first frame in 4 s, the player plays `url` at once; Stand by is still at 8 s.

**What the source sees:** `User-Agent: Opencast TV (Android)` (the phone app: `Opencast (Android)`), `Accept: */*`, and the player's `Range`. No `Origin`, no cookies (OkHttp's `NO_COOKIES`: Capacitor installs a `CookieHandler` that `HttpURLConnection` and Capacitor's own HTTP plugin would use), no `Referer`. Redirects are followed by hand, up to 5, across http and https. Refused: anything but http(s), user names and passwords in the address, and local or private addresses, by name or by what DNS gives (debug builds allow them, for the dev server's mock streams).

**The shared native code** lives beside the player, in `packages/player/native/android/src/main/java/org/useopencast/direct/` (`DirectFetcher`, `DirectStreams`, `DirectWebViewClient`, `OpencastDirectPlugin`), with its JVM test in `…/src/test/java/…/DirectFetcherTest.java` (OkHttp's MockWebServer on 127.0.0.1). Both apps' `app/build.gradle` add those folders to their `sourceSets` and depend on `com.squareup.okhttp3:okhttp` (`okhttpVersion` in `variables.gradle`, 4.12.0; `mockwebserver` for the test). `./gradlew testDebugUnitTest` runs the test in either project.

**Why a path the web view client answers, not base64 over the bridge.** Measured on the "opencast-tv" emulator (WebView 113), fetching a 4 MB segment from this Mac through `adb reverse`, median of 6: the intercepted path 244 ms (about 130 Mbps), Capacitor's HTTP plugin with base64 216 ms (about 150 Mbps) including the decode; neither stalled the page's main thread by more than 2 ms. Both are far beyond a stream's 2 to 8 Mbps. The path wins on what the emulator doesn't show: base64 inflates every segment by a third and holds it whole three times (the native buffer, the bridge's JSON string, the decoded copy), where the path streams it; the low-memory Fire TV sticks feel that. And Capacitor's HTTP plugin goes through `HttpURLConnection`, which sends and keeps the web view's cookies.

**Shown on the emulator (2026-10-01, debug build against a scratch page and stand-in servers on this Mac):** the plugin's path; the web view itself failing to read a stand-in source that answers 500 and an HTML page to any `Origin`; the same source through direct mode answering 200 with its master (which names an http chunklist on another port); a redirect to another port followed natively; a wrong token answered 403 and a `file:` address 400; and real hls.js through the direct loader playing it (640×360, first frame in 0.2 to 0.3 s, ten seconds played, no errors), with no `Origin`, cookie or `Referer` on any of its 30 requests. Not shown on the emulator: TV mode's own player tuning a dial row in direct mode (covered by packages/player's tests), and a session tied to the viewer's IP (one machine).

**Needs a new build:** direct mode is native code and a manifest change, so it reaches a TV or phone only with a rebuilt and reinstalled APK (`npm run build:android -w @opencast/tv`, then Gradle; the phone app's `npm run build:native -- android`). A new web bundle on an older APK has no `OpencastDirect` plugin and plays `url` as before.

**The iPhone app (follow-up).** WKWebView can't intercept http or https requests, so the same approach needs a custom scheme (`WKURLSchemeHandler`, say `opencast-direct://`) fed by `URLSession`, with the loader pointed at it; and an ATS exception for plain http (`NSAllowsArbitraryLoadsForMedia` covers AVFoundation only, not `URLSession`, so `NSAllowsArbitraryLoads` with a reason for App Review, or per-domain exceptions, which a station list can't know ahead). Safari's own HLS (the native driver, on iPhones without Managed Media Source) can't use a loader at all. Until then the iPhone app plays `url`, as Safari does.

### Installing

**The Android TV emulator** (AVD "opencast-tv", system image `system-images;android-34;android-tv;arm64-v8a`):

```sh
$ANDROID_HOME/emulator/emulator -avd opencast-tv &
adb wait-for-device
adb install -r apps/tv/android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n org.useopencast.tv/.MainActivity
```

**A Fire TV Stick:**
1. On the stick, go to Settings → My Fire TV → Developer options and turn on ADB debugging. Turn on "Apps from Unknown Sources" (on Fire OS 7 and later it's per app).
2. Tap About seven times if Developer options is hidden.
3. Find the stick's IP address in About → Network.
4. Install and launch:
   ```sh
   adb connect <ip>:5555
   adb -s <ip>:5555 install -r app-debug.apk
   adb -s <ip>:5555 shell am start -n org.useopencast.tv/.MainActivity
   ```

**Sending remote keys over adb** (works on the emulator and devices):
```sh
adb shell input keyevent KEYCODE_CHANNEL_UP              # also CHANNEL_DOWN, GUIDE, INFO, MENU, LAST_CHANNEL, MEDIA_PLAY_PAUSE
adb shell input keyevent KEYCODE_1 KEYCODE_2 KEYCODE_PERIOD KEYCODE_1   # tune 12.1
adb shell input keyevent --longpress KEYCODE_BACK        # hold Back: the menu
adb shell input keyevent --longpress KEYCODE_DPAD_CENTER # hold OK
```
The emulator's extended controls (⋯ → Directional pad) have the D-pad, OK, Back and Home. With the emulator window focused, the Mac's arrow keys and Enter act as the D-pad.

### The STOP demo: TV mode on an Android TV emulator, on mocks

Mocks run from the dev server (the mock HLS streams are dev-server middleware), so a debug build loads `npm run dev:mock`:

1. `npm run dev:mock -w @opencast/tv` (port 5175).
2. `cd apps/tv && TV_DEV_SERVER=http://localhost:5175 npx cap sync android`, then `./gradlew assembleDebug` in `android/`.
3. Start the emulator, then run `adb reverse tcp:5175 tcp:5175`, install and launch (see Installing).
4. **Show:**
   - First launch (the sign-in code; "Watch without signing in").
   - The picture with the banner.
   - ▲ ▼ on the emulator's D-pad changing channel.
   - `KEYCODE_CHANNEL_UP` / `DOWN` from adb.
   - `1 2 . 1` tuning by number.
   - ▶ and `KEYCODE_GUIDE` opening the guide.
   - OK on a guide cell.
   - Back closing it.
   - Holding Back opening the menu rail.
   - Settings → About this TV reading "Opencast app on Android TV".
   - The sleep timer at its shortest, returning to the emulator's home screen when it ends.
   - Back on the picture with no last channel leaving the app.
5. **Before a release build:** run `npx cap sync android` again without `TV_DEV_SERVER`. Release builds never allow http.

### Run on the emulator (2026-09-28)

TV mode's debug build was compiled and run on the "opencast-tv" AVD (Android TV 14, arm64, 1920 by 1080; WebView 113) against `dev:mock` through `adb reverse`. What it showed:

- **Works:** first launch registering the device and showing the sign-in code; "Watch without signing in"; the picture; `KEYCODE_CHANNEL_UP` (with the banner); `1`, `2` tuning 12.1 BEAT; ▶ opening the guide and ▼ moving through it; Back closing it; holding Back opening the menu rail; Info, Menu and Last channel reaching the page; Settings; About this TV reading "Opencast app on Android TV".
- **`KEYCODE_GUIDE` never reaches the app on Android TV.** The system takes it for its own guide before dispatch. TV mode's guide is on ▶ (and OK twice), as on a basic remote. Check a Fire TV remote's guide key separately.
- **Holding Back:** Android marks a long press at 400 ms, sooner than the page's 500 ms hold. The key bridge (`src/native/keys.ts`) holds back a release that follows Android's long-press repeat until the hold has counted, so a long press always opens the menu.
- **WebView 113 draws `color-mix()` with a variable inside a `box-shadow` as the text colour.** The guide's dim painted the whole screen in the ink colour. It's a plain colour now (`--tvg-dim` in `pages/guide/Guide.css`); keep `color-mix()` out of shadows for older TV WebViews.
- **The emulator's data partition** defaults to 10 GB; `disk.dataPartition.size=2G` in the AVD's `config.ini` is plenty.
- **The dev server's file watcher** sometimes keeps serving an old module on this Mac; restart `dev:mock` after edits before trusting what the TV shows.
- **Not shown:** the sleep timer returning to the TV's home screen (its shortest choice is 30 minutes; covered by `src/native/lifecycle.test.tsx`).

### Open questions

- **⏪ on Fire TV's remote:** nothing, or channel down? (⏩ is Back to live, 2026-09-29.)
- **A single APK for phones too?** Today it's TV-only (leanback required), and the viewer app is the phone app.
- **Fire OS 5 devices** (API 22) are below Capacitor 8's `minSdk` 24. Accept that?
- **Detecting Google TV** from its home-screen package is a heuristic. Google has no official feature flag for it; check it on a Chromecast with Google TV and on a Google TV set.
- **The API's CORS** must allow `https://localhost` for the app. Is that in the platform's allowed origins?
- **Back with no last channel exits.** Should the first Back show a "Press Back again to leave" hint instead? Android TV and Fire TV apps usually just exit.

## TV mode on Samsung TVs (Tizen)

TV mode's web build packaged as a Tizen web app (`.wgt`) for sideloading onto a Samsung TV (A250). No Capacitor: the TV's own web runtime runs the page. Nothing has been submitted to Samsung's store.

**Never run on a TV.** It was checked with unit tests (a fake `window.tizen`) and in Chrome at 1920×1080 with a fake `window.tizen`, over http on the mocks and from `file://` against staging. The Tizen CLI isn't installed on the Mac it was written on, so no `.wgt` has been signed or installed yet.

**Why a packaged copy, not a page in Samsung's browser or a hosted wrapper:** in the browser, the remote's arrows move a pointer and the channel buttons never reach the page. A Tizen app gets keys only by registering them (`tizen.tvinputdevice.registerKey`), and that API exists only for content inside the package. A wrapper that loads opencast-tv.vercel.app would be a remote page without it. The cost: a new web build reaches the TV only as a new `.wgt`.

### What's where

| File | What it does |
|---|---|
| `tizen/config.xml` | The app: package `OpcastTv01`, app id `OpcastTv01.Opencast`, name "Opencast", `tv-samsung` profile, `required_version` 7.0, privileges `internet` and `tv.inputdevice`, `<access origin="*">` (the API and the stations' streams come from many hosts), landscape, no context menu, no pointer, no background play. |
| `tizen/icon.png` | The 512×423 icon (the lockup on TV mode's ground), drawn by `npm run tizen:art -w @opencast/tv` (`scripts/tizen-art.mjs`, sharing `scripts/brand-art.mjs` with the Android art). |
| `scripts/build-tizen.mjs` | `npm run build:tizen -w @opencast/tv`: builds into `dist-tizen/` and copies `config.xml` and the icon beside it. With the Tizen CLI on `PATH` it runs `tizen build-web`, and `tizen package` when `TIZEN_PROFILE` names a certificate profile; otherwise it prints the commands. |
| `vite.config.ts` (`tizenBuild`) | For this build only: one classic script (iife, no module scripts: Tizen can refuse a module from `file://` for its MIME type), syntax for Chromium 94, one CSS file, no receiver entry, and Samsung's `webapis.js` (the TV's own copy, `$WEBAPIS/webapis/webapis.js`) before the app. |
| `src/config.ts` (`hashRoutes`) | `VITE_TIZEN=true`: routes in the hash (`#/guide`), since the page's own path is the file's. |
| `src/native/tizen.ts` | Registers the remote's keys and renames them to the keys `keyboard.ts` maps; leaves the app; the Android app's lifecycle rules with Tizen's calls. |

### Which TVs

`required_version` 7.0 installs on Samsung's 2023 TVs and later. Samsung's web engines by year:

| Year | Tizen | Chromium | Opencast |
|---|---|---|---|
| 2025, 2026 | 9.0, 10.0 | 120, 130 | Everything as designed. |
| 2024 | 8.0 | 108 | Works; `color-mix()` tints (the guide's tuned row, stand-by fills) are missing. |
| 2023 | 7.0 | 94 | Works; also no `:has()` (the guide doesn't move the picture into its window) and no container-query sizes (the bug and lower thirds use the default size). |
| 2022 and older | 6.5 and older | 85 and older | Refused at install. Below Chromium 88 the layout itself breaks (flex `gap`, `aspect-ratio`). To try anyway, lower `required_version` and `TIZEN_TARGET` in `vite.config.ts` together. |

The API client no longer uses `URLSearchParams.size` (Chromium 113): before 2025, TVs dropped every query string with it.

### The remote

Tizen delivers the arrows, OK (`Enter`) and Back (Return) by itself. `src/native/tizen.ts` registers the rest at start, using the codes the TV reports (`getSupportedKeys()`; Samsung's documented codes if it can't say), and renames each key as it arrives (a capture listener on the window, before anything reads it) to the key `packages/player`'s `keyboard.ts` already maps. So a Samsung remote means what an Android TV remote means:

| Samsung key (code) | Page key | Command |
|---|---|---|
| Return (10009) | `GoBack` | Picture: last channel, or **leave the app when there's no last channel**. Overlay: close. Hold: menu. Needs no registering. |
| Enter (13), arrows | as they are | OK and the arrows, as on every TV. |
| `ChannelUp` / `ChannelDown` (427/428) | `ChannelUp` / `ChannelDown` | Channel up and down; pages the guide. |
| `0`–`9` (48–57) | `0`–`9` | Tune by number. |
| `Minus` (189) | `.` | The dot: "18-2" tunes 18.2. |
| `Info` (457) | `Info` | Banner or details. |
| `Guide` (458), `ChannelList` (10073) | `Guide` | Guide. |
| `PreviousChannel` (10190) | `MediaLast` | Last channel. |
| `Tools` (10135, older remotes) | `ContextMenu` | Menu rail. |
| `MediaPlayPause` (10252), `MediaPlay` (415), `MediaPause` (19) | the same | Pause and play. |
| `MediaStop` (413) | `MediaPause` | Pause (nothing to stop to on live TV). |
| `MediaRewind` / `MediaFastForward` (412/417) | the same | ⏪: nothing yet. ⏩: back to live on the picture. |
| `MediaTrackNext` / `MediaTrackPrevious` (10233/10232) | `ChannelUp` / `ChannelDown` | Channel. |

- **Not registered:** Exit (Samsung requires it to leave the app at once; the TV does that), Menu, Home, Source, volume and mute (the TV's), and the colour keys (unused).
- **Back at the root** leaves with `tizen.application.getCurrentApplication().exit()`. Samsung's store policy asks for an exit popup at an app's home screen, but its FAQ allows Return there to exit or hide the app; this matches the Android app. Revisit before a store submission.
- **The pointer is off** (`pointing-device-support="disable"`): the remote's arrows are keys.
- **What each remote has:** Samsung's Smart Remotes (2016 and later) have CH ▲▼, OK, the arrows and Return, but no number keys. Their `123` button (or a long press on it) shows an on-screen number pad with the numbers and "-", and on some models CH LIST, PRE-CH and GUIDE. Check on the TV which of these reach the app. Basic IR remotes have numbers, "-", PRE-CH, CH LIST, INFO, GUIDE and TOOLS.

### The env and the API

- `VITE_API_BASE`: from Vite's env for the mode, then the shell. **Unset, the build points at staging** (`https://api-staging-9fae.up.railway.app`), with `VITE_VIEWER_URL` at `https://opencast-web.vercel.app` for "sign in on your phone". A production build sets both.
- **CORS:** a packaged Tizen app's requests carry `Origin: file://` (what Samsung's forums report for Tizen) or `Origin: null` (Chromium's own for a file page). The API must allow both. In `WEB_ORIGIN`, add `file://,null`; `apps/api/src/server.ts` keeps `file://` as written (before, it was parsed to the origin "null" and never matched). For staging (set by `.railway/railway.ts` today), the api service's value becomes:
  ```
  https://opencast-web.vercel.app,https://opencast-business.vercel.app,https://opencast-site.vercel.app,https://opencast-tv.vercel.app,file://,null
  ```
  `null` works with the API as deployed; `file://` needs this branch's `server.ts` on staging.
- **Sign-in** is TV mode's code sign-in with bearer tokens in `localStorage`, as on Android TV. No cookies.
- **Streams** are fetched from their own hosts. A stream whose server allows only the web app's origin (not `*`) won't play in the Samsung app; the stream checks (A238) test with the web app's origin.

### Playback

- **hls.js** plays HLS through Media Source Extensions, which every Tizen TV from 2017 on has. Samsung's own HLS (a native `<video src=…m3u8>` or AVPlay) isn't used: one player everywhere, and AVPlay would be a second player for the same streams. Add it only if hls.js fails on the TV.
- **dash.js** plays DASH stream links the same way. Its content-steering code calls `Array.prototype.at` (Chromium 92); fine from 2023 on.
- **Autoplay with sound:** desktop Chrome holds the sound until a key is pressed ("Tap for sound"); a packaged Tizen app is expected not to. Check on the TV that the first channel starts with sound.
- **Codecs:** H.264 and AAC, in TS (hls.js remuxes it) or fMP4, play on every Samsung TV. Check any station that sends HEVC or AC-3 on the TV itself.
- **The screen saver** is turned off while the picture plays (`webapis.appcommon.setScreenSaver`, from the TV's `webapis.js`) and allowed again when it's paused, off air or stopped. Not checked on a TV.
- **Leaving the app** (Home, Source, another app) hides it: the picture pauses (`visibilitychange`), and coming back returns to live. `background-support="disable"` stops it playing on behind the home screen.
- **The sleep timer's end** leaves the app, as on Android TV.

### Sideloading onto your TV (on a Mac)

The TV and the Mac must be on the same network.

1. **Install Tizen Studio.** Download "Tizen Studio with IDE installer" (or the CLI installer) for macOS from developer.tizen.org, and install it to `~/tizen-studio`. Then put the CLI on your `PATH`:
   ```sh
   export PATH="$HOME/tizen-studio/tools/ide/bin:$HOME/tizen-studio/tools:$PATH"
   ```
2. **Add Samsung's extensions.** Open the Package Manager (in `~/tizen-studio/package-manager/`, or **Tools → Package Manager** in Tizen Studio). On the **Extension SDK** tab, install **Samsung Certificate Extension** and **TV Extensions** (the newest version), with **TV Extension Tools** if it's listed separately.
3. **Put the TV in Developer mode.**
   1. On the TV, open **Apps**.
   2. Press **1 2 3 4 5** on the remote (on a remote without numbers, use the `123` button's on-screen number pad).
   3. Turn **Developer mode** on, and enter your Mac's IP address (`ipconfig getifaddr en0` in Terminal, or System Settings → Wi-Fi → Details).
   4. Restart the TV: hold the power button until the TV turns off and on again (a quick press only puts it to standby).
   5. Apps now shows "Developer mode" at the top.
4. **Find the TV's IP address:** Settings → General (or Connection) → Network → Network Status → IP Settings.
5. **Connect to the TV.**
   ```sh
   sdb connect <tv-ip>        # port 26101
   sdb devices                # the TV's serial (<tv-ip>:26101), "device", and its name, e.g. QE55Q80T
   ```
   Or in Tizen Studio: **Tools → Device Manager → Remote Device Manager → +**, enter a name, the TV's IP and port **26101**, and switch **Connection** on.
6. **Make a Samsung certificate** (once). Open **Tools → Certificate Manager** in Tizen Studio.
   1. Click **+**, choose **Samsung**, then **TV**.
   2. Name the certificate profile, for example `opencast`.
   3. **Author certificate:** create a new one (a name and a password you keep), then sign in with your Samsung account.
   4. **Distributor certificate:** create a new one, privilege **Public**. It must list your TV's **DUID**. With the TV connected (step 5), Certificate Manager lists the connected TV's DUID and adds it. Otherwise `sdb -s <tv-ip>:26101 shell 0 getduid` should print it.
   5. Finish. The files go to `~/SamsungCertificate/opencast/`.
7. **Let the TV accept your certificate** (once per TV): in Device Manager, right-click the TV and choose **Permit to install applications**.
8. **Build and package:**
   ```sh
   npm run build:tizen -w @opencast/tv          # staging; or VITE_API_BASE=https://… for another API
   tizen build-web -- apps/tv/dist-tizen
   tizen package -t wgt -s opencast -- apps/tv/dist-tizen/.buildResult
   ```
   With the CLI on `PATH`, `TIZEN_PROFILE=opencast npm run build:tizen -w @opencast/tv` runs all three. The package is `apps/tv/dist-tizen/.buildResult/Opencast.wgt`.
9. **Install and open:**
   ```sh
   tizen install -n Opencast.wgt -t <TV name from sdb devices> -- apps/tv/dist-tizen/.buildResult
   tizen run -p OpcastTv01.Opencast -t <TV name>
   ```
   Opencast is in the TV's Apps from then on. In Tizen Studio you can instead import `apps/tv/dist-tizen` as a project and choose **Run As → Tizen Web Application**.
10. **A new version:** build, package and install again (steps 8 and 9). Installing over the same app id with the same certificate replaces it, and should keep its storage (the TV's registration and sign-in).

**Logs and debugging:** start the app in debug mode and open its Web Inspector in Chrome on the Mac:
```sh
sdb -s <tv-ip>:26101 shell 0 debug OpcastTv01.Opencast      # prints "... port: 7011" (the number varies)
sdb -s <tv-ip>:26101 forward tcp:7011 tcp:7011
```
Then open `http://localhost:7011` in Chrome (or `chrome://inspect` → Configure → `localhost:7011`). In Tizen Studio, **Debug As → Tizen Web Application** does the same.

**Uninstalling:** `tizen uninstall -p OpcastTv01.Opencast -t <TV name>`, or on the TV: Apps → Settings (the gear) → Opencast → Delete. Developer mode stays on until you turn it off in Apps (1 2 3 4 5 again).

### Trying the build on a computer

`npm run build:tizen -w @opencast/tv -- --mode mock` builds against the mocks for a computer's browser. Serve `apps/tv/dist-tizen` over http with the mock streams (the dev server's `/mock-hls` middleware), and inject a fake `window.tizen` (an object with `tvinputdevice.getSupportedKeys`, `registerKey`, `unregisterKey` and `application.getCurrentApplication().exit`) before the page loads. Keyboard arrows and Enter work as on the TV; Samsung's keys can be sent as `KeyboardEvent`s with their codes (427 for CH ▲). A file page has no service worker, so mock mode never runs from `file://` or on the TV.

### Open questions

- **The origin the TV sends:** `file://` or `null`? Both are in the value above; once known, the other can go.
- **An exit popup** at the root, for a store submission (Samsung's policy) rather than sideloading?
- **2022 and older TVs:** worth a build for them (polyfills and plainer CSS), or 2023 on only?
- **Samsung's store:** a Samsung Seller Office account and Samsung's review would be needed; nothing has started.
