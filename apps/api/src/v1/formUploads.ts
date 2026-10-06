// Form uploads (multipart, through multer), tightened 2026-10-06: who may send a file is checked
// before a byte of it is read, each endpoint takes its own size (more is cut off as it streams in,
// 413 `too_big`), and the temp file goes whatever happens: a refusal, an error, a dropped
// connection. Direct uploads (modules/uploads) don't come through here.

import { randomBytes } from "node:crypto";
import { createWriteStream, mkdirSync, promises as fs, type WriteStream } from "node:fs";
import path from "node:path";
import type { Request, RequestHandler, Response } from "express";
import multer from "multer";
import { badRequest, HttpError } from "./errors.js";

/** What one endpoint takes in a form upload. */
export interface FormUploadLimits {
  /** The largest file, in bytes (the endpoint's own limit). A bigger one is cut off: 413 `too_big`. */
  maxBytes: number;
  /** What a file over it is told, in the endpoint's own words ("Use a file of 2 MB or less."). */
  tooBig: string;
  /** Form fields besides the file (default 16). */
  fields?: number;
  /** The longest field, in bytes (default 64 KiB). */
  fieldBytes?: number;
}

const DEFAULT_FIELDS = 16;
const DEFAULT_FIELD_BYTES = 64 * 1024;

/** The connection went before the request was read: nobody to answer. */
export class ConnectionGone extends Error {
  constructor() {
    super("the connection closed during the upload");
  }
}

/** The temp files one request's upload wrote. */
class TempFiles {
  private files = new Map<string, WriteStream>();
  private done = false;

  add(file: string, out: WriteStream) {
    this.files.set(file, out);
    // Opened after `removeAll` ran (the write stream opens asynchronously): removed once it closes.
    out.once("close", () => {
      if (this.done) void unlinkQuietly(file);
    });
  }

  get closed() {
    return this.done;
  }

  /** Stops any write still going and removes every file. Later ones are removed as they close. */
  async removeAll() {
    this.done = true;
    const files = [...this.files];
    this.files.clear();
    await Promise.all(
      files.map(([file, out]) => {
        if (!out.closed) out.destroy();
        return unlinkQuietly(file);
      })
    );
  }
}

const TEMP = Symbol("formUploadTempFiles");
type Tracked = Request & { [TEMP]?: TempFiles };

/**
 * Writes each file to `dir` under a random name, as multer's disk storage does, and remembers it
 * on the request so it can always be removed. When the file passes its limit, the write ends there
 * at once (multer then removes it and answers 413), rather than when the rest of the part arrives.
 */
class TempStorage implements multer.StorageEngine {
  constructor(private dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  _handleFile(req: Request, file: Express.Multer.File, cb: (error?: unknown, info?: Partial<Express.Multer.File>) => void) {
    const temp = (req as Tracked)[TEMP];
    if (!temp || temp.closed) {
      file.stream.resume();
      cb(new ConnectionGone());
      return;
    }
    const filename = randomBytes(16).toString("hex");
    const target = path.join(this.dir, filename);
    const out = createWriteStream(target, { flags: "wx" });
    temp.add(target, out);
    let answered = false;
    const answer = (error: unknown, info?: Partial<Express.Multer.File>) => {
      if (answered) return;
      answered = true;
      cb(error, info);
    };
    out.on("error", (error) => answer(error));
    out.on("finish", () => answer(null, { destination: this.dir, filename, path: target, size: out.bytesWritten }));
    // Past the limit: nothing more is written (multer, told by the same event, removes the file).
    file.stream.once("limit", () => {
      file.stream.unpipe(out);
      out.end();
      file.stream.resume();
    });
    // The request broke off mid-file: multer is told by the stream itself; the half-written file goes.
    file.stream.once("error", () => {
      file.stream.unpipe(out);
      out.destroy();
      void unlinkQuietly(target);
    });
    file.stream.pipe(out);
  }

  _removeFile(_req: Request, file: Express.Multer.File, cb: (error: Error | null) => void) {
    void unlinkQuietly(file.path).then(() => cb(null));
  }
}

async function unlinkQuietly(file: string) {
  await fs.unlink(file).catch(() => undefined);
}

/** Form uploads into `dir` (`<storage root>/uploads/tmp`), one middleware per endpoint. */
export class FormUploads {
  private storage: TempStorage;

  constructor(dir: string) {
    this.storage = new TempStorage(dir);
  }

  /** The `file` field and up to `fields` others, within the endpoint's limits. */
  middleware(limits: FormUploadLimits): { run(req: Request, res: Response): Promise<void>; limits: FormUploadLimits } {
    const fields = limits.fields ?? DEFAULT_FIELDS;
    const handler: RequestHandler = multer({
      storage: this.storage,
      limits: {
        // Busboy calls a file that reaches its limit exactly cut off, so one more byte: a file of
        // exactly `maxBytes` is taken, as the handlers' own checks (`size > max`) take it.
        fileSize: limits.maxBytes + 1,
        files: 1,
        fields,
        fieldSize: limits.fieldBytes ?? DEFAULT_FIELD_BYTES,
        fieldNameSize: 100,
        parts: fields + 1
      }
    }).single("file");
    return {
      limits,
      run: (req, res) => receive(handler, req, res, limits)
    };
  }
}

/** Runs multer. Resolves once the form is read; rejects with the API's error (or `ConnectionGone`). */
function receive(handler: RequestHandler, req: Request, res: Response, limits: FormUploadLimits): Promise<void> {
  const temp = new TempFiles();
  (req as Tracked)[TEMP] = temp;
  return new Promise<void>((resolve, reject) => {
    const gone = () => reject(new ConnectionGone());
    res.once("close", gone);
    handler(req, res, (error?: unknown) => {
      res.off("close", gone);
      if (error) reject(uploadError(error, limits));
      else resolve();
    });
  });
}

/** Removes whatever this request's upload wrote that's still there. Safe to call more than once. */
export async function removeTempFiles(req: Request) {
  await (req as Tracked)[TEMP]?.removeAll();
}

/** Multer's and busboy's errors as the API's: 413 `too_big` for a limit, 400 for a broken form. */
function uploadError(error: unknown, limits: FormUploadLimits): unknown {
  if (error instanceof ConnectionGone || error instanceof HttpError) return error;
  if (error instanceof multer.MulterError) {
    switch (error.code) {
      case "LIMIT_FILE_SIZE":
        return new HttpError(413, "too_big", limits.tooBig);
      case "LIMIT_FIELD_VALUE":
      case "LIMIT_FIELD_COUNT":
      case "LIMIT_FIELD_KEY":
      case "LIMIT_PART_COUNT":
        return new HttpError(413, "too_big", "The form has too many fields, or one that's too long.");
      case "LIMIT_FILE_COUNT":
        return badRequest("Send one file at a time.", { file: "One file" });
      case "LIMIT_UNEXPECTED_FILE":
        return badRequest("Send the file as `file`.", { [error.field ?? "file"]: "Not expected" });
      default:
        return badRequest("The form couldn't be read.");
    }
  }
  // A system error (the disk, say) is ours: a 500. Anything else came from reading the form.
  if (typeof (error as NodeJS.ErrnoException)?.syscall === "string") return error;
  return badRequest("The upload didn't arrive whole. Try again.");
}

/**
 * A file's name as the person named it. Busboy reads a part's `filename` as Latin-1 unless the
 * header says otherwise, so a UTF-8 name ("Programación — été.csv", as browsers send it) arrives
 * as one character per byte. Those bytes are read again as UTF-8 when they are valid UTF-8; an
 * ASCII name, or one that isn't UTF-8 (a real Latin-1 name, or one already decoded from
 * `filename*=`), is kept as it is.
 */
export function fileName(raw: string): string {
  if (!/[^\x00-\x7f]/.test(raw) || /[^\x00-\xff]/.test(raw)) return raw;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(raw, "latin1"));
  } catch {
    return raw;
  }
}

/**
 * The old form uploads' limit (8 GiB) for files the apps now send as direct uploads (library items,
 * replacements, spots, orders' files): the form endpoints still take them, as before.
 */
export const FORM_FILE_MAX_BYTES = 8 * 1024 ** 3;
export const FORM_FILE_TOO_BIG = "Use a file of 8 GB or less.";

/** Logos (a block's, a business's): stored at 512 pixels, so 20 MB is plenty. */
export const LOGO_MAX_BYTES = 20 * 1024 ** 2;
export const LOGO_TOO_BIG = "Use an image of 20 MB or less.";
