// What the visitor's device asks for: reduced motion (no smooth scroll, no ticker rotation, still
// scenes, no cursor) and a fine pointer (the custom cursor shows only there).

const mq = (q: string) => typeof matchMedia === "function" && matchMedia(q).matches;

export const reducedMotion = () => mq("(prefers-reduced-motion: reduce)");
export const finePointer = () => mq("(hover: hover) and (pointer: fine)");
