// Mounts contract endpoints on an Express router. Each request is parsed with the
// endpoint's Zod schemas; each response is parsed too, which strips anything the
// contract doesn't declare (a stream key can't leak by accident).

import { promises as fs } from "node:fs";
import path from "node:path";
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import multer from "multer";
import { z } from "zod";
import type { Body, EndpointDef, Params, Query, Response as ContractResponse } from "@opencast/contracts";
import { tokenFrom } from "./auth.js";
import type { Deps, Services } from "./context.js";
import { badRequest, forbidden, fromDatabaseError, HttpError, unauthorized } from "./errors.js";

export interface CurrentUser {
  id: string;
  privyDid: string | null;
  isAdmin: boolean;
  /** Set when a TV session acts as the person (endpoints marked `tvSession`). */
  viaTv?: { tvId: string; sessionId: string };
}

/** A TV app: by its device token, or by its TV session (then `sessionId` is set). */
export interface DeviceCaller {
  tvId: string;
  sessionId: string | null;
}

/** A guest's phone paired with one TV, by its phone token. */
export interface PhoneCaller {
  phoneId: string;
  tvId: string;
}

/** What a token turned out to be. */
export type TvTokenResolution =
  | { kind: "device"; tvId: string }
  | { kind: "tv_session"; tvId: string; sessionId: string; user: CurrentUser }
  | { kind: "phone"; phoneId: string; tvId: string };

/** The TV module's tokens: device (`tvd_`), TV session (`tvs_`) and phone (`tvp_`). Never Privy's. */
export const isTvToken = (token: string) => /^tv[dsp]_/.test(token);

interface Callers {
  user: CurrentUser | null;
  device: DeviceCaller | null;
  phone: PhoneCaller | null;
}

/** An open event stream. */
export interface EventStream {
  /** Sends an event; its data is parsed with the endpoint's schema for it (unknown fields are dropped). */
  send(event: string, data: unknown): void;
  /** Ends the stream from this side. */
  close(): void;
  readonly closed: boolean;
  onClose(listener: () => void): void;
  /** Runs at each heartbeat (every 25 s). */
  onHeartbeat(listener: () => void): void;
}

export interface UploadedFile {
  path: string;
  originalName: string;
  size: number;
  mimeType: string;
}

export interface HandlerContext<E extends EndpointDef> {
  params: Params<E>;
  query: Query<E>;
  body: Body<E>;
  /** Set for `user` and `admin` endpoints; may be set for `optional`. */
  user: E["auth"] extends "user" | "admin" ? CurrentUser : CurrentUser | null;
  /** Set for `device` endpoints; may be set elsewhere when a TV calls. */
  device: E["auth"] extends "device" ? DeviceCaller : DeviceCaller | null;
  /** A paired guest phone, when one calls with its phone token. */
  phone: PhoneCaller | null;
  file: UploadedFile | null;
  req: Request;
}

export type Handler<E extends EndpointDef> = (ctx: HandlerContext<E>) => Promise<ContractResponse<E>> | ContractResponse<E>;

/** An event-stream handler: checks what it needs (throwing is a JSON error), then `open()`s the stream. */
export type StreamHandler<E extends EndpointDef> = (ctx: HandlerContext<E>, open: () => EventStream) => Promise<void> | void;

const SSE_HEARTBEAT_MS = 25_000;

export class RouteRegistrar {
  private upload: multer.Multer;

  constructor(
    readonly router: Router,
    private deps: Deps,
    private services: Services
  ) {
    this.upload = multer({ dest: path.join(deps.config.storageRoot, "uploads", "tmp"), limits: { fileSize: 8 * 1024 ** 3 } });
  }

  handle<E extends EndpointDef>(endpoint: E, handler: Handler<E>) {
    const method = endpoint.method.toLowerCase() as "get" | "post" | "put" | "patch" | "delete";
    const middleware = endpoint.multipart ? [this.upload.single("file")] : [];
    this.router[method](endpoint.path, ...middleware, async (req: Request, res: Response, next: NextFunction) => {
      try {
        const callers = await this.authenticate(endpoint, req);
        const params = parse(endpoint.params, req.params, "params") as Params<E>;
        const query = parse(endpoint.query, req.query, "query") as Query<E>;
        const body = parse(endpoint.body, endpoint.multipart ? req.body ?? {} : req.body, "body") as Body<E>;
        const file = req.file
          ? { path: req.file.path, originalName: req.file.originalname, size: req.file.size, mimeType: req.file.mimetype }
          : null;
        const result = await handler({ params, query, body, user: callers.user as never, device: callers.device as never, phone: callers.phone, file, req });
        const output = endpoint.response.parse(result);
        res.status(endpoint.status ?? 200).json(output);
      } catch (error) {
        next(error);
      } finally {
        if (req.file) {
          await fs.unlink(req.file.path).catch(() => undefined);
        }
      }
    });
  }

  /** An event stream (`endpoint.events`): Server-Sent Events, with a heartbeat comment every 25 s. */
  stream<E extends EndpointDef>(endpoint: E, handler: StreamHandler<E>) {
    const events = endpoint.events;
    if (!events || endpoint.method !== "GET") throw new Error(`${endpoint.path} isn't an event stream`);
    const heartbeatMs = this.deps.config.sseHeartbeatMs ?? SSE_HEARTBEAT_MS;
    this.router.get(endpoint.path, async (req: Request, res: Response, next: NextFunction) => {
      let opened = false;
      try {
        const callers = await this.authenticate(endpoint, req);
        const params = parse(endpoint.params, req.params, "params") as Params<E>;
        const query = parse(endpoint.query, req.query, "query") as Query<E>;
        const open = (): EventStream => {
          if (opened) throw new Error("stream already open");
          opened = true;
          const closeListeners: Array<() => void> = [];
          const beatListeners: Array<() => void> = [];
          let closed = false;
          res.status(200).set({
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-cache, no-transform",
            connection: "keep-alive",
            // Proxies that buffer (nginx and friends) pass it through as it comes.
            "x-accel-buffering": "no"
          });
          res.flushHeaders();
          res.write("retry: 3000\n\n");
          const heartbeat = setInterval(() => {
            if (closed) return;
            res.write(": ping\n\n");
            for (const listener of beatListeners) safely(listener);
          }, heartbeatMs);
          const finish = () => {
            if (closed) return;
            closed = true;
            clearInterval(heartbeat);
            for (const listener of closeListeners) safely(listener);
          };
          req.on("close", finish);
          res.on("close", finish);
          return {
            send(event, data) {
              if (closed) return;
              const schema = events[event];
              if (!schema) throw new Error(`${endpoint.path} has no event ${event}`);
              res.write(`event: ${event}\ndata: ${JSON.stringify(schema.parse(data))}\n\n`);
            },
            close() {
              if (closed) return;
              finish();
              res.end();
            },
            get closed() {
              return closed;
            },
            onClose(listener) {
              if (closed) safely(listener);
              else closeListeners.push(listener);
            },
            onHeartbeat(listener) {
              beatListeners.push(listener);
            }
          };
        };
        await handler({ params, query, body: undefined as Body<E>, user: callers.user as never, device: callers.device as never, phone: callers.phone, file: null, req }, open);
      } catch (error) {
        if (!opened) next(error);
        else {
          console.error(`[v1] stream ${endpoint.path} failed`, error);
          res.end();
        }
      }
    });
  }

  private async authenticate(endpoint: EndpointDef, req: Request): Promise<Callers> {
    const callers: Callers = { user: null, device: null, phone: null };
    const token = tokenFrom({ authorization: req.headers.authorization, cookie: req.headers.cookie });
    if (!token) {
      if (endpoint.auth === "user" || endpoint.auth === "admin" || endpoint.auth === "device") {
        throw unauthorized(endpoint.auth === "device" ? "This is for the TV app." : undefined);
      }
      return callers;
    }
    if (isTvToken(token)) {
      return this.authenticateTv(endpoint, token);
    }
    if (endpoint.auth === "device") {
      throw unauthorized("This is for the TV app.");
    }
    let user: CurrentUser;
    try {
      user = await this.services.accounts.userForToken(token);
    } catch {
      if (endpoint.auth === "public" || endpoint.auth === "optional") {
        return callers;
      }
      throw unauthorized("Your sign-in has expired. Sign in again.");
    }
    if (endpoint.auth === "admin" && !user.isAdmin) {
      throw forbidden();
    }
    return { ...callers, user };
  }

  /**
   * A TV's or a paired phone's token. A TV session is `user` only where the endpoint says
   * `tvSession`; anywhere else that needs a person it's 403 `tv_not_allowed`.
   */
  private async authenticateTv(endpoint: EndpointDef, token: string): Promise<Callers> {
    const callers: Callers = { user: null, device: null, phone: null };
    const found = await this.services.tv.resolveToken(token);
    if (found?.kind === "device") callers.device = { tvId: found.tvId, sessionId: null };
    if (found?.kind === "tv_session") {
      callers.device = { tvId: found.tvId, sessionId: found.sessionId };
      if (endpoint.tvSession && endpoint.auth !== "admin") callers.user = found.user;
    }
    if (found?.kind === "phone") callers.phone = { phoneId: found.phoneId, tvId: found.tvId };

    const signedOut = () =>
      token.startsWith("tvs_")
        ? new HttpError(401, "tv_signed_out", "This TV was signed out. Sign in again on your phone.")
        : unauthorized(token.startsWith("tvd_") ? "This TV isn't registered. Restart the app." : "This phone isn't paired any more.");
    switch (endpoint.auth) {
      case "device":
        if (!callers.device) throw found ? unauthorized("This is for the TV app.") : signedOut();
        break;
      case "user":
      case "admin":
        if (callers.user) break;
        if (found?.kind === "tv_session") throw new HttpError(403, "tv_not_allowed", "A TV can't do that. Use your phone or computer.");
        if (!found) throw signedOut();
        throw unauthorized(found.kind === "device" ? "Sign this TV in first: it shows a code to enter on your phone." : undefined);
      default:
        break;
    }
    return callers;
  }
}

function safely(listener: () => void) {
  try {
    listener();
  } catch (error) {
    console.error("[v1] stream listener failed", error);
  }
}

function parse(schema: z.ZodType | undefined, value: unknown, where: string) {
  if (!schema) {
    return where === "body" ? undefined : {};
  }
  const result = schema.safeParse(value ?? (where === "body" ? undefined : {}));
  if (!result.success) {
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) {
      fields[issue.path.join(".") || where] = issue.message;
    }
    throw badRequest(`Check the ${where === "body" ? "form" : where}: ${result.error.issues[0]?.message ?? "invalid"}.`, fields);
  }
  return result.data;
}

/** The last middleware: errors become `{ error: { code, message } }`. */
export function errorHandler(production: boolean) {
  return (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const known = error instanceof HttpError ? error : fromDatabaseError(error);
    if (known) {
      res.status(known.status).json({ error: { code: known.code, message: known.message, fields: known.fields } });
      return;
    }
    if (error instanceof z.ZodError) {
      // A response that doesn't match its contract is our bug, not the caller's.
      console.error("[v1] response didn't match its contract", error.issues);
      res.status(500).json({ error: { code: "contract_mismatch", message: "Something went wrong on our side." } });
      return;
    }
    console.error("[v1] unhandled error", error);
    res.status(500).json({
      error: { code: "internal", message: production ? "Something went wrong on our side." : String((error as Error)?.message ?? error) }
    });
  };
}

export function jsonRouter(): Router {
  const router = express.Router();
  router.use(express.json({ limit: "2mb" }));
  return router;
}
