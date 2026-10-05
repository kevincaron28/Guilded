// Static public-site preview only. No bot, database or credentials.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
const root = resolve("dist/site");
const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".jpg": "image/jpeg", ".png": "image/png" };
createServer(async (request, response) => {
  try {
    if (request.method !== "GET" && request.method !== "HEAD") { response.writeHead(405); response.end(); return; }
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const file = resolve(root, "." + (pathname.endsWith("/") ? pathname + "index.html" : pathname));
    if (!file.startsWith(root + sep) || !mime[extname(file)]) { response.writeHead(404); response.end(); return; }
    const content = await readFile(file);
    response.writeHead(200, { "content-type": mime[extname(file)], "cache-control": "no-store", "x-content-type-options": "nosniff" });
    response.end(request.method === "HEAD" ? undefined : content);
  } catch { response.writeHead(404); response.end("Not found. Build with npm run site:build."); }
}).listen(8800, "127.0.0.1", () => console.log("Guilded site preview: http://127.0.0.1:8800 (no bot)"));
