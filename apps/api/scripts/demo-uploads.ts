// The Phase 4 STOP demo (direct uploads): a 4 GB upload interrupted and resumed, and a duplicate
// stored once, on a throwaway database.
//
//   npm run demo:uploads -w @opencast/api                       local protocol (files on disk)
//   npm run demo:uploads -w @opencast/api -- --s3               and again against an S3-compatible server in Docker
//                                                               (SeaweedFS: real presigned S3 part URLs; --s3-size 1g)
//   npm run demo:uploads -w @opencast/api -- --size 1g          another size (default 4g; smaller when the disk has under 15 GB free)
//
// The API runs on a real port. The uploader is a separate process that does what the browser does
// (Uppy's S3 multipart flow): it starts the upload, sends parts in parallel to their presigned URLs,
// asks for more URLs a batch at a time, and completes. It's killed with SIGKILL part-way through; a
// new one, knowing only the upload's ID (as Golden Retriever keeps it), lists the parts storage
// already has, sends the rest, and completes. Then the same file is uploaded again as another item:
// it's stored once. The file is a real 20-second MP4 (its index first) at the start of a sparse file
// (no disk used for the rest), so the API's probe and checks read it as video; the API still reads
// all of it back from storage for its content ID.

import { spawn, type ChildProcess } from "node:child_process";
import { promises as fs, openSync, readSync, closeSync, statSync } from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const GiB = 1024 ** 3;
const MiB = 1024 ** 2;
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const mb = (bytes: number, seconds: number) => `${((bytes / MiB) / seconds).toFixed(0)} MiB/s (${((bytes * 8) / 1e9 / seconds).toFixed(2)} Gbit/s)`;

// ---- The uploader (a child process): what the browser does ---------------------------------------

async function uploader() {
  const [, , , apiBase, token, file, purposeJson, resumeId] = process.argv;
  const size = statSync(file!).size;
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const api = async <T = unknown>(method: string, route: string, body?: unknown): Promise<T> => {
    const res = await fetch(`${apiBase}/v1${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) throw new Error(`${method} ${route}: ${res.status} ${JSON.stringify(json)}`);
    return json as T;
  };
  let id: string;
  let partSize: number;
  let partCount: number;
  let parallel = 5;
  const urls = new Map<number, string>();
  if (!resumeId) {
    const session = await api<{ id: string; partSize: number; partCount: number; parallel: number; parts: Array<{ partNumber: number; url: string }> }>("POST", "/uploads", { purpose: JSON.parse(purposeJson!), filename: path.basename(file!), size, contentType: "video/mp4" });
    ({ id, partSize, partCount, parallel } = session);
    for (const p of session.parts) urls.set(p.partNumber, p.url);
    console.log(`STARTED ${id} ${partCount} ${partSize}`);
  } else {
    id = resumeId;
    const view = await api<{ partSize: number; partCount: number }>("GET", `/uploads/${id}`);
    ({ partSize, partCount } = view);
  }
  const done = new Map<number, string>();
  if (resumeId) {
    const listed = await api<{ parts: Array<{ partNumber: number; etag: string }> }>("GET", `/uploads/${id}/parts`);
    for (const p of listed.parts) done.set(p.partNumber, p.etag);
    console.log(`RESUMING ${done.size} ${partCount}`);
  }
  const todo = Array.from({ length: partCount }, (_, i) => i + 1).filter((n) => !done.has(n));
  const fd = openSync(file!, "r");
  let sent = 0;
  const started = Date.now();
  const urlFor = async (n: number) => {
    if (!urls.has(n)) {
      const batch = todo.filter((m) => m >= n && !urls.has(m) && !done.has(m)).slice(0, 10);
      const signed = await api<{ parts: Array<{ partNumber: number; url: string }> }>("POST", `/uploads/${id}/parts`, { partNumbers: batch.length ? batch : [n] });
      for (const p of signed.parts) urls.set(p.partNumber, p.url);
    }
    const url = urls.get(n)!;
    urls.delete(n);
    return url.startsWith("/") ? `${apiBase}${url}` : url;
  };
  let next = 0;
  await Promise.all(
    Array.from({ length: parallel }, async () => {
      while (next < todo.length) {
        const n = todo[next++]!;
        const start = (n - 1) * partSize;
        const length = Math.min(partSize, size - start);
        const bytes = Buffer.allocUnsafe(length);
        readSync(fd, bytes, 0, length, start);
        for (let attempt = 1; ; attempt++) {
          const res = await fetch(await urlFor(n), { method: "PUT", body: bytes });
          if (res.ok) {
            done.set(n, res.headers.get("etag")!);
            break;
          }
          if (attempt >= 3) throw new Error(`part ${n}: ${res.status} ${await res.text()}`);
        }
        sent += length;
        console.log(`PART ${n} ${done.size} ${partCount} ${sent}`);
      }
    })
  );
  closeSync(fd);
  const seconds = (Date.now() - started) / 1000;
  console.log(`SENT ${sent} ${seconds}`);
  const completedAt = Date.now();
  await api("POST", `/uploads/${id}/complete`, { parts: [...done].map(([partNumber, etag]) => ({ partNumber, etag })) });
  for (;;) {
    const view = await api<{ state: string }>("GET", `/uploads/${id}`);
    if (view.state !== "checking") {
      console.log(`FINISHED ${(Date.now() - completedAt) / 1000} ${JSON.stringify(view)}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

// ---- The demo -------------------------------------------------------------------------------------

interface Run {
  child: ChildProcess;
  lines: string[];
  exited: Promise<number | null>;
  on(pattern: RegExp, then: (line: string) => void): void;
}

function runUploader(apiBase: string, token: string, file: string, purpose: object, resumeId?: string): Run {
  const child = spawn(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), "uploader", apiBase, token, file, JSON.stringify(purpose), ...(resumeId ? [resumeId] : [])], { stdio: ["ignore", "pipe", "inherit"] });
  const lines: string[] = [];
  const watchers: Array<{ pattern: RegExp; then: (line: string) => void }> = [];
  let buffer = "";
  child.stdout!.on("data", (d: Buffer) => {
    buffer += d.toString();
    for (let i = buffer.indexOf("\n"); i >= 0; i = buffer.indexOf("\n")) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      lines.push(line);
      for (const w of watchers) if (w.pattern.test(line)) w.then(line);
    }
  });
  return { child, lines, exited: new Promise((r) => child.on("exit", (code) => r(code))), on: (pattern, then) => watchers.push({ pattern, then }) };
}

async function demo(label: string, options: { size: number; objects?: (root: string) => import("../src/v1/storage.js").ObjectStore; countObjects: (cid: string) => Promise<number> }) {
  const { createHarness, market, stationFixture } = await import("../test/harness.js");
  const { schema } = await import("@opencast/db");
  const { eq } = await import("drizzle-orm");
  const { contentIdOf } = await import("../src/v1/storage.js");
  const h = await createHarness({ objects: options.objects, realTime: true });
  const server = h.app.listen(0);
  const apiBase = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const file = path.join(os.tmpdir(), `opencast-demo-${process.pid}.mp4`);
  try {
    const kai = await h.signIn("Kai");
    const marketId = (await market(h)).id;
    const beat = await stationFixture(h, { callSign: "BEAT", name: "Inland Beat", ownerId: kai.id, marketId, tenths: 121, signedOn: true });

    // A real clip at the start, the rest sparse.
    const clip = path.join(os.tmpdir(), `opencast-demo-${process.pid}-clip.mp4`);
    await new Promise<void>((resolve, reject) =>
      spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=duration=20:size=1280x720:rate=30", "-f", "lavfi", "-i", "sine=frequency=440:duration=20", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", "-movflags", "+faststart", clip]).on("exit", (c) => (c === 0 ? resolve() : reject(new Error("ffmpeg failed"))))
    );
    await fs.copyFile(clip, file);
    await fs.rm(clip);
    await fs.truncate(file, options.size);
    const { cid } = await contentIdOf(file);
    const onDisk = (await fs.stat(file)).blocks * 512;
    console.log(`\n=== ${label}: a ${(options.size / GiB).toFixed(options.size >= GiB ? 0 : 2)} GiB file (${(onDisk / MiB).toFixed(1)} MiB on disk; the rest is sparse), content ID ${cid}\n`);

    // 1. Started, then killed part-way through.
    const purpose = { kind: "library_item", stationId: beat.id, fields: { title: "The long night", code: "PGM" } };
    const first = runUploader(apiBase, kai.token, file, purpose);
    let uploadId = "";
    let partCount = 0;
    let partSize = 0;
    let killedAt = 0;
    first.on(/^STARTED /, (line) => {
      const [, id, count, psize] = line.split(" ");
      uploadId = id!;
      partCount = Number(count);
      partSize = Number(psize);
      console.log(`Started upload ${uploadId}: ${partCount} parts of ${partSize / MiB} MiB, 5 at a time.`);
    });
    const t0 = Date.now();
    first.on(/^PART /, (line) => {
      const [, , doneCount, , sent] = line.split(" ");
      if (!killedAt && Number(doneCount) >= Math.ceil(partCount * 0.45)) {
        killedAt = Number(sent);
        first.child.kill("SIGKILL");
        console.log(`Killed the uploader (SIGKILL) with ${doneCount} of ${partCount} parts in, ${(Number(sent) / GiB).toFixed(2)} GiB, after ${((Date.now() - t0) / 1000).toFixed(1)} s: ${mb(Number(sent), (Date.now() - t0) / 1000)}.`);
      }
    });
    await first.exited;
    const [row] = await h.db.select().from(schema.uploads).where(eq(schema.uploads.id, uploadId));
    console.log(`The upload is still "${row!.state}"; nothing is stored under its content ID yet: ${(await options.countObjects(cid)) === 0}.`);

    // 2. A new uploader that only knows the upload's ID: resumes.
    const second = runUploader(apiBase, kai.token, file, purpose, uploadId);
    second.on(/^RESUMING /, (line) => {
      const [, have, count] = line.split(" ");
      console.log(`A new uploader asked storage which parts it has (listUploadParts): ${have} of ${count}. It sends only the other ${Number(count) - Number(have)}.`);
    });
    await second.exited;
    const sent2 = second.lines.find((l) => l.startsWith("SENT "))!.split(" ");
    console.log(`Resumed: ${(Number(sent2[1]) / GiB).toFixed(2)} GiB in ${Number(sent2[2]).toFixed(1)} s: ${mb(Number(sent2[1]), Number(sent2[2]))}.`);
    const finished1 = second.lines.find((l) => l.startsWith("FINISHED "))!;
    const [, checkSeconds1] = finished1.split(" ");
    const view1 = JSON.parse(finished1.slice(finished1.indexOf("{")));
    console.log(`Completed. Checking took ${Number(checkSeconds1).toFixed(1)} s (read back from storage for the content ID, probed, loudness measured, moved to its content ID in Infrequent Access): "${view1.state}", content ID matches the file: ${view1.contentId === cid}, duplicate: ${view1.duplicate}, item ${view1.result?.itemId}.`);
    if (view1.state !== "preparing" || view1.contentId !== cid) throw new Error(`the first upload didn't finish: ${finished1}`);

    // 3. The same file again, as another item: stored once.
    const again = runUploader(apiBase, kai.token, file, { ...purpose, fields: { title: "The long night (again)", code: "PGM" } });
    await again.exited;
    const sent3 = again.lines.find((l) => l.startsWith("SENT "))!.split(" ");
    const finished2 = again.lines.find((l) => l.startsWith("FINISHED "))!;
    const view2 = JSON.parse(finished2.slice(finished2.indexOf("{")));
    console.log(`The same file again, uninterrupted: ${(Number(sent3[1]) / GiB).toFixed(2)} GiB in ${Number(sent3[2]).toFixed(1)} s: ${mb(Number(sent3[1]), Number(sent3[2]))}; checking ${Number(finished2.split(" ")[1]).toFixed(1)} s.`);
    console.log(`Second upload: "${view2.state}", same content ID: ${view2.contentId === cid}, duplicate: ${view2.duplicate}.`);
    const contents = await h.db.select().from(schema.contents).where(eq(schema.contents.cid, cid));
    const refs = await h.db.select().from(schema.contentRefs).where(eq(schema.contentRefs.cid, cid));
    const objects = await options.countObjects(cid);
    const prepared = await h.db.select().from(schema.preparedItems).where(eq(schema.preparedItems.key, cid));
    console.log(`Stored once: ${contents.length} contents row (${contents[0]?.storageClass}, ${(Number(contents[0]?.bytes) / GiB).toFixed(2)} GiB), ${objects} object in storage, ${refs.filter((r) => r.owner === "asset_file").length} library items pointing at it. Preparation queued: ${prepared[0]?.status ?? "no"}.`);
    if (!view2.duplicate || contents.length !== 1 || objects !== 1) throw new Error("the duplicate wasn't stored once");
  } finally {
    server.close();
    await h.close();
    await fs.rm(file, { force: true });
    await fs.rm(h.deps.config.storageRoot, { recursive: true, force: true });
  }
}

async function freeBytes(dir: string) {
  const s = await fs.statfs(dir);
  return s.bavail * s.bsize;
}

function sh(command: string, args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args);
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("exit", (code) => resolve({ code: code ?? 1, out }));
    child.on("error", () => resolve({ code: 1, out: "" }));
  });
}

async function main() {
  // Never a real provider (as the tests' setup does).
  for (const key of ["LIVEPEER_API_KEY", "PINATA_JWT", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_PUBLIC_BASE", "PRIVY_APP_SECRET", "STRIPE_SECRET_KEY"]) process.env[key] = "";
  const free = await freeBytes(os.tmpdir());
  const asked = arg("--size");
  const parsed = asked ? /^(\d+(?:\.\d+)?)([gm])$/i.exec(asked) : null;
  if (asked && !parsed) throw new Error("--size is like 4g or 300m");
  let size = parsed ? Math.round(Number(parsed[1]) * (parsed[2]!.toLowerCase() === "g" ? GiB : MiB)) : 4 * GiB;
  if (!asked && free < 15e9) {
    size = GiB;
    console.log(`Only ${(free / 1e9).toFixed(1)} GB free: the demo uses a 1 GiB file instead of 4 GiB.`);
  }
  console.log(`Free space: ${(free / 1e9).toFixed(1)} GB.`);
  const { localObjectStore } = await import("../src/v1/storage.js");
  let localRoot = "";
  await demo("Local protocol (development: parts to the API, files on disk)", {
    size,
    objects: (root) => {
      localRoot = path.join(root, "objects");
      return localObjectStore(localRoot, "/objects");
    },
    countObjects: async (cid) => ((await fs.readdir(localRoot).catch(() => [] as string[])).includes(cid) ? 1 : 0)
  });

  if (process.argv.includes("--s3")) {
    const docker = await sh("docker", ["version", "--format", "{{.Server.Version}}"]);
    if (docker.code !== 0) {
      console.log("\nDocker isn't running: skipped the S3-compatible server.");
      return;
    }
    // SeaweedFS's S3 gateway (MinIO's images aren't published on Docker Hub any more), with one
    // access key, so presigned URLs are checked. Its data is in a folder under home (Docker's VMs
    // share home), deleted afterwards.
    const data = await fs.mkdtemp(path.join(os.homedir(), ".opencast-demo-s3-"));
    const name = `opencast-demo-s3-${process.pid}`;
    const port = 18000 + (process.pid % 500);
    const identities = JSON.stringify({ identities: [{ name: "opencast", credentials: [{ accessKey: "opencast", secretKey: "opencast-demo-secret" }], actions: ["Admin", "Read", "Write", "List", "Tagging"] }] });
    const started = await sh("docker", ["run", "-d", "--rm", "--name", name, "-p", `${port}:8333`, "-v", `${data}:/data`, "--entrypoint", "sh", "chrislusf/seaweedfs", "-c", `echo '${identities}' > /s3.json && exec weed server -s3 -s3.config=/s3.json -dir=/data -volume.max=0 -master.volumeSizeLimitMB=1024`]);
    if (started.code !== 0) {
      console.log(`\nThe S3-compatible server didn't start: ${started.out}`);
      return;
    }
    try {
      const endpoint = `http://127.0.0.1:${port}`;
      const { s3ObjectStore } = await import("../src/v1/storage.js");
      const { S3Client, ListObjectsV2Command, CreateBucketCommand } = await import("@aws-sdk/client-s3");
      const target = { endpoint, accessKeyId: "opencast", secretAccessKey: "opencast-demo-secret", bucket: "opencast-demo", forcePathStyle: true };
      const s3 = new S3Client({ region: "us-east-1", endpoint, forcePathStyle: true, credentials: { accessKeyId: target.accessKeyId, secretAccessKey: target.secretAccessKey } });
      for (let i = 0; ; i++) {
        try {
          await s3.send(new CreateBucketCommand({ Bucket: target.bucket }));
          break;
        } catch (error) {
          if (i > 60) throw error;
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
      const { applyUploadBucketRules } = await import("../src/v1/uploadsBucket.js");
      const rules = await applyUploadBucketRules(target, ["http://localhost:5174", "http://localhost:5181"]);
      console.log(`\nBucket rules on SeaweedFS: CORS ${rules.cors}; lifecycle ${rules.lifecycle}`);
      const s3Size = Number(arg("--s3-size")?.replace(/g$/i, "")) * GiB || size;
      await demo("SeaweedFS's S3 gateway in Docker (presigned S3 part URLs checked by the store, server-side copy in parts)", {
        size: s3Size,
        // Copies above 256 MiB go in parts here, to run the path R2 takes above 5 GiB.
        objects: () => s3ObjectStore({ ...target, storageClasses: false, copyInPartsAbove: 256 * MiB }),
        countObjects: async (cid) => {
          const page = await s3.send(new ListObjectsV2Command({ Bucket: target.bucket }));
          const keys = (page.Contents ?? []).map((o) => o.Key!);
          const staged = keys.filter((k) => k.startsWith("uploads/"));
          if (staged.length) console.log(`(staged objects still in the bucket: ${staged.join(", ")})`);
          return keys.filter((k) => k === cid).length;
        }
      });
    } finally {
      await sh("docker", ["rm", "-f", name]);
      await fs.rm(data, { recursive: true, force: true });
    }
  }
}

if (process.argv[2] === "uploader") await uploader();
else await main();
