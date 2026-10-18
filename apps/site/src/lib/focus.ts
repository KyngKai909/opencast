// Keeping focus inside an open menu or sheet: Tab and Shift+Tab wrap, Escape closes, and focus
// goes back to whatever opened it.

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface Trap {
  release(): void;
}

export function trapFocus(el: HTMLElement, onEscape: () => void): Trap {
  const back = document.activeElement as HTMLElement | null;
  const items = () => [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onEscape();
      return;
    }
    if (e.key !== "Tab") return;
    const list = items();
    if (!list.length) return;
    const first = list[0]!;
    const last = list[list.length - 1]!;
    // Focus that slipped outside (or never got in) comes back.
    if (!el.contains(document.activeElement)) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
      return;
    }
    if (e.shiftKey && (document.activeElement === first || !el.contains(document.activeElement))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  document.addEventListener("keydown", onKey);
  // Containers that fade in may not be focusable on the next frame; try again shortly after.
  const into = () => !el.contains(document.activeElement) && items()[0]?.focus();
  requestAnimationFrame(into);
  setTimeout(into, 60);
  return {
    release() {
      document.removeEventListener("keydown", onKey);
      back?.focus?.();
    }
  };
}
