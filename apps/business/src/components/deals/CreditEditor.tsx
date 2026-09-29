// The credit line as it's typed (sponsorships 02.1 .credit-edit), with the flagged phrases
// underlined in standby where they sit. A real textarea over a mirror of its text: the mirror draws
// the marks, the textarea takes the typing, and both wrap the same way.

import type { ChangeEvent } from "react";
import "./CreditEditor.css";

export interface CreditMark {
  start: number;
  end: number;
}

export function CreditEditor({ id, value, onChange, marks, describedBy }: { id: string; value: string; onChange: (v: string) => void; marks: CreditMark[]; describedBy?: string }) {
  const sorted = [...marks].filter((m) => m.end > m.start && m.end <= value.length).sort((a, b) => a.start - b.start);
  const parts: { text: string; mark: boolean }[] = [];
  let at = 0;
  for (const m of sorted) {
    if (m.start < at) continue;
    if (m.start > at) parts.push({ text: value.slice(at, m.start), mark: false });
    // The mark leaves out a leading space, as the frame underlines words, not gaps.
    const lead = value.slice(m.start, m.end).match(/^\s*/)![0].length;
    if (lead) parts.push({ text: value.slice(m.start, m.start + lead), mark: false });
    parts.push({ text: value.slice(m.start + lead, m.end), mark: true });
    at = m.end;
  }
  parts.push({ text: value.slice(at), mark: false });
  return (
    <div className="bz-credit">
      <div className="bz-credit__mirror" aria-hidden="true">
        {parts.map((p, i) => (p.mark ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
        {/* Keeps a trailing line break's height. */}
        <span> </span>
      </div>
      <textarea
        id={id}
        className="bz-credit__input"
        value={value}
        maxLength={200}
        rows={2}
        spellCheck
        aria-describedby={describedBy}
        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)}
      />
    </div>
  );
}
