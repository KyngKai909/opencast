// vercel.json is written from scripts/http.mjs; this fails when someone changes one without the other.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { vercelConfig } from "../../scripts/vercel-json.mjs";
import { REDIRECTS } from "../../scripts/http.mjs";

const committed = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8"));

describe("vercel.json", () => {
  it("is what scripts/vercel-json.mjs writes (rerun npm run vercel:config if not)", () => {
    const origin = /connect-src 'self' (\S+?)(;|$)/.exec(JSON.stringify(committed))?.[1] ?? "";
    expect(committed).toEqual(vercelConfig(origin));
  });
  it("carries every redirect, permanent", () => {
    expect(committed.redirects).toEqual(Object.entries(REDIRECTS).map(([source, destination]) => ({ source, destination, permanent: true })));
  });
});
