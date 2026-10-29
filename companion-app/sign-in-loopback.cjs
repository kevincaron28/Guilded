"use strict";
const http = require("node:http");

// "Sign in with Discord" without a code (8.1): the app listens on 127.0.0.1 only, gives the bot
// its port, and after the member approves, the website sends the browser here with a one-time
// proof. The bot hands the credential only to a poll carrying that proof, so a sign-in link
// someone else started never connects their app. See src/services/companion-signin.ts.
function startSignInLoopback({ onProof = () => {}, page = defaultPage } = {}) {
  let proof;
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const value = url.searchParams.get("proof") ?? "";
    if (request.method !== "GET" || url.pathname !== "/guilded-sign-in" || !/^[A-Za-z0-9_-]{16,100}$/.test(value)) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found");
      return;
    }
    proof ??= value;
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'" }).end(page());
    onProof(value);
  });
  const ready = new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
  return { ready, proof: () => proof, close: () => server.close() };
}

function defaultPage() {
  return `<!doctype html><meta charset="utf-8"><title>Guilded Companion</title><body style="font-family:system-ui,sans-serif;max-width:32em;margin:3em auto;padding:0 1em">`
    + `<h1>Companion connected / Compagnon relié</h1><p>You can close this tab and go back to Guilded Companion.</p><p>Vous pouvez fermer cet onglet et revenir à Guilded Companion.</p>`;
}

module.exports = { startSignInLoopback };
