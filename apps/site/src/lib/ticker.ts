// Tickers (`[data-ticker]`): swap the line every `data-interval` ms with the reference's slide
// (the old line leaves for 400 ms, the new one comes in 380 ms after). Paused while the ticker is
// hovered, focused, off screen or in a hidden tab; never rotates under reduced motion.

import { reducedMotion } from "./motion";

export function initTickers(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>("[data-ticker]:not([data-ticker-ready])")) {
    el.dataset.tickerReady = "";
    const items = JSON.parse(el.dataset.items ?? "[]") as string[];
    const view = el.querySelector<HTMLElement>(".dl-v");
    if (!view || items.length < 2 || reducedMotion()) continue;
    let i = 1;
    let held = false;
    let visible = true;
    const hold = (on: boolean) => () => (held = on);
    el.addEventListener("mouseenter", hold(true));
    el.addEventListener("mouseleave", hold(false));
    el.addEventListener("focusin", hold(true));
    el.addEventListener("focusout", hold(false));
    new IntersectionObserver((e) => (visible = !!e[0]?.isIntersecting)).observe(el);
    const show = () => {
      const old = view.firstElementChild;
      if (old) {
        old.classList.add("out");
        setTimeout(() => old.remove(), 400);
      }
      const html = items[i++ % items.length]!;
      setTimeout(
        () => {
          const next = document.createElement("div");
          next.innerHTML = html;
          view.appendChild(next);
        },
        old ? 380 : 0
      );
    };
    setInterval(() => {
      if (!held && visible && !document.hidden) show();
    }, Number(el.dataset.interval) || 3400);
  }
}
