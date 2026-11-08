// Store screenshots of the Expo web export through headless Edge and the DevTools protocol.
// Public Guilded endpoints are answered with made-up sample data (no real player names).
// usage: node mobile/store/capture-screenshots.mjs <appUrl> <outDir> [featureHtmlPath]
//   1. cd mobile && npx expo export -p web --output-dir <dir>   2. python -m http.server 8767 --directory <dir>
//   3. node mobile/store/capture-screenshots.mjs http://127.0.0.1:8767/ mobile/store/screenshots mobile/store/feature-graphic.html
/* global WebSocket */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [appUrl, outDir, featureHtml] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9333;
const profile = join(outDir, "..", "edge-profile-" + Date.now());
const edge = spawn(EDGE, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let target;
for (let i = 0; i < 50 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page"); } catch { /* not up yet */ }
  if (!target) await sleep(200);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let next = 0;
const waiting = new Map();
const handlers = [];
ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
  else if (msg.method) for (const h of handlers) h(msg);
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++next;
  waiting.set(id, (msg) => msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result));
  ws.send(JSON.stringify({ id, method, params }));
});

const summary = { season: "Season 1", ratedRunsThisWeek: 128, guilds: 9, topRuns: [
  { dungeon: "Sample Caverns", levels: "", time: "", score: 312 }, { dungeon: "Sample Keep", levels: "", time: "", score: 296 }, { dungeon: "Sample Depths", levels: "", time: "", score: 281 }] };
const people = [["Aelira Dawnmere", "Priest", "HEALER"], ["Borin Ashguard", "Warrior", "TANK"], ["Cindra Vale", "Mage", "DPS"], ["Doran Fenwick", "Rogue", "DPS"], ["Elsa Thornwood", "Druid", "HEALER"], ["Fenn Galeheart", "Hunter", "DPS"]];
const boards = { season: "Season 1", brackets: [
  { key: "a", name: "Levels 15–29", characters: people.map(([name, className, role], i) => ({ rank: i + 1, name, realm: "Sample realm", className, role, points: 640 - i * 23 })),
    guilds: [["Northwind", 2210], ["Silver Lantern", 1984], ["Oakshield", 1720]].map(([name, points], i) => ({ rank: i + 1, id: `g${i}`, name, slug: null, points, rated: 30 - i * 4 })) },
  { key: "b", name: "Levels 30–44", characters: [], guilds: [] }] };
const answer = (url) => url.includes("summary.json") ? summary : url.includes("headlines") ? { enabled: true, items: [] } : boards;

await send("Fetch.enable", { patterns: [{ urlPattern: "*guilded.kcaron.top*" }] });
handlers.push((msg) => {
  if (msg.method !== "Fetch.requestPaused") return;
  const body = Buffer.from(JSON.stringify(answer(msg.params.request.url))).toString("base64");
  void send("Fetch.fulfillRequest", { requestId: msg.params.requestId, responseCode: 200, body,
    responseHeaders: [{ name: "content-type", value: "application/json" }, { name: "access-control-allow-origin", value: "*" }] });
});
await send("Page.enable");
await send("Runtime.enable");

const shot = async (name) => {
  await sleep(700);
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(outDir, name), Buffer.from(data, "base64"));
  console.log("saved", name);
};
const tap = async (text, last = false) => {
  const { result } = await send("Runtime.evaluate", { returnByValue: true, expression: `(() => {
    const hits = [...document.querySelectorAll("div,span")].filter((el) => el.children.length === 0 && el.textContent.trim() === ${JSON.stringify(text)} && el.getBoundingClientRect().height > 0);
    const el = hits[${last ? "hits.length - 1" : "0"}];
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()` });
  if (!result.value) throw new Error(`no element with text ${text}`);
  const { x, y } = result.value;
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  await sleep(600);
};

// Phone: 360x640 CSS pixels at 3x = 1080x1920.
await send("Emulation.setDeviceMetricsOverride", { width: 360, height: 640, deviceScaleFactor: 3, mobile: true });
await send("Page.navigate", { url: appUrl });
await sleep(3500);
await shot("01-stats.png");
await tap("Guild");
await tap("Look at a sample guild", true);
await sleep(800);
await shot("02-guild-roster.png");
await tap("Map");
await sleep(800);
await send("Runtime.evaluate", { expression: `(() => { const el = [...document.querySelectorAll("div")].find((d) => d.textContent.trim() === "Sample continent" && d.children.length === 0); el && el.scrollIntoView({ block: "start" }); })()` });
await shot("03-guild-map.png");
await tap("Raids");
await shot("04-guild-raids.png");
await tap("Me");
await shot("05-me-profile.png");
await send("Runtime.evaluate", { expression: `(() => { const el = [...document.querySelectorAll("div")].find((d) => d.textContent.trim() === "BADGES" && d.children.length === 0); el && el.scrollIntoView(); })()` });
await shot("06-me-badges.png");
await tap("Alerts");
await shot("07-alerts.png");

if (featureHtml) {
  await send("Emulation.setDeviceMetricsOverride", { width: 1024, height: 500, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: "file:///" + featureHtml.replace(/\\/g, "/") });
  await sleep(1500);
  await shot("feature-graphic-1024x500.png");
}
ws.close();
edge.kill();
