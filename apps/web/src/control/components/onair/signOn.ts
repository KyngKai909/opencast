// The line under "Ready to sign on" (A.6): how many checks, how many are done, and what's left.
// Warnings don't stop sign-on; blockers do (a gap in the next 24 hours, no station ID, rights).
// Some lines only inform (G9's `off_air_hours`: off air is planned, and it isn't dead air): they're
// listed, never counted as checks.

import { countWord } from "./time";

export interface CheckLike {
  key?: string;
  passed: boolean;
  blocking: boolean;
}

/** Checks that only inform: shown as fine, never counted, never blocking. */
export const INFORMATIONAL_CHECKS: ReadonlySet<string> = new Set(["off_air_hours"]);

export function isInformational(c: CheckLike): boolean {
  return !!c.key && INFORMATIONAL_CHECKS.has(c.key);
}

/** "Five checks. Four are done; one is a warning you can sign on through." */
export function signOnSummary(all: CheckLike[]): string {
  const checks = all.filter((c) => !isInformational(c));
  const n = checks.length;
  const done = checks.filter((c) => c.passed).length;
  const blockers = checks.filter((c) => !c.passed && c.blocking).length;
  const warnings = checks.filter((c) => !c.passed && !c.blocking).length;
  const head = `${countWord(n, true)} ${n === 1 ? "check" : "checks"}.`;
  if (done === n) return `${head} ${n === 1 ? "It's" : `All ${countWord(n)} are`} done.`;
  const doneText = `${countWord(done, true)} ${done === 1 ? "is" : "are"} done`;
  if (blockers) return `${head} ${doneText}; ${countWord(blockers)} ${blockers === 1 ? "needs" : "need"} fixing before you can sign on.`;
  return `${head} ${doneText}; ${countWord(warnings)} ${warnings === 1 ? "is a warning" : "are warnings"} you can sign on through.`;
}
