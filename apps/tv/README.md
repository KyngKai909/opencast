# @opencast/tv

TV mode and the Cast receiver, port 5175. Owned by the apps prompt (`docs/prompts/2-apps.md`).

- `npm run dev:mock -w @opencast/tv`: TV mode on the mocks. Keyboard arrows, Enter and Escape stand in for the remote.
- **Android TV and Fire TV:** `npm run build:android -w @opencast/tv`, then Gradle in `android/`. See docs/apps/native.md, "TV mode on Android TV and Fire TV".
- **Samsung TVs (Tizen):** `npm run build:tizen -w @opencast/tv` builds a Tizen web app into `dist-tizen/` (staging's API unless `VITE_API_BASE` is set; `-- --mode mock` for a computer's browser). Then, with Tizen Studio's CLI:

  ```sh
  tizen build-web -- apps/tv/dist-tizen
  tizen package -t wgt -s <certificate profile> -- apps/tv/dist-tizen/.buildResult
  tizen install -n Opencast.wgt -t <TV name from sdb devices> -- apps/tv/dist-tizen/.buildResult
  ```

  The TV must be in Developer mode with a Samsung certificate made for it, and the API must allow the app's origin (`file://` and `null` in `WEB_ORIGIN`). Step by step, with the remote's keys and which TVs it runs on: docs/apps/native.md, "TV mode on Samsung TVs (Tizen)". The app is `tizen/config.xml` and `tizen/icon.png` (`npm run tizen:art`); the remote's keys are `src/native/tizen.ts`.
