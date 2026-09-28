import { cx } from "../lib/cx";

export interface AvatarProps {
  /** The person's name: "Kai M.". Read by screen readers, and the initials come from it. */
  name: string;
  /** Two letters to show instead of the ones taken from the name. */
  initials?: string;
  /** 34 (headers), 40 (team rows), 46 (the phone's You), 56 (the You page). */
  size?: 34 | 40 | 46 | 56;
  /** The ring that marks the page you're on (the header's avatar on You). */
  current?: boolean;
  /** Hide it from screen readers when the name is written beside it. */
  decorative?: boolean;
  className?: string;
}

/** "Kai M." → "KM"; "Marcus Reyes" → "MR"; "kai@example.com" → "K". */
export function initialsOf(name: string): string {
  const words = name
    .replace(/@.*$/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  const letters = words.length > 1 ? [words[0]!, words[words.length - 1]!] : words.slice(0, 1);
  return letters.map((w) => w[0]!.toUpperCase()).join("");
}

/** A person, as their initials in a circle. */
export function Avatar({ name, initials, size = 34, current, decorative, className }: AvatarProps) {
  return (
    <span
      className={cx("oc-avatar", size !== 34 && `oc-avatar--${size}`, current && "oc-avatar--current", className)}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative ? true : undefined}
    >
      <span aria-hidden="true">{initials ?? initialsOf(name)}</span>
    </span>
  );
}
