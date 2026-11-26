// Store screenshots of the Expo web export through headless Edge and the DevTools protocol.
// Everything the app asks for is answered by this script with made-up data (no real player, guild or server names), the
// phone is "signed in" to a made-up guild, and Edge cannot reach any host but 127.0.0.1.
// usage (from the repository root):
//   1. cd mobile
//      (PowerShell) $env:EXPO_PUBLIC_GUILDED_WEB_URL = "http://127.0.0.1:8767"; npx.cmd expo export -p web --clear --output-dir <dir>
//   2. node mobile/store/capture-screenshots.mjs <dir> <outDir> [en|fr] [featureHtmlPath]
// Painted badges and header pictures are read from this repository's site/ folder.
/* global WebSocket */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const [exportDir, outDir, lang = "en", featureHtml] = process.argv.slice(2);
if (!exportDir || !outDir || !["en", "fr"].includes(lang)) throw new Error("usage: capture-screenshots.mjs <webExportDir> <outDir> [en|fr] [featureHtml]");
mkdirSync(outDir, { recursive: true });
const fr = lang === "fr";
const say = (en, french) => fr ? french : en;
const SITE = resolve(fileURLToPath(import.meta.url), "..", "..", "..", "site");
const APP_PORT = 8767;
const ORIGIN = `http://127.0.0.1:${APP_PORT}`;

// ---- Made-up data. Names, guild, server, places and items are invented. ----
const HOUR = 3_600_000, DAY = 24 * HOUR;
const at = (offset) => new Date(Date.now() + offset).toISOString();
/** 20:00 local time, `days` from today: raid nights look like raid nights whenever the pictures are taken. */
const evening = (days, hour = 20, minute = 0) => { const d = new Date(Date.now() + days * DAY); d.setHours(hour, minute, 0, 0); return d.toISOString(); };
const GUILD_ID = "100000000000";
const RAID_1 = "sampleraidbarrowdeeps0001", RAID_2 = "sampleraidemberhold000002";
const people = [["Aelira Dawnmere", "Priest", "HEALER"], ["Borin Ashguard", "Warrior", "TANK"], ["Cindra Vale", "Mage", "DPS"], ["Doran Fenwick", "Rogue", "DPS"], ["Elsa Thornwood", "Druid", "HEALER"], ["Fenn Galeheart", "Hunter", "DPS"]];
const brackets = [say("Levels 45–60", "Niveaux 45 à 60"), say("Levels 30–44", "Niveaux 30 à 44")];
const season = say("Season 1", "Saison 1");
const character = (id, name, className, spec, level, isMain, rank, role) => ({
  id, name, displayName: null, realm: "Stonehall", className, spec, level, isMain, edition: "forever", rank,
  guild: { name: "Northwind", edition: "forever", current: true, discordId: GUILD_ID, serverName: "Northwind" },
  cores: role ? [{ id: "core-thu", name: say("Thursday", "Jeudi"), role, bench: false, trial: false, backup: false, lootMode: "RESERVE" }] : []
});
const api = {
  "/api/v1/hub": () => ({
    me: { officer: false, raidLeader: false }, updatedAt: at(-HOUR), guild: { name: "Northwind", edition: "forever" },
    characters: [character("char-aelira", "Aelira Dawnmere", "Priest", say("Holy", "Sacré"), 60, true, "Raider", "HEALER"), character("char-borin", "Borin Ashguard", "Warrior", say("Protection", "Protection"), 58, false, "Raider", "TANK")],
    reserves: { writable: false, list: null, items: [], mineCount: 0, cores: [] }
  }),
  "/api/v1/manage": () => ({ me: { officer: false, raidLeader: false }, updatedAt: at(-HOUR), edition: "forever", guildName: "Northwind", characters: [], cores: [] }),
  "/api/v1/standings": () => ({
    gameEdition: "forever", wowGuildName: "Northwind", updatedAt: at(-HOUR),
    nextRaid: { id: RAID_1, title: say("Barrow Deeps", "Les Profondeurs"), scheduledAt: evening(1), core: say("Thursday", "Jeudi"), coreId: "core-thu",
      players: [{ name: "Aelira-Stonehall", role: "HEALER" }, { name: "Borin-Stonehall", role: "TANK" }, { name: "Doran-Stonehall", role: "DPS" }], maybe: ["Cindra-Stonehall"] },
    raids: [{ id: RAID_1, title: say("Barrow Deeps", "Les Profondeurs"), at: evening(1), core: say("Thursday", "Jeudi"), note: say("Bring flasks.", "Apportez vos flacons.") },
      { id: RAID_2, title: say("Emberhold", "Fort-Braise"), at: evening(4), core: say("Sunday", "Dimanche"), note: "" }],
    standings: [{ character: "Aelira-Stonehall", realm: "Stonehall", main: true, ep: 1400, gp: 220, pr: 6.36 }, { character: "Borin-Stonehall", realm: "Stonehall", main: false, ep: 800, gp: 300, pr: 2.67 }]
  }),
  "/api/v1/me/raid-signups": () => ({ raids: [{ raidId: RAID_1, status: "SIGNED_UP", role: "HEALER", late: false, closesAt: evening(1) }] }),
  "/api/v1/mobile/device": () => ({ enabled: true, helpCalls: true, raidSpots: true }),
  "/api/v1/me/guild-feed": () => ({ days: 14, items: [
    { kind: "raidKill", at: evening(-1, 21, 40), actor: "Northwind", boss: say("The Ashen King", "Le Roi des cendres"), instance: say("Barrow Deeps", "Les Profondeurs") },
    { kind: "donation", at: evening(-1, 20, 15), actor: "Borin", copper: 250000 },
    { kind: "join", at: evening(-1, 19, 5), actor: "Fenn" },
    { kind: "promote", at: evening(-2, 22, 10), actor: "Mira", target: "Cindra", rank: "Raider" },
    { kind: "donation", at: evening(-2, 20, 30), actor: "Aelira", item: say("Linen Cloth", "Tissu de lin"), count: 20 },
    { kind: "join", at: evening(-2, 18, 45), actor: "Cindra" },
    { kind: "leave", at: evening(-3, 21, 0), actor: "Tobin" }
  ] }),
  "/api/v1/me/crafting": (url) => {
    const items = [
      { itemKey: 1, itemName: say("Runecloth Bag", "Sac en étoffe runique"), profession: "Tailoring", crafters: ["Cindra", "Mira"] },
      { itemKey: 2, itemName: say("Linen Bag", "Sac en lin"), profession: "Tailoring", crafters: ["Cindra"] },
      { itemKey: 3, itemName: say("Mooncloth Bag", "Sac en étoffe lunaire"), profession: "Tailoring", crafters: ["Elsa"] }
    ];
    return { items: (url.searchParams.get("q") ?? "").length >= 2 ? items : [], requests: [
      { id: "req-1", item: say("Major Healing Potion", "Potion de soins majeure"), quantity: 5, status: "CLAIMED", crafter: "Mira", mine: true, createdAt: at(-5 * HOUR) },
      { id: "req-2", item: say("Thorium Shells", "Obus en thorium"), quantity: 1, status: "OPEN", crafter: null, mine: true, createdAt: at(-30 * HOUR) }
    ] };
  },
  "/api/v1/companion/guild-map": () => ({
    enabled: true, sharing: true, days: 28,
    mates: [
      { character: "Borin Ashguard", name: "Borin Ashguard", className: "Warrior", level: 58, mine: false, zone: say("Green Hills", "Collines"), mapId: 1, x: 0.4, y: 0.5, continentId: 1, cx: 0.26, cy: 0.3, seenAt: at(-12 * 60_000) },
      { character: "Cindra Vale", name: "Cindra Vale", className: "Mage", level: 51, mine: false, zone: say("Grey Marsh", "Marais"), mapId: 2, x: 0.6, y: 0.3, continentId: 1, cx: 0.55, cy: 0.58, seenAt: at(-95 * 60_000) },
      { character: "Doran Fenwick", name: "Doran Fenwick", className: "Rogue", level: 60, mine: false, zone: say("Long Coast", "Côte"), mapId: 3, x: 0.2, y: 0.7, continentId: 1, cx: 0.72, cy: 0.78, seenAt: at(-26 * HOUR) }
    ],
    continents: [{ id: 1, name: say("Sample continent", "Continent d'exemple"), cells: [[5, 4, 6], [6, 4, 9], [6, 5, 4], [12, 9, 3], [13, 9, 7], [17, 12, 2], [4, 11, 1]], zones: [
      { zone: say("Green Hills", "Collines"), cx: 0.26, cy: 0.28, count: 19 }, { zone: say("Grey Marsh", "Marais"), cx: 0.55, cy: 0.6, count: 10 }, { zone: say("Long Coast", "Côte"), cx: 0.72, cy: 0.79, count: 2 }] }],
    calls: [{ character: "Cindra Vale", name: "Cindra Vale", mine: false, zone: say("Grey Marsh", "Marais"), subzone: say("Old Mill", "Vieux moulin"), continentId: 1, cx: 0.56, cy: 0.6,
      attackers: [{ name: "Raider One", class: "ROGUE", level: 55 }], calledAt: at(-3 * 60_000), active: true, cleared: false }]
  }),
  "/api/v1/me/characters": () => ({ characters: [
    { id: "char-aelira", name: "Aelira Dawnmere", isMain: true, trust: "confirmed", level: 60, className: "Priest", serverName: "Northwind", inGuild: true, guildRank: "Raider" },
    { id: "char-borin", name: "Borin Ashguard", isMain: false, trust: "confirmed", level: 58, className: "Warrior", serverName: "Northwind", inGuild: true, guildRank: "Raider" }
  ] }),
  "/api/v1/me/promotion": () => ({ servers: [] }),
  "/leaderboards/summary.json": () => ({ season, ratedRunsThisWeek: 128, guilds: 9, topRuns: [
    { dungeon: say("Sample Caverns", "Cavernes d'exemple"), levels: "", time: "", score: 312 }, { dungeon: say("Sample Keep", "Donjon d'exemple"), levels: "", time: "", score: 296 }, { dungeon: say("Sample Depths", "Abîmes d'exemple"), levels: "", time: "", score: 281 }] }),
  "/leaderboards/boards.json": (url) => ({ season, seasonId: "s1", seasons: [{ id: "s1", label: season }],
    brackets: [{ key: "a", name: brackets[0], characters: people.map(([name, className, role], i) => ({ rank: i + 1, name, realm: "Stonehall", className, role, points: 640 - i * 23 })),
      guilds: [["Northwind", 2210], ["Silver Lantern", 1984], ["Oakshield", 1720]].map(([name, points], i) => ({ rank: i + 1, id: `g${i}`, name, slug: null, points, rated: 30 - i * 4 })) },
      { key: "b", name: brackets[1], characters: [], guilds: [] }],
    ...(url.searchParams.get("player") ? { player: {
      brackets: [{ key: "a", name: brackets[0], rank: 4, points: 571, of: 120 }, { key: "b", name: brackets[1], rank: 11, points: 402, of: 96 }],
      runs: [{ dungeon: say("Sample Caverns", "Cavernes d'exemple"), bracket: brackets[0], points: 148, durationSec: 1385, endedAt: evening(-1, 21, 12) },
        { dungeon: say("Sample Keep", "Donjon d'exemple"), bracket: brackets[0], points: 132, durationSec: 1710, endedAt: evening(-2, 19, 48) },
        { dungeon: say("Sample Depths", "Abîmes d'exemple"), bracket: brackets[0], points: 117, durationSec: 2042, endedAt: evening(-3, 22, 5) }] } } : {}) }),
  "/leaderboards/duels.json": (url) => ({ season, seasons: [], duels: 214, players: [],
    ...(url.searchParams.get("player") ? { player: { rank: 7, rating: 1184, wins: 23, losses: 9, streak: 3, bestStreak: 8, ranked: true, lastDuelAt: at(-DAY) } } : {}) }),
  "/leaderboards/raids.json": () => ({ opensAt: null, open: true, totalKills: 0, guilds: [], firsts: [] }),
  "/news/headlines.json": () => ({ enabled: true, items: [] })
};

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".ttf": "font/ttf", ".woff2": "font/woff2", ".ico": "image/x-icon" };
const fileUnder = (root, path) => {
  const file = normalize(join(root, path));
  return file.startsWith(resolve(root) + sep) && existsSync(file) && statSync(file).isFile() ? file : null;
};
const unanswered = new Set();
const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", ORIGIN);
  const path = decodeURIComponent(url.pathname);
  const answer = api[path];
  if (answer) {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(answer(url)));
    return;
  }
  const file = fileUnder(resolve(exportDir), path === "/" ? "index.html" : path) ?? fileUnder(SITE, path);
  if (!file) { unanswered.add(path); response.writeHead(404); response.end(); return; }
  response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  response.end(readFileSync(file));
});
await new Promise((done, fail) => { server.once("error", fail); server.listen(APP_PORT, "127.0.0.1", done); });

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9333;
const profile = mkdtempSync(join(tmpdir(), "guilded-shots-"));
const edge = spawn(EDGE, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "--hide-scrollbars",
  "--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1", `--lang=${say("en-CA", "fr-CA")}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  let target;
  for (let i = 0; i < 150 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === "page"); } catch { /* not up yet */ }
    if (!target) await sleep(200);
  }
  if (!target) throw new Error("Edge did not start");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let next = 0;
  const waiting = new Map();
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
  });
  const send = (method, params = {}) => new Promise((done, fail) => {
    const id = ++next;
    waiting.set(id, (msg) => msg.error ? fail(new Error(`${method}: ${msg.error.message}`)) : done(msg.result));
    ws.send(JSON.stringify({ id, method, params }));
  });
  const run = async (expression) => (await send("Runtime.evaluate", { returnByValue: true, expression })).result.value;
  const until = async (text) => {
    for (let i = 0; i < 150; i++) {
      if (await run(`Boolean(document.body) && (document.body.innerText.includes(${JSON.stringify(text)}) || [...document.querySelectorAll("[aria-label]")].some((node) => node.getAttribute("aria-label") === ${JSON.stringify(text)}))`)) return;
      await sleep(200);
    }
    throw new Error(`never showed: ${text}`);
  };
  const shot = async (name) => {
    await sleep(1500);
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(outDir, name), Buffer.from(data, "base64"));
    console.log("saved", name);
  };
  /** Clicks the first visible element whose own text (or accessibility label) is `text`. */
  const tap = async (text) => {
    await until(text).catch(() => {});
    const point = await run(`(() => {
      const wanted = ${JSON.stringify(text)};
      const el = [...document.querySelectorAll("[role=tab],[role=button],div,span,input")].find((node) => node.getBoundingClientRect().height > 0 &&
        (node.getAttribute("aria-label") === wanted || (node.children.length === 0 && node.textContent.trim() === wanted)));
      if (!el) return null;
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    if (!point) throw new Error(`no element with text ${text}`);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: point.x, y: point.y, button: "left", clickCount: 1 });
    await sleep(900);
  };
  /** Puts the element holding exactly `text` near the top of its scroll view. */
  const scrollTo = async (text) => {
    await until(text);
    await run(`(() => { const wanted = ${JSON.stringify(text)}; const el = [...document.querySelectorAll("div,span,input")].find((d) => d.getAttribute("aria-label") === wanted || (d.children.length === 0 && d.textContent.trim() === wanted));
      if (el) el.scrollIntoView({ block: "start" }); })()`);
    await sleep(400);
  };

  // Phone: 360x640 CSS pixels at 3x = 1080x1920.
  await send("Emulation.setDeviceMetricsOverride", { width: 360, height: 640, deviceScaleFactor: 3, mobile: true });
  await send("Page.enable");
  await send("Runtime.enable");
  const session = { companionCredential: "s".repeat(43), personal: false, guildDiscordId: GUILD_ID, guildName: "Northwind", gameEdition: "forever", apiOrigin: ORIGIN, renewedAt: Date.now() };
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `
    localStorage.setItem("guilded.mobile.session", ${JSON.stringify(JSON.stringify(session))});
    localStorage.setItem("guilded.mobile.lang", ${JSON.stringify(lang)});
    localStorage.setItem("guilded.mobile.reminders", "1");
    localStorage.setItem("guilded.mobile.intro.v1", "1");` });
  await send("Page.navigate", { url: ORIGIN + "/" });
  await until("Aelira Dawnmere");

  // 1 Guild activity
  await tap(say("Activity", "Activité"));
  await until("Borin");
  await scrollTo(say("Activity", "Activité"));
  await shot("01-guild-activity.png");
  // 2 Raids with sign-up
  await tap(say("Raids", "Raids"));
  await scrollTo(say("Barrow Deeps", "Les Profondeurs"));
  await shot("02-guild-raids.png");
  // 3 Crafting: search, then open one item
  await tap(say("Crafting", "Artisanat"));
  await tap(say("Item name", "Nom de l'objet"));
  await send("Input.insertText", { text: say("bag", "sac") });
  await tap(`${say("Runecloth Bag", "Sac en étoffe runique")}, Cindra, Mira`);
  await scrollTo(say("Item name", "Nom de l'objet"));
  await shot("03-crafting.png");
  // 4 My character page
  await tap(say("Me", "Moi"));
  await tap(`${say("Details", "Détails")}, Aelira Dawnmere`);
  await until("1184");
  await scrollTo("Aelira Dawnmere");
  await shot("04-character.png");
  // 5 Guild map
  await tap(say("Guild", "Guilde"));
  await tap(say("Map", "Carte"));
  await scrollTo(say("Sample continent", "Continent d'exemple"));
  await shot("05-guild-map.png");
  // 6 Alerts: the push switches. The "this browser only lists reminders" line exists only in the web preview, so it is removed.
  await tap(say("Alerts", "Alertes"));
  await until(say("A guildmate calls for help in game", "Un membre de la guilde appelle à l'aide en jeu"));
  await run(`(() => { for (const el of document.querySelectorAll("div,span")) if (el.children.length === 0 && /^(This browser lists the reminders|Ce navigateur affiche les rappels)/.test(el.textContent.trim())) el.remove(); })()`);
  await scrollTo(say("Raid alerts from your guild server", "Alertes de raid de ton serveur de guilde"));
  await shot("06-alerts.png");
  // 7 Stats: this week and the public leaderboards
  await tap(say("Stats", "Stats"));
  await until(say("Sample Caverns", "Cavernes d'exemple"));
  await shot("07-stats.png");
  // 8 Roster
  await tap(say("Guild", "Guilde"));
  await tap(say("Roster", "Membres"));
  await shot("08-guild-roster.png");

  if (featureHtml) {
    await send("Emulation.setDeviceMetricsOverride", { width: 1024, height: 500, deviceScaleFactor: 1, mobile: false });
    await send("Page.navigate", { url: "file:///" + resolve(featureHtml).replace(/\\/g, "/") });
    await shot("feature-graphic-1024x500.png");
  }
  ws.close();
  if (unanswered.size) console.log("not answered (404):", [...unanswered].join(" "));
} finally {
  edge.kill();
  server.close();
}
