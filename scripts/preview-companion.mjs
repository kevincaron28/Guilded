// A public-files-only preview. No database, credentials or Discord client.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
const assets = new Set(["index.html", "app.js", "web-bundle.js", "style.css", "logo.png", "manifest.json"]);
const types = { html: "text/html", js: "text/javascript", css: "text/css", png: "image/png", json: "application/manifest+json" };
const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  const name = url.pathname === "/companion/" ? "index.html" : url.pathname.replace(/^\/companion\//, "");
  if (!url.pathname.startsWith("/companion/") || !assets.has(name)) { response.writeHead(404); response.end('{"error":"Local preview: no bot is connected."}'); return; }
  try { const data = await readFile(new URL(`../companion-app/renderer/${name}`, import.meta.url)); response.writeHead(200, { "content-type": types[name.split(".").at(-1)], "cache-control": "no-store" }); response.end(data); }
  catch { response.writeHead(503); response.end("Run npm run companion:build first."); }
});
server.listen(8799, "127.0.0.1", () => console.log("Companion preview: http://127.0.0.1:8799/companion/ (no live bot)"));
