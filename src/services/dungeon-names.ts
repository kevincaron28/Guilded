import type { Lang } from "../i18n.js";
import { BETA_DUNGEONS } from "./dungeon-beta-preset.js";
import { dungeonDisplayName, frenchDungeon } from "./dungeon-card.js";
import { SEASON2_ENDGAME_ROUTES } from "./dungeon-endgame-routes.js";
import { novemberDungeonCatalog } from "./dungeon-november-catalog.js";
import { ROUTE_BOSSES } from "./dungeon-bosses.js";

// A dungeon's name in the page language. A run stores the name the UPLOADER's client reported (a French client says "Mortemines"), so a
// public table that shows run.dungeonName shows the first uploader's language. The canonical English name comes from the instance
// (and route) id, then frenchDungeon translates it when the page is French.

const byInstance = new Map<number, string>();
const byRoute = new Map<string, string>();
const sharedMap = (instanceId: number) => ROUTE_BOSSES.filter(r => r.instanceId === instanceId).length > 1;
for (const r of ROUTE_BOSSES) { byRoute.set(r.key, r.name); if (!sharedMap(r.instanceId)) byInstance.set(r.instanceId, r.name); }
for (const d of BETA_DUNGEONS) { byRoute.set(d.key, d.name); if (!d.key.includes(":")) byInstance.set(d.instanceId, d.name); }
const catalog = new Map(novemberDungeonCatalog().routes.map(r => [r.id, r.name]));
for (const r of SEASON2_ENDGAME_ROUTES) {
  const name = catalog.get(r.planId);
  if (!name) continue;
  byRoute.set(r.key, name);
  if (!r.key.includes(":")) byInstance.set(r.instanceId, name);
}
// Maps shared by several routes have one name for the map itself when the wing is unknown.
byInstance.set(189, "Scarlet Monastery"); byInstance.set(229, "Blackrock Spire"); byInstance.set(429, "Dire Maul"); byInstance.set(329, "Stratholme");

type Encounters = readonly { name?: string | undefined; success?: boolean | undefined }[];
interface NamedRun { instanceId: number; dungeonName: string; routeKey?: string | null | undefined; evidence?: { encounters?: readonly unknown[] | undefined } | null }

/** The canonical English name of the dungeon (or route); the uploaded name only when the instance is unknown. */
export function englishDungeonName(run: NamedRun): string {
  const key = run.routeKey ? byRoute.get(run.routeKey) : undefined;
  if (key) return key;
  const base = byInstance.get(run.instanceId) ?? run.dungeonName;
  // Scarlet Monastery: the wing from the boss kills, like the dungeon cards.
  return dungeonDisplayName({ dungeonName: base, encounters: run.evidence?.encounters as Encounters }, "en");
}

/** The dungeon's name in the page language, whichever language the uploader's client used. */
export function localDungeonName(run: NamedRun, lang: Lang): string {
  const english = englishDungeonName(run);
  if (lang !== "fr") return english;
  const wing = /^(.*): (Graveyard|Library|Armory|Cathedral)$/.exec(english);
  return wing ? `${frenchDungeon(wing[1]!, "fr")} : ${FRENCH_WING[wing[2]!]}` : frenchDungeon(english, "fr");
}
const FRENCH_WING: Record<string, string> = { Graveyard: "Cimetière", Library: "Bibliothèque", Armory: "Armurerie", Cathedral: "Cathédrale" };
