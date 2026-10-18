// The header's own motion (chrome/header.html's script): the rail's sliding indicator, which
// rests on the current page and follows hover and focus, and the tuner LCD flipping between the
// channel and what's on every 3.4 s.

import { reducedMotion } from "./motion";

export function initNav(): void {
  const rail = document.querySelector<HTMLElement>(".nl2");
  if (rail) {
    const ind = rail.querySelector<HTMLElement>(".nl-ind")!;
    const cur = rail.querySelector<HTMLElement>(".is-cur");
    const to = (a: HTMLElement | null) => {
      if (!a) return ind.classList.remove("on");
      ind.style.left = `${a.offsetLeft}px`;
      ind.style.width = `${a.offsetWidth}px`;
      ind.classList.add("on");
    };
    const rest = () => to(cur);
    rail.querySelectorAll<HTMLElement>("a").forEach((a) => {
      a.addEventListener("mouseenter", () => to(a));
      a.addEventListener("focus", () => to(a));
    });
    rail.addEventListener("mouseleave", rest);
    rail.addEventListener("focusout", (e) => !rail.contains(e.relatedTarget as Node) && rest());
    addEventListener("load", rest);
    addEventListener("resize", rest);
    document.fonts?.ready.then(rest);
    rest();
  }
  const t = document.querySelector(".tnb");
  if (t && !reducedMotion()) setInterval(() => !document.hidden && t.classList.toggle("flip"), 3400);
}
