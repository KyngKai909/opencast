// Going live from the browser (B3): the camera and microphone go to the browser source's ingest
// over WHIP (WebRTC). The SDP offer is POSTed to `whipUrl` with the token as the bearer; the
// answer comes back as SDP and the session's address in `Location`, which a DELETE ends. The
// station's graphics (the bug, the lower third) are drawn on this screen only: what's sent is the
// camera's picture.

import { useEffect, useRef, useState } from "react";

export interface Ingest {
  whipUrl: string;
  token: string;
}

export type WhipState = "idle" | "connecting" | "sending" | "dropped";

export interface WhipSession {
  /** Swap the camera, microphone or a shared screen without a new session. */
  replace(stream: MediaStream): Promise<void>;
  /** End the session: close the connection and DELETE the resource. */
  stop(): Promise<void>;
  pc: RTCPeerConnection;
}

export interface WhipDeps {
  fetch: typeof fetch;
  createPeer: (config: RTCConfiguration) => RTCPeerConnection;
}

const defaultDeps = (): WhipDeps => ({
  fetch: (...a) => fetch(...a),
  createPeer: (c) => new RTCPeerConnection(c)
});

/** Waits for the ICE candidates to be gathered (or two seconds), so the offer carries them. */
function gathered(pc: RTCPeerConnection, ms = 2000): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener("icegatheringstatechange", check);
      clearTimeout(timer);
      resolve();
    };
    const check = () => pc.iceGatheringState === "complete" && done();
    const timer = setTimeout(done, ms);
    pc.addEventListener("icegatheringstatechange", check);
  });
}

/** Opens a WHIP session sending `stream`. Throws when the ingest refuses it. */
export async function publishWhip(stream: MediaStream, ingest: Ingest, deps: WhipDeps = defaultDeps()): Promise<WhipSession> {
  const pc = deps.createPeer({ bundlePolicy: "max-bundle" });
  const video = stream.getVideoTracks()[0];
  const audio = stream.getAudioTracks()[0];
  const vt = pc.addTransceiver(video ?? "video", { direction: "sendonly", streams: [stream] });
  const at = pc.addTransceiver(audio ?? "audio", { direction: "sendonly", streams: [stream] });
  try {
    await pc.setLocalDescription(await pc.createOffer());
    await gathered(pc);
    const res = await deps.fetch(ingest.whipUrl, {
      method: "POST",
      headers: { "content-type": "application/sdp", authorization: `Bearer ${ingest.token}` },
      body: pc.localDescription?.sdp ?? ""
    });
    if (!res.ok) throw new Error(`The ingest said ${res.status}.`);
    await pc.setRemoteDescription({ type: "answer", sdp: await res.text() });
    const location = res.headers.get("location");
    const resource = location ? new URL(location, ingest.whipUrl).toString() : null;
    return {
      pc,
      replace: async (next) => {
        await vt.sender.replaceTrack(next.getVideoTracks()[0] ?? null);
        await at.sender.replaceTrack(next.getAudioTracks()[0] ?? null);
      },
      stop: async () => {
        pc.close();
        if (resource) await deps.fetch(resource, { method: "DELETE", headers: { authorization: `Bearer ${ingest.token}` } }).catch(() => undefined);
      }
    };
  } catch (e) {
    pc.close();
    throw e;
  }
}

/**
 * Sends `stream` to `ingest` while `active`: connects, follows camera changes, and reconnects
 * after a drop (every five seconds). Without an ingest (no Livepeer), it stays idle.
 */
export function useWhip(stream: MediaStream | null, ingest: Ingest | null | undefined, active: boolean): WhipState {
  const [state, setState] = useState<WhipState>("idle");
  const session = useRef<WhipSession | null>(null);
  const latest = useRef(stream);
  useEffect(() => {
    latest.current = stream;
  });
  const [attempt, setAttempt] = useState(0);
  const hasStream = !!stream;
  const url = ingest?.whipUrl;
  const token = ingest?.token;

  useEffect(() => {
    if (!active || !url || !token || !hasStream || typeof RTCPeerConnection === "undefined") {
      setState("idle");
      return;
    }
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const again = () => {
      if (cancelled) return;
      setState("dropped");
      retry = setTimeout(() => setAttempt((n) => n + 1), 5000);
    };
    setState((s) => (s === "dropped" ? s : "connecting"));
    publishWhip(latest.current!, { whipUrl: url, token })
      .then((s) => {
        if (cancelled) return void s.stop();
        session.current = s;
        setState("sending");
        s.pc.addEventListener("connectionstatechange", () => {
          const c = s.pc.connectionState;
          if (c === "connected") setState("sending");
          else if (c === "failed" || c === "closed") {
            session.current = null;
            void s.stop();
            again();
          }
        });
      })
      .catch(again);
    return () => {
      cancelled = true;
      clearTimeout(retry);
      void session.current?.stop();
      session.current = null;
    };
  }, [active, url, token, hasStream, attempt]);

  // A new camera, microphone or shared screen goes out on the same session.
  useEffect(() => {
    if (stream && session.current) void session.current.replace(stream).catch(() => undefined);
  }, [stream]);

  return state;
}
