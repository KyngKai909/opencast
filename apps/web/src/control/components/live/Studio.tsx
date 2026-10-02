// The studio view's parts (live-listings 02.1 on the web, 05.1 and 05.2 on the phone): the
// picture with the station's graphics, the camera bar, the countdown, the lower third editor, the
// speaker list and the controls for during the show.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { defaultDriver } from "@opencast/player";
import { Button, Field, KeyValueList, Modal, PictureFrame, SelectField, Sheet, Slate, Tag, Tally, Toggle, clock } from "@opencast/ui";
import type { LowerThird } from "@opencast/contracts";
import { STATION_TZ } from "../../../lib/clock";
import type { Camera } from "./useCamera";
import "./Studio.css";

export interface Speaker {
  id: string;
  name: string;
  title: string | null;
  position: number;
}

/** A section's top: a heading over a line rule, with something at its end. */
export function SecTop({ title, end, id }: { title: ReactNode; end?: ReactNode; id?: string }) {
  return (
    <div className="cc-sec-top">
      <h3 id={id}>{title}</h3>
      {end && <span className="cc-sec-top__end">{end}</span>}
    </div>
  );
}

/** The browser's camera, as a video that fills the picture. */
function CameraVideo({ stream, mirror }: { stream: MediaStream; mirror?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} autoPlay muted playsInline className={mirror ? "cc-studio__mirror" : undefined} />;
}

/** An encoder's signal, as it arrives (S14's private preview, the source's own playback). */
function SignalVideo({ url }: { url: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const h = defaultDriver().attach(v, url, () => {});
    v.muted = true;
    void v.play().catch(() => {});
    return () => h.destroy();
  }, [url]);
  return <video ref={ref} autoPlay muted playsInline />;
}

export interface StudioPictureProps {
  kind: "browser" | "encoder";
  camera?: Camera;
  /** Encoders: what's arriving, or null when nothing is. */
  signalUrl?: string | null;
  bug: { callSign: string; channel: string };
  lowerThird: LowerThird | null;
  /** Before the block: the amber sign on the picture. */
  standby: boolean;
  /** The connection dropped while on air: viewers see the stand by slate. */
  dropped?: boolean;
  label: string;
  /** Fill the parent (the phone's portrait picture). */
  fill?: boolean;
  className?: string;
}

export function StudioPicture({ kind, camera, signalUrl, bug, lowerThird, standby, dropped, label, fill, className }: StudioPictureProps) {
  let picture: ReactNode = null;
  if (dropped) {
    picture = <Slate kind="standby">Viewers see this until the connection comes back. Reconnecting.</Slate>;
  } else if (kind === "browser" && camera) {
    if (camera.stream) picture = <CameraVideo stream={camera.stream} />;
    else if (camera.problem)
      picture = (
        <div className="cc-studio__problem" role="alert">
          <b>{camera.problem === "missing" ? "There's no camera here." : camera.problem === "unsupported" ? "This browser can't use a camera." : "Master control can't use the camera."}</b>
          <span>{camera.problem === "denied" ? "Allow the camera and microphone for this site in your browser, then try again." : "Connect one, or go live from another computer or a phone."}</span>
          <Button size="sm" onClick={camera.retry}>
            Try again
          </Button>
        </div>
      );
  } else if (kind === "encoder") {
    picture = signalUrl ? <SignalVideo url={signalUrl} /> : <Slate kind="standby" title="Not connected yet">Nothing is arriving from the encoder.</Slate>;
  }
  const lt = lowerThird && !lowerThird.hidden && lowerThird.name ? { name: lowerThird.name, title: lowerThird.title ?? undefined } : undefined;
  return (
    <PictureFrame
      className={className}
      fill={fill}
      bug={bug}
      lowerThird={dropped ? undefined : lt}
      corner={standby ? <Tally state="standby" on="picture" /> : undefined}
      // A picture is an image to a screen reader, unless it holds the camera's problem and its button.
      label={!dropped && kind === "browser" && camera && !camera.stream && camera.problem ? undefined : label}
    >
      {picture}
    </PictureFrame>
  );
}

/** The microphone's level, as the frame's small bars. */
export function MicMeter({ level }: { level: number }) {
  const lit = Math.round(level * 6);
  return (
    <span className="cc-meter" aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => (
        <i key={i} className={i < lit ? undefined : "cc-meter__off"} />
      ))}
    </span>
  );
}

/** The camera, the microphone with its meter, and Share screen. */
export function CameraBar({ camera }: { camera: Camera }) {
  const label = (d: MediaDeviceInfo, i: number, what: string) => d.label || `${what} ${i + 1}`;
  return (
    <div className="cc-studio__bar">
      <SelectField className="cc-studio__cam" size="sm" aria-label="Camera" value={camera.cameraId} onChange={(e) => camera.setCameraId(e.target.value)} disabled={!camera.cameras.length}>
        {camera.cameras.length ? camera.cameras.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{label(d, i, "Camera")}</option>) : <option value="">Camera</option>}
      </SelectField>
      <span className="cc-studio__mic">
        <SelectField size="sm" aria-label="Microphone" value={camera.micId} onChange={(e) => camera.setMicId(e.target.value)} disabled={!camera.mics.length}>
          {camera.mics.length ? camera.mics.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{label(d, i, "Microphone")}</option>) : <option value="">Microphone</option>}
        </SelectField>
        <MicMeter level={camera.level} />
      </span>
      {camera.sharing ? (
        <Button size="sm" className="cc-studio__share" onClick={camera.stopSharing}>
          Stop sharing
        </Button>
      ) : (
        <Button size="sm" className="cc-studio__share" onClick={() => void camera.shareScreen()} disabled={typeof navigator === "undefined" || !navigator.mediaDevices?.getDisplayMedia}>
          Share screen
        </Button>
      )}
    </div>
  );
}

/** The countdown before the block, or how long it's been on. */
export function CountdownBox({ phase, title, startsAt, endsAt, count, elapsedText, endedAt }: { phase: "standby" | "on_air" | "ended"; title: string; startsAt: string; endsAt: string; count: string; elapsedText: string; endedAt: string | null }) {
  if (phase === "standby") {
    return (
      <div className="cc-countdown" role="timer" aria-live="off">
        <Tally state="standby" />
        <div className="cc-countdown__cd" aria-label={`${count} to go`}>
          {count}
        </div>
        <small>
          {title} goes out at <span className="oc-mono">{clock(startsAt, { timeZone: STATION_TZ })}</span> by itself. Stay on this page.
        </small>
      </div>
    );
  }
  if (phase === "on_air") {
    return (
      <div className="cc-countdown cc-countdown--on">
        <div className="cc-countdown__cd">{elapsedText.replace(/ in$/, "")}</div>
        <small>
          {title} is going out until <span className="oc-mono">{clock(endsAt, { timeZone: STATION_TZ })}</span>.
        </small>
      </div>
    );
  }
  return (
    <div className="cc-countdown cc-countdown--ended">
      <small>
        {title} ended at <span className="oc-mono">{clock(endedAt ?? endsAt, { timeZone: STATION_TZ })}</span>. The log took over.
      </small>
    </div>
  );
}

/** The lower third: shown or hidden, and the words (02.1). */
export function LowerThirdEditor({ value, onChange, disabled }: { value: LowerThird | null; onChange: (next: Partial<LowerThird>, commit: boolean) => void; disabled?: boolean }) {
  return (
    <section aria-labelledby="cc-l3-h">
      <SecTop
        id="cc-l3-h"
        title="Lower third"
        end={<Toggle checked={!!value && !value.hidden} label="Show the lower third" disabled={disabled || !value} onChange={(on) => onChange({ hidden: !on }, true)} />}
      />
      <div className="cc-l3-edit">
        <Field
          label="Name"
          size="sm"
          value={value?.name ?? ""}
          maxLength={80}
          disabled={disabled || !value}
          onChange={(e) => onChange({ name: e.target.value, speakerId: null }, false)}
          onBlur={() => onChange({}, true)}
        />
        <Field
          label="Title"
          size="sm"
          value={value?.title ?? ""}
          maxLength={120}
          disabled={disabled || !value}
          onChange={(e) => onChange({ title: e.target.value || null, speakerId: null }, false)}
          onBlur={() => onChange({}, true)}
        />
      </div>
    </section>
  );
}

/** The speaker list: added once, shown with one tap (05.2). */
export function SpeakerList({ speakers, showing, onShow, onAdd, heading = true, busy }: { speakers: Speaker[]; showing: string | null; onShow: (s: Speaker) => void; onAdd: () => void; heading?: boolean; busy?: boolean }) {
  return (
    <section className="cc-speakers" aria-labelledby={heading ? "cc-speakers-h" : undefined} aria-label={heading ? undefined : "Speakers"}>
      {heading && <h4 id="cc-speakers-h">Speakers</h4>}
      <KeyValueList
        variant="rows"
        items={[
          ...speakers.map((s) => ({
            title: s.name,
            detail: s.title ?? undefined,
            actions:
              s.id === showing ? (
                <Tag>Showing</Tag>
              ) : (
                <Button size="sm" onClick={() => onShow(s)} disabled={busy} aria-label={`Show ${s.name}`}>
                  Show
                </Button>
              )
          })),
          {
            title: "Add a speaker",
            actions: (
              <Button size="sm" onClick={onAdd}>
                Add
              </Button>
            )
          }
        ]}
      />
    </section>
  );
}

/** Adding a speaker: a name and a title. A modal on the web, a sheet on the phone. */
export function AddSpeaker({ open, phone, onClose, onAdd, error }: { open: boolean; phone: boolean; onClose: () => void; onAdd: (name: string, title: string | null) => void; error?: string | null }) {
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  useEffect(() => {
    if (open) {
      setName("");
      setTitle("");
    }
  }, [open]);
  const Dialog = phone ? Sheet : Modal;
  const submit = () => name.trim() && onAdd(name.trim(), title.trim() || null);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add a speaker"
      footer={
        <>
          <Button variant="primary" onClick={submit} disabled={!name.trim()}>
            Add
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </>
      }
    >
      <form
        className="cc-add-speaker"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} autoFocus error={error ?? undefined} />
        <Field label="Title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}
