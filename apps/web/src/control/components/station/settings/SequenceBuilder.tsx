// Settings, Breaks: one bumper sequence (A243, 2026-10-02; no frame draws it: built like the
// ladder's rows). A row of role chips in air order ("Into the break", "Up next"), each draggable
// and movable with the arrow keys (announced, as the ladder's rows are), each with a remove button,
// an Add menu with the roles not already there (four at most), what fills each role under its
// chip ("2 in your library", "None yet, so an Any bumper airs"), and how often it airs.

import { useState, type DragEvent, type KeyboardEvent } from "react";
import type { BumperRole, PositionRule } from "@opencast/contracts";
import { Icon, Menu } from "@opencast/ui";
import { ValueSelect } from "../ValueSelect";
import { cadenceKey, everyFromKey, MAX_ROLES, moveRole, placeRole, SEQ_ROLE_WORDS, sequenceOptions, type SequencePosition } from "../breakRule";
import "./SequenceBuilder.css";

const ROLES: BumperRole[] = ["into_break", "up_next", "out_of_break", "any"];

export interface SequenceBuilderProps {
  position: SequencePosition;
  /** "Opening the break". */
  title: string;
  rule: PositionRule;
  onChange: (rule: PositionRule) => void;
  /** What fills each role ("2 in your library"). */
  supply: (role: BumperRole) => string;
  disabled?: boolean;
}

export function SequenceBuilder({ position, title, rule, onChange, supply, disabled }: SequenceBuilderProps) {
  const [dragging, setDragging] = useState<BumperRole | null>(null);
  const [said, setSaid] = useState("");
  const roles = rule.roles;
  const id = (r: BumperRole) => `cc-seq-${position}-${r}`;
  const set = (next: BumperRole[]) => onChange({ ...rule, roles: next });

  const move = (role: BumperRole, delta: -1 | 1) => {
    const next = moveRole(roles, role, delta);
    if (next.join() === roles.join()) return;
    set(next);
    setSaid(`${SEQ_ROLE_WORDS[role]}, now ${next.indexOf(role) + 1} of ${next.length}`);
    requestAnimationFrame(() => document.getElementById(id(role))?.focus());
  };
  const onKey = (e: KeyboardEvent<HTMLLIElement>, role: BumperRole) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "ArrowUp" || e.key === "ArrowLeft" || e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      move(role, e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 1);
    }
  };
  const onDrop = (e: DragEvent<HTMLLIElement>, index: number) => {
    e.preventDefault();
    if (dragging) set(placeRole(roles, dragging, index));
    setDragging(null);
  };
  const remove = (role: BumperRole) => {
    set(roles.filter((r) => r !== role));
    setSaid(`${SEQ_ROLE_WORDS[role]} removed`);
  };
  const add = (role: BumperRole) => {
    set([...roles, role]);
    setSaid(`${SEQ_ROLE_WORDS[role]} added, ${roles.length + 1} of ${roles.length + 1}`);
  };
  const addable = ROLES.filter((r) => !roles.includes(r));

  return (
    <div className="cc-seq" data-position={position}>
      {roles.length ? (
        <ol className="cc-seq__chips" aria-label={`${title}, in this order`}>
          {roles.map((role, i) => (
            <li
              key={role}
              id={id(role)}
              className={dragging === role ? "cc-seq__chip cc-seq__chip--dragging" : "cc-seq__chip"}
              draggable={!disabled}
              tabIndex={disabled ? undefined : 0}
              aria-describedby={disabled ? undefined : `cc-seq-${position}-keys`}
              onDragStart={(e) => {
                setDragging(role);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={() => setDragging(null)}
              onDragOver={(e) => dragging && e.preventDefault()}
              onDrop={(e) => onDrop(e, i)}
              onKeyDown={disabled ? undefined : (e) => onKey(e, role)}
            >
              <span className="cc-seq__top">
                <b>{SEQ_ROLE_WORDS[role]}</b>
                {!disabled && (
                  <button type="button" className="cc-seq__x" aria-label={`Remove ${SEQ_ROLE_WORDS[role]}`} onClick={() => remove(role)}>
                    <Icon name="x" size={12} />
                  </button>
                )}
              </span>
              <small>{supply(role)}</small>
            </li>
          ))}
        </ol>
      ) : (
        <p className="cc-seq__empty">Nothing airs here.</p>
      )}
      <div className="cc-seq__end">
        {!disabled && roles.length < MAX_ROLES && addable.length > 0 && <Menu label={`Add to ${title}`} trigger={{ content: <span className="cc-seq__add">Add</span>, className: "cc-seq__addbtn" }} items={addable.map((r) => ({ label: SEQ_ROLE_WORDS[r], onSelect: () => add(r) }))} />}
        <ValueSelect
          label={`How often: ${title}`}
          value={cadenceKey(rule.every === "break" && position === "between" ? { every: "program" } : rule)}
          options={sequenceOptions(position)}
          disabled={disabled}
          onChange={(key) => {
            const every = everyFromKey(key);
            onChange({ roles, every: every.every, ...(every.n ? { n: every.n } : {}) });
          }}
        />
      </div>
      <span className="oc-sr-only" id={`cc-seq-${position}-keys`}>
        Move it with the arrow keys.
      </span>
      <span className="oc-sr-only" aria-live="polite">
        {said}
      </span>
    </div>
  );
}
