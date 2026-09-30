// A229 in the viewer's mock world: Riverside County's three streams sharing RIVC on 15, and Inland
// Beat's second station sharing BEAT on 12.2. On the dial in channel order, each with its own
// address; the station page, search and the guide find each one, told apart by channel and name.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../config", async (importOriginal) => {
  const { config } = await importOriginal<typeof import("../../../config")>();
  return { config: { ...config, mock: true, mockClock: "2026-09-27T03:42:12Z" } };
});
import { setupServer } from "msw/node";
import { stationsApi } from "@opencast/contracts";
import { handlers } from "../../../mocks/handlers";
import { gridRows } from "../../components/guide/logic";
import { GuideX } from "../../api/ext";
import { watchPath, stationPath } from "../../components/station/actions";
import { externalDown, externalUp } from "../external";

const server = setupServer(...handlers);
const BASE = "http://api.test/v1";
beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterAll(() => server.close());
beforeEach(() => localStorage.clear());

const get = async (path: string) => {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, json: await res.json() };
};

describe("families on the viewer's mock dial", () => {
  it("puts them in channel order, each with its own address", async () => {
    const dial = stationsApi.getDial.response.parse((await get("/markets/inland-empire/dial?band=tv")).json);
    const rows = dial.rows.filter((r) => r.station.callSign === "RIVC" || r.station.callSign === "BEAT");
    expect(rows.map((r) => [r.station.channel, r.station.callSign, r.station.slug, r.station.sharesCallSign, r.station.name])).toEqual([
      ["12.1", "BEAT", "beat", true, "Inland Beat"],
      ["12.2", "BEAT", "beat-12-2", true, "Beat Tapes"],
      ["15.1", "RIVC", "rivc", true, "Riverside County, Board of Supervisors"],
      ["15.2", "RIVC", "rivc-15-2", true, "Riverside County, Public Works"],
      ["15.3", "RIVC", "rivc-15-3", true, "Riverside County Library Live"]
    ]);
    expect(rows.map((r) => watchPath(r.station))).toEqual(["/watch/beat", "/watch/beat-12-2", "/watch/rivc", "/watch/rivc-15-2", "/watch/rivc-15-3"]);
    expect(stationPath(rows[3]!.station)).toBe("/rivc-15-2");
  });

  it("finds each station page by its address, and the call sign alone is X.1's", async () => {
    expect((await get("/stations/rivc-15-2")).json.station).toMatchObject({ name: "Riverside County, Public Works", channel: "15.2" });
    expect((await get("/stations/RIVC")).json.station).toMatchObject({ channel: "15.1" });
    expect((await get("/stations/beat-12-2")).json.station).toMatchObject({ name: "Beat Tapes" });
    expect((await get("/stations/beat")).json.station).toMatchObject({ name: "Inland Beat" });
    // Beat Tapes' page has its own programs, not Inland Beat's.
    expect((await get("/stations/beat-12-2")).json.programs.map((p: { title: string }) => p.title)).toEqual(["Beat Tapes"]);
  });

  it("names each in the guide, and a stream down leaves only it off the dial", async () => {
    const from = "2026-09-27T03:30:00.000Z";
    const to = "2026-09-27T05:30:00.000Z";
    const guide = GuideX.parse((await get(`/markets/inland-empire/guide?band=tv&from=${from}&to=${to}`)).json);
    const rows = gridRows(guide).filter((r) => r.callSign === "RIVC");
    expect(rows.map((r) => [r.channel, r.name])).toEqual([
      ["15.1", "Riverside County, Board of Supervisors"],
      ["15.2", "Riverside County, Public Works"],
      ["15.3", "Riverside County Library Live"]
    ]);
    expect(gridRows(guide).find((r) => r.callSign === "CIVC")?.name).toBeUndefined();
    externalDown("rivc-15-2", 6);
    const dial = stationsApi.getDial.response.parse((await get("/markets/inland-empire/dial?band=tv")).json);
    expect(dial.rows.filter((r) => r.station.callSign === "RIVC").map((r) => r.station.channel)).toEqual(["15.1", "15.3"]);
    externalUp("rivc-15-2");
  });
});
