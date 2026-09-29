// Market 03.1 previewing an episode: the one place with a scrub bar, the maker's break points in
// amber under it, and the listing's facts. Previews aren't airings; the first play is counted
// (how many, never who). On the phone, a sheet.
//
// packages/player has no seekable preview mode yet, so the picture is the episode's title card and
// the scrub bar keeps its own playhead (see the report). The preview's HLS is `previewUrl`.

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { catalogApi } from "@opencast/contracts";
import { Button, KeyValueList, Modal, ScrubBar, Sheet } from "@opencast/ui";
import { call } from "../../../api/client";
import type { OfferDetailX } from "../../api/ext/market";
import { useIsPhone } from "../../layout/shell";
import { ADVISORY_WORDS, breakPointsText, captionsText, makerName } from "./words";
import "./PreviewEpisode.css";

export function PreviewEpisode({ offer: o, episodeId, action, onClose }: { offer: OfferDetailX; episodeId: string; action: ReactNode; onClose: () => void }) {
  const phone = useIsPhone();
  const e = o.episodes.find((x) => x.id === episodeId);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const counted = useRef(false);
  const length = e?.durationMs ?? 0;
  const ready = !!e?.previewUrl;

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setPosition((p) => Math.min(length, p + 1000)), 1000);
    return () => clearInterval(t);
  }, [playing, length]);
  useEffect(() => {
    if (playing && position >= length) setPlaying(false);
  }, [playing, position, length]);

  const toggle = () => {
    if (!ready) return;
    if (!playing && !counted.current) {
      counted.current = true;
      void call(catalogApi.countPreview, { params: { offerId: o.id } }).catch(() => undefined);
    }
    setPlaying((p) => !p);
  };

  if (!e) {
    return (
      <Modal open onClose={onClose} title="That episode isn't offered.">
        {null}
      </Modal>
    );
  }
  const title = `${o.program.title}${e.episodeNumber != null ? `, ep. ${e.episodeNumber}` : ""}: ${e.title}`;
  const captions = captionsText(e.captions, e.speech);
  const body = (
    <div className="cc-mk-preview">
      <div className="cc-mk-preview__pic" style={{ "--cc-pic": o.program.colour ?? o.maker.colour ?? undefined } as CSSProperties}>
        <div>
          <div className="cc-mk-preview__t">{o.program.title}</div>
          <div className="cc-mk-preview__e">{e.title}</div>
          {!ready && <div className="cc-mk-preview__wait">The preview is still being made.</div>}
        </div>
      </div>
      <ScrubBar position={position} length={length} playing={playing} onPlayPause={toggle} onSeek={ready ? setPosition : undefined} breaks={e.breakPointsMs} step={30_000} className="cc-mk-preview__scrub" />
      <KeyValueList
        className="cc-mk-preview__kv"
        items={[
          { label: "Break points", value: breakPointsText(e.breakPointsMs) },
          ...(captions ? [{ label: "Captions", value: captions }] : []),
          ...(o.program.advisory ? [{ label: "Advisory", value: ADVISORY_WORDS[o.program.advisory] }] : [])
        ]}
      />
    </div>
  );
  const footer = (
    <>
      {action}
      <Button onClick={onClose}>Back to the program</Button>
    </>
  );
  const eyebrow = `Preview, from ${makerName(o.maker)}`;
  return phone ? (
    <Sheet open onClose={onClose} eyebrow={eyebrow} title={title} footer={footer} footStacked>
      {body}
    </Sheet>
  ) : (
    <Modal open onClose={onClose} width={780} eyebrow={eyebrow} title={title} footer={footer}>
      {body}
    </Modal>
  );
}
