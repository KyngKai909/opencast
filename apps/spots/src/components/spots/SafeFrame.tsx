// The uploaded spot with TV's safe areas drawn over it (biz-spots 02.1): action safe (outer dashes),
// title safe (inner dashes), what needs the business drawn where it is in amber, and the code and
// QR Opencast adds. The picture is the spot itself when it can play here; until then, its still.

import { useState } from "react";
import { PictureFrame } from "@opencast/ui";
import { checkDetail, type SpotX } from "../../api/ext/spots";
import "./SafeFrame.css";

export function SafeFrame({ spot }: { spot: SpotX }) {
  const [videoFailed, setVideoFailed] = useState(false);
  const checks = spot.file?.checks ?? [];
  const safe = checks.find((c) => c.check === "safe_area");
  const problem = safe?.result === "for_you" ? checkDetail(safe.detail) : null;
  const found = safe ? checkDetail(safe.detail).text : undefined;
  const code = checks.find((c) => c.check === "code");
  const placement = code ? (checkDetail(code.detail).placement ?? "bottom_left") : null;
  const scaled = checks.some((c) => c.check === "safe_area" && c.result === "fixed");
  const url = spot.file?.previewUrl ?? spot.file?.url ?? null;
  const drawn = !url || videoFailed || !!spot.still?.stillUrl;
  const still = spot.still;
  return (
    <PictureFrame label={`${spot.title}, with the safe areas drawn over it`} className="bz-safe">
      <div className={`bz-safe__content${scaled ? " bz-safe__content--scaled" : ""}`}>
        {drawn ? (
          still?.stillUrl ? (
            <img src={still.stillUrl} alt="" />
          ) : (
            <div className="bz-safe__card" style={{ background: still?.colour ?? "var(--ink-50)" }}>
              <b>{still?.headline ?? spot.title}</b>
              {still?.line && <span>{still.line}</span>}
              {/* Shrunk to fit: what was outside title safe now sits inside it. */}
              {scaled && found && <span className="bz-safe__found">{found}</span>}
            </div>
          )
        ) : (
          <video src={url} muted playsInline preload="metadata" onError={() => setVideoFailed(true)} />
        )}
      </div>
      {problem?.box && (
        <span
          className="bz-safe__problem"
          style={{ left: `${problem.box.x * 100}%`, top: `${problem.box.y * 100}%`, width: `${problem.box.w * 100}%`, height: `${problem.box.h * 100}%` }}
        >
          {drawn && problem.text}
          <span className="oc-sr-only">Outside title safe{problem.text ? `: ${problem.text}` : ""}</span>
        </span>
      )}
      {spot.code && placement && (
        <div className={`bz-safe__code bz-safe__code--${placement}`}>
          <span className="bz-safe__qr" aria-hidden="true" />
          <div>
            <b>{spot.code.code}</b>
            <small>{spot.code.offer}. Added by Opencast</small>
          </div>
        </div>
      )}
      <span className="bz-safe__as" aria-hidden="true" />
      <span className="bz-safe__ts" aria-hidden="true" />
    </PictureFrame>
  );
}
