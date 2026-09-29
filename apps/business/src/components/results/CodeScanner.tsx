// Scanning the customer's phone at the counter: the camera, looking for the QR on the saved offer.
// It reads the code (and, from the saved offer's QR, which customer it is) with the browser's
// barcode detector. Where the browser has none, or no camera, it says so: type the code instead.

import { useEffect, useRef, useState } from "react";
import { PictureFrame } from "@opencast/ui";
import "./CodeScanner.css";

interface Detected {
  code: string;
  customerRef?: string;
}

/** The code in a scanned QR: a saved offer's link (".../c/ORANGE10?customer=…"), or the code itself. */
export function readScan(text: string): Detected | null {
  const t = text.trim();
  try {
    const u = new URL(t);
    const m = /\/c\/([A-Za-z0-9]{3,16})(?:\/|$)/.exec(u.pathname);
    if (m) return { code: m[1]!.toUpperCase(), customerRef: u.searchParams.get("customer") ?? undefined };
  } catch {
    // Not a link.
  }
  return /^[A-Za-z0-9]{3,16}$/.test(t) ? { code: t.toUpperCase() } : null;
}

type Detector = { detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> };

export function CodeScanner({ onCode }: { onCode: (d: Detected) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    let stopped = false;
    const Ctor = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) return setProblem("This phone's camera isn't available here. Type the code instead.");
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      } catch {
        return setProblem("The camera isn't available. Allow it in your browser, or type the code instead.");
      }
      if (stopped) return stream.getTracks().forEach((t) => t.stop());
      if (video.current) {
        video.current.srcObject = stream;
        await video.current.play().catch(() => undefined);
      }
      if (!Ctor) return setProblem("This browser can't read codes from the camera. Type the code instead.");
      const detector = new Ctor({ formats: ["qr_code"] });
      timer = setInterval(async () => {
        if (!video.current || video.current.readyState < 2) return;
        const found = await detector.detect(video.current).catch(() => []);
        const d = found.map((f) => readScan(f.rawValue)).find(Boolean);
        if (d) {
          clearInterval(timer);
          onCode(d);
        }
      }, 300);
    })();
    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onCode]);
  return (
    <div className="bz-scan">
      <PictureFrame className="bz-scan__view" label="The camera, looking for the code on the customer's screen">
        <video ref={video} muted playsInline />
      </PictureFrame>
      <p className="bz-scan__p" role={problem ? "alert" : undefined}>
        {problem ?? "Hold the customer's screen up to the camera."}
      </p>
    </div>
  );
}
