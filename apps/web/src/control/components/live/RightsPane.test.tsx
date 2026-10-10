// The rights pane (A.3) on the mocks, programming Phase 6 (P6.13): with the owner's permission it
// asks where the owner allows it (Opencast always on and not removable; other apps, relays, FAST
// and recording), starting from the API's default (Opencast and relays), and sends what's ticked.
// "I made it" and "It's in the public domain" go everywhere and ask nothing more.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { setupServer } from "msw/node";
import type { LibraryItem } from "@opencast/contracts";

vi.mock("../../../config", () => ({
  config: { mock: true, apiBase: "http://api.test", privyAppId: null, mockClock: "2026-09-27T03:42:12Z" }
}));

import { handlers } from "../../mocks/handlers";
import { getDb, resetDb } from "../../mocks/db";
import { renderWithApi, signInAs, stubMatchMedia } from "../onair/testing";
import { RightsPane } from "./LibraryParts";

const server = setupServer(...handlers);
beforeAll(() => {
  stubMatchMedia();
  server.listen({ onUnhandledRequest: "bypass" });
});
afterAll(() => server.close());
beforeEach(() => {
  resetDb();
  signInAs("kai@example.com");
});
afterEach(() => server.resetHandlers());

const crate = () => getDb().library.items.find((i) => i.title === "Crate Session 03")!;
const open = (item: LibraryItem, onClose = () => {}) => renderWithApi(<RightsPane item={item} callSign="BEAT" phone={false} onClose={onClose} />);
const box = (scope: HTMLElement, name: string) => within(scope).getByRole("checkbox", { name: new RegExp(`^${name}`) }) as HTMLInputElement;

describe("the rights pane's outlets (P6.13)", () => {
  it("asks where the owner allows it only with the owner's permission", async () => {
    open(crate());
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("group", { name: "Where the owner allows it" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("radio", { name: /^I made it/ }));
    expect(within(dialog).queryByRole("group", { name: "Where the owner allows it" })).toBeNull();

    fireEvent.click(within(dialog).getByRole("radio", { name: /^The owner gave permission/ }));
    const group = within(dialog).getByRole("group", { name: "Where the owner allows it" });
    expect(within(dialog).getByText("Where the owner allows it")).toBeTruthy();
    expect(within(dialog).getByText("Opencast is always on. Tick what else the owner agreed to.")).toBeTruthy();
    // The API's default: Opencast and relays. Opencast can't be taken off.
    expect(within(group).getAllByRole("checkbox")).toHaveLength(5);
    expect([box(group, "Opencast").checked, box(group, "Opencast").disabled]).toEqual([true, true]);
    expect(box(group, "Relays").checked).toBe(true);
    for (const name of ["Other apps", "FAST platforms", "Recording"]) expect(box(group, name).checked).toBe(false);
    expect(within(group).getByText("Our own apps, web, TV and Cast. Always on")).toBeTruthy();
  });

  it("sends what's ticked, and opens with it next time", async () => {
    const onClose = vi.fn();
    const view = open(crate(), onClose);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: /^The owner gave permission/ }));
    const group = within(dialog).getByRole("group", { name: "Where the owner allows it" });
    fireEvent.click(box(group, "Relays"));
    fireEvent.click(box(group, "Other apps"));
    fireEvent.click(box(group, "Opencast"));
    expect(box(group, "Opencast").checked).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm rights" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(crate().rights).toMatchObject({ basis: "owner_permission", outlets: ["opencast", "other_apps"] });

    view.unmount();
    open(crate());
    const again = within(await screen.findByRole("dialog")).getByRole("group", { name: "Where the owner allows it" });
    expect(["Opencast", "Other apps", "Relays", "FAST platforms", "Recording"].map((n) => box(again, n).checked)).toEqual([true, true, false, false, false]);
  });

  it("sends no outlets for what Kai made: it goes everywhere", async () => {
    const onClose = vi.fn();
    open(crate(), onClose);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: /^I made it/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm rights" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(crate().rights).toMatchObject({ basis: "made_it", outlets: ["opencast", "other_apps", "relays", "fast", "recording"] });
  });
});
