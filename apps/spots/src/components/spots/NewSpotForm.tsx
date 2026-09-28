// Before the check frame (biz-spots 02.1): the spot's name and its file. Choosing "Upload and check"
// starts the spot as a draft (createSpot) and sends the file (uploadSpotFile, multipart); the checks
// come back with it. Used by New spot and by getting started's "Your first spot".
//
// createSpot needs a rate and a budget before there's a file (contract request B1). Until a draft
// can be made without them, it starts with the rate page's suggested values, which the business
// sets on the next page; a draft is never in any station's market.

import { useId, useState, type FormEvent } from "react";
import { Button, Field } from "@opencast/ui";
import { spotsApi, type Business } from "@opencast/contracts";
import { call } from "../../api/client";
import { SpotX } from "../../api/ext/spots";
import { chosenFiles, errorText } from "./data";
import "./NewSpotForm.css";

/** What a new draft starts with until B1 lands: the rate page's suggested rate, budget and cap. */
export const SUGGESTED = {
  rate: { kind: "per_thousand" as const, micros: 8_000_000, perAiringMaxMicros: null },
  budget: { totalMicros: 300_000_000, dailyCapMicros: 12_000_000 }
};

const LENGTHS = [15, 30, 60] as const;

/** The spot's length from the file itself, to the nearest length a spot can be (:30 when it can't be read). */
export function nearestLength(seconds: number | null): 15 | 30 | 60 {
  if (!seconds || !Number.isFinite(seconds)) return 30;
  return LENGTHS.reduce((a, b) => (Math.abs(b - seconds) < Math.abs(a - seconds) ? b : a));
}

function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    let url = "";
    try {
      url = URL.createObjectURL(file);
    } catch {
      resolve(null);
      return;
    }
    const v = document.createElement("video");
    const done = (d: number | null) => {
      URL.revokeObjectURL(url);
      resolve(d);
    };
    const t = setTimeout(() => done(null), 4000);
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      clearTimeout(t);
      done(Number.isFinite(v.duration) ? v.duration : null);
    };
    v.onerror = () => {
      clearTimeout(t);
      done(null);
    };
    v.src = url;
  });
}

export interface NewSpotFormProps {
  business: Pick<Business, "id" | "category">;
  /** A draft that has no file yet: upload to it instead of starting another. */
  draft?: SpotX;
  onDone: (spot: SpotX) => void;
}

export function NewSpotForm({ business, draft, onDone }: NewSpotFormProps) {
  const fileId = useId();
  const [title, setTitle] = useState(draft?.title ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A draft made on an earlier try: a failed upload doesn't leave a second draft behind.
  const [made, setMade] = useState<SpotX | undefined>(draft);
  const ready = title.trim().length > 0 && !!file && !busy;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready || !file) return;
    setBusy(true);
    setError(null);
    try {
      const spot =
        made ??
        (await call(
          spotsApi.createSpot,
          {
            params: { businessId: business.id },
            body: { title: title.trim(), lengthSec: nearestLength(await readDuration(file)), category: business.category, ...SUGGESTED }
          },
          SpotX
        ));
      setMade(spot);
      chosenFiles.set(spot.id, file);
      const uploaded = await call(spotsApi.uploadSpotFile, { params: { spotId: spot.id }, body: { file, scaleToFit: false } }, SpotX);
      onDone(uploaded);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <form className="bz-newspot" onSubmit={(e) => void submit(e)}>
      <Field label="Call it" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} disabled={!!draft || busy} required />
      <div className="bz-newspot__file">
        <span className="bz-newspot__label" id={`${fileId}-l`}>
          The spot
        </span>
        <div className="bz-newspot__pick">
          <input id={fileId} className="bz-newspot__input" type="file" accept="video/*,.mov,.mp4" aria-labelledby={`${fileId}-l ${fileId}-b`} disabled={busy} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <label htmlFor={fileId} id={`${fileId}-b`} className="oc-btn oc-btn--ghost oc-btn--sm bz-newspot__choose">
            {file ? "Choose another" : "Choose the file"}
          </label>
          <span className="bz-newspot__name">{file ? file.name : "A :15, :30 or :60 video"}</span>
        </div>
        <p className="bz-newspot__help">It's checked the moment it arrives: length, picture, safe areas, captions and loudness. Opencast adds its code and QR.</p>
      </div>
      {error && (
        <p className="bz-newspot__error" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" block disabled={!ready}>
        {busy ? "Uploading and checking" : "Upload and check"}
      </Button>
    </form>
  );
}
