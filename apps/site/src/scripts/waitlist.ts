// The waitlist sheet's behaviour (src/components/WaitlistSheet.astro): opens with what the link
// asked for (role, number, call sign, what it's for), checks the call sign as it's typed with the
// shared rules and then the API, and posts to `waitlist.join`. Keeps focus inside, closes on
// Escape, and gives focus back to the link that opened it.
import { waitlistApi } from "@contracts/waitlist";
import type { WaitlistIntent } from "../data/links";
import { IE_NUMBERS, takenBy } from "../data/dial";
import { ApiError, call, NetworkError } from "../lib/api";
import { checkCallSign, suggestNumber } from "../lib/callsign";
import { trapFocus, type Trap } from "../lib/focus";
import { choose, initSegs } from "../lib/seg";
import { smoothScroll } from "../lib/site";
import { COPY, cleanZip, confirmation, fieldErrorsFrom, toBody, validate, type FieldErrors, type Role, type WaitlistDraft } from "../lib/waitlist";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** The words that change with the role. */
const FOR: Record<Role, { lede: string; go: string; about?: string }> = {
  viewer: { lede: "Dial opens one market at a time. Say who you are and where, and we'll write when yours is on.", go: "Join the waitlist" },
  station: { lede: "Hold a call sign and a number in your market while you get ready. We keep them for 120 days and remind you before they lapse.", go: "Hold my number" },
  producer: { lede: "List your show when the syndication market opens to makers. Tell us what it is and we'll write first.", go: "Join as a producer", about: "Your show" },
  business: { lede: "Be in the breaks when the spot market opens near you. We'll write with your first stations.", go: "Join as a business", about: "Your business" }
};

/** How the planner's picks read in the sheet. */
const DETAIL_LABELS: Record<string, string> = { where: "Where you sell", kind: "Kind of business", times: "Time of day", budget: "Budget", cap: "Most a day", program: "Program" };

let ready = false;
let trap: Trap | null = null;
let draft: WaitlistDraft = { role: "viewer", email: "", zip: "", callSign: "" };
let checkT = 0;
let checkSeq = 0;

function setRole(role: Role): void {
  draft.role = role;
  const group = $("wlRole");
  const btn = group.querySelector<HTMLButtonElement>(`[data-v="${role}"]`);
  if (btn && !btn.classList.contains("on")) choose(group, btn);
  for (const el of document.querySelectorAll<HTMLElement>("#waitlist [data-for]")) el.hidden = !el.dataset.for!.split(" ").includes(role);
  $("wlLede").textContent = FOR[role].lede;
  $("wlGoL").textContent = FOR[role].go;
  if (FOR[role].about) $("wlAboutL").textContent = FOR[role].about!;
  chip();
}

function chip(): void {
  const station = draft.role === "station";
  $("wlChip").textContent = station ? draft.channel ?? "__.1" : "+1";
  $("wlCh").textContent = draft.channel ?? "__.1";
}

function fieldError(name: "email" | "zip" | "callSign", msg?: string): void {
  const input = name === "email" ? $("wlEmail") : name === "zip" ? $("wlZip") : $("wlCs");
  input.setAttribute("aria-invalid", msg ? "true" : "false");
  if (name === "callSign") {
    const m = $("wlCsMsg");
    m.className = `wl-hint${msg ? " no" : ""}`;
    if (msg) m.textContent = msg;
  } else $(name === "email" ? "wlEmailE" : "wlZipE").textContent = msg ?? "";
}

function showErrors(errors: FieldErrors): void {
  fieldError("email", errors.email);
  fieldError("zip", errors.zip);
  if (errors.callSign) fieldError("callSign", errors.callSign);
}

/** Check the call sign: the shared rules at once, then the API's answer (which knows who holds what). */
function checkCs(): void {
  const cs = draft.callSign;
  const msg = $("wlCsMsg");
  $("wlCs").setAttribute("aria-invalid", "false");
  if (!cs) {
    msg.className = "wl-hint";
    msg.textContent = "Three to five letters. We'll hold it for 120 days.";
    return;
  }
  const local = checkCallSign(cs, takenBy);
  if (!local.ok) {
    msg.className = "wl-hint no";
    msg.textContent = local.message;
    return;
  }
  if (!draft.channel || draft.suggested) {
    draft.channel = suggestNumber(cs, IE_NUMBERS);
    draft.suggested = true;
    chip();
  }
  msg.className = "wl-hint ok";
  msg.textContent = `${cs} looks free. Checking…`;
  clearTimeout(checkT);
  const seq = ++checkSeq;
  checkT = window.setTimeout(async () => {
    try {
      const r = await call(waitlistApi.checkCallSign, { params: { callSign: cs } });
      if (seq !== checkSeq) return;
      if (r.available || r.reservable) {
        msg.className = "wl-hint ok";
        msg.textContent = r.available ? COPY.callSignFree(cs) + " We'll hold it for 120 days." : COPY.callSignAlsoAsked(cs);
      } else {
        msg.className = "wl-hint no";
        const ideas = r.suggestions.slice(0, 2);
        msg.textContent = r.refusal ? `${checkCallSign(cs, () => null).message}${ideas.length ? ` Try ${ideas.join(" or ")}.` : ""}` : COPY.callSignTaken(cs);
      }
    } catch {
      if (seq === checkSeq) msg.textContent = `${cs} looks free.`;
    }
  }, 350);
}

async function submit(e: Event): Promise<void> {
  e.preventDefault();
  draft.email = $<HTMLInputElement>("wlEmail").value;
  draft.zip = cleanZip($<HTMLInputElement>("wlZip").value);
  draft.about = $<HTMLInputElement>("wlAbout").value;
  $("wlErr").textContent = "";
  const errors = validate(draft);
  if (draft.role === "station" && draft.callSign && !checkCallSign(draft.callSign, takenBy).ok) errors.callSign = checkCallSign(draft.callSign, takenBy).message;
  showErrors(errors);
  const first = (["callSign", "email", "zip"] as const).find((k) => errors[k]);
  if (first) {
    (first === "email" ? $("wlEmail") : first === "zip" ? $("wlZip") : $("wlCs")).focus();
    return;
  }
  const go = $<HTMLButtonElement>("wlGo");
  go.setAttribute("aria-busy", "true");
  go.disabled = true;
  try {
    const r = await call(waitlistApi.join, { body: toBody(draft) });
    const c = confirmation(r);
    $("wlDoneH").textContent = c.heading;
    $("wlDoneP").textContent = c.paragraph;
    const held = r.role === "station" && r.heldCallSign;
    $("wlHeld").hidden = !held;
    if (held) {
      $("wlHeldN").textContent = draft.channel ?? "";
      $("wlHeldCs").textContent = r.heldCallSign!;
    }
    $("wlForm").hidden = true;
    $("wlDone").hidden = false;
    $("wlDone").focus();
  } catch (err) {
    if (err instanceof ApiError) {
      const { fields, rest } = fieldErrorsFrom(err.fields);
      showErrors(fields);
      if (err.code === "call_sign_refused" || err.code === "call_sign_taken") fieldError("callSign", checkCallSign(draft.callSign, err.code === "call_sign_taken" ? () => "on the dial" : () => null).message);
      else if (!Object.keys(fields).length) $("wlErr").textContent = rest[0] ?? err.message;
    } else if (err instanceof NetworkError) $("wlErr").textContent = COPY.offline;
    else $("wlErr").textContent = "Something went wrong. Try again.";
  } finally {
    go.removeAttribute("aria-busy");
    go.disabled = false;
  }
}

function setup(): void {
  if (ready) return;
  ready = true;
  initSegs($("waitlist"));
  $("wlRole").addEventListener("seg:change", (e) => setRole((e as CustomEvent<{ value: string }>).detail.value as Role));
  const cs = $<HTMLInputElement>("wlCs");
  cs.addEventListener("input", () => {
    const v = cs.value.replace(/[^a-z]/gi, "").toUpperCase().slice(0, 5);
    if (cs.value !== v) cs.value = v;
    draft.callSign = v;
    checkCs();
  });
  const zip = $<HTMLInputElement>("wlZip");
  zip.addEventListener("input", () => {
    const v = cleanZip(zip.value);
    if (zip.value !== v) zip.value = v;
  });
  $("wlEmail").addEventListener("input", () => fieldError("email"));
  zip.addEventListener("input", () => fieldError("zip"));
  $("wlForm").addEventListener("submit", submit);
  document.querySelectorAll("#waitlist [data-wl-close]").forEach((b) => b.addEventListener("click", closeWaitlist));
}

/** Open the sheet with what `intent` asks for. Focus goes back to the link that opened it. */
export function openWaitlist(intent: WaitlistIntent): void {
  setup();
  const sheet = $("waitlist");
  draft = { role: intent.role, email: draft.email, zip: draft.zip, callSign: intent.callSign ?? (intent.role === "station" ? draft.callSign : ""), channel: intent.number, about: intent.about ?? "", details: intent.details, suggested: !intent.number };
  $<HTMLInputElement>("wlCs").value = draft.callSign;
  $<HTMLInputElement>("wlAbout").value = draft.about ?? "";
  const dl = $("wlDetails");
  const entries = Object.entries(intent.details ?? {}).filter(([k]) => DETAIL_LABELS[k]);
  dl.hidden = !entries.length;
  dl.innerHTML = entries.map(([k, v]) => `<dt>${DETAIL_LABELS[k]}</dt><dd>${v.replace(/</g, "&lt;")}</dd>`).join("");
  $("wlForm").hidden = false;
  $("wlDone").hidden = true;
  $("wlErr").textContent = "";
  showErrors({});
  setRole(intent.role);
  checkCs();
  sheet.hidden = false;
  document.documentElement.style.overflow = "hidden";
  smoothScroll()?.stop();
  trap = trapFocus(sheet, closeWaitlist);
  requestAnimationFrame(() => (intent.role === "station" && !draft.callSign ? $("wlCs") : $("wlEmail")).focus());
}

export function closeWaitlist(): void {
  const sheet = $("waitlist");
  if (sheet.hidden) return;
  sheet.hidden = true;
  document.documentElement.style.overflow = "";
  smoothScroll()?.start();
  trap?.release();
  trap = null;
}
