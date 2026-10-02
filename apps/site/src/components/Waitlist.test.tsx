import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { useState } from "react";
import { handlers } from "../mocks/handlers";
import type { Role } from "../lib/waitlist";
import { Waitlist } from "./Waitlist";

vi.mock("../config", () => ({ config: { mock: false, apiBase: "http://api.test" } }));

const server = setupServer(...handlers);
const sent: unknown[] = [];
server.events.on("request:start", async ({ request }) => {
  if (request.method === "POST") sent.push(await request.clone().json());
});
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  sent.length = 0;
});
afterAll(() => server.close());

function Harness({ start = "viewer" as Role }) {
  const [role, setRole] = useState<Role>(start);
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Waitlist role={role} onRoleChange={setRole} />
    </QueryClientProvider>
  );
}

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const submit = () => fireEvent.click(screen.getByRole("button", { name: "Join the waitlist" }));

describe("Waitlist", () => {
  it("offers four roles, viewer first, and the call sign only for a station", () => {
    render(<Harness />);
    const group = screen.getByRole("radiogroup", { name: "I'm joining as" });
    expect([...group.querySelectorAll("[role=radio]")].map((r) => r.textContent)).toEqual(["A viewer", "A station", "A producer", "A business"]);
    expect(screen.getByRole("radio", { name: "A viewer" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByLabelText("Call sign you'd like")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "A station" }));
    expect(screen.getByLabelText("Call sign you'd like")).toBeTruthy();
    expect(screen.getByText("Three to five letters. We'll hold it until your market opens.")).toBeTruthy();
  });

  it("checks the fields before sending anything", () => {
    render(<Harness />);
    submit();
    expect(screen.getByText("Enter an email address")).toBeTruthy();
    expect(screen.getByText("Enter your ZIP code.")).toBeTruthy();
    type("ZIP code", "92-3");
    expect((screen.getByLabelText("ZIP code") as HTMLInputElement).value).toBe("923");
    submit();
    expect(screen.getByText("A ZIP code is five digits.")).toBeTruthy();
    expect(sent).toEqual([]);
  });

  it("joins as a viewer and says the market's dial", async () => {
    render(<Harness />);
    type("Email", "kai@example.com");
    type("ZIP code", "92373");
    submit();
    expect(await screen.findByRole("heading", { name: "You’re on the list." })).toBeTruthy();
    expect(screen.getByText("We’ll write when the Inland Empire dial opens.")).toBeTruthy();
    expect(sent).toEqual([{ role: "viewer", email: "kai@example.com", zip: "92373" }]);
  });

  it("says a ZIP outside every market", async () => {
    render(<Harness />);
    type("Email", "kai@example.com");
    type("ZIP code", "10001");
    submit();
    expect(await screen.findByText("Your ZIP isn’t in a market yet. We’ll write when a dial opens near you.")).toBeTruthy();
  });

  it("cleans the call sign, checks it live, and holds it", async () => {
    render(<Harness start="station" />);
    type("Call sign you'd like", "zx-yq9");
    expect((screen.getByLabelText("Call sign you'd like") as HTMLInputElement).value).toBe("ZXYQ");
    expect(await screen.findByText("ZXYQ is free.")).toBeTruthy();
    type("Email", "kai@example.com");
    type("ZIP code", "92373");
    submit();
    expect(await screen.findByRole("heading", { name: "ZXYQ is on hold for you." })).toBeTruthy();
    expect(screen.getByText("We’ll write when your market opens, and your call sign is held until then.")).toBeTruthy();
    expect(sent).toEqual([{ role: "station", email: "kai@example.com", zip: "92373", callSign: "ZXYQ" }]);
  });

  // 2026-09-29: names Opencast won't allow (call_signs.refused) say why, with names to try.
  it("says why a call sign isn't allowed, with names to try, and won't send it", async () => {
    render(<Harness start="station" />);
    type("Call sign you'd like", "kxyz");
    expect(await screen.findByText("Four letters starting with K or W look like a real broadcast call sign. Try XYZ or XYZS.")).toBeTruthy();
    type("Email", "kai@example.com");
    type("ZIP code", "92373");
    submit();
    expect(screen.getByText("Four letters starting with K or W look like a real broadcast call sign. Try XYZ or XYZS.")).toBeTruthy();
    expect(sent).toEqual([]);
  });

  it("says a taken call sign under the field, and won't send it", async () => {
    render(<Harness start="station" />);
    type("Call sign you'd like", "beat");
    expect(await screen.findByText("BEAT is taken. Try another.")).toBeTruthy();
    type("Email", "kai@example.com");
    type("ZIP code", "92373");
    submit();
    expect(sent).toEqual([]);
  });

  it("puts the API's 409 on the call sign", async () => {
    // The check said free, but someone held it before the form was sent.
    server.use(http.get("*/v1/call-signs/:callSign", ({ params }) => HttpResponse.json({ callSign: String(params.callSign), valid: true, available: true, reservable: true, heldForYou: false, refusal: null, suggestions: [] })));
    render(<Harness start="station" />);
    type("Call sign you'd like", "REEL");
    await screen.findByText("REEL is free.");
    type("Email", "kai@example.com");
    type("ZIP code", "92373");
    submit();
    expect(await screen.findByText("REEL is taken. Try another.")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText("Call sign you'd like"));
  });

  it("drops the call sign when the role changes", async () => {
    render(<Harness start="station" />);
    type("Call sign you'd like", "KXYZ");
    fireEvent.click(screen.getByRole("radio", { name: "A producer" }));
    type("Email", "kai@example.com");
    type("ZIP code", "92373");
    submit();
    expect(await screen.findByRole("heading", { name: "Your programs are on the list." })).toBeTruthy();
    expect(screen.getByText("We’ll write when the syndication market opens to makers.")).toBeTruthy();
    expect(sent).toEqual([{ role: "producer", email: "kai@example.com", zip: "92373" }]);
  });

  it("joins a business", async () => {
    render(<Harness start="business" />);
    type("Email", "shop@example.com");
    type("ZIP code", "92373");
    submit();
    expect(await screen.findByRole("heading", { name: "Your business is on the list." })).toBeTruthy();
    expect(screen.getByText("We’ll write when the first spot market opens near you.")).toBeTruthy();
  });

  it("puts the API's field errors on the fields", async () => {
    server.use(http.post("*/v1/waitlist", () => HttpResponse.json({ error: { code: "bad_request", message: "Check the form: Invalid email address.", fields: { email: "Invalid email address" } } }, { status: 400 })));
    render(<Harness />);
    type("Email", "kai@example.com");
    type("ZIP code", "92373");
    submit();
    expect(await screen.findByText("Invalid email address")).toBeTruthy();
  });

  it("says when it can't reach Opencast", async () => {
    server.use(http.post("*/v1/waitlist", () => HttpResponse.error()));
    render(<Harness />);
    type("Email", "kai@example.com");
    type("ZIP code", "92373");
    submit();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("We couldn’t reach Opencast. Check your connection and try again.");
    await waitFor(() => expect(screen.getByRole("button", { name: "Join the waitlist" }).hasAttribute("disabled")).toBe(false));
  });
});
