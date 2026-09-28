import { useId, type ReactNode } from "react";
import { cx } from "../lib/cx";
import { Icon } from "../icons/Icon";
import type { ShellLink } from "./ShellRail";
import { PhoneBackBar } from "./PhoneBackBar";

/** One settings section. */
export interface SettingsSection extends ShellLink {
  id: string;
  /** Its name on the sub-rail ("Identity", "Money and receipts"). */
  label: string;
  /** In red: a section that ends something (Ownership, Close account). */
  danger?: boolean;
}

export interface SettingsLayoutProps {
  /** The sections, in order. */
  sections: SettingsSection[];
  /** The section on screen. On the phone, null shows the list of sections. */
  active: string | null;
  /** The sub-rail's heading. */
  title?: string;
  /** The pane's heading. Defaults to the active section's label. */
  heading?: ReactNode;
  /** One line under the heading ("These apply on this account's phones, computers and TVs."). */
  description?: ReactNode;
  /**
   * viewer: the viewer's settings page (220px rail, you 05.1). app: master control's and the
   * business app's, inside their shell's main (200px rail, station settings 01.1, biz settings 01.1).
   */
  variant?: "viewer" | "app";
  /** web: sub-rail and pane. phone: the list of sections, and each section a screen with a back arrow. */
  form?: "web" | "phone";
  /** Phone: back from a section to the list. */
  onBack?: () => void;
  /** Phone: the list's link, for the back arrow. */
  backHref?: string;
  children?: ReactNode;
  className?: string;
}

function SectionLink({ s, className, on, children }: { s: SettingsSection; className: string; on: boolean; children: ReactNode }) {
  if (s.href !== undefined)
    return (
      <a className={className} href={s.href} onClick={s.onClick} aria-current={on ? "page" : undefined}>
        {children}
      </a>
    );
  return (
    <button type="button" className={className} onClick={s.onClick} aria-current={on ? "page" : undefined}>
      {children}
    </button>
  );
}

/** Settings: a sub-rail of sections and one pane, on the web; a list of sections, each its own screen, on the phone. */
export function SettingsLayout({
  sections,
  active,
  title = "Settings",
  heading,
  description,
  variant = "app",
  form = "web",
  onBack,
  backHref,
  children,
  className
}: SettingsLayoutProps) {
  const titleId = useId();
  const current = sections.find((s) => s.id === active);

  if (form === "phone") {
    if (!current) {
      return (
        <div className={cx("oc-settings", "oc-settings--phone", className)}>
          <PhoneBackBar title={title} />
          <nav aria-label={title}>
            <ul className="oc-settings__list">
              {sections.map((s) => (
                <li key={s.id}>
                  <SectionLink s={s} on={false} className={cx("oc-settings__row", s.danger && "oc-settings__row--danger")}>
                    {s.label}
                    <Icon name="chev" className="oc-settings__chev" />
                  </SectionLink>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      );
    }
    return (
      <div className={cx("oc-settings", "oc-settings--phone", className)}>
        <PhoneBackBar title={heading ?? current.label} onBack={onBack} backHref={backHref} />
        <div className="oc-settings__screen">
          {description && <p className="oc-settings__phone-lede">{description}</p>}
          {children}
        </div>
      </div>
    );
  }

  return (
    <div className={cx("oc-settings", `oc-settings--${variant}`, className)}>
      <nav className="oc-settings__rail" aria-labelledby={titleId}>
        <h2 className="oc-settings__title" id={titleId}>
          {title}
        </h2>
        {sections.map((s) => (
          <SectionLink
            key={s.id}
            s={s}
            on={s.id === active}
            className={cx("oc-settings__link", s.id === active && "oc-settings__link--on", s.danger && "oc-settings__link--danger")}
          >
            {s.label}
          </SectionLink>
        ))}
      </nav>
      <section className="oc-settings__pane" aria-labelledby={`${titleId}-pane`}>
        <h3 className="oc-settings__heading" id={`${titleId}-pane`}>
          {heading ?? current?.label}
        </h3>
        {description && <p className="oc-settings__lede">{description}</p>}
        {children}
      </section>
    </div>
  );
}
