import { cx } from "../lib/cx";

/**
 * The traffic log's codes: program, spot, underwriting, bumper, station ID; OPEN for unsold break
 * time. A242 (2026-10-02): OPN an opener, CLS a closer and OFF an off-air card, a library's types
 * that air at sign-on and sign-off (never on the log).
 */
export type LogCodeName = "PGM" | "SPT" | "UND" | "BMP" | "SID" | "OPEN" | "OPN" | "CLS" | "OFF";

/** What each code stands for, in words (the style guide's Program log note). */
export const LOG_CODE_WORDS: Record<LogCodeName, string> = {
  PGM: "Program",
  SPT: "Spot",
  UND: "Underwriting",
  BMP: "Bumper",
  SID: "Station ID",
  OPEN: "Open",
  OPN: "Opener",
  CLS: "Closer",
  OFF: "Off-air card"
};

export interface LogCodeProps {
  code: LogCodeName;
  /** app: master control's log (11px). guide: the style guide's program log table (12px). */
  size?: "app" | "guide";
  className?: string;
}

/** A log code. The code is the signal; colour only backs it up. */
export function LogCode({ code, size = "app", className }: LogCodeProps) {
  return (
    <abbr className={cx("oc-code", `oc-code--${code.toLowerCase()}`, size === "guide" && "oc-code--guide", className)} title={LOG_CODE_WORDS[code]}>
      {code}
    </abbr>
  );
}
