import { describe, expect, it } from "vitest";
import { seedEvening, type DbBreak } from "./evening";
import { seedLibrary } from "./library";
import { BACKUP_NOTE, freeMs, placeRotation, type PlaceSpot } from "./spots";
import { at, SEC } from "./time";

const NOW = at("20:42:12");
const spot = (id: string, business: string, sec: number, o: Partial<PlaceSpot> = {}): PlaceSpot => ({ id, business, title: business, lengthMs: sec * SEC, upToPerDay: 6, paused: false, ...o });
const ORANGE = spot("orange", "Orange Street Coffee", 30);
const TIRE = spot("tire", "Inland Tire and Wheel", 30);
const DENTAL = spot("dental", "Cypress Dental", 30);
const HARDWARE = spot("hardware", "Redlands Hardware", 15);
const FARMERS = spot("farmers", "Citrus Valley Farmers Market", 15);

function tonight(): DbBreak[] {
  return seedEvening(seedLibrary().items).breaks;
}
const names = (b: DbBreak) => b.fills.filter((f) => f.kind === "spot").map((f) => f.business);
const open = (bs: DbBreak[]) => bs.filter((b) => b.startsAt > NOW).reduce((a, b) => a + freeMs(b), 0);

describe("placing the rotation (master control C.3)", () => {
  it("starts from C.1: 4:15 open in the three upcoming breaks", () => {
    expect(open(tonight()) / SEC).toBe(255);
  });

  it("fills the breaks as C.3 draws them, leaving 0:30 open", () => {
    const input = tonight();
    const out = placeRotation(input, NOW, [ORANGE, TIRE, DENTAL], [HARDWARE, FARMERS]);
    const [aired, reel, after, live] = out;
    expect(aired).toBe(input[0]);
    expect(names(reel)).toEqual(["Orange Street Coffee", "Inland Tire and Wheel"]);
    expect(names(after)).toEqual(["Cypress Dental", "Orange Street Coffee"]);
    expect(names(live)).toEqual(["Inland Tire and Wheel", "Cypress Dental", "Orange Street Coffee", "Redlands Hardware"]);
    expect(live.fills.find((f) => f.business === "Redlands Hardware")?.note).toBe(BACKUP_NOTE);
    expect(open(out) / SEC).toBe(30);
  });

  it("keeps REEL's barter time and puts spots after the producer's", () => {
    const reel = placeRotation(tonight(), NOW, [ORANGE, TIRE, DENTAL], [])[1];
    expect(reel.fills.slice(0, 2).map((f) => f.kind)).toEqual(["producer", "producer"]);
    expect(reel.fills.slice(2).every((f) => f.kind === "spot")).toBe(true);
  });

  it("leaves open time to the station ID and bumpers when the rotation is empty, even with backups", () => {
    const out = placeRotation(tonight(), NOW, [], [HARDWARE, FARMERS]);
    expect(out.flatMap(names)).toEqual(["Inland Tire and Wheel", "Cypress Dental"]); // the aired break only
  });

  it("hands a paused spot's time to the backup rotation", () => {
    const out = placeRotation(tonight(), NOW, [{ ...ORANGE, paused: true }, TIRE, DENTAL], [HARDWARE, FARMERS]);
    const all = out.slice(1).flatMap((b) => b.fills.filter((f) => f.kind === "spot"));
    expect(all.some((f) => f.spotId === "orange")).toBe(false);
    // Orange Street's :30 at 8:44 becomes two :15 backups.
    expect(names(out[1])).toEqual(["Redlands Hardware", "Citrus Valley Farmers Market", "Inland Tire and Wheel"]);
    expect(out[1].fills.filter((f) => f.note === BACKUP_NOTE)).toHaveLength(2);
  });

  it("is stable: the same rotation gives the same fill ids", () => {
    const a = placeRotation(tonight(), NOW, [ORANGE, TIRE, DENTAL], [HARDWARE]);
    const b = placeRotation(a, NOW, [ORANGE, TIRE, DENTAL], [HARDWARE]);
    expect(b.map((x) => x.fills.map((f) => f.id))).toEqual(a.map((x) => x.fills.map((f) => f.id)));
  });

  it("keeps to the cap on spot time an hour", () => {
    const many = Array.from({ length: 8 }, (_, i) => spot(`s${i}`, `Business ${i}`, 30));
    const out = placeRotation(tonight(), NOW, many, []);
    const eightPm = out.filter((b) => b.startsAt < at("21:00")).flatMap((b) => b.fills.filter((f) => f.kind === "spot"));
    expect(eightPm.reduce((a, f) => a + f.lengthMs, 0)).toBeLessThanOrEqual(180 * SEC);
  });
});
