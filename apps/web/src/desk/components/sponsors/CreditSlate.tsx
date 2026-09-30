// The catalog credit as it airs (desk-pages 03's pane): the series' colour, "{Series} is made
// possible by", the sponsor's name large, and their one line. Playout draws the same slate
// (apps/api playout slates.credit), in title safe, at 16:9.
import "./CreditSlate.css";

export function CreditSlate({ subject, name, line, colour, small }: { subject: string; name: string; line: string; colour: string | null; small?: boolean }) {
  return (
    <figure className={`nd-slate${small ? " nd-slate--small" : ""}`} style={{ background: colour ?? "#1F3A5F" }} aria-label={`The credit: ${subject} is made possible by ${name}. ${line}`}>
      <span className="nd-slate__lead" aria-hidden="true">
        {subject} is made possible by
      </span>
      <span className="nd-slate__name" aria-hidden="true">
        {name}
      </span>
      <span className="nd-slate__line" aria-hidden="true">
        {line}
      </span>
    </figure>
  );
}
