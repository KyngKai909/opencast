import { describe, expect, it } from "vitest";
import { StationSetup } from "@opencast/contracts";
import { seed } from "./db";

describe("the mock db's seed", () => {
  it("gives every station a setup the contract accepts", () => {
    for (const st of seed().stations) {
      const r = StationSetup.safeParse({ station: st.ident, ...st.setup });
      expect(r.success, `${st.ident.name}: ${JSON.stringify(r.error?.issues)}`).toBe(true);
    }
  });
});
