// The checks beside the frame (biz-spots 02.1): what passes gets a mark, what Opencast fixed says
// what it did, what needs the business is amber with a way forward. Checks still to come ("pending",
// checked in review) are listed after them, quietly.

import type { ReactNode } from "react";
import { Checks, checksSummary, type Check, type CheckState } from "@opencast/ui";
import type { UploadCheck } from "@opencast/contracts";
import { checkDetail } from "../../api/ext/spots";
import "./UploadChecks.css";

const STATE: Record<Exclude<UploadCheck["result"], "pending">, CheckState> = { fine: "fine", fixed: "fixed", for_you: "attention" };

/** "4 fine, 1 fixed, 1 for you", and how many are still to be checked. */
export function uploadSummary(checks: UploadCheck[]): string {
  const done = checks.filter((c) => c.result !== "pending").map((c) => ({ state: STATE[c.result as keyof typeof STATE], title: c.label }));
  const pending = checks.filter((c) => c.result === "pending").length;
  return [checksSummary(done), pending ? `${pending} checked in review` : ""].filter(Boolean).join(", ");
}

/** A check that stops the spot from airing: the wrong length or picture. */
export function blocksListing(checks: UploadCheck[]): boolean {
  return checks.some((c) => (c.check === "length" || c.check === "picture") && c.result === "for_you");
}

export function UploadChecks({ checks, actions }: { checks: UploadCheck[]; actions?: Partial<Record<UploadCheck["check"], ReactNode>> }) {
  const done: Check[] = checks
    .filter((c) => c.result !== "pending")
    .map((c) => ({ state: STATE[c.result as keyof typeof STATE], title: c.label, detail: checkDetail(c.detail).note, action: actions?.[c.check] }));
  const pending = checks.filter((c) => c.result === "pending");
  return (
    <>
      <Checks items={done} variant="upload" label="Checks" />
      {pending.length > 0 && (
        <ul className="bz-uchecks-pending" aria-label="Checked in review">
          {pending.map((c) => (
            <li key={c.check} className="bz-uchecks-pending__item">
              <span className="bz-uchecks-pending__mark" aria-hidden="true" />
              <span>
                <span className="oc-sr-only">Checked in review: </span>
                <b>{c.label}</b>
                <small>{checkDetail(c.detail).note ?? "Checked in review, usually within a few hours"}</small>
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
