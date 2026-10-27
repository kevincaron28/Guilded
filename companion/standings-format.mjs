import { snapshotDungeonRole } from "./dungeon-role.mjs";
function luaString(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/[\r\n]/g, " ")}"`;
}

// Set item prices as a Lua table body: ["item key"] = gp, plus ["#id"] = gp when the price has an item id.
function valuesToLua(values, indent) {
  const lines = [];
  for (const value of values ?? []) {
    const gp = Math.max(0, Math.trunc(Number(value.gp) || 0));
    lines.push(`${indent}[${luaString(value.key)}] = ${gp},`);
    if (value.id && value.key !== `#${value.id}`) lines.push(`${indent}[${luaString(`#${value.id}`)}] = ${gp},`);
  }
  return lines;
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
function guidanceToLua(g) {
  if (!g || !Array.isArray(g.routes)) return "nil";
  const integer = n => Number.isInteger(n) && n >= 0 && n <= 100000 ? n : "nil";
  return `{ level = ${integer(g.level)}, bestCount = ${integer(g.bestCount)}, routes = { ${g.routes.slice(0, 100).map(r => {
    const n = r.next;
    const next = n ? `{ durationSec = ${integer(n.durationSec)}, gain = ${integer(n.gain)}, total = ${integer(n.total)}, pushedOut = { ${(n.pushedOut ?? []).slice(0, 20).map(luaString).join(", ")} } }` : "nil";
    return `{ key = ${luaString(r.key)}, name = ${luaString(r.name)}, targetSec = ${integer(r.targetSec)}, fit = ${luaString(r.fit)}, penaltyPercent = ${integer(r.penaltyPercent)}, next = ${next} }`;
  }).join(", ")} } }`;
}

function ratingDetailsToLua(details) {
  return (details ?? []).map(d => `{ dungeonKey = ${luaString(d.dungeonKey ?? String(d.instanceId))}, instanceId = ${Math.trunc(d.instanceId)}, name = ${luaString(d.name)}, points = ${Math.trunc(d.points)}, counted = ${typeof d.counted === "boolean" ? String(d.counted) : "nil"}, speedBonus = ${Math.trunc(d.speedBonus)}, durationSec = ${Math.trunc(d.durationSec)}, targetSec = ${d.targetSec == null ? "nil" : Math.trunc(d.targetSec)}, runRef = ${luaString(d.runRef)}, unrankedReason = ${d.unrankedReason ? luaString(d.unrankedReason) : "nil"}, ${Number.isInteger(d.penaltyPercent) ? `penaltyPercent = ${d.penaltyPercent}, ` : ""}bosses = { ${(d.bosses ?? []).map(b => `{ id = ${Math.trunc(b.id)}, name = ${luaString(b.name)}, durationSec = ${Math.trunc(b.durationSec)}, runRef = ${luaString(b.runRef)} }`).join(", ")} } }`);
}
function seasonFields(board) {
  if (board.detailsAvailable === undefined) return "";
  const details = (board.profiles ?? []).map(profile => {
    const runs = ratingDetailsToLua(profile.details);
    const roles = Array.isArray(profile.roles) ? `{ ${profile.roles.filter(r => snapshotDungeonRole(r.role)).map(r =>
      `{ role = ${luaString(snapshotDungeonRole(r.role))}, points = ${Math.trunc(r.points)}, guidance = ${guidanceToLua(r.guidance)}, details = { ${ratingDetailsToLua(r.details).join(", ")} } }`).join(", ")} }` : "nil";
    return `{ name = ${luaString(profile.name)}, points = ${Math.trunc(profile.points)}, ${bracketField(profile)}characters = { ${(profile.characters ?? []).map(luaString).join(", ")} }, details = { ${runs.join(", ")} }, roles = ${roles}, guidance = ${guidanceToLua(profile.guidance)} }`;
  });
  const catalog = (board.catalog ?? []).map(d => `{ dungeonKey = ${luaString(d.dungeonKey ?? String(d.instanceId))}, instanceId = ${Math.trunc(d.instanceId)}, name = ${luaString(d.name)}, targetSec = ${d.targetSec == null ? "nil" : Math.trunc(d.targetSec)}, minLevel = ${d.minLevel ?? "nil"}, maxLevel = ${d.maxLevel ?? "nil"}, provisional = ${d.provisional === true ? "true" : "false"}${typeof d.bracket === "string" ? `, bracket = ${luaString(d.bracket)}` : ""} }`);
  return `provisionalTargets = ${board.provisionalTargets === true ? "true" : "false"}, id = ${luaString(board.id ?? "")}, ratingVersion = ${Math.trunc(board.ratingVersion ?? 0)}, detailsAvailable = ${board.detailsAvailable === true ? "true" : "false"}, ${bracketList(board)}profiles = { ${details.join(", ")} }, catalog = { ${catalog.join(", ")} }, `;
}

export function dungeonBoardToLua(board, updatedAt, variable = "GuildedDungeonBoard") {
  if (!board) return [`${variable} = nil`];
  return [
    `${variable} = { season = ${luaString(board.season)}, status = ${luaString(board.status ?? "ACTIVE")}, updatedAt = ${luaString(updatedAt)}, ${seasonDates(board)}${seasonFields(board)}${weekField(board)}rows = {`,
    ...board.rows.map(row => `  { name = ${luaString(row.name)}, ${bracketField(row)}points = ${Math.trunc(row.points)} },`),
    "}, history = {",
    ...(board.history ?? []).map(past => ` { season = ${luaString(past.season)}, status = ${luaString(past.status)}, ${seasonDates(past)}${seasonFields(past)}rows = { ${past.rows.map(row => `{ name = ${luaString(row.name)}, ${bracketField(row)}points = ${Math.trunc(row.points)} }`).join(", ")} } },`),
    "} }"
  ];
}

export function publicScoreToLua(board) {
  return [...dungeonBoardToLua(board, board?.updatedAt ?? "", "GuildedDungeonsPublicScore"),
    ...(board ? [`GuildedDungeonsPublicScore.character = ${luaString(board.character)}`, `GuildedDungeonsPublicScore.realm = ${luaString(board.realm)}`] : [])].join("\n") + "\n";
}

export function standingsToLua(data) {
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
    "",
    "-- Dungeon points this season (top 10), for the addon's Dungeons tab.",
    ...dungeonBoardToLua(data.dungeonBoard, data.updatedAt),
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
      ...data.raids.map((raid) => `  { id = ${luaString(raid.id)}, title = ${luaString(raid.title)}, at = ${luaString(raid.at)}, core = ${luaString(raid.core ?? "")}, note = ${luaString(raid.note ?? "")} },`),
      "}"
    ] : ["GuildedRaids = nil"]),
    "",
    "-- How each raid core decides loot: the system, set item prices, own-pool standings.",
    ...publicRaidsToLua(data.publicRaids),
    ...lootToLua(data.loot),
    "",
    "-- The next raid's signed-up players (main characters), for /guilded invite raid.",
    ...(data.nextRaid ? [
      `GuildedNextRaid = { id = ${luaString(data.nextRaid.id)}, title = ${luaString(data.nextRaid.title)}, at = ${luaString(data.nextRaid.scheduledAt)}, core = ${luaString(data.nextRaid.core ?? "")}, coreId = ${luaString(data.nextRaid.coreId ?? "")}, players = {`,
      ...data.nextRaid.players.map((player) => `  { name = ${luaString(player.name)}, role = ${luaString(player.role)} },`),
      "}, maybe = {",
      ...(data.nextRaid.maybe ?? []).map((name) => `  ${luaString(name)},`),
      "} }"
    ] : ["GuildedNextRaid = nil"]),
    ""
  ].join("\n");
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

