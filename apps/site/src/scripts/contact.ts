// The Contact page (SITE-SPEC §7): the switchboard (pick a desk, a cable runs to the lamp), the
// form that follows the desk, and sending it: POST /contact (proposed, D3; the mock answers it
// until it lands), falling back to a mailto: to the desk when the API can't take it.
import { contactApi } from "../api/contact";
import { DESKS, deskById, HOURS_CLOSED, HOURS_OPEN, isOpen, type Desk } from "../data/contact";
import { ApiError, call, NetworkError } from "../lib/api";
import { reducedMotion } from "../lib/motion";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const jackX = (i: number) => 40 + i * 80;
// The lamp group is drawn at x+408 and shifted 150 left in the markup.
const SOCKET = { x: 258, y: 200 };

let desk: Desk | null = null;
let sending = false;

/** The desk's response time and whether it's open now, in the switchboard's header strip. */
function hours(): void {
  const el = $("sbHours"), open = isOpen();
  el.classList.toggle("open", open);
  el.innerHTML = open ? `<i></i>${HOURS_OPEN}` : HOURS_CLOSED;
}

function cable(i: number, animate: boolean): void {
  const path = $("ctCable") as unknown as SVGPathElement, x = jackX(i), y = 262;
  path.setAttribute("d", `M${x} ${y} C${x} ${y + 46} ${SOCKET.x + (x - SOCKET.x) * 0.15} ${SOCKET.y + 92} ${SOCKET.x} ${SOCKET.y}`);
  const plug = $("ctPlug") as unknown as SVGCircleElement;
  plug.setAttribute("cx", String(x));
  plug.setAttribute("cy", String(y));
  const len = path.getTotalLength();
  path.style.strokeDasharray = String(len);
  path.classList.remove("draw");
  if (animate && !reducedMotion()) {
    path.style.strokeDashoffset = String(len);
    void path.getBoundingClientRect();
    path.classList.add("draw");
  } else path.style.strokeDashoffset = "0";
}

/** Patch a desk through: the cable, the lamp, the strip, the form's fields. */
function choose(d: Desk, animate = true, focus = false): void {
  desk = d;
  const i = DESKS.indexOf(d);
  const root = document.querySelector<HTMLElement>(".ct")!;
  root.style.setProperty("--desk", d.c);
  document.documentElement.style.setProperty("--st", d.c);
  root.classList.remove("patched");
  void root.offsetWidth;
  root.classList.add("patched");
  cable(i, animate);
  document.querySelectorAll<SVGGElement>(".ct-jack").forEach((g, k) => g.classList.toggle("on", k === i));
  document.querySelectorAll<HTMLButtonElement>("#sbJacks button").forEach((b, k) => {
    b.setAttribute("aria-checked", String(k === i));
    b.tabIndex = k === i ? 0 : -1;
    if (k === i && focus) b.focus();
  });
  $("sbDesk").textContent = `${d.name} · ${d.answers}`;
  $("sbNote").textContent = `Patched to ${d.email}`;
  $("fcTo").textContent = `To the ${d.name}`;
  $("ctPick").hidden = true;
  document.querySelectorAll<HTMLFieldSetElement>(".ct-desk").forEach((f) => (f.hidden = f.dataset.desk !== d.id));
  $("ctErr").textContent = "";
}

function switchboard(): void {
  const group = $("sbJacks");
  const jacks = [...group.querySelectorAll<HTMLButtonElement>("button")];
  group.addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>("button");
    const d = b && deskById(b.dataset.desk);
    if (d && d !== desk) choose(d);
  });
  group.addEventListener("keydown", (e) => {
    const i = jacks.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const to = e.key === "ArrowRight" || e.key === "ArrowDown" ? (i + 1) % jacks.length : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (i - 1 + jacks.length) % jacks.length : e.key === "Home" ? 0 : e.key === "End" ? jacks.length - 1 : -1;
    if (to >= 0) {
      e.preventDefault();
      choose(DESKS[to]!, true, true);
    }
  });
}

/** The radio choices inside the form (Rights: holder or reporter). */
function radios(): void {
  document.querySelectorAll<HTMLElement>(".ct-seg").forEach((g) => {
    const opts = [...g.querySelectorAll<HTMLButtonElement>("button")];
    const pick = (b: HTMLButtonElement, focus = false) => {
      opts.forEach((o) => {
        const on = o === b;
        o.classList.toggle("on", on);
        o.setAttribute("aria-checked", String(on));
        o.tabIndex = on ? 0 : -1;
      });
      if (focus) b.focus();
    };
    g.addEventListener("click", (e) => {
      const b = (e.target as Element).closest<HTMLButtonElement>("button");
      if (b) pick(b);
    });
    g.addEventListener("keydown", (e) => {
      const i = opts.indexOf(document.activeElement as HTMLButtonElement);
      if (i < 0 || !["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(e.key)) return;
      e.preventDefault();
      pick(opts[(i + (e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : opts.length - 1)) % opts.length]!, true);
    });
  });
}

function fieldError(id: string, msg: string): void {
  $(id).setAttribute("aria-invalid", msg ? "true" : "false");
  $(`${id}E`).textContent = msg;
}

/** The desk's own fields, as typed. */
function deskFields(d: Desk): Record<string, string> {
  const out: Record<string, string> = {};
  const set = document.querySelector<HTMLElement>(`.ct-desk[data-desk="${d.id}"]`)!;
  set.querySelectorAll<HTMLInputElement>("input[data-field]").forEach((i) => i.value.trim() && (out[i.dataset.field!] = i.value.trim()));
  set.querySelectorAll<HTMLElement>(".ct-seg[data-field]").forEach((g) => (out[g.dataset.field!] = g.querySelector<HTMLButtonElement>("[aria-checked=true]")?.dataset.v ?? ""));
  return out;
}

function sent(email: string, viaMail: boolean, d: Desk): void {
  $("ctForm").hidden = true;
  $("ctSentH").textContent = viaMail ? "Over to your email." : "Patched through.";
  $("ctSentP").textContent = viaMail ? `We couldn't send it from here, so your email app has it, addressed to ${d.email}. Send it from there and a person writes back.` : `We'll write back to ${email}.`;
  $("ctSent").hidden = false;
  $("ctSent").focus();
}

function mailto(d: Desk, name: string, message: string, fields: Record<string, string>): string {
  const extra = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("\n");
  const body = `${message}\n\n${extra ? `${extra}\n` : ""}${name}`;
  return `mailto:${d.email}?subject=${encodeURIComponent(`For the ${d.name}`)}&body=${encodeURIComponent(body)}`;
}

async function submit(e: Event): Promise<void> {
  e.preventDefault();
  if (sending) return;
  const name = $<HTMLInputElement>("ctName").value.trim();
  const email = $<HTMLInputElement>("ctEmail").value.trim();
  const message = $<HTMLTextAreaElement>("ctMsg").value.trim();
  fieldError("ctName", name ? "" : "Tell us your name.");
  fieldError("ctEmail", EMAIL.test(email) ? "" : "Enter an email address");
  fieldError("ctMsg", message ? "" : "Write a message.");
  if (!desk) {
    $("ctErr").textContent = "Pick a desk on the switchboard.";
    $("sbJacks").querySelector<HTMLButtonElement>("button")?.focus();
    return;
  }
  const bad = [["ctName", name], ["ctEmail", EMAIL.test(email) ? email : ""], ["ctMsg", message]].find(([, v]) => !v);
  if (bad) return $(bad[0]!).focus();
  const d = desk, fields = deskFields(d);
  const go = $<HTMLButtonElement>("ctGo");
  sending = true;
  go.disabled = true;
  go.setAttribute("aria-busy", "true");
  $("ctErr").textContent = "";
  try {
    await call(contactApi.send, { body: { desk: d.id, name, email, message, fields } });
    sent(email, false, d);
  } catch (err) {
    if (err instanceof ApiError && err.status === 400) {
      $("ctErr").textContent = err.message;
    } else if (err instanceof NetworkError || err instanceof ApiError) {
      // The API can't take it yet (D3) or can't be reached: hand it to the visitor's email app.
      location.href = mailto(d, name, message, fields);
      sent(email, true, d);
    } else $("ctErr").textContent = "Something went wrong. Try again.";
  } finally {
    sending = false;
    go.disabled = false;
    go.removeAttribute("aria-busy");
  }
}

function again(): void {
  ($("ctForm") as HTMLFormElement).reset();
  $("ctSent").hidden = true;
  $("ctForm").hidden = false;
  $("ctMsg").focus();
}

export function initContact(): void {
  hours();
  setInterval(hours, 60000);
  switchboard();
  radios();
  for (const id of ["ctName", "ctEmail", "ctMsg"]) $(id).addEventListener("input", () => fieldError(id, ""));
  $("ctForm").addEventListener("submit", submit);
  $("ctAgain").addEventListener("click", again);
  // Arriving from a link: ?desk=, and from Claim a number, ?number= and ?callsign=.
  const q = new URLSearchParams(location.search);
  const d = deskById(q.get("desk"));
  if (d) choose(d, false);
  const number = q.get("number"), cs = q.get("callsign");
  if (number) $<HTMLInputElement>("ct-stations-number").value = number;
  if (cs) $<HTMLInputElement>("ct-stations-callSign").value = cs.toUpperCase();
  if (!d && (number || cs)) choose(deskById("stations")!, false);
  addEventListener("resize", () => desk && cable(DESKS.indexOf(desk), false));
}
