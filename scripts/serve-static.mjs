// Serves a built single-page app (a Vite `dist`) on $PORT: files as they are, anything else gets
// index.html so client-side routes work. Used by the web apps on Railway.
//   node scripts/serve-static.mjs apps/web/dist
import { createReadStream, promises as fs } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? "dist");
const port = Number(process.env.PORT ?? 4173);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".webmanifest": "application/manifest+json" };

createServer(async (req, res) => {
  const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
  if (url === "/health") return void res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
  let file = path.join(root, path.normalize(url).replace(/^(\.\.[/\\])+/, ""));
  if (!file.startsWith(root)) return void res.writeHead(403).end();
  const stat = await fs.stat(file).catch(() => null);
  if (!stat || stat.isDirectory()) file = path.join(root, "index.html");
  const ext = path.extname(file);
  // Hashed assets forever; the page itself never, so a deploy shows at once.
  // The Opencast app's Network desk (/desk) is Opencast's own tool: never indexed.
  const noIndex = url === "/desk" || url.startsWith("/desk/") ? { "x-robots-tag": "noindex, nofollow" } : {};
  res.writeHead(200, { "content-type": types[ext] ?? "application/octet-stream", "cache-control": ext === ".html" ? "no-store" : "public, max-age=31536000, immutable", ...noIndex });
  createReadStream(file).on("error", () => res.end()).pipe(res);
}).listen(port, () => console.log(`Serving ${root} on :${port}`));
