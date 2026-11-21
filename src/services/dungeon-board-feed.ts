import type { addonDungeonBoard } from "./dungeon-stats.js";

type Board = Awaited<ReturnType<typeof addonDungeonBoard>>;

// The dungeon board as the companion standings feed sends it: `addonDungeonBoard` without the fields no companion or addon has
// ever read (21 Nov 2026, "shrink the board"). The companion copies only named fields into Standings.lua
// (companion/standings-format.mjs), so these were bytes on the wire and nothing else:
//  - per run: `ratingVersion` (the season carries it), `bossesKilled` / `bossesTotal` (bot-side boss-skip scoring);
//  - per guidance: `bracket` (the profile carries it); per route: `bestPoints` and `counted` (the profile's runs carry both),
//    and the scenario's `routePoints`.
// Everything else is kept as it is, so every companion in the field (9.4.x included) writes the same Standings.lua as before.
type Json = Record<string, unknown>;
const without = (value: unknown, keys: readonly string[]): unknown => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const copy: Json = { ...(value as Json) };
  for (const key of keys) delete copy[key];
  return copy;
};
const DETAIL_UNREAD = ["ratingVersion", "bossesKilled", "bossesTotal"] as const;
const runs = (details: unknown) => Array.isArray(details) ? details.map(detail => without(detail, DETAIL_UNREAD)) : details;
function guidance(value: unknown): unknown {
  if (!value || typeof value !== "object" || !Array.isArray((value as Json)["routes"])) return value;
  const g = without(value, ["bracket"]) as Json;
  g["routes"] = (g["routes"] as unknown[]).map(route => {
    const r = without(route, ["bestPoints", "counted"]) as Json;
    if (r["next"] && typeof r["next"] === "object") r["next"] = without(r["next"], ["routePoints"]);
    return r;
  });
  return g;
}
function profile(value: Json): Json {
  return {
    ...value,
    details: runs(value["details"]),
    ...(Array.isArray(value["roles"]) ? { roles: (value["roles"] as Json[]).map(role => ({ ...role, details: runs(role["details"]), guidance: guidance(role["guidance"]) })) } : {}),
    guidance: guidance(value["guidance"])
  };
}
function season<T extends Json>(value: T): T {
  return Array.isArray(value["profiles"]) ? { ...value, profiles: (value["profiles"] as Json[]).map(profile) } : value;
}

export function feedDungeonBoard(board: Board): Board {
  if (!board) return board;
  return { ...season(board as unknown as Json), history: (board.history ?? []).map(past => season(past as unknown as Json)) } as unknown as Board;
}
