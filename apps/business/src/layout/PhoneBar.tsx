// The phone's top bar. No phone frame draws one (they're reached from notifications), so this is
// the least that lets someone move around: the business, the page's title, and a menu with the
// rail's pages, switching business and signing out.

import { useState } from "react";
import { BUSINESS_RAIL, IconButton, Sheet, type BusinessPage, type ShellItems } from "@opencast/ui";
import { useAuth } from "../auth/AuthProvider";
import "./PhoneBar.css";

export function PhoneBar(props: { initials: string; colour: string; name: string; title?: string; items: ShellItems<BusinessPage>; linkTo: (p: BusinessPage) => string; active: BusinessPage; onSwitch: () => void }) {
  const [open, setOpen] = useState(false);
  const auth = useAuth();
  return (
    <header className="bz-phonebar">
      <button type="button" className="bz-phonebar__biz" onClick={props.onSwitch} aria-label={`${props.name}. Switch business`}>
        <span className="bz-phonebar__logo" style={{ background: props.colour }} aria-hidden="true">
          {props.initials}
        </span>
      </button>
      <span className="bz-phonebar__title">{props.title ?? props.name}</span>
      <IconButton icon="guide" label="Menu" bare onClick={() => setOpen(true)} />
      <Sheet open={open} onClose={() => setOpen(false)} title={props.name}>
        <nav className="bz-phonebar__nav" aria-label="Opencast for business">
          {BUSINESS_RAIL.map((g) => (
            <div key={g.label} className="bz-phonebar__group">
              <p className="bz-phonebar__g">{g.label}</p>
              {g.items.map((it) => {
                const item = props.items[it.id];
                return item?.disabled ? (
                  <span key={it.id} className="bz-phonebar__link bz-phonebar__link--off" title={item.disabled}>
                    {it.label}
                  </span>
                ) : (
                  <a key={it.id} className="bz-phonebar__link" href={props.linkTo(it.id)} aria-current={props.active === it.id ? "page" : undefined} onClick={() => setOpen(false)}>
                    {it.label}
                    {item?.count && <span className="bz-phonebar__count">{item.count}</span>}
                  </a>
                );
              })}
            </div>
          ))}
          <button type="button" className="bz-phonebar__link" onClick={() => (setOpen(false), props.onSwitch())}>
            Switch business
          </button>
          <button type="button" className="bz-phonebar__link" onClick={() => void auth.signOut()}>
            Sign out
          </button>
        </nav>
      </Sheet>
    </header>
  );
}
