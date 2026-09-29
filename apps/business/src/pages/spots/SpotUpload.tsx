// biz-spots 02.1 new spot: upload and the checks (/:businessId/spots/:spotId/setup; /spots/new
// starts the draft).
//
// /spots/new: the name and the file. Once it's uploaded: the frame with TV's safe areas drawn over
// it and the checks beside it, from the spot's `file.checks`: fine, fixed for you, for you to fix,
// or checked in review. "Shrink to fit" sends the same file again with scaleToFit (P2); "Change"
// changes the code and its offer.

import { useState } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router";
import { spotsApi } from "@opencast/contracts";
import { Button } from "@opencast/ui";
import { useApi } from "../../api/hooks";
import { checkDetail, type SpotX } from "../../api/ext/spots";
import { useBusiness } from "../../business/BusinessContext";
import { CodeModal } from "../../components/spots/CodeModal";
import { chosenFiles, errorText, useSpot, useSpotWrite } from "../../components/spots/data";
import { dayWords } from "../../components/spots/format";
import { NewSpotForm } from "../../components/spots/NewSpotForm";
import { LoadError, Section, SpotHead, ViewerBlocked } from "../../components/spots/parts";
import { SafeFrame } from "../../components/spots/SafeFrame";
import { blocksListing, UploadChecks, uploadSummary } from "../../components/spots/UploadChecks";
import { now } from "../../lib/clock";
import { useShellOptions } from "../../layout/shell";
import { Quiet } from "../common";
import "./SpotUpload.css";

export default function SpotUpload() {
  const b = useBusiness();
  const { spotId } = useParams();
  const navigate = useNavigate();
  useShellOptions({ title: "New spot" });
  const allowed = b.can("advertise");
  const spot = useSpot(allowed ? spotId : undefined);
  const business = useApi(spotsApi.getBusiness, { params: { businessId: b.id } }, { enabled: allowed });
  if (!allowed) return <ViewerBlocked />;
  if (spotId && spot.isLoading) return <Quiet />;
  if (spotId && spot.error) return <LoadError message={errorText(spot.error)} />;
  const s = spot.data;
  if (s && s.state !== "draft") return <Navigate to={`${b.base}/spots/${s.id}`} replace />;
  if (!s || !s.file) {
    return (
      <div className="bz-upload">
        <SpotHead crumb="New spot" title={s?.title ?? "New spot"} description="Upload the finished spot. Opencast checks it will air cleanly and adds its code; then you set a rate and a budget." />
        {business.data ? (
          <NewSpotForm business={business.data} draft={s} onDone={(x) => navigate(`${b.base}/spots/${x.id}/setup`, { replace: true })} />
        ) : business.error ? (
          <LoadError message={errorText(business.error)} />
        ) : (
          <Quiet />
        )}
      </div>
    );
  }
  return <Checked spot={s} />;
}

/** "uploaded just now", or the day it was. */
function uploadedWords(spot: SpotX): string {
  const ago = now().getTime() - new Date(spot.createdAt).getTime();
  return ago < 10 * 60_000 ? "uploaded just now" : `uploaded ${dayWords(spot.createdAt)}`;
}

function Checked({ spot }: { spot: SpotX }) {
  const b = useBusiness();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const shrink = useSpotWrite(spotsApi.uploadSpotFile);
  const [needFile, setNeedFile] = useState(false);
  const checks = spot.file?.checks ?? [];
  const blocked = blocksListing(checks);
  const codeCheck = checks.find((c) => c.check === "code");
  const codeFrom = codeCheck ? checkDetail(codeCheck.detail) : {};
  const lastSeconds = codeFrom.fromMs !== undefined && codeFrom.toMs !== undefined ? Math.round((codeFrom.toMs - codeFrom.fromMs) / 1000) : null;

  const doShrink = (file: File) => shrink.mutate({ params: { spotId: spot.id }, body: { file, scaleToFit: true } });
  const onShrink = () => {
    const file = chosenFiles.get(spot.id);
    if (file) doShrink(file);
    else setNeedFile(true);
  };
  const openCode = () => setParams((p) => (p.set("modal", "code"), p));
  const closeCode = () => setParams((p) => (p.delete("modal"), p), { replace: true });

  return (
    <div className="bz-upload">
      <SpotHead crumb="New spot" title={spot.title} description={`${spot.file?.originalFilename ?? "The spot"}, ${uploadedWords(spot)}`} />
      <div className="bz-upload__grid">
        <div>
          <SafeFrame spot={spot} />
          <p className="bz-upload__cap">
            Outer dashes: action safe. Inner dashes: title safe, where text is readable on every TV.
            {lastSeconds !== null && ` The code appears for the last :${String(lastSeconds).padStart(2, "0")}.`}
          </p>
        </div>
        <div>
          <Section title="Checks" sub={uploadSummary(checks)}>
            <UploadChecks
              checks={checks}
              actions={{
                safe_area: checks.some((c) => c.check === "safe_area" && c.result === "for_you") ? (
                  <Button size="sm" onClick={onShrink} disabled={shrink.isPending}>
                    Shrink to fit
                  </Button>
                ) : undefined,
                code: (
                  <Button size="sm" onClick={openCode}>
                    Change
                  </Button>
                )
              }}
            />
          </Section>
          {needFile && (
            <div className="bz-upload__again">
              <label className="bz-upload__againlabel" htmlFor="bz-upload-again">
                Choose the same file again to shrink it
              </label>
              <input
                id="bz-upload-again"
                type="file"
                accept="video/*,.mov,.mp4"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    chosenFiles.set(spot.id, f);
                    setNeedFile(false);
                    doShrink(f);
                  }
                }}
              />
            </div>
          )}
          {shrink.error && (
            <p className="bz-sperror" role="alert">
              {errorText(shrink.error)}
            </p>
          )}
          {blocked && <p className="bz-upload__blocked">The length or picture won't air as it is. Upload a new cut to go on.</p>}
          <Button variant="primary" block className="bz-upload__next" disabled={blocked} onClick={() => navigate(`${b.base}/spots/${spot.id}/setup/rate`)}>
            Next: rate and budget
          </Button>
        </div>
      </div>
      {params.get("modal") === "code" && <CodeModal spot={spot} open onClose={closeCode} />}
    </div>
  );
}
