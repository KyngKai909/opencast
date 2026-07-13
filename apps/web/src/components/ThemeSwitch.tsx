import { cn } from "../lib/utils";
import { THEME_OPTIONS, useTheme } from "../theme/ThemeProvider";

/** Day / Dusk / Night / Auto segmented control. */
export function ThemeSwitch({ className, compact }: { className?: string; compact?: boolean }) {
  const { pref, mode, setPref } = useTheme();
  return (
    <div
      className={cn("flex gap-1 rounded-pill border border-line bg-surface2 p-1", className)}
      role="group"
      aria-label="Theme mode"
    >
      {THEME_OPTIONS.map((opt) => {
        const active = pref === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={active}
            onClick={() => setPref(opt.value)}
            title={opt.value === "auto" ? `Auto — currently ${mode}` : opt.label}
            className={cn(
              "rounded-pill font-semibold transition-colors duration-[130ms]",
              compact ? "px-2.5 py-1 text-[12px]" : "px-3 py-1.5 text-[13px]",
              active ? "bg-signal text-signal-ink" : "text-ink-muted hover:text-ink"
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
