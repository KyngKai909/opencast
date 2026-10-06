// Form uploads (2026-10-06): multer wrote a file to disk before the caller was known and before the
// endpoint's own limit applied (up to 8 GB, for anyone). Now who may send it is checked before a
// byte of the file is read, each endpoint takes its own size (cut off as it streams in, 413), the
// temp file goes whatever happens, and a UTF-8 file name arrives as it was named.
import { promises as fs } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileName } from "../src/v1/formUploads.js";
import type { Fetch } from "../src/v1/modules/network/external.js";
import { anon, createHarness, market, stationFixture, testClip, type Harness, type User } from "./harness.js";

let h: Harness;
let server: http.Server;
let dee: User;
let kai: User;
let stranger: User;
let sourceId: string;
let stationId: string;

const WEEKLY = [`All times Pacific`, `,Mon,Tue,Wed,Thu,Fri,Sat,Sun`, `,Morning Show 7:00 AM,Morning Show 7:00 AM,Morning Show 7:00 AM,Morning Show 7:00 AM,Morning Show 7:00 AM,Cartoons 8:00 AM,Cartoons 8:00 AM`, `,Movie 8:00 PM,Movie 8:00 PM,Movie 8:00 PM,Movie 8:00 PM,Movie 8:00 PM,Movie 9:00 PM,Movie 9:00 PM`].join("\n");
const MB = 1024 * 1024;

/** Multer's temp directory, and what's in it. */
const tmpDir = () => path.join(h.deps.config.storageRoot, "uploads", "tmp");
const temps = async () => (await fs.readdir(tmpDir())).sort();
const scheduleFile = () => `/v1/admin/listed-sources/${sourceId}/schedule-file`;

async function until(check: () => Promise<boolean>, ms = 5_000) {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/**
 * A form upload that says it's 1 GiB, sends the part's header and `bytes` of the file, and never
 * finishes: the answer has to come while the rest is still "on its way". `abort` drops the
 * connection instead of waiting for one (once a temp file is there).
 */
function partialUpload(url: string, token: string | null, bytes: number, options: { abort?: boolean } = {}) {
  const boundary = "----opencast-form-upload-test";
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="big.csv"\r\nContent-Type: text/csv\r\n\r\n`);
  const { port } = server.address() as AddressInfo;
  return new Promise<{ status: number; body: { error?: { code: string; message: string } }; connection: string | undefined; tempsWhenAnswered: string[] }>((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1",
      port,
      method: "POST",
      path: url,
      headers: { "content-type": `multipart/form-data; boundary=${boundary}`, "content-length": String(1024 ** 3), ...(token ? { authorization: `Bearer ${token}` } : {}) }
    });
    req.on("error", () => undefined);
    req.on("response", (res) => {
      let text = "";
      res.on("data", (chunk) => (text += chunk));
      res.on("end", async () => {
        const tempsWhenAnswered = await temps();
        req.destroy();
        resolve({ status: res.statusCode!, body: JSON.parse(text), connection: res.headers.connection, tempsWhenAnswered });
      });
    });
    req.write(head);
    req.write(Buffer.alloc(bytes, 0x41));
    if (options.abort) {
      until(async () => (await temps()).length > 0).then(
        () => {
          req.destroy();
          resolve({ status: 0, body: {}, connection: undefined, tempsWhenAnswered: [] });
        },
        reject
      );
    }
  });
}

beforeAll(async () => {
  // No network: the stream check on listing fails, as it may.
  h = await createHarness({ externalFetch: (async () => Promise.reject(new TypeError("fetch failed"))) as Fetch });
  h.clock.set("2026-10-08T16:00:00.000Z");
  server = h.app.listen(0);
  dee = await h.signIn("Dee A.", { admin: true });
  kai = await h.signIn("Kai");
  stranger = await h.signIn("Stranger");
  const marketId = (await market(h)).id;
  sourceId = (
    await dee
      .post("/v1/admin/listed-sources", { marketId, band: "tv", channel: "47.1", callSign: "LOOP", name: "Loop Channel", streamUrl: "https://loop.example.org/live/index.m3u8", plays: "stream_link", evidence: { publicBasis: "A volunteer channel's public stream" } })
      .expect(201)
  ).body.id;
  stationId = (await stationFixture(h, { ownerId: kai.id, name: "Kai TV" })).id;
}, 60_000);
afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await h.close();
});

describe("who may send a file is known before it's read", () => {
  it("answers an anonymous upload 401 at once, with nothing written and the rest of the body never read", async () => {
    expect(await temps()).toEqual([]);
    const res = await partialUpload(scheduleFile(), null, 256 * 1024);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({ code: "unauthorized", message: "Sign in to do that." });
    expect(res.tempsWhenAnswered).toEqual([]);
    // The connection closes after the answer: the other 1023 MB aren't read either.
    expect(res.connection).toBe("close");
    // And a whole one, as a browser sends it.
    await anon(h).post(scheduleFile()).attach("file", Buffer.from(WEEKLY), "week.csv").expect(401);
    expect(await temps()).toEqual([]);
  });

  it("answers the wrong role the same way, on the desk and on a station's 8 GB upload", async () => {
    const desk = await partialUpload(scheduleFile(), kai.token, 256 * 1024);
    expect(desk).toMatchObject({ status: 403, body: { error: { code: "forbidden" } }, tempsWhenAnswered: [], connection: "close" });
    // Not on the station's staff (404, as for any station of someone else's): refused before the
    // file, though the endpoint takes 8 GB.
    const station = await partialUpload(`/v1/stations/${stationId}/library/uploads`, stranger.token, 256 * 1024);
    expect(station).toMatchObject({ status: 404, body: { error: { code: "not_found" } }, tempsWhenAnswered: [], connection: "close" });
    await stranger.post(`/v1/stations/${stationId}/library/uploads`).attach("file", Buffer.alloc(64 * 1024), "clip.mp4").expect(404);
    expect(await temps()).toEqual([]);
  });
});

describe("each endpoint's own limit", () => {
  it("cuts an oversize file off as it streams in: 413 in the endpoint's words, before the rest arrives, nothing left", async () => {
    const res = await partialUpload(scheduleFile(), dee.token, 2 * MB + 64 * 1024);
    expect(res.status).toBe(413);
    expect(res.body.error).toEqual({ code: "too_big", message: "Use a file of 2 MB or less." });
    expect(res.tempsWhenAnswered).toEqual([]);
    // Sent whole: the same.
    const whole = await dee.post(scheduleFile()).attach("file", Buffer.alloc(2 * MB + 1, 0x41), "week.csv").expect(413);
    expect(whole.body.error).toEqual({ code: "too_big", message: "Use a file of 2 MB or less." });
    expect(await temps()).toEqual([]);
  });

  it("takes a file of exactly the limit (the handler reads it, and says what's wrong with it)", async () => {
    const res = await dee.post(scheduleFile()).attach("file", Buffer.alloc(2 * MB, 0x41), "week.csv").expect(422);
    expect(res.body.error.code).toBe("no_event_data");
    expect(await temps()).toEqual([]);
  });

  it("limits the form's other fields too", async () => {
    const res = await dee.post(scheduleFile()).field("sheet", "x".repeat(70 * 1024)).attach("file", Buffer.from(WEEKLY), "week.csv").expect(413);
    expect(res.body.error.code).toBe("too_big");
    const two = await dee.post(scheduleFile()).attach("file", Buffer.from(WEEKLY), "a.csv").attach("file", Buffer.from(WEEKLY), "b.csv").expect(400);
    expect(two.body.error).toMatchObject({ code: "bad_request", message: "Send one file at a time." });
    expect(await temps()).toEqual([]);
  });
});

describe("temp files", () => {
  it("are removed when the connection drops mid-file", async () => {
    await partialUpload(scheduleFile(), dee.token, 512 * 1024, { abort: true });
    await until(async () => (await temps()).length === 0);
  });

  it("are removed when the handler refuses the file", async () => {
    expect((await dee.post(scheduleFile()).attach("file", Buffer.from("%PDF-1.4"), "week.pdf").expect(422)).body.error.code).toBe("not_a_spreadsheet");
    expect(await temps()).toEqual([]);
  });
});

describe("file names", () => {
  it("reads a UTF-8 name as it was named, and keeps ASCII and other names as they are", () => {
    const named = "Programación — été.csv";
    // What busboy hands over: the UTF-8 bytes, one Latin-1 character each.
    expect(fileName(Buffer.from(named, "utf8").toString("latin1"))).toBe(named);
    expect(fileName("week.csv")).toBe("week.csv");
    // Not UTF-8 as bytes: a real Latin-1 name, or one already decoded (from `filename*=`).
    expect(fileName("café.csv")).toBe("café.csv");
    expect(fileName(named)).toBe(named);
  });

  it("keeps a non-ASCII name through to what the endpoint records", async () => {
    const res = await dee.post(scheduleFile()).attach("file", Buffer.from(WEEKLY), "Programación — été.csv").expect(200);
    expect(res.body.schedule.file).toMatchObject({ name: "Programación — été.csv", kind: "csv" });
    const [change] = (await dee.get(`/v1/admin/listed-sources/${sourceId}/changes`).expect(200)).body;
    expect(change.fields).toContainEqual({ field: "scheduleFile", from: null, to: "Programación — été.csv, 14 shows" });
    expect(await temps()).toEqual([]);
  });
});

describe("an upload that's fine", () => {
  it("is taken as before: a station's library upload, prepared after the request (its own copy, not the temp file)", async () => {
    const res = await kai.post(`/v1/stations/${stationId}/library/uploads`).attach("file", await testClip(2), "Señal de prueba.mp4").expect(201);
    expect(res.body).toMatchObject({ title: "Señal de prueba", status: "preparing" });
    expect(await temps()).toEqual([]);
    await h.services.library.settle();
    expect((await kai.get(`/v1/library/${res.body.id}`).expect(200)).body).toMatchObject({ title: "Señal de prueba", status: "ready" });
  });
});
