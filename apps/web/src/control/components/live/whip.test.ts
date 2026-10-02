import { describe, expect, it, vi } from "vitest";
import { publishWhip, type WhipDeps } from "./whip";

function fakePeer() {
  const senders = [{ replaceTrack: vi.fn(async () => undefined) }, { replaceTrack: vi.fn(async () => undefined) }];
  let n = 0;
  const pc = {
    iceGatheringState: "complete",
    localDescription: null as { sdp: string } | null,
    addTransceiver: vi.fn(() => ({ sender: senders[n++] })),
    createOffer: vi.fn(async () => ({ type: "offer", sdp: "v=0 offer" })),
    setLocalDescription: vi.fn(async (d: { sdp: string }) => {
      pc.localDescription = d;
    }),
    setRemoteDescription: vi.fn(async () => undefined),
    close: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  };
  return { pc, senders };
}

const track = (kind: string) => ({ kind }) as unknown as MediaStreamTrack;
const stream = (v = track("video"), a = track("audio")) => ({ getVideoTracks: () => [v], getAudioTracks: () => [a] }) as unknown as MediaStream;
const ingest = { whipUrl: "https://livepeer.example/webrtc/abc-123", token: "abc-123" };

describe("publishing to WHIP (B3)", () => {
  it("posts the offer with the token, takes the answer, and deletes the session when it stops", async () => {
    const { pc } = fakePeer();
    const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "DELETE" ? new Response(null, { status: 200 }) : new Response("v=0 answer", { status: 201, headers: { location: "/webrtc/abc-123/session-1" } })
    );
    const s = await publishWhip(stream(), ingest, { fetch: fetch as unknown as typeof globalThis.fetch, createPeer: () => pc as unknown as RTCPeerConnection } satisfies WhipDeps);
    expect(fetch).toHaveBeenCalledWith(ingest.whipUrl, expect.objectContaining({ method: "POST", body: "v=0 offer", headers: { "content-type": "application/sdp", authorization: "Bearer abc-123" } }));
    expect(pc.setRemoteDescription).toHaveBeenCalledWith({ type: "answer", sdp: "v=0 answer" });
    expect(pc.addTransceiver).toHaveBeenCalledTimes(2);
    await s.stop();
    expect(pc.close).toHaveBeenCalled();
    expect(fetch).toHaveBeenLastCalledWith("https://livepeer.example/webrtc/abc-123/session-1", expect.objectContaining({ method: "DELETE" }));
  });

  it("swaps the camera on the same session", async () => {
    const { pc, senders } = fakePeer();
    const fetch = vi.fn(async () => new Response("v=0 answer", { status: 201 }));
    const s = await publishWhip(stream(), ingest, { fetch: fetch as unknown as typeof globalThis.fetch, createPeer: () => pc as unknown as RTCPeerConnection });
    const screen = track("video");
    await s.replace(stream(screen));
    expect(senders[0]!.replaceTrack).toHaveBeenCalledWith(screen);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("closes the connection when the ingest refuses it", async () => {
    const { pc } = fakePeer();
    const fetch = vi.fn(async () => new Response("no", { status: 403 }));
    await expect(publishWhip(stream(), ingest, { fetch: fetch as unknown as typeof globalThis.fetch, createPeer: () => pc as unknown as RTCPeerConnection })).rejects.toThrow("403");
    expect(pc.close).toHaveBeenCalled();
  });
});
