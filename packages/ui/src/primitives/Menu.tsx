import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cx } from "../lib/cx";
import { Icon } from "../icons/Icon";
import type { IconName } from "../icons/glyphs";
import { moveIndex } from "./roving";

export interface MenuItem {
  /** Verb first, sentence case: "Remove", "Export to IPFS". */
  label: string;
  onSelect: () => void;
  icon?: IconName;
  /** A line under the label. */
  detail?: string;
  /** Something that takes a thing away ("Remove"): drawn in the live red, as settings' danger links are. */
  danger?: boolean;
  disabled?: boolean;
}

export interface MenuProps {
  items: ReadonlyArray<MenuItem>;
  /** The button's name. "More" by default, as in the reference; name the row when there are many ("More for NITE 88.3"). */
  label?: string;
  /** Which edge of the button the list lines up with. End by default (row menus sit at the row's end). */
  align?: "start" | "end";
  /** Show the list now (the gallery's still states). */
  defaultOpen?: boolean;
  /** What the button shows in place of "···" (the header avatar's initials), with its own class. */
  trigger?: { content: ReactNode; className: string };
  className?: string;
}

/**
 * The "···" row menu: a small button that opens a list of actions. Arrow keys, Home and End move
 * through it, Enter chooses, Escape and Tab close it; focus goes back to the button.
 */
export function Menu({ items, label = "More", align = "end", defaultOpen = false, trigger, className }: MenuProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [active, setActive] = useState(-1);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();
  const disabled = (i: number) => !!items[i]?.disabled;

  const openAt = (i: number | null) => {
    setOpen(true);
    setActive(i ?? -1);
  };
  const close = (returnFocus: boolean) => {
    setOpen(false);
    setActive(-1);
    if (returnFocus) button.current?.focus();
  };

  // Focus follows the active item once the list is drawn.
  useEffect(() => {
    if (open && active >= 0) refs.current[active]?.focus();
  }, [open, active]);

  // A press anywhere outside closes it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!list.current?.contains(t) && !button.current?.contains(t)) close(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const first = moveIndex(-1, "Home", items.length, disabled);
  const last = moveIndex(items.length, "End", items.length, disabled);

  return (
    <div className={cx("oc-menu", className)}>
      <button
        ref={button}
        type="button"
        className={trigger ? trigger.className : "oc-menu__btn"}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : openAt(first))}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openAt(first);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            openAt(last);
          } else if (e.key === "Escape" && open) {
            e.stopPropagation();
            close(true);
          }
        }}
      >
        {trigger ? trigger.content : <span aria-hidden="true">&middot;&middot;&middot;</span>}
      </button>
      {open && (
        <div
          ref={list}
          id={menuId}
          role="menu"
          aria-label={label}
          className={cx("oc-menu__list", `oc-menu__list--${align}`)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              close(true);
            } else if (e.key === "Tab") {
              close(false);
            } else {
              const next = moveIndex(active, e.key, items.length, disabled);
              if (next !== null) {
                e.preventDefault();
                setActive(next);
              }
            }
          }}
        >
          {items.map((item, i) => (
            <button
              key={item.label}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="menuitem"
              tabIndex={i === active ? 0 : -1}
              disabled={item.disabled}
              className={cx("oc-menu__item", item.danger && "oc-menu__item--danger")}
              onMouseEnter={() => !item.disabled && setActive(i)}
              onClick={() => {
                close(true);
                item.onSelect();
              }}
            >
              {item.icon && <Icon name={item.icon} />}
              <span className="oc-menu__words">
                {item.label}
                {item.detail && <small>{item.detail}</small>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

