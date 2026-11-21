import { snapshotDungeonRole } from "./dungeon-role.mjs";
import { featuresLua } from "./group-relay.mjs";
import { runCardsToLua } from "./run-cards.mjs";
function luaString(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/[\r\n]/g, " ")}"`;
}

// Set item prices as a Lua table body: ["item key"] = gp, plus ["#id"] = gp when the price has an item id.
function valuesToLua(values, indent) {
  const lines = [];
  for (const value of values ?? []) {
    const gp = Math.max(0, Math.trunc(Number(value.gp) || 0));
    lines.push(`${indent}[${luaString(value.key)}] = ${gp},`);
    if (value.id && !value.key.includes("@") && value.key !== `#${value.id}`) lines.push(`${indent}[${luaString(`#${value.id}`)}] = ${gp},`);
  }
  return lines;
}

function pricingToLua(p) {
  if (!p || p.preset !== 'december-flat-v1') return 'nil';
  const slots = Object.entries(p.slots ?? {}).filter(([,v]) => Number.isInteger(v) && v >= 0 && v <= 100000);
  return `{ preset = ${luaString(p.preset)}, edition = ${luaString(p.edition)}, revision = ${Math.max(0, Math.trunc(p.revision ?? 0))}, slots = { ${slots.map(([k,v]) => `[${luaString(k)}] = ${v}`).join(', ')} }, equipment = { ${Object.entries(p.equipment ?? {}).map(([k,v]) => `[${luaString(k)}] = ${luaString(v)}`).join(', ')} } }`;
}

// How each raid core decides loot (see the addon's Modules/Loot.lua).
function lootToLua(loot) {
  if (!loot) return ["GuildedLoot = nil"];
  return [
    "GuildedLoot = {",
    `  default = ${luaString(loot.default)},`,
    // Every EP/GP entry needs a raid core: the addon refuses an award with no core chosen.
    `  coreOnly = ${loot.coreOnly ? "true" : "false"},`,
    `  minimumBid = ${Math.max(0, Math.trunc(loot.minimumBid ?? 10))},`,
    "  values = {",
    ...valuesToLua(loot.values, "    "),
    "  },",
    "  cores = {",
    ...(loot.cores ?? []).flatMap((core) => [
      "    {",
      `      id = ${luaString(core.id)}, name = ${luaString(core.name)}, mode = ${luaString(core.mode)}, pool = ${core.separatePool ? "true" : "false"},`,
      `      reserves = ${Math.max(1, Math.trunc(core.reserves ?? 1))}, baseGp = ${Math.max(0, Math.trunc(core.baseGp ?? 0))},`,
      `      offspec = ${Math.max(0, Math.min(100, Math.trunc(core.offspecPercent ?? 50)))}, minEp = ${Math.max(0, Math.trunc(core.minEp ?? 0))},`,
      `      pricing = ${pricingToLua(core.pricing)},`,
      "      values = {",
      ...valuesToLua(core.values, "        "),
      "      },",
      "      players = {",
      ...(core.standings ?? []).map((row) => `        { name = ${luaString(row.character)}, ep = ${Math.trunc(row.ep)}, gp = ${Math.trunc(row.gp)}, account = ${luaString(core.accounts?.[row.character] ?? "")} },`),
      "      },",
      // Who is in the core, by in-game character (a backup character is its own row).
      "      roster = {",
      ...(core.roster ?? []).slice(0, 200).map((row) =>
        `        { name = ${luaString(row.name)}, member = ${luaString(row.member)}, role = ${luaString(row.role)}, spot = ${luaString(row.spot)}, backup = ${row.backup ? "true" : "false"} },`),
      "      },",
      "    },"
    ]),
    "  }",
    "}"
  ];
}

// Season dates (ISO UTC) let the addon tag each recent run with its season.
function seasonDates(board) {
  const iso = (value) => typeof value === "string" && !Number.isNaN(Date.parse(value)) ? luaString(value) : "nil";
  return `startsAt = ${iso(board.startsAt)}, endsAt = ${iso(board.endsAt)}, `;
}

// All-level seasons (rules version 6): the brackets, and each row's bracket key.
const bracketField = row => typeof row.bracket === "string" ? `bracket = ${luaString(row.bracket)}, ` : "";
function bracketList(board) {
  if (!Array.isArray(board.brackets) || !board.brackets.length) return "";
  return `brackets = { ${board.brackets.map(b => `{ key = ${luaString(b.key)}, min = ${Math.trunc(b.min)}, max = ${Math.trunc(b.max)}, bestCount = ${Math.trunc(b.bestCount)} }`).join(", ")} }, `;
}

// This week's board (since the weekly reset), for the addon's Week view. Older addons ignore it.
function weekField(board) {
  const week = board.week;
  if (!week || !Array.isArray(week.rows) || typeof week.startsAt !== "string" || Number.isNaN(Date.parse(week.startsAt))) return "";
  return `week = { startsAt = ${luaString(week.startsAt)}, rows = { ${week.rows.slice(0, 50).map(row => `{ name = ${luaString(row.name)}, ${bracketField(row)}points = ${Math.trunc(row.points)} }`).join(", ")} } }, `;
}

// Serialize only known fields; all names go through the existing Lua string escaper.
// A Lua table field, left out when its value is nil: `{ a = nil }` and `{}` are the same table, so a nil field is only bytes.
const field = (name, value) => value === "nil" ? "" : `${name} = ${value}, `;
const luaTable = (fields) => `{ ${fields.join("").replace(/, $/, "")} }`;
const luaInteger = (n, max = 100000) => Number.isInteger(n) && n >= 0 && n <= max ? n : "nil";
function guidanceToLua(g) {
  if (!g || !Array.isArray(g.routes)) return "nil";
  return luaTable([field("level", luaInteger(g.level)), field("bestCount", luaInteger(g.bestCount)), field("routes", `{ ${g.routes.slice(0, 100).map(r => {
    const n = r.next;
    const next = n ? luaTable([field("durationSec", luaInteger(n.durationSec)), field("gain", luaInteger(n.gain)), field("total", luaInteger(n.total)), field("pushedOut", `{ ${(n.pushedOut ?? []).slice(0, 20).map(luaString).join(", ")} }`)]) : "nil";
    return luaTable([field("key", luaString(r.key)), field("name", luaString(r.name)), field("targetSec", luaInteger(r.targetSec)), field("fit", luaString(r.fit)), field("penaltyPercent", luaInteger(r.penaltyPercent)), field("next", next)]);
  }).join(", ")} }`)]);
}

function ratingDetailsToLua(details) {
  return (details ?? []).map(d => luaTable([field("dungeonKey", luaString(d.dungeonKey ?? String(d.instanceId))), field("instanceId", Math.trunc(d.instanceId)), field("name", luaString(d.name)), field("points", Math.trunc(d.points)),
    field("counted", typeof d.counted === "boolean" ? String(d.counted) : "nil"), field("speedBonus", Math.trunc(d.speedBonus)), field("durationSec", Math.trunc(d.durationSec)), field("targetSec", d.targetSec == null ? "nil" : Math.trunc(d.targetSec)),
    field("runRef", luaString(d.runRef)), field("unrankedReason", d.unrankedReason ? luaString(d.unrankedReason) : "nil"), Number.isInteger(d.penaltyPercent) ? field("penaltyPercent", d.penaltyPercent) : "",
    field("bosses", `{ ${(d.bosses ?? []).map(b => `{ id = ${Math.trunc(b.id)}, name = ${luaString(b.name)}, durationSec = ${Math.trunc(b.durationSec)}, runRef = ${luaString(b.runRef)} }`).join(", ")} }`)]));
}
// A guildmate's runs as the addon reads them (9.4.7, "shrink the board"): `/guilded score <name>` prints each run's name, points,
// speed bonus and time, the guild ranking counts them and the best-N order sorts them by points and key. Their bosses, run
// references, targets and reasons only ever show on the player's own panel, and the officer relay sends only from full profiles.
// Each is one call of the file's local `briefRun`, which builds exactly that table, with the dungeon's name from the file's local
// name list (`names`: name -> position): a dungeon's name is written once instead of once per guildmate.
function briefDetailsToLua(details, names) {
  return (details ?? []).map(d => {
    const name = String(d.name);
    if (!names.has(name)) names.set(name, names.size + 1);
    return `briefRun(${luaString(d.dungeonKey ?? String(d.instanceId))}, ${names.get(name)}, ${Math.trunc(d.points)}, ${Math.trunc(d.speedBonus)}, ${Math.trunc(d.durationSec)})`;
  });
}
// The two file locals brief runs use (before the board's first line; they end with the file).
const briefRunLocals = (names) => [
  `local briefRunNames = { ${[...names.keys()].map(luaString).join(", ")} }`,
  "local function briefRun(dungeonKey, name, points, speedBonus, durationSec) return { dungeonKey = dungeonKey, name = briefRunNames[name], points = points, speedBonus = speedBonus, durationSec = durationSec } end"
];
const profileRoles = (profile) => Array.isArray(profile.roles) ? profile.roles.filter(r => snapshotDungeonRole(r.role)) : null;
function fullProfileToLua(profile) {
  const roles = profileRoles(profile);
  return luaTable([field("name", luaString(profile.name)), field("points", Math.trunc(profile.points)), bracketField(profile), field("characters", `{ ${(profile.characters ?? []).map(luaString).join(", ")} }`),
    field("details", `{ ${ratingDetailsToLua(profile.details).join(", ")} }`),
    field("roles", roles ? `{ ${roles.map(r => luaTable([field("role", luaString(snapshotDungeonRole(r.role))), field("points", Math.trunc(r.points)), field("guidance", guidanceToLua(r.guidance)),
      field("details", `{ ${ratingDetailsToLua(r.details).join(", ")} }`)])).join(", ")} }` : "nil"),
    field("guidance", guidanceToLua(profile.guidance))]);
}
// A guildmate's profile (9.4.7): what any addon (9.4.x included) reads of someone else's profile. Their score, bracket, alts and
// role totals (the unit tooltip), and their runs: complete for an officer (the officer relay answers members without a companion
// from them), brief for a member (marked `brief`; a 9.4.7 officer addon never relays one). Improvement scenarios and per-role runs
// are only ever shown for the player's own characters, so a guildmate's are left out.
function guildmateProfileToLua(profile, officer, names) {
  const roles = profileRoles(profile);
  return luaTable([field("name", luaString(profile.name)), field("points", Math.trunc(profile.points)), bracketField(profile), field("characters", `{ ${(profile.characters ?? []).map(luaString).join(", ")} }`),
    field("details", `{ ${(officer ? ratingDetailsToLua(profile.details) : briefDetailsToLua(profile.details, names)).join(", ")} }`),
    // `details = {}` keeps a role a table the score panel can count, should a profile ever be one of the player's own after all.
    field("roles", roles ? `{ ${roles.map(r => `{ role = ${luaString(snapshotDungeonRole(r.role))}, points = ${Math.trunc(r.points)}, details = {} }`).join(", ")} }` : "nil"),
    officer ? "" : "brief = true, "]);
}

// Names compared the way the addon's character keys are, loosely: lowercase, no realm, single spaces. Loose on purpose (also the
// first word, since older runs and addons store bare first names): a guildmate kept complete by mistake only costs bytes.
const nameKey = (name) => String(name ?? "").normalize("NFC").split("-")[0].trim().replace(/\s+/g, " ").toLowerCase();
const firstWord = (name) => nameKey(name).split(" ")[0];
/**
 * Which profiles of the board are written complete (9.4.7): those of this PC's own characters (every WoW account folder of the
 * install, and the characters the bot holds for the signed-in member). `null` (nothing known about this PC) keeps every profile
 * complete, as before.
 */
export function ownProfileMatcher(names) {
  const keys = new Set(), words = new Set();
  for (const name of names ?? []) {
    const key = nameKey(name);
    if (!key) continue;
    keys.add(key); words.add(firstWord(name));
  }
  if (!keys.size) return null;
  const mine = (name) => keys.has(nameKey(name)) || words.has(firstWord(name));
  return (profile) => mine(profile.name) || (profile.characters ?? []).some(mine);
}

// `shape` (9.4.7): { own: (profile) => boolean, officer } writes guildmates' profiles as guildmateProfileToLua does; without it every
// profile is complete (the public score file, and a PC whose characters are not known yet).
function seasonFields(board, shape, names) {
  if (board.detailsAvailable === undefined) return "";
  const details = (board.profiles ?? []).map(profile => !shape?.own || shape.own(profile) ? fullProfileToLua(profile) : guildmateProfileToLua(profile, shape.officer === true, names));
  const catalog = (board.catalog ?? []).map(d => `{ dungeonKey = ${luaString(d.dungeonKey ?? String(d.instanceId))}, instanceId = ${Math.trunc(d.instanceId)}, name = ${luaString(d.name)}, targetSec = ${d.targetSec == null ? "nil" : Math.trunc(d.targetSec)}, minLevel = ${d.minLevel ?? "nil"}, maxLevel = ${d.maxLevel ?? "nil"}, provisional = ${d.provisional === true ? "true" : "false"}${typeof d.bracket === "string" ? `, bracket = ${luaString(d.bracket)}` : ""} }`);
  return `provisionalTargets = ${board.provisionalTargets === true ? "true" : "false"}, id = ${luaString(board.id ?? "")}, ratingVersion = ${Math.trunc(board.ratingVersion ?? 0)}, detailsAvailable = ${board.detailsAvailable === true ? "true" : "false"}, ${bracketList(board)}profiles = { ${details.join(", ")} }, catalog = { ${catalog.join(", ")} }, `;
}

/** @param {{ own: (profile: any) => boolean, officer?: boolean } | null} [shape] */
export function dungeonBoardToLua(board, updatedAt, variable = "GuildedDungeonBoard", shape = null) {
  if (!board) return [`${variable} = nil`];
  const names = new Map();
  const lines = [
    `${variable} = { season = ${luaString(board.season)}, status = ${luaString(board.status ?? "ACTIVE")}, updatedAt = ${luaString(updatedAt)}, ${seasonDates(board)}${seasonFields(board, shape, names)}${weekField(board)}rows = {`,
    ...board.rows.map(row => `  { name = ${luaString(row.name)}, ${bracketField(row)}points = ${Math.trunc(row.points)} },`),
    "}, history = {",
    ...(board.history ?? []).map(past => ` { season = ${luaString(past.season)}, status = ${luaString(past.status)}, ${seasonDates(past)}${seasonFields(past, shape, names)}rows = { ${past.rows.map(row => `{ name = ${luaString(row.name)}, ${bracketField(row)}points = ${Math.trunc(row.points)} }`).join(", ")} } },`),
    "} }"
  ];
  return names.size ? [...briefRunLocals(names), ...lines] : lines;
}

export function publicScoreToLua(board) {
  return [...dungeonBoardToLua(board, board?.updatedAt ?? "", "GuildedDungeonsPublicScore"),
    ...(board ? [`GuildedDungeonsPublicScore.character = ${luaString(board.character)}`, `GuildedDungeonsPublicScore.realm = ${luaString(board.realm)}`] : [])].join("\n") + "\n";
}

// In game, "Linked to Discord as <name>" once after the first sync (Modules/CompanionLink.lua,
// 8.5 Track L). The companion adds this line for its own signed-in account; only a plain name goes in.
export function linkedAsLua(account) {
  const raw = account && (account.displayName || account.username);
  const plain = (char) => char.charCodeAt(0) >= 32 && char !== '"' && char !== "\\" && char !== "|";
  const name = typeof raw === "string" ? Array.from(raw).filter(plain).join("").trim().slice(0, 40) : "";
  return name ? `GuildedLinkedAs = ${luaString(name)}\n` : "GuildedLinkedAs = nil\n";
}

// Per-character identity in game (9.1.4): GuildedLinked[characterKey] = { discord = "<name>", confirmed = true|false } for THIS
// PC's own characters only, plus GuildedLinkedMeta.updatedAt (the addon ignores a map older than 14 days). The key is the
// character's name in ASCII lowercase with single spaces, as Modules/CompanionLink.lua computes it. `entries` are
// { name, discord?, confirmed }: a confirmed entry carries the member's own Discord name, a reported one none.
export const linkedMapKey = (name) => String(name ?? "").trim().replace(/\s+/g, " ").replace(/[A-Z]/g, (letter) => letter.toLowerCase());
const plainDiscordName = (raw) => typeof raw === "string" ? Array.from(raw).filter((char) => char.charCodeAt(0) >= 32 && char !== '"' && char !== "\\" && char !== "|").join("").trim().slice(0, 40) : "";
export function linkedMapLua(entries, updatedAt) {
  const seen = new Set();
  const lines = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const key = linkedMapKey(entry?.name);
    if (!key || seen.has(key) || key.length > 60 || seen.size >= 24) continue;
    seen.add(key);
    const discord = entry.confirmed === true ? plainDiscordName(entry.discord) : "";
    lines.push(`  [${luaString(key)}] = { ${discord ? `discord = ${luaString(discord)}, ` : ""}confirmed = ${discord ? "true" : "false"} },`);
  }
  return ["GuildedLinked = {", ...lines, "}", `GuildedLinkedMeta = { updatedAt = ${luaString(updatedAt)}, }`, featuresLua(updatedAt), ""].join("\n");
}

// The bot's "ready to promote" list for an OFFICER's addon (Modules/Promotion.lua). Members never receive it.
export function promotionToLua(promotion) {
  const ready = Array.isArray(promotion?.ready) ? promotion.ready.filter(name => typeof name === "string" && name && !/[\t\r\n]/.test(name)).slice(0, 100) : null;
  if (!ready) return ["GuildedPromotion = nil"];
  const waiting = Array.isArray(promotion.waiting) ? promotion.waiting.filter(row => row && typeof row.name === "string" && row.name && !/[\t\r\n]/.test(row.name) && Number.isInteger(row.daysLeft) && row.daysLeft >= 0 && row.daysLeft <= 3650).slice(0, 100) : [];
  const okName = (value, max = 80) => typeof value === "string" && value.length > 0 && value.length <= max && !/[\t\r\n]/.test(value);
  const alts = Array.isArray(promotion.alts) ? promotion.alts.filter(row => row && okName(row.name) && okName(row.main)).slice(0, 200) : [];
  const swaps = Array.isArray(promotion.swaps) ? promotion.swaps.filter(row => row && okName(row.to) && okName(row.from) && row.to !== row.from).slice(0, 50) : [];
  const iso = typeof promotion.updatedAt === "string" && !Number.isNaN(Date.parse(promotion.updatedAt)) ? luaString(promotion.updatedAt) : "nil";
  const days = Number.isInteger(promotion.minDays) && promotion.minDays >= 0 && promotion.minDays <= 3650 ? promotion.minDays : "nil";
  const level = Number.isInteger(promotion.minLevel) && promotion.minLevel >= 0 && promotion.minLevel <= 100 ? promotion.minLevel : 0;
  const voice = Number.isInteger(promotion.minVoiceMinutes) && promotion.minVoiceMinutes >= 0 && promotion.minVoiceMinutes <= 10080 ? promotion.minVoiceMinutes : "nil";
  const link = typeof promotion.requireLink === "boolean" ? String(promotion.requireLink) : "nil";
  return [
    "GuildedPromotion = {",
    `  updatedAt = ${iso}, fromRank = ${typeof promotion.fromRank === "string" ? luaString(promotion.fromRank.slice(0, 40)) : "nil"}, minDays = ${days}, minLevel = ${level}, minVoice = ${voice}, requireLink = ${link},`,
    // Only these members may be offered for promotion in game (Modules/Promotion.lua): never "linked" on its own.
    "  ready = {",
    ...ready.map(name => `    ${luaString(name)},`),
    "  },",
    "  waiting = {",
    ...waiting.map(row => `    { name = ${luaString(row.name)}, daysLeft = ${row.daysLeft}${typeof row.reason === "string" && /^[a-z0-9:,]{1,60}$/.test(row.reason) ? `, reason = ${luaString(row.reason)}` : ""} },`),
    "  },",
    "  alts = {",
    ...alts.map(row => `    { name = ${luaString(row.name)}, main = ${luaString(row.main)} },`),
    "  },",
    "  swaps = {",
    ...swaps.map(row => `    { to = ${luaString(row.to)}, from = ${luaString(row.from)} },`),
    "  }",
    "}"
  ];
}

/** @param {any} data @param {{ own: (profile: any) => boolean, officer?: boolean } | null} [shape] */
export function standingsToLua(data, shape = null) {
  const rows = data.standings.map((row) =>
    `    { name = ${luaString(row.character)}, ${row.displayName ? `displayName = ${luaString(row.displayName)}, ` : ""}ep = ${Math.trunc(row.ep)}, gp = ${Math.trunc(row.gp)}, main = ${row.main ? "true" : "false"}, account = ${luaString(data.accounts?.[row.character] ?? "")} },`
  );
  return [
    "-- Generated by the Guilded companion from the Discord bot. Overwritten",
    "-- automatically; edits here are lost.",
    "GuildedLedgerAccepted = {",
    ...(data.acceptedLedgerRefs ?? []).map((ref) => `  [${luaString(ref)}] = true,`),
    "}",
    "GuildedStandings = {",
    `  updatedAt = ${luaString(data.updatedAt)},`,
    // PR = EP / (GP + baseGp); the addon recomputes PR with this.
    `  baseGp = ${Math.max(0, Math.trunc(data.baseGp ?? 0))},`,
    "  players = {",
    ...rows,
    "  }",
    "}",
    "",
    "-- Dungeon runs the bot has stored; the addon marks these as synced.",
    "GuildedDungeonAccepted = {",
    ...(data.acceptedRunRefs ?? []).map((ref) => `  ${luaString(ref)},`),
    "}",
    // 9.0.8: why a received run earned nothing (a copy of a guildmate's run, not completed, ...).
    "GuildedDungeonNotes = {",
    ...Object.entries(data.runNotes && typeof data.runNotes === "object" ? data.runNotes : {}).slice(0, 300)
      .filter(([, note]) => typeof note === "string" && note)
      .map(([ref, note]) => `  [${luaString(ref)}] = ${luaString(String(note).slice(0, 80))},`),
    "}",
    // 9.3.5: level, guild, score gained and season total of the newest stored runs, for the in-game result card.
    ...runCardsToLua(data.runCards),
    "",
    "-- Dungeon points this season (top 10), for the addon's Dungeons tab.",
    ...dungeonBoardToLua(data.dungeonBoard, data.updatedAt, "GuildedDungeonBoard", shape),
    "",
    "-- Item tooltips: who wishlisted an item and what it usually costs (key = lowercase item name).",
    ...((data.items ?? []).length ? [
      "GuildedItems = {",
      ...data.items.map((item) => `  [${luaString(item.key)}] = { gp = ${item.gp === null || item.gp === undefined ? "nil" : Math.trunc(item.gp)}, n = ${Math.trunc(item.awards ?? 0)}, wn = ${Math.trunc(item.wishTotal ?? 0)}, wish = { ${(item.wish ?? []).map((w) => `{ ${luaString(w.name)}, ${Math.trunc(w.priority)} }`).join(", ")} } },`),
      "}"
    ] : ["GuildedItems = nil"]),
    "",
    "-- Upcoming Discord raids (next three weeks): the addon can make in-game calendar events from them.",
    ...((data.raids ?? []).length ? [
      "GuildedRaids = {",
      ...data.raids.map((raid) => `  { id = ${luaString(raid.id)}, title = ${luaString(raid.title)}, at = ${luaString(raid.at)}, core = ${luaString(raid.core ?? "")}, note = ${luaString(raid.note ?? "")}${raidSignupsToLua(raid.signups)} },`),
      "}"
    ] : ["GuildedRaids = nil"]),
    "",
    "-- How each raid core decides loot: the system, set item prices, own-pool standings.",
    ...publicRaidsToLua(data.publicRaids),
    ...lootToLua(data.loot),
    "",
    "-- Officers only: who the bot says is ready to promote (the in-game Ready to promote panel).",
    ...promotionToLua(data.promotion),
    "",
    "-- The next raid's signed-up players (main characters), for /guilded invite raid.",
    ...(data.nextRaid ? [
      `GuildedNextRaid = { id = ${luaString(data.nextRaid.id)}, title = ${luaString(data.nextRaid.title)}, at = ${luaString(data.nextRaid.scheduledAt)}, core = ${luaString(data.nextRaid.core ?? "")}, coreId = ${luaString(data.nextRaid.coreId ?? "")}, players = {`,
      ...data.nextRaid.players.map((player) => `  { name = ${luaString(player.name)}, role = ${luaString(player.role)} },`),
      "}, maybe = {",
      ...(data.nextRaid.maybe ?? []).map((name) => `  ${luaString(name)},`),
      "} }"
    ] : ["GuildedNextRaid = nil"]),
    "",
    "-- 9.1 guild bank: the guild's last contents (from any member who opened it), items below their",
    "-- minimum, and this member's own requests (Modules/GuildBank.lua).",
    ...guildBankToLua(data.bank),
    "",
    "-- Crafting orders in game: Discord craft requests for the Crafting page (Modules/CraftOrders.lua).",
    ...craftOrdersToLua(data.craftOrders, data.updatedAt),
    "",
    "-- Officers only: names waiting for a guild invite (full Forever names), for the addon's To invite panel.",
    ...(Array.isArray(data.officerInvites) ? [
      `GuildedInvites = { fetchedAt = ${luaString(data.updatedAt ?? "")}, names = {`,
      ...data.officerInvites.slice(0, 30).map((row) => `  { name = ${luaString(row.name)}, at = ${luaString(row.at ?? "")}${typeof row.id === "string" && /^[A-Za-z0-9_-]{8,40}$/.test(row.id) ? `, id = ${luaString(row.id)}` : ""}${Number.isInteger(row.sent) && row.sent > 0 ? `, sent = ${row.sent}` : ""}${typeof row.state === "string" && /^[a-z]{3,12}$/.test(row.state) ? `, state = ${luaString(row.state)}` : ""} },`),
      "} }"
    ] : ["GuildedInvites = nil"]),
    "",
    "-- Officers only: names on the do-not-invite list (names only, no reason), so the invite panels can flag them.",
    ...(Array.isArray(data.officerDni) && data.officerDni.length ? [
      "GuildedDni = { names = {",
      ...data.officerDni.slice(0, 300).filter((name) => typeof name === "string" && name.length > 1 && name.length < 80).map((name) => `  ${luaString(name)},`),
      "} }"
    ] : ["GuildedDni = nil"]),
    ""
  ].join("\n");
}

// Crafting orders: at most 50 (open, claimed, and done in the last day); off when officers turned them off.
export function craftOrdersToLua(orders, updatedAt) {
  if (!orders || typeof orders !== "object") return ["GuildedOrders = nil"];
  const at = luaString(typeof updatedAt === "string" ? updatedAt : "");
  if (orders.enabled === false) return [`GuildedOrders = { at = ${at}, off = true }`];
  const int = (v) => Math.trunc(Number(v) || 0);
  const epochOrNil = (v) => Number.isSafeInteger(v) && v > 0 ? String(v) : "nil";
  const text = (v) => luaString(typeof v === "string" ? v : "");
  const rows = (Array.isArray(orders.orders) ? orders.orders : []).slice(0, 50)
    .filter((o) => o && typeof o.id === "string" && /^[A-Za-z0-9_-]{6,40}$/.test(o.id) && ["OPEN", "CLAIMED", "DONE"].includes(o.status))
    .map((o) => `  { id = ${luaString(o.id)}, ref = ${luaString(typeof o.ref === "string" && /^[A-Za-z0-9_-]{6,40}$/.test(o.ref) ? o.ref : "")}, key = ${Number.isSafeInteger(o.key) && o.key !== 0 ? o.key : "nil"}, item = ${text(o.item)}, qty = ${Math.max(1, int(o.qty))}, `
      + `prof = ${text(o.prof)}, status = ${luaString(o.status)}, by = ${text(o.by)}, crafter = ${text(o.crafter)}, character = ${text(o.character)}, asked = ${text(o.asked)}, `
      + `mats = ${o.mats === true ? "true" : "false"}, note = ${text(o.note)}, at = ${epochOrNil(o.at)}, claimedAt = ${epochOrNil(o.claimedAt)}, doneAt = ${epochOrNil(o.doneAt)} },`);
  return [`GuildedOrders = { at = ${at}, orders = {`, ...rows, "} }"];
}

// The guild bank for the addon: at most 400 items, 30 low rows and 15 requests; nothing when absent.
export function guildBankToLua(bank) {
  if (!bank || typeof bank !== "object") return ["GuildedBank = nil"];
  const int = (v) => Math.trunc(Number(v) || 0);
  const items = (Array.isArray(bank.items) ? bank.items : []).slice(0, 400).filter((i) => i && Number.isInteger(i.id) && i.id > 0)
    .map((i) => `  { id = ${i.id}, name = ${luaString(i.name ?? "")}, count = ${int(i.count)}, tab = ${luaString(i.tab ?? "")}${Number.isInteger(i.q) ? `, q = ${i.q}` : ""} },`);
  const low = (Array.isArray(bank.low) ? bank.low : []).slice(0, 30).filter((r) => r && Number.isInteger(r.itemId))
    .map((r) => `  { itemId = ${r.itemId}, itemName = ${luaString(r.itemName ?? "")}, have = ${int(r.have)}, min = ${int(r.min)} },`);
  const requests = (Array.isArray(bank.requests) ? bank.requests : []).slice(0, 15).filter((r) => r && typeof r.item === "string")
    .map((r) => `  { ref = ${luaString(r.ref ?? "")}, item = ${luaString(r.item)}, count = ${int(r.count)}, status = ${luaString(String(r.status ?? "PENDING").replace(/[^A-Z]/g, ""))}, at = ${int(r.at)} },`);
  return [
    `GuildedBank = { at = ${Number.isInteger(bank.at) ? bank.at : "nil"}, money = ${Number.isSafeInteger(bank.money) ? bank.money : "nil"}, open = ${Number.isInteger(bank.open) ? bank.open : "nil"}, items = {`,
    ...items, "}, low = {", ...low, "}, requests = {", ...requests, "} }"
  ];
}

// Who is down for a raid (bot raids only): { name, role T/H/D, class, status S/M/W, unix time }, at most 40.
export function raidSignupsToLua(signups) {
  if (!Array.isArray(signups) || signups.length === 0) return "";
  const rows = signups.slice(0, 40)
    .filter((row) => row && typeof row.name === "string" && row.name)
    .map((row) => `{ ${luaString(row.name)}, ${luaString(["T", "H", "D"].includes(row.role) ? row.role : "D")}, ${luaString(String(row.class ?? "").replace(/[^A-Z]/g, ""))}, ${luaString(["S", "M", "W"].includes(row.status) ? row.status : "S")}, ${Math.trunc(Number(row.at) || 0)} }`);
  return rows.length ? `, signups = { ${rows.join(", ")} }` : "";
}

// Public summary only: never copy signups, character names or officer notes into this feed.
export function publicRaidsToLua(snapshot) {
  const count = n => Number.isInteger(n) && n > 0 ? Math.min(n, 1000) : 0;
  return [
    `GuildedPublicRaids = { fetchedAt = ${luaString(snapshot?.fetchedAt ?? "")}, raids = {`,
    ...(Array.isArray(snapshot?.raids) ? snapshot.raids : []).slice(0, 100).map(raid =>
      `  { id = ${luaString(raid.id)}, title = ${luaString(raid.title)}, guildName = ${luaString(raid.guildName)}, coreName = ${luaString(raid.coreName ?? "")}, at = ${luaString(raid.scheduledAt)}, realm = ${luaString(raid.realm)}, faction = ${luaString(raid.faction)}, language = ${luaString(raid.language)}, tanks = ${count(raid.spots?.TANK)}, healers = ${count(raid.spots?.HEALER)}, dps = ${count(raid.spots?.DPS)}, signupUrl = ${luaString(raid.signupUrl)}, inviteUrl = ${luaString(raid.inviteUrl)} },`),
    "} }"
  ];
}

