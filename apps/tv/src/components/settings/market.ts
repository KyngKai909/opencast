// The market line on first launch (tv 05.3: "The market is guessed ... and said out loud with
// where to change it"), and choosing a market on the TV ("/market").

/** The line under "Watch without signing in". Null while the guess is on its way (a quiet blank). */
export function marketLine(o: { loading: boolean; guessed: string | null; noneOpen: boolean; current: string | null }): string | null {
  if (o.loading) return null;
  if (o.guessed) return `Your market: ${o.guessed}, from this TV's connection. Change it any time in the menu.`;
  if (o.noneOpen) return o.current ? `No market is open near this TV's connection yet, so it's showing ${o.current}. Change it any time in the menu.` : null;
  return o.current ? `Your market: ${o.current}. Change it any time in the menu.` : null;
}

/** The markets to choose from: open ones, in the order the API gives, and where focus starts. */
export function marketChoices<M extends { slug: string; open: boolean }>(all: M[], current: string): { list: M[]; focus: number } {
  const list = all.filter((m) => m.open);
  return { list, focus: Math.max(0, list.findIndex((m) => m.slug === current)) };
}
