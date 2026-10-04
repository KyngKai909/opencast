// The app's height when it's installed to an iPhone's or iPad's home screen (2026-10-04). There,
// with the black-translucent status bar, CSS's 100% (and anything pinned to the edges) is the screen
// less the status bar, so the app stopped short and left a band of ground at the bottom. An
// installed app always fills the screen, so its height is the screen's: the longer side upright,
// the shorter on its side (iOS doesn't turn `screen` with the device). The page is marked
// .oc-installed and the height set as --oc-app-h, which app.css uses; everywhere else nothing changes.

/** Installed to the home screen (the manifest's `standalone`, or iOS's own flag). */
export function isInstalled(): boolean {
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** An iPhone or iPad, including an iPad that reports itself as a Mac. */
export function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/** The height an installed app has: the screen's on iOS, else the window's. */
export function installedHeight(win: Pick<Window, "innerHeight" | "screen" | "matchMedia">, ios: boolean): number {
  if (!ios) return win.innerHeight;
  const { width, height } = win.screen;
  const landscape = win.matchMedia("(orientation: landscape)").matches;
  return Math.max(win.innerHeight, landscape ? Math.min(width, height) : Math.max(width, height));
}

/** Keeps --oc-app-h right as the device turns. Returns a stop function. */
export function watchAppHeight(): () => void {
  if (!isInstalled()) return () => undefined;
  const ios = isIos();
  document.documentElement.classList.add("oc-installed");
  const set = () => document.documentElement.style.setProperty("--oc-app-h", `${installedHeight(window, ios)}px`);
  set();
  window.addEventListener("resize", set);
  window.addEventListener("orientationchange", set);
  return () => {
    window.removeEventListener("resize", set);
    window.removeEventListener("orientationchange", set);
  };
}
