import { addonDungeonBoard } from "../../src/services/dungeon-stats.js";
import { dungeonBoardFixture } from "./dungeon-board-fixture.js";

/** The fixture board (an active all-level season with roles and scenarios) with boss records on some runs, as production has. */
export async function sizedBoard(chars = 24, runs = 140) {
  const { database } = dungeonBoardFixture(chars, runs);
  const board = (await addonDungeonBoard(database as never, "g", new Date("2026-11-20T12:00:00Z")))!;
  let n = 0;
  const bosses = (detail: { runRef: string }) => (n++ % 2 ? [] : [1, 2, 3].map(id => ({ id: 1000 + id, name: `Boss "${id}"`, durationSec: 100 * id, runRef: detail.runRef })));
  for (const profile of board.profiles) {
    for (const detail of profile.details) detail.bosses = bosses(detail);
    for (const role of profile.roles ?? []) for (const detail of role.details) detail.bosses = bosses(detail);
  }
  return board;
}

/** A Lua function that writes any value as canonical text (sorted keys), to compare two loaded files table for table. */
export const LUA_DUMP = String.raw`
function DUMP(v)
  local t = type(v)
  if t == "table" then
    local keys = {}
    for k in pairs(v) do keys[#keys + 1] = k end
    table.sort(keys, function(a, b) return tostring(a) < tostring(b) end)
    local out = {}
    for _, k in ipairs(keys) do out[#out + 1] = tostring(k) .. "=" .. DUMP(v[k]) end
    return "{" .. table.concat(out, ",") .. "}"
  elseif t == "string" then return string.format("%q", v) end
  return tostring(v)
end`;
