import type { IncomingMessage, ServerResponse } from "node:http";

// The browser companion was removed. Its old addresses lead to the companion download page,
// which the website serves statically, so no bookmark or Discord message from before breaks.
const DOWNLOAD_PAGE = "https://guilded.kcaron.top/companion/";

export async function serveCompanionWeb(request: IncomingMessage, response: ServerResponse, pathname: string): Promise<boolean> {
  if (pathname !== "/companion" && !pathname.startsWith("/companion/")) return false;
  if (request.method !== "GET" && request.method !== "HEAD") { response.writeHead(405, { Allow: "GET, HEAD" }); response.end(); return true; }
  const lang = new URL(request.url ?? "/", "http://localhost").searchParams.get("lang");
  response.writeHead(301, { location: `${DOWNLOAD_PAGE}${lang === "fr" || lang === "en" ? `?lang=${lang}` : ""}`, "cache-control": "no-store" });
  response.end();
  return true;
}
