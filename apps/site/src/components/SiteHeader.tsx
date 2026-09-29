import { Button, Lockup, useGround } from "@opencast/ui";

export const NAV = [
  { href: "#dial", label: "The dial" },
  { href: "#remote", label: "On your TV" },
  { href: "#stations", label: "Run a station" },
  { href: "#producers", label: "For producers" },
  { href: "#businesses", label: "For businesses" },
  { href: "#open", label: "Open source" }
] as const;

/** The toggle names the ground it switches to, as the reference's does. */
export function GroundToggle() {
  const { ground, setChoice } = useGround();
  return (
    <button type="button" className="st-ground-toggle" onClick={() => setChoice(ground === "dark" ? "light" : "dark")}>
      {ground === "dark" ? "Light ground" : "Dark ground"}
    </button>
  );
}

/** S.00: the sticky header. The nav and the toggle go under 900px. */
export function SiteHeader() {
  return (
    <header className="st-head">
      <div className="st-wrap st-head__row">
        <a className="st-brand" href="#top" aria-label="Opencast, top of page">
          <Lockup size="site" />
        </a>
        <nav className="st-nav" aria-label="Sections">
          {NAV.map((n) => (
            <a key={n.href} href={n.href}>{n.label}</a>
          ))}
        </nav>
        <div className="st-head__end">
          <GroundToggle />
          <Button variant="primary" size="sm" href="#join" className="st-btn st-btn--sm">Join the waitlist</Button>
        </div>
      </div>
    </header>
  );
}
