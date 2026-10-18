// The market (synd.js "find what fits"): search, four dropdowns on desktop, a filter sheet on
// tablet and phone, and each program's Request / Add it, which opens the waitlist with the program
// named (or the app's market, in live mode).
import { requestProgram } from "../../data/links";
import { FILTER_START, filterPrograms, optionLabel, fitCount, PROGRAMS, showCount, type FilterKey, type FilterState } from "../../data/syndication";
import { trapFocus, type Trap } from "../../lib/focus";
import { smoothScroll } from "../../lib/site";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const TERMS = { cash: "Cash", share: "Revenue share", free: "Free" } as const;

export function initMarket(): void {
  const list = document.getElementById("fList");
  if (!list) return;
  const F: FilterState = { ...FILTER_START };
  const dds = [...document.querySelectorAll<HTMLElement>(".fit .f-dd")];
  const sheet = $("fSheet");

  const sync = () => {
    for (const d of dds) {
      const k = d.dataset.k as FilterKey;
      d.querySelector(".f-dd-b b")!.textContent = optionLabel(k, F[k]);
      d.classList.toggle("set", k !== "sort" && F[k] !== "any");
      d.querySelectorAll("[role=option]").forEach((o) => o.setAttribute("aria-selected", String((o as HTMLElement).dataset.v === F[k])));
    }
    sheet.querySelectorAll<HTMLElement>(".seg2").forEach((g) => g.querySelectorAll<HTMLButtonElement>("button").forEach((x) => {
      const on = x.dataset.v === F[g.dataset.k as FilterKey];
      x.classList.toggle("on", on);
      x.setAttribute("aria-pressed", String(on));
    }));
    const n = (["slot", "len", "terms"] as const).filter((k) => F[k] !== "any").length;
    $("fN").textContent = String(n);
    $("fN").hidden = !n;
  };
  const render = () => {
    const r = filterPrograms(F, PROGRAMS);
    list.innerHTML = r.length
      ? r.map((p) => {
          const cta = requestProgram({ id: p.id, title: p.t });
          const attrs = Object.entries(cta.attrs).map(([k, v]) => ` ${k}="${esc(v)}"`).join("");
          const verb = p.terms === "free" ? "Add" : "Request";
          return `<div class="fp" style="--c:${p.c}"><div class="fp-l"><span class="fp-len tab">${p.len >= 120 ? "2 h" : `${p.len} min`}</span><span class="fp-g">${p.g}</span></div><div class="fp-m"><b>${esc(p.t)}</b><small>${esc(p.by)} · ${esc(p.eps)}</small></div><div class="fp-t"><b>${TERMS[p.terms]}</b><small>${p.tv}</small></div><a class="fp-b" href="${esc(cta.href)}"${attrs} aria-label="${verb} ${esc(p.t)}">${p.terms === "free" ? "Add it" : "Request"}</a></div>`;
        }).join("")
      : '<p class="f-none">Nothing fits that yet. Widen the slot, the length or the search.</p>';
    $("fCount").textContent = fitCount(r.length);
    $("fShowN").textContent = showCount(r.length);
    sync();
  };

  // ---- dropdowns ----
  const closeAll = (except?: HTMLElement) => dds.forEach((d) => {
    if (d === except) return;
    (d.querySelector(".f-pop") as HTMLElement).hidden = true;
    d.querySelector(".f-dd-b")!.setAttribute("aria-expanded", "false");
    d.classList.remove("open");
  });
  for (const d of dds) {
    const b = d.querySelector<HTMLButtonElement>(".f-dd-b")!, pop = d.querySelector<HTMLElement>(".f-pop")!;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = pop.hidden;
      closeAll(d);
      pop.hidden = !open;
      d.classList.toggle("open", open);
      b.setAttribute("aria-expanded", String(open));
      if (open) pop.querySelector<HTMLElement>("[aria-selected=true]")?.focus();
    });
    pop.addEventListener("click", (e) => {
      const o = (e.target as Element).closest<HTMLElement>("[role=option]");
      if (!o) return;
      (F as Record<string, string>)[d.dataset.k!] = o.dataset.v!;
      closeAll();
      b.focus();
      render();
    });
    pop.addEventListener("keydown", (e) => {
      const os = [...pop.querySelectorAll<HTMLElement>("[role=option]")], i = os.indexOf(document.activeElement as HTMLElement);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        os[Math.min(os.length - 1, i + 1)]?.focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        os[Math.max(0, i - 1)]?.focus();
      } else if (e.key === "Home") {
        e.preventDefault();
        os[0]?.focus();
      } else if (e.key === "End") {
        e.preventDefault();
        os[os.length - 1]?.focus();
      } else if (e.key === "Escape") {
        closeAll();
        b.focus();
      }
    });
    // Tabbing out closes it (the reference left it open until a click elsewhere).
    d.addEventListener("focusout", (e) => !d.contains(e.relatedTarget as Node) && closeAll());
  }
  document.addEventListener("click", (e) => !(e.target as Element).closest(".f-dd") && closeAll());
  $<HTMLInputElement>("fQ").addEventListener("input", function () {
    F.q = this.value;
    render();
  });

  // ---- the filter sheet (tablet and phone) ----
  document.body.appendChild(sheet);
  let trap: Trap | null = null;
  const openSheet = () => {
    sheet.hidden = false;
    document.documentElement.classList.add("sheet-open");
    smoothScroll()?.stop();
    setTimeout(() => sheet.classList.add("on"), 10);
    trap = trapFocus(sheet, closeSheet);
  };
  function closeSheet() {
    sheet.classList.remove("on");
    document.documentElement.classList.remove("sheet-open");
    smoothScroll()?.start();
    setTimeout(() => {
      sheet.hidden = true;
      trap?.release();
      trap = null;
    }, 260);
  }
  $("fMob").addEventListener("click", openSheet);
  sheet.addEventListener("click", (e) => {
    const t = e.target as Element;
    if (t.closest("[data-close]")) return closeSheet();
    const b = t.closest<HTMLButtonElement>(".seg2 button");
    if (b) {
      (F as Record<string, string>)[(b.parentNode as HTMLElement).dataset.k!] = b.dataset.v!;
      render();
    }
  });
  $("fClear").addEventListener("click", () => {
    Object.assign(F, FILTER_START);
    $<HTMLInputElement>("fQ").value = "";
    render();
  });
  render();
}
