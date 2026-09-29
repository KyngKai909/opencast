// The line under "Ready to sign on" (A.6): how many checks, how many are done, and what's left.
// Warnings don't stop sign-on; blockers do (a gap in the next 24 hours, no station ID, rights).

import { countWord } from "./time";

export interface CheckLike {
  passed: boolean;
  blocking: boolean;
}

/** "Five checks. Four are done; one is a warning you can sign on through." */
export function signOnSummary(checks: CheckLike[]): string {
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
