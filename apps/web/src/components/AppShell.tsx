import { useState, type ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { cn } from "../lib/utils";
import { shortWallet } from "../lib/format";
import { useChannels } from "../state/ChannelsProvider";
import { Logo } from "./Brand";
import { Button } from "./ui";
import { ThemeSwitch } from "./ThemeSwitch";

const NAV = [
  { to: "/", label: "Explore", end: true },
  { to: "/dashboard", label: "Studio" }
];

export function AppShell({ children, wide, bare }: { children: ReactNode; wide?: boolean; bare?: boolean }) {
  const { wallet, connect, disconnect } = useChannels();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const handleConnect = async () => {
    setBusy(true);
    try {
      await connect();
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-line/80 bg-[color-mix(in_oklab,var(--bg)_78%,transparent)] backdrop-blur-xl" data-drift>
        <div className={cn("mx-auto flex h-14 items-center gap-4 px-4 sm:px-6", wide ? "max-w-[1560px]" : "max-w-[1320px]")}>
          <Link to="/" aria-label="OpenCast home" className="shrink-0">
            <Logo />
          </Link>
          <nav className="ml-2 hidden items-center gap-1 sm:flex">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    "rounded-pill px-3 py-1.5 text-sm font-medium transition-colors",
                    isActive ? "bg-surface2 text-ink" : "text-ink-muted hover:text-ink"
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <ThemeSwitch className="hidden md:flex" compact />
            {wallet ? (
              <button
                onClick={disconnect}
                className="hidden items-center gap-2 rounded-pill border border-line bg-surface2 px-3 py-1.5 text-sm sm:flex"
                title="Disconnect"
              >
                <span className="h-2 w-2 rounded-full bg-signal" />
                <span className="font-mono text-ink-muted">{shortWallet(wallet)}</span>
              </button>
            ) : (
              <Button variant="signal" size="sm" onClick={handleConnect} disabled={busy}>
                {busy ? "Connecting…" : "Connect"}
              </Button>
            )}
            <button
              className="grid h-9 w-9 place-items-center rounded-pill border border-line text-ink-muted md:hidden"
              aria-label="Menu"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" aria-hidden>
                <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>

        {open && (
          <div className="border-t border-line bg-bg px-4 py-3 md:hidden" data-drift>
            <nav className="flex flex-col">
              {NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    cn("rounded-lg px-3 py-2.5 text-sm font-medium", isActive ? "bg-surface2 text-ink" : "text-ink-muted")
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
            <div className="mt-3 flex items-center justify-between">
              <ThemeSwitch compact />
              {wallet && (
                <button onClick={disconnect} className="text-sm text-ink-muted">
                  Disconnect
                </button>
              )}
            </div>
          </div>
        )}
      </header>

      <main className={cn("mx-auto w-full", bare ? "" : cn("px-4 pb-24 pt-6 sm:px-6", wide ? "max-w-[1560px]" : "max-w-[1320px]"))}>
        {children}
      </main>
    </div>
  );
}
