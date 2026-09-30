// Settings, Station account, pay-as-you-go (follow-up Phase 2), on the mocks at the reference's
// Saturday, 8:42:12 pm (the month so far, the grace period's days left and August's bill follow the
// mock clock): each standing (ok, grace, paused), usage lines and the month's estimate, caps, what
// pays and the card's stand-in (no publishable key on the mocks), Pay now, operators read-only, and
// the Monitor's banner.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setupServer } from "msw/node";
import { MemoryRouter } from "react-router";
import { ToastProvider } from "@opencast/ui";

vi.mock("../../../config", () => ({
  config: { mock: true, apiBase: "http://api.test", privyAppId: null, mockClock: "2026-09-27T03:42:12Z" }
}));

import { handlers } from "../../mocks/handlers";
import { getDb, resetDb, saveDb } from "../../mocks/db";
import { resetEarnings } from "../../mocks/fixtures/earnings";
import { mockAccount, resetAccounts, saveAccounts, setAccountState } from "../../mocks/fixtures/account";
import { KAI } from "../../mocks/fixtures/people";
import { BEAT, HALL } from "../../mocks/fixtures/stations";
import { MOCK_SIGNED_IN_KEY } from "../../../auth/mockAuth";
import { AuthProvider } from "../../../auth/AuthProvider";
import { can, type Role } from "../../station/abilities";
import { StationProvider } from "../../station/StationContext";
import { stubMatchMedia } from "../onair/testing";
import { AccountBanner } from "./AccountBanner";
import { UsageAccount } from "./UsageAccount";

const server = setupServer(...handlers);
beforeAll(() => {
  stubMatchMedia();
  server.listen({ onUnhandledRequest: "bypass" });
});
afterAll(() => server.close());
beforeEach(() => {
  localStorage.clear();
  resetDb();
  resetEarnings();
  resetAccounts();
});
afterEach(() => server.resetHandlers());

function renderAccount(station: typeof BEAT, role: Role, ui = <UsageAccount />) {
  localStorage.setItem(MOCK_SIGNED_IN_KEY, "kai@example.com");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const base = `/control/${station.callSign!.toLowerCase()}`;
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={[`${base}/settings/account`]}>
          <AuthProvider>
            <StationProvider value={{ station, id: station.id, role, studio: false, base, can: (a) => can(role, a) }}>{ui}</StationProvider>
          </AuthProvider>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

const usageTable = () => screen.findByRole("table", { name: "This month" });
const rowOf = (table: HTMLElement, label: string) => within(table).getAllByRole("row").find((r) => within(r).queryByRole("rowheader")?.querySelector("b")?.textContent?.startsWith(label))!;
const cells = (row: HTMLElement) => within(row).getAllByRole("cell").map((c) => c.textContent);
const capsList = () => screen.getByRole("list", { name: "Caps" });
const capRow = (label: string) => within(capsList()).getAllByRole("listitem").find((li) => li.querySelector("b")?.textContent === label)!;

describe("standing", () => {
  it("ok (BEAT, paid from earnings): no notice, nothing due", async () => {
    renderAccount(BEAT, "owner");
    await usageTable();
    expect(screen.queryByText(/is due for/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Pay now" })).toBeNull();
    const bills = screen.getByRole("heading", { name: "Bills" }).closest("section")!;
    expect(within(bills).getByText("$38.94 from earnings.")).toBeTruthy();
  });

  it("grace: what's due, the date relays and live shows pause, the declined card; the channel stays on air", async () => {
    // HALL is in grace on the mocks, but Kai only operates it (see "operators"): BEAT, put in grace, is the owner's view.
    setAccountState(BEAT.id, "grace");
    renderAccount(BEAT, "owner");
    expect(await screen.findByText("$96.40 is due for August's usage")).toBeTruthy();
    expect(screen.getByText("Relays and live shows keep going until October 4 (7 days), then pause until it's paid. Your channel stays on air. Visa ending 0002: Your card was declined.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pay now" })).toBeTruthy();
    const bills = screen.getByRole("heading", { name: "Bills" }).closest("section")!;
    expect(within(bills).getByText("$96.40 due. Visa ending 0002: Your card was declined.")).toBeTruthy();
    expect(within(bills).getByText("Due")).toBeTruthy();
  });

  it("paused: what's paused, the channel still on air, Pay now to bring them back", async () => {
    setAccountState(BEAT.id, "paused");
    renderAccount(BEAT, "owner");
    expect(await screen.findByText("Relays and live shows are paused")).toBeTruthy();
    expect(
      screen.getByText(
        "$96.40 is still due for August's usage. Your channel is still on air. Paused: Relays of everything you air; Live shows (station ID and bumpers air instead). Visa ending 0002: Your card was declined. Pay it to bring them back."
      )
    ).toBeTruthy();
    const table = await usageTable();
    expect(within(rowOf(table, "Relays, everything you air")).getByText("Paused")).toBeTruthy();
    expect(within(rowOf(table, "Storage")).queryByText("Paused")).toBeNull();
    expect(screen.getByRole("button", { name: "Pay now" })).toBeTruthy();
  });
});

describe("usage so far and the month's estimate", () => {
  it("each type with its units, price and free allowance; so far and estimated; the total", async () => {
    renderAccount(BEAT, "owner");
    const table = await usageTable();
    expect(within(table).getAllByRole("columnheader").map((c) => c.textContent)).toEqual(["Usage", "So far", "Month, estimated"]);
    const storage = rowOf(table, "Storage");
    expect(within(storage).getByText("37.80 GB-months so far, 42 GB kept today. 10 GB free a month, all used. $0.04 a GB-month.")).toBeTruthy();
    expect(cells(storage)).toEqual(["$1.11", "$1.28"]);
    const relays = rowOf(table, "Relays, everything you air");
    expect(within(relays).getByText("156.9 hours so far, about 180 hours by the month's end. $0.20 an hour.")).toBeTruthy();
    expect(cells(relays)).toEqual(["$31.39", "$36.00"]);
    expect(cells(rowOf(table, "Live hours"))).toEqual(["$2.25", "$3.13"]);
    expect(cells(rowOf(table, "Radio live"))).toEqual(["Free", "Free"]);
    expect(within(rowOf(table, "Relays, live shows only")).getByText(/Always free\.$/)).toBeTruthy();
    const total = within(table).getAllByRole("row").at(-1)!;
    expect(total.textContent).toBe("Total$34.75$40.41");
    expect(screen.getByText(/^Free each month: 10 GB of storage and 5 live hours\. Left in September: 0 GB and 0 live hours\./)).toBeTruthy();
  });
});

describe("caps", () => {
  it("set, changed and removed, with what reaching one pauses (never the channel)", async () => {
    renderAccount(BEAT, "owner");
    await usageTable();
    expect(within(capRow("Relays, everything you air")).getByText("$31.39 of $60.00 so far. At the cap: relays pause for the rest of the month; your channel stays on air.")).toBeTruthy();
    expect(within(capRow("Storage")).getByText("No cap. At a cap: new uploads and imports pause for the rest of the month; your channel stays on air.")).toBeTruthy();
    // Free types have no cap.
    expect(within(capsList()).queryByText("Relays, live shows only")).toBeNull();

    // Set one on live hours.
    fireEvent.click(screen.getByRole("button", { name: "Set a cap: Live hours" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Monthly cap for Live hours" }), { target: { value: "1" } });
    fireEvent.click(within(capRow("Live hours")).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Live hours is capped at $1.00 a month.")).toBeTruthy();
    // $2.25 so far is past it: reached, and paused.
    await waitFor(() => expect(within(capRow("Live hours")).getByText(/^Reached \$1\.00\. Live shows pause for the rest of the month \(station ID and bumpers air instead\); your channel stays on air\./)).toBeTruthy());
    expect(within(rowOf(screen.getByRole("table", { name: "This month" }), "Live hours")).getByText("Cap reached")).toBeTruthy();

    // A bad amount says so.
    fireEvent.click(screen.getByRole("button", { name: "Change: Relays, everything you air" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Monthly cap for Relays, everything you air" }), { target: { value: "sixty" } });
    fireEvent.click(within(capRow("Relays, everything you air")).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Enter a dollar amount, like 25.00.")).toBeTruthy();
    fireEvent.click(within(capRow("Relays, everything you air")).getByRole("button", { name: "Cancel" }));

    // Removed.
    fireEvent.click(screen.getByRole("button", { name: "Remove cap: Relays, everything you air" }));
    expect(await screen.findByText("Relays, everything you air has no cap.")).toBeTruthy();
    await waitFor(() => expect(within(capRow("Relays, everything you air")).getByText("No cap")).toBeTruthy());
    expect(mockAccount(BEAT.id).caps).toEqual({ live_hours: 1_000_000 });
  });
});

describe("what pays", () => {
  it("earnings first; the card by default; Clear only with full access, chosen instead", async () => {
    renderAccount(BEAT, "owner");
    await usageTable();
    const choices = screen.getByRole("radiogroup", { name: "What pays what earnings don't cover" });
    const clear = within(choices).getByRole("radio", { name: /Your Clear wallet/ });
    const card = within(choices).getByRole("radio", { name: /Visa ending 4242/ });
    expect(card.getAttribute("aria-checked")).toBe("true");
    expect(clear.getAttribute("aria-disabled") === "true" || (clear as HTMLButtonElement).disabled).toBe(true);
    expect(within(choices).getByText("Connect Clear first.")).toBeTruthy();
    expect(screen.getByText("You haven't chosen, so the card pays: a Clear wallet with full access first, otherwise the card.")).toBeTruthy();
    expect(screen.getByText("BEAT's earnings")).toBeTruthy();
  });

  it("with Clear linked with full access, the owner chooses it", async () => {
    getDb().clearLinks[KAI.id] = { address: "0x1111111111111111111111111111111111111111", access: "full", linkedAt: "2026-09-20T00:00:00.000Z" };
    saveDb();
    mockAccount(BEAT.id).chosen = "card";
    saveAccounts();
    renderAccount(BEAT, "owner");
    await usageTable();
    const choices = screen.getByRole("radiogroup", { name: "What pays what earnings don't cover" });
    expect(within(choices).getByText("0x1111…1111. You approve each payment in Clear")).toBeTruthy();
    fireEvent.click(within(choices).getByRole("radio", { name: /Your Clear wallet/ }));
    expect(await screen.findByText("Clear pays what earnings don't cover.")).toBeTruthy();
    await waitFor(() => expect(within(choices).getByRole("radio", { name: /Your Clear wallet/ }).getAttribute("aria-checked")).toBe("true"));
    expect(mockAccount(BEAT.id).chosen).toBe("clear");
  });

  it("the card's stand-in with no publishable key: removed, then added back with the test card", async () => {
    renderAccount(BEAT, "owner");
    await usageTable();
    fireEvent.click(screen.getByRole("button", { name: "Remove Visa ending 4242" }));
    expect(await screen.findByText("Visa ending 4242 is removed.")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("No card")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Add a card" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a card" });
    expect(await within(dialog).findByText("Stripe's card form goes here")).toBeTruthy();
    expect(within(dialog).getByText("This server has no Stripe publishable key, so no card number is asked for. Saving adds the test card, Visa ending 4242.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Save test card" }));
    expect(await screen.findByText("Visa ending 4242 is saved.")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("Expires August 2029. Saved with Stripe")).toBeTruthy();
  });
});

describe("Pay now", () => {
  it("a declined card says so; a new card pays at once and it's back to ok", async () => {
    setAccountState(BEAT.id, "grace");
    renderAccount(BEAT, "owner");
    fireEvent.click(await screen.findByRole("button", { name: "Pay now" }));
    expect(await screen.findByText("Your card was declined. Replace the card to pay it.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    const dialog = await screen.findByRole("dialog", { name: "Replace the card" });
    fireEvent.click(await within(dialog).findByRole("button", { name: "Save test card" }));
    expect(await screen.findByText("Visa ending 4242 is saved, and $96.40 is paid. Nothing is due.")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("$96.40 is due for August's usage")).toBeNull());
  });

  it("paused, with a card that works: paid, relays and live shows are back", async () => {
    setAccountState(BEAT.id, "paused");
    mockAccount(BEAT.id).card!.declines = false;
    saveAccounts();
    renderAccount(BEAT, "owner");
    fireEvent.click(await screen.findByRole("button", { name: "Pay now" }));
    expect(await screen.findByText("$96.40 is paid. Relays and live shows are back.")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("Relays and live shows are paused")).toBeNull());
    expect(within(await usageTable()).queryByText("Paused")).toBeNull();
  });

  it("from Clear with full access: the owner approves the transfer in Clear, then it's paid", async () => {
    setAccountState(BEAT.id, "grace");
    getDb().clearLinks[KAI.id] = { address: "0x1111111111111111111111111111111111111111", access: "full", linkedAt: "2026-09-20T00:00:00.000Z" };
    saveDb();
    renderAccount(BEAT, "owner");
    fireEvent.click(await screen.findByRole("button", { name: "Pay from Clear" }));
    expect(await screen.findByText("$96.40 is paid. Nothing is due.")).toBeTruthy();
    expect(mockAccount(BEAT.id).lastMonth).toMatchObject({ dueMicros: 0, fromClearMicros: 96_400_000 });
  });
});

describe("operators", () => {
  it("see it all, read-only: no Pay now, no cap or card buttons, no choice", async () => {
    // Kai operates HALL, in its grace period.
    renderAccount(HALL, "operator");
    expect(await screen.findByText("$96.40 is due for August's usage")).toBeTruthy();
    expect(screen.getByText(/Your channel stays on air\. Visa ending 0002: Your card was declined\. An owner can pay it here\.$/)).toBeTruthy();
    expect(screen.getByText("Only owners change caps and what pays, or pay what's due.")).toBeTruthy();
    await usageTable();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.getByText("Then, what earnings don't cover")).toBeTruthy();
    // The card, as what pays and as the card on file.
    expect(screen.getAllByText("Visa ending 0002")).toHaveLength(2);
  });
});

describe("the banner (the Monitor and Earnings)", () => {
  it("nothing while ok; in grace, the date relays and live shows pause; paused, that the channel is still on air; linking to Station account", async () => {
    const { unmount } = renderAccount(BEAT, "owner", <AccountBanner />);
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByRole("link", { name: "Station account" })).toBeNull();
    unmount();

    renderAccount(HALL, "operator", <AccountBanner />);
    expect(await screen.findByText("Relays and live shows pause on October 4")).toBeTruthy();
    expect(screen.getByText("$96.40 is due for August's usage. Your channel stays on air.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Station account" }).getAttribute("href")).toBe("/control/hall/settings/account");
  });

  it("paused", async () => {
    setAccountState(HALL.id, "paused");
    renderAccount(HALL, "operator", <AccountBanner />);
    expect(await screen.findByText("Relays and live shows are paused")).toBeTruthy();
    expect(screen.getByText("$96.40 is still due for August's usage. Your channel is still on air.")).toBeTruthy();
  });
});
