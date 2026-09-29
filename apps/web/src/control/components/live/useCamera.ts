// The browser studio's camera and microphone (live-listings 02.1, 05.x): the local picture, the
// device lists for the two selects, a level for the microphone meter, and sharing the screen.
// Nothing is sent anywhere: browser ingest has no endpoint yet (docs/contract-requests.md B3).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type CameraProblem = "denied" | "missing" | "unsupported" | null;

export interface Camera {
  stream: MediaStream | null;
  problem: CameraProblem;
  cameras: MediaDeviceInfo[];
  mics: MediaDeviceInfo[];
  cameraId: string;
  micId: string;
  setCameraId(id: string): void;
  setMicId(id: string): void;
  /** 0 to 1, the microphone's level right now. */
  level: number;
  sharing: boolean;
  shareScreen(): Promise<void>;
  stopSharing(): void;
  retry(): void;
}

export function useCamera(enabled = true): Camera {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [screen, setScreen] = useState<MediaStream | null>(null);
  const [problem, setProblem] = useState<CameraProblem>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState("");
  const [micId, setMicId] = useState("");
  const [level, setLevel] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const current = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    if (!md?.getUserMedia) {
      setProblem("unsupported");
      return;
    }
    let cancelled = false;
    md.getUserMedia({
      video: cameraId ? { deviceId: { exact: cameraId }, width: { ideal: 1920 }, height: { ideal: 1080 } } : { width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: micId ? { deviceId: { exact: micId } } : true
    })
      .then(async (s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        current.current?.getTracks().forEach((t) => t.stop());
        current.current = s;
        setStream(s);
        setProblem(null);
        const list = await md.enumerateDevices();
        if (cancelled) return;
        setDevices(list);
        const v = s.getVideoTracks()[0]?.getSettings().deviceId;
        const a = s.getAudioTracks()[0]?.getSettings().deviceId;
        if (v && !cameraId) setCameraId(v);
        if (a && !micId) setMicId(a);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const name = e instanceof DOMException ? e.name : "";
        setProblem(name === "NotFoundError" || name === "OverconstrainedError" ? "missing" : "denied");
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, cameraId, micId, attempt]);

  // Let go of the camera when the page goes.
  useEffect(
    () => () => {
      current.current?.getTracks().forEach((t) => t.stop());
    },
    []
  );

  // The microphone meter.
  useEffect(() => {
    if (!stream || !stream.getAudioTracks().length || typeof AudioContext === "undefined") return;
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    const data = new Uint8Array(an.fftSize);
    let raf = 0;
    let last = 0;
    const tick = (ts: number) => {
      raf = requestAnimationFrame(tick);
      if (ts - last < 80) return;
      last = ts;
      an.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
      setLevel(Math.min(1, peak * 1.6));
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      void ctx.close();
    };
  }, [stream]);

  const shareScreen = useCallback(async () => {
    const md = navigator.mediaDevices;
    if (!md?.getDisplayMedia) return;
    try {
      const s = await md.getDisplayMedia({ video: true, audio: false });
      s.getVideoTracks()[0]?.addEventListener("ended", () => setScreen(null));
      setScreen(s);
    } catch {
      // Dismissed: stay on the camera.
    }
  }, []);

  const stopSharing = useCallback(() => {
    setScreen((s) => {
      s?.getTracks().forEach((t) => t.stop());
      return null;
    });
  }, []);

  // The picture: the shared screen with the microphone's sound, or the camera.
  const shown = useMemo(() => (screen && stream ? new MediaStream([...screen.getVideoTracks(), ...stream.getAudioTracks()]) : stream), [screen, stream]);

  return {
    stream: shown,
    problem,
    cameras: devices.filter((d) => d.kind === "videoinput"),
    mics: devices.filter((d) => d.kind === "audioinput"),
    cameraId,
    micId,
    setCameraId,
    setMicId,
    level,
    sharing: !!screen,
    shareScreen,
    stopSharing,
    retry: () => setAttempt((n) => n + 1)
  };
}
