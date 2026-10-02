// A one-page PDF of plain lines (receipts and statements for the books, E4). Helvetica, US Letter,
// no dependencies: the smallest valid PDF with a text stream. Long documents run onto more pages.

const PAGE = { width: 612, height: 792, margin: 56, lineHeight: 16, size: 11 };

/** Escapes text for a PDF string; characters outside Latin-1 become "?". */
function pdfText(line: string): string {
  const latin = [...line].map((ch) => (ch.charCodeAt(0) <= 0xff ? ch : ch === "’" ? "'" : ch === "—" || ch === "–" ? "-" : "?")).join("");
  return latin.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

export function simplePdf(lines: Array<string | { text: string; bold?: boolean; size?: number }>): Buffer {
  const perPage = Math.floor((PAGE.height - PAGE.margin * 2) / PAGE.lineHeight);
  const items = lines.map((l) => (typeof l === "string" ? { text: l } : l));
  const pages: (typeof items)[] = [];
  for (let i = 0; i < Math.max(1, items.length); i += perPage) pages.push(items.slice(i, i + perPage));

  const objects: string[] = [];
  // 1: catalog, 2: pages, 3: regular font, 4: bold font, then a page and its content per page.
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  const kids: string[] = [];
  pages.forEach((page, i) => {
    const pageId = 5 + i * 2;
    const contentId = pageId + 1;
    kids.push(`${pageId} 0 R`);
    let y = PAGE.height - PAGE.margin;
    const body = page
      .map((l) => {
        const out = `BT /${l.bold ? "F2" : "F1"} ${l.size ?? PAGE.size} Tf ${PAGE.margin} ${y} Td (${pdfText(l.text)}) Tj ET`;
        y -= PAGE.lineHeight;
        return out;
      })
      .join("\n");
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(body, "latin1")} >>\nstream\n${body}\nendstream`;
  });
  objects[2] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>`;

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(out, "latin1");
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
