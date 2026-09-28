// Errors a handler throws. The router turns them into `{ error: { code, message } }`.

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>
  ) {
    super(message);
  }
}

export const badRequest = (message: string, fields?: Record<string, string>) =>
  new HttpError(400, "bad_request", message, fields);
export const unauthorized = (message = "Sign in to do that.") => new HttpError(401, "unauthorized", message);
export const forbidden = (message = "You don't have access to that.") => new HttpError(403, "forbidden", message);
export const notFound = (what = "That") => new HttpError(404, "not_found", `${what} wasn't found.`);
export const conflict = (code: string, message: string) => new HttpError(409, code, message);
/** A rule of the product refused it (e.g. a spot without a day of budget). */
export const refused = (code: string, message: string) => new HttpError(422, code, message);

/** Postgres errors from the schema's guards become 409/422 with the guard's own words. */
export function fromDatabaseError(error: unknown): HttpError | undefined {
  const pgError = error as { code?: string; message?: string; constraint?: string };
  if (!pgError || typeof pgError.code !== "string") {
    return undefined;
  }
  switch (pgError.code) {
    case "23505":
      return conflict("already_exists", uniqueMessage(pgError.constraint) ?? "That's already taken.");
    case "23514":
    case "23P01":
      return refused(pgError.constraint ?? "check_failed", humanise(pgError.message ?? "That isn't allowed."));
    case "23503":
      return refused("missing_reference", "Something it refers to doesn't exist, or isn't ready (rights, agreement).");
    case "23001":
      return refused("restricted", humanise(pgError.message ?? "That can't be changed."));
    default:
      return undefined;
  }
}

function uniqueMessage(constraint: string | undefined): string | undefined {
  switch (constraint) {
    case "stations_call_sign":
      return "That call sign is taken.";
    case "channels_number_in_market":
      return "That channel is taken in this market.";
    case "stations_handle":
      return "That handle is taken.";
    default:
      return undefined;
  }
}

function humanise(message: string): string {
  const trimmed = message.replace(/^new row for relation "[^"]+" violates check constraint "([^"]+)".*$/, "Not allowed: $1.");
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}
