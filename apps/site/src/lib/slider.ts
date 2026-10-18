// Range inputs (`[data-slider]`): keeps the filled part of the track (`--p`) under the thumb as
// it moves. What the value means is the page's business.

export function fill(input: HTMLInputElement): void {
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  input.style.setProperty("--p", `${((Number(input.value) - min) / (max - min)) * 100}%`);
}

export function initSliders(root: ParentNode = document): void {
  for (const input of root.querySelectorAll<HTMLInputElement>("input[data-slider]:not([data-slider-ready])")) {
    input.dataset.sliderReady = "";
    input.addEventListener("input", () => fill(input));
    fill(input);
  }
}
