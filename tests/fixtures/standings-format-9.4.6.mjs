// The dungeon board serializer exactly as companion 9.4.6 shipped it (companion/standings-format.mjs at cb2fa541): the golden
// reference of tests/dungeon-board-size.test.ts and tests/lua/dungeon-board-size.test.ts. Do not edit.
import { snapshotDungeonRole } from "../../companion/dungeon-role.mjs";
function luaString(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/[\r\n]/g, " ")}"`;
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
