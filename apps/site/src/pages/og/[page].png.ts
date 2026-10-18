// Each page's Open Graph image, made at build time: 1200×630, the lockup and the page's headline
// on night (satori lays it out with the site's own fonts, resvg rasterises it).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { APIRoute, GetStaticPaths } from "astro";
import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import lockup from "../../assets/brand/dial-lockup-cream.svg?raw";
import { PAGES } from "../../data/pages";
import type { PageKey } from "../../data/links";

const require = createRequire(import.meta.url);
const font = (pkg: string, file: string) => readFileSync(require.resolve(`@fontsource/${pkg}/files/${file}`));
const fonts = [
  { name: "Big Shoulders Display", data: font("big-shoulders-display", "big-shoulders-display-latin-900-normal.woff"), weight: 900 as const, style: "normal" as const },
  { name: "Instrument Sans", data: font("instrument-sans", "instrument-sans-latin-600-normal.woff"), weight: 600 as const, style: "normal" as const }
];

export const getStaticPaths: GetStaticPaths = () => (Object.keys(PAGES) as PageKey[]).map((page) => ({ params: { page } }));

const NIGHT = "#0E0A1C";
const CREAM = "#F3EAD9";
const MUTED = "#A79FBF";

export const GET: APIRoute = async ({ params }) => {
  const meta = PAGES[params.page as PageKey];
  const [line, dim] = meta.og;
  const logo = `data:image/svg+xml;base64,${Buffer.from(lockup).toString("base64")}`;
  const h = (type: string, style: Record<string, unknown>, children?: unknown) => ({ type, props: { style, children } });
  const svg = await satori(
    h("div", { width: 1200, height: 630, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "72px 80px", background: `radial-gradient(70% 60% at 50% 0%, #2a1236, ${NIGHT} 70%)`, color: CREAM }, [
      { type: "img", props: { src: logo, width: 279, height: 100 } },
      h("div", { display: "flex", flexDirection: "column", fontFamily: "Big Shoulders Display", fontWeight: 900, fontSize: 112, lineHeight: 0.9, textTransform: "uppercase", letterSpacing: "-0.005em" }, [
        h("span", {}, line),
        ...(dim ? [h("span", { color: MUTED }, dim)] : [])
      ]),
      h("div", { display: "flex", justifyContent: "space-between", alignItems: "center", fontFamily: "Instrument Sans", fontWeight: 600, fontSize: 26, color: MUTED }, [
        h("span", {}, "usedial.com"),
        h("span", { display: "flex", alignItems: "center", gap: 12, color: CREAM }, [h("span", { width: 14, height: 14, borderRadius: 7, background: "#FF4A3D" }), "Free to watch"])
      ])
    ]) as never,
    { width: 1200, height: 630, fonts }
  );
  const png = new Resvg(svg, { fitTo: { mode: "width", value: 1200 } }).render().asPng();
  return new Response(new Uint8Array(png), { headers: { "content-type": "image/png" } });
};
