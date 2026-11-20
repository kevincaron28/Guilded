import type { Lang } from "../i18n.js";
import { BETA_DUNGEONS } from "./dungeon-beta-preset.js";
import { SEASON2_ENDGAME_ROUTES } from "./dungeon-endgame-routes.js";
import { novemberDungeonCatalog } from "./dungeon-november-catalog.js";
import { ROUTE_BOSSES } from "./dungeon-bosses.js";

// One place for dungeon names. A run stores the name the UPLOADER's client reported (a French client says "Mortemines"), so a card or
// table must never print run.dungeonName in another language than the page. The canonical English name comes from the instance (and
// route) id; frenchDungeon translates it when the page is French. Nothing here imports the card code, so cards and tables share it.

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

/** The canonical English name of a route key ("189:library") when known. */
export const routeEnglishName = (routeKey: string | null | undefined): string | undefined => routeKey ? byRoute.get(routeKey) : undefined;
/** The canonical English name of a map id (the map's own name for wing maps) when known. */
export const instanceEnglishName = (instanceId: number | null | undefined): string | undefined => instanceId === undefined || instanceId === null ? undefined : byInstance.get(instanceId);

/** Every English dungeon name Guilded knows (routes and maps), for the French-table test. */
export function allEnglishDungeonNames(): string[] {
  const names = new Set<string>([...byRoute.values(), ...byInstance.values(), ...catalog.values()]);
  return [...names].sort();
}

// French names. Source: Wowhead's French names for WoW Forever as compiled at kami-labs.fr (donjons-raids-wow-forever, 16 Nov 2026);
// the classic ones are the long-standing French client names. A name not verified keeps its English name: UNVERIFIED_FRENCH.
const FRENCH_NAMES: [string[], string][] = [
  [["Ragefire Chasm"], "Gouffre de Ragefeu"],
  [["The Hall of Thanes", "Hall of Thanes"], "La Salle des thanes"],
  [["Wailing Caverns", "The Wailing Caverns"], "Cavernes des lamentations"],
  [["Ruins of Lordaeron", "The Ruins of Lordaeron"], "Ruines de Lordaeron"],
  [["The Deadmines", "Deadmines"], "Les Mortemines"],
  [["Shadowfang Keep"], "Donjon d'Ombrecroc"],
  [["The Stockade", "Stormwind Stockade"], "La Prison"],
  [["Blackfathom Deeps"], "Profondeurs de Brassenoire"],
  [["Razorfen Downs"], "Souilles de Tranchebauge"],
  [["Razorfen Kraul"], "Kraal de Tranchebauge"],
  [["Excavation Site: Wetlands", "Excavation Site"], "Site de fouilles des Paluns"],
  [["Scarlet Monastery"], "Monastère Écarlate"],
  [["City of Dalaran"], "Cité de Dalaran"],
  [["Gnomeregan"], "Gnomeregan"],
  [["Uldaman"], "Uldaman"],
  [["The Drowned City", "Drowned City"], "La Cité engloutie"],
  [["Temple of Atal'Hakkar (Sunken Temple)", "The Temple of Atal'Hakkar", "Temple of Atal'Hakkar", "Sunken Temple"], "Le Temple d'Atal'Hakkar"],
  [["Zul'Farrak"], "Zul'Farrak"],
  [["Maraudon"], "Maraudon"],
  [["Blackrock Depths"], "Profondeurs de Rochenoire"],
  [["Lower Blackrock Spire"], "Bas du pic Rochenoire"],
  [["Upper Blackrock Spire"], "Sommet du pic Rochenoire"],
  [["Blackrock Spire"], "Pic Rochenoire"],
  [["Dire Maul"], "Hache-tripes"],
  [["Scholomance"], "Scholomance"],
  [["Stratholme"], "Stratholme"],
  [["Blackmaw Hold"], "Repaire des Noiregueules"],
  [["Shaper's Terrace"], "Terrasse du Façonneur"]
];
/** Catalog dungeons whose French name is not verified yet: they keep the English name on French pages. */
export const UNVERIFIED_FRENCH: readonly string[] = ["Krol'dok Stronghold", "Alcaz Prison"];

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Longest name first so "Lower Blackrock Spire" wins over "Blackrock Spire".
const FRENCH_DUNGEONS: [RegExp, string][] = FRENCH_NAMES.flatMap(([names, french]) => names.map((name): [string, string] => [name, french]))
  .sort((a, b) => b[0].length - a[0].length).map(([name, french]) => [new RegExp(`^(?:The )?${escapeRe(name.replace(/^The /, ""))}(?![\\p{L}\\p{N}])`, "iu"), french]);

/** Wings and gates after the map name, English to French. */
export const FRENCH_WING: Record<string, string> = { Graveyard: "Cimetière", Library: "Bibliothèque", Armory: "Armurerie", Cathedral: "Cathédrale",
  East: "Est", West: "Ouest", North: "Nord", "Main Gate": "Porte principale", "Service Gate": "Porte de service", Upper: "Haut", Lower: "Bas" };
const WING_TAIL = new RegExp(`^: (${Object.keys(FRENCH_WING).map(escapeRe).join("|")})(?![\\p{L}])`, "u");

/** True when the English name (or its map) has a French name in the table. */
export const hasFrenchName = (english: string): boolean => FRENCH_DUNGEONS.some(([match]) => match.test(english));

/** The French name of an English dungeon title ("Name", "Name: Wing", "Name (Difficulty)"); a title already in French or unknown stays as it is. */
export function frenchDungeon(title: string, lang: Lang): string {
  if (lang !== "fr") return title;
  const found = FRENCH_DUNGEONS.find(([match]) => match.test(title));
  if (!found) return title;
  const rest = title.replace(found[0], "");
  const wing = WING_TAIL.exec(rest);
  return `${found[1]}${wing ? ` : ${FRENCH_WING[wing[1]!]}${rest.slice(wing[0].length)}` : rest}`;
}

const plain = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const stripArticle = (text: string) => text.replace(/^(?:les|la|le|l'|the)\s*/i, "");
// French name (accent- and article-insensitive) to the first English name of its row, longest first.
const ENGLISH_BY_FRENCH: [string, string][] = FRENCH_NAMES.map(([names, french]): [string, string] => [plain(stripArticle(french)), names[0]!])
  .sort((a, b) => b[0].length - a[0].length);
const ENGLISH_WING_BY_FRENCH = Object.entries(FRENCH_WING).map(([en, fr]): [string, string] => [plain(fr), en]);

/** The English name of a dungeon title as a French client uploads it ("Mortemines", "Monastere Ecarlate : Cimetiere"); an English or unknown title stays as it is. Display always uses English. */
export function englishDungeon(title: string): string {
  const base = stripArticle(title.trim());
  const key = plain(base);
  const found = ENGLISH_BY_FRENCH.find(([fr]) => key.startsWith(fr) && !/[\p{L}\p{N}]/u.test(key.charAt(fr.length)));
  if (!found) return title;
  const rest = key.slice(found[0].length);
  const wing = /^\s*:\s*(.+)$/.exec(rest);
  if (!wing) return rest.trim() ? `${found[1]}${rest}` : found[1];
  const hit = ENGLISH_WING_BY_FRENCH.find(([fr]) => plain(wing[1]!).startsWith(fr));
  return hit ? `${found[1]}: ${hit[1]}${wing[1]!.slice(hit[0].length)}` : title;
}
