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
  file: UploadedFile | null;
  req: Request;
}

export type Handler<E extends EndpointDef> = (ctx: HandlerContext<E>) => Promise<ContractResponse<E>> | ContractResponse<E>;

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
        const user = await this.authenticate(endpoint, req);
        const params = parse(endpoint.params, req.params, "params") as Params<E>;
        const query = parse(endpoint.query, req.query, "query") as Query<E>;
        const body = parse(endpoint.body, endpoint.multipart ? req.body ?? {} : req.body, "body") as Body<E>;
        const file = req.file
          ? { path: req.file.path, originalName: req.file.originalname, size: req.file.size, mimeType: req.file.mimetype }
          : null;
        const result = await handler({ params, query, body, user: user as never, file, req });
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

  private async authenticate(endpoint: EndpointDef, req: Request): Promise<CurrentUser | null> {
    const token = tokenFrom({ authorization: req.headers.authorization, cookie: req.headers.cookie });
    if (!token) {
      if (endpoint.auth === "user" || endpoint.auth === "admin") {
        throw unauthorized();
      }
      return null;
    }
    let user: CurrentUser;
    try {
      user = await this.services.accounts.userForToken(token);
    } catch {
      if (endpoint.auth === "public" || endpoint.auth === "optional") {
        return null;
      }
      throw unauthorized("Your sign-in has expired. Sign in again.");
    }
    if (endpoint.auth === "admin" && !user.isAdmin) {
      throw forbidden();
    }
    return user;
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
