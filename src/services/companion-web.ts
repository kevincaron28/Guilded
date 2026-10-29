import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
const assets: Record<string, string> = {
  "": "index.html", "index.html": "index.html", "style.css": "style.css",
  "app.js": "app.js", "manage.js": "manage.js", "raid-hub.js": "raid-hub.js", "web-bundle.js": "web-bundle.js", "logo.png": "logo.png", "manifest.json": "manifest.json",
  "precision.css": "precision.css", "kc-emblem.webp": "kc-emblem.webp"
};
const sharedAssets: Record<string, string> = {
  "design-tokens.css": "../../site/design-tokens.css",
  "fonts/inter-latin.woff2": "../../site/fonts/inter-latin.woff2",
  "fonts/source-serif-latin.ttf": "../../site/fonts/source-serif-latin.ttf"
};
const mime: Record<string, string> = { html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", png: "image/png", webp: "image/webp", woff2: "font/woff2", ttf: "font/ttf", json: "application/manifest+json" };
// Serve only public renderer assets, never configuration or Electron's preload.
export async function serveCompanionWeb(request: IncomingMessage, response: ServerResponse, pathname: string): Promise<boolean> {
  if (pathname !== "/companion" && !pathname.startsWith("/companion/")) return false;
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  if (request.method !== "GET" && request.method !== "HEAD") { response.writeHead(405, { Allow: "GET, HEAD" }); response.end(); return true; }
  if (pathname === "/companion") { response.writeHead(302, { location: "/companion/" }); response.end(); return true; }
  const name = pathname.slice("/companion/".length);
  const file = assets[name];
  const shared = sharedAssets[name];
  if (!file && !shared) { response.writeHead(404); response.end("Not found"); return true; }
  try {
    const content = await readFile(new URL(shared || `../../companion-app/renderer/${file}`, import.meta.url));
    response.writeHead(200, { "content-type": mime[(file || name).split(".").at(-1)!], "cache-control": "no-cache" });
    response.end(request.method === "HEAD" ? undefined : content);
  } catch {
    response.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
    response.end("The online companion is not built yet. Ask the owner to run npm run companion:build.");
  }
  return true;
}
