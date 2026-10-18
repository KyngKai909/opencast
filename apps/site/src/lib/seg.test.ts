// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { initSegs } from "./seg";

describe("segmented controls", () => {
  it("moves the choice and fires seg:change", () => {
    document.body.innerHTML = '<div data-seg id="g"><button class="on" aria-pressed="true" data-f="all">All <span>9</span></button><button aria-pressed="false" data-f="fm">Radio <span>3</span></button></div>';
    initSegs();
    const g = document.getElementById("g")!;
    let got = "";
    g.addEventListener("seg:change", (e) => (got = (e as CustomEvent<{ value: string }>).detail.value));
    (g.querySelector('[data-f="fm"] span') as HTMLElement).click();
    expect(got).toBe("fm");
    expect(g.querySelector(".on")?.getAttribute("data-f")).toBe("fm");
    expect(g.querySelector('[data-f="all"]')?.getAttribute("aria-pressed")).toBe("false");
  });
});
