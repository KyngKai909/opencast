// Segmented controls (`.seg2[data-seg]`): clicking a button makes it the one that's on, and the
// group fires `seg:change` with the value, which the page's own code listens for.

export interface SegChange {
  value: string;
  button: HTMLButtonElement;
}

export function choose(group: HTMLElement, button: HTMLButtonElement): void {
  for (const b of group.querySelectorAll<HTMLButtonElement>(":scope > button")) {
    const on = b === button;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
  }
  const value = Object.values(button.dataset)[0] ?? "";
  group.dispatchEvent(new CustomEvent<SegChange>("seg:change", { detail: { value, button }, bubbles: true }));
}

export function initSegs(root: ParentNode = document): void {
  for (const group of root.querySelectorAll<HTMLElement>("[data-seg]:not([data-seg-ready])")) {
    group.dataset.segReady = "";
    group.addEventListener("click", (e) => {
      const b = (e.target as Element).closest<HTMLButtonElement>("button");
      if (b && b.parentElement === group && !b.classList.contains("on")) choose(group, b);
    });
  }
}
