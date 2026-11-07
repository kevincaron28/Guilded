import type { Lang } from "../i18n.js";
import { canonicalClass } from "./character-display.js";
import { CLASS_NAMES_FR } from "../permissions.js";
import { canonicalSpecialization } from "../wow-specializations.js";
import type { DungeonImportResult } from "./dungeon-import.js";
import { formatDuration } from "./dungeon-rules.js";
import { difficultyName } from "./dungeon-stats.js";
import { classColor, type DungeonMotif, type DungeonVisual, type ScoreCard } from "./score-card.js";

type Run = DungeonImportResult;
type Detail = NonNullable<Run["playerDetails"]>[number];

/** The party's guild members: flagged by the addon, or matched to a linked character. A member may legitimately earn zero points. */
export function guildPlayers(run: Run): Set<string> {
  const flagged = new Set(run.inGuildPlayers ?? []);
  return new Set(run.players.filter((name) => !run.unlinked.includes(name) || flagged.has(name)));
}

/** "TANK" / "HEALER" / "DPS" (DAMAGER folded into DPS), or undefined when the addon recorded no role. */
export function normalRole(role: string | undefined): "TANK" | "HEALER" | "DPS" | undefined {
  const r = (role ?? "").toUpperCase();
  return r === "TANK" ? "TANK" : r === "HEALER" ? "HEALER" : r === "DPS" || r === "DAMAGER" ? "DPS" : undefined;
}
/** Localized role name: never the raw "HEALER"/"TANK" the addon sends. */
export function roleName(role: string | undefined, lang: Lang): string | undefined {
  const r = normalRole(role);
  return r === "TANK" ? "Tank" : r === "HEALER" ? (lang === "fr" ? "Soigneur" : "Healer") : r === "DPS" ? "DPS" : undefined;
}
export function className(raw: string | undefined, lang: Lang): string | undefined {
  const canonical = canonicalClass(raw);
  return canonical ? (lang === "fr" ? CLASS_NAMES_FR[canonical] ?? canonical : canonical) : raw || undefined;
}

/** The party with duplicates removed, guild first. Without per-player details only names are known. */
export function partyOf(run: Run): { detail: Detail; guild: boolean }[] {
  const members = guildPlayers(run);
  const details: Detail[] = run.playerDetails?.length ? run.playerDetails : run.players.map((character) => ({ character }) as Detail);
  const seen = new Set<string>();
  const unique = details.filter((player) => { const key = player.character.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });
  const rows = unique.map((detail) => ({ detail, guild: members.has(detail.character) }));
  return [...rows.filter((row) => row.guild), ...rows.filter((row) => !row.guild)];
}

/** The last boss killed, by time. Null when the run recorded no named kill. */
export function finalBoss(run: Run): string | null {
  const kills = (run.encounters ?? []).filter((event) => event.success && event.name).sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  return kills.length ? kills[kills.length - 1]!.name ?? null : null;
}

export function runLabel(run: { runRef: string; dungeonName: string; difficultyId: number }): string {
  const difficulty = difficultyName(run.difficultyId);
  const test = run.runRef.startsWith("SIM-") ? "[TEST] " : "";
  return difficulty ? `${test}${run.dungeonName} (${difficulty})` : `${test}${run.dungeonName}`;
}

// Themed backgrounds are generated, not copied art: a two-colour wash plus a simple silhouette motif.
const THEMES: { match: RegExp; a: string; b: string; motif: DungeonMotif }[] = [
  { match: /wailing|lamentations|caverns? des/i, a: "#0e3a2c", b: "#2f7a4d", motif: "cave" },
  { match: /ragefire|ragefeu|fournaise/i, a: "#4a0f06", b: "#d2561a", motif: "fire" },
  { match: /deadmines|mortemine/i, a: "#2c1a0c", b: "#a8682b", motif: "mine" },
  { match: /shadowfang|croc/i, a: "#1e1236", b: "#6a4aa8", motif: "keep" },
  { match: /stockade|prison/i, a: "#1a2330", b: "#4f6a85", motif: "keep" },
  { match: /blackfathom|noirprofondeurs|profondeurs/i, a: "#06293a", b: "#1f7f8f", motif: "sea" },
  { match: /gnomeregan|gnomeregon/i, a: "#182a2e", b: "#4aa5a0", motif: "mine" },
  { match: /razorfen|kraul|ravenne|haillonne/i, a: "#2a2a0c", b: "#8a7a2a", motif: "thorn" },
  { match: /scarlet|[ée]carlate/i, a: "#3a0a12", b: "#b0243a", motif: "keep" },
  { match: /uldaman|maraudon|zul|sunken|engloutis|temple|stratholme|scholomance|blackrock|diremaul|hache-tripes/i, a: "#2a1e0c", b: "#9a7a3a", motif: "cave" }
];
function hashOf(text: string): number { let h = 2166136261; for (const c of text) h = Math.imul(h ^ c.codePointAt(0)!, 16777619); return h >>> 0; }
export function dungeonTheme(name: string): DungeonVisual["theme"] {
  const seed = hashOf(name.toLowerCase());
  const found = THEMES.find((theme) => theme.match.test(name));
  if (found) return { a: found.a, b: found.b, motif: found.motif, seed };
  // Unknown dungeon: a stable hue from its name, so it always looks the same.
  const hue = seed % 360, motifs: DungeonMotif[] = ["cave", "keep", "mine", "thorn"];
  return { a: `hsl(${hue} 55% 12%)`, b: `hsl(${(hue + 25) % 360} 50% 36%)`, motif: motifs[seed % motifs.length]!, seed };
}

/**
 * The death positions worth drawing: a dungeon has several floors (uiMapIDs) and points on different maps cannot share one
 * grid, so only the map with the most deaths is drawn. Empty when the run recorded none.
 */
export function deathPointsOf(run: Run): { x: number; y: number }[] {
  const points = run.deathPoints ?? [];
  const counts = new Map<number, number>();
  for (const point of points) counts.set(point.map, (counts.get(point.map) ?? 0) + 1);
  const best = [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
  return points.filter((point) => point.map === best).map(({ x, y }) => ({ x, y }));
}

export interface DungeonCardOptions {
  /** Death positions as 0..1 map coordinates, when the addon recorded them (see docs/DUNGEON_CARDS.md). */
  deathPoints?: { x: number; y: number }[];
}

/**
 * The completion card for one run: dungeon art, time, final boss, deaths and the whole party with full names,
 * class colour, role icon and an "outside the guild" mark. Plain data, so it can be queued and drawn on delivery.
 */
export function dungeonRunCard(run: Run, lang: Lang, options: DungeonCardOptions = {}): ScoreCard {
  const fr = lang === "fr";
  const t = (en: string, french: string) => fr ? french : en;
  const party = partyOf(run);
  const deathPoints = options.deathPoints?.length ? options.deathPoints : deathPointsOf(run);
  const tracked = party.filter((row) => row.detail.deaths !== null && row.detail.deaths !== undefined).length;
  const totalDeaths = party.reduce((sum, row) => sum + (row.detail.deaths ?? 0), 0);
  const boss = finalBoss(run);
  const date = run.endedAt ? new Date(run.endedAt * 1000).toISOString().slice(0, 10) : undefined;
  const members = party.filter((row) => row.guild).length;
  const mark = run.challenge ? `Mythic+ +${run.challenge.level}` : undefined;
  return {
    eyebrow: t("Guilded · Dungeon completed", "Guilded · Donjon terminé"),
    title: runLabel(run).replace(/ \(.*\)$/, ""),
    subtitle: [difficultyName(run.difficultyId), mark, date].filter(Boolean).join(" · "),
    stats: [
      { label: t("Time", "Temps"), value: formatDuration(run.durationSec ?? 0), accent: "gold",
        note: run.completedBy === "final boss" ? t("Final boss defeated", "Boss final vaincu") : run.completedBy === "manual" ? t("Completed manually", "Fin manuelle") : undefined },
      { label: t("Final boss", "Boss final"), value: boss ?? "—", accent: "green" },
      { label: t("Deaths", "Morts"), value: tracked ? String(totalDeaths) : "—", accent: totalDeaths ? "red" : "green",
        note: tracked && tracked < party.length ? t(`${tracked}/${party.length} tracked`, `${tracked}/${party.length} suivis`) : tracked ? undefined : t("Not tracked", "Non suivies") }
    ],
    rowsLabel: t(`Party · ${members} from the guild`, `Groupe · ${members} de la guilde`),
    badges: run.guildRecord ? [{ text: t("New guild record", "Nouveau record de guilde"), tone: "ok" }] : [],
    footer: t("Guilded · Dungeon run as recorded by the party's addons · guilded.kcaron.top", "Guilded · Donjon noté par les addons du groupe · guilded.kcaron.top"),
    dungeon: {
      theme: dungeonTheme(run.dungeonName),
      party: party.slice(0, 40).map(({ detail, guild }) => {
        const cls = canonicalClass(detail.class);
        const spec = canonicalSpecialization(cls, detail.spec);
        const deaths = detail.deaths === null || detail.deaths === undefined ? undefined : fr ? `${detail.deaths} mort(s)` : `${detail.deaths} death(s)`;
        return {
          name: run.fullNames?.[detail.character] ?? detail.character,
          color: classColor(cls ?? detail.class),
          role: normalRole(detail.role),
          roleLabel: roleName(detail.role, lang),
          sub: [className(detail.class, lang), spec ? (fr ? spec.french : spec.name) : undefined, deaths].filter(Boolean).join(" · "),
          guild
        };
      }),
      mapKey: run.dungeonName.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
      guildLabel: t("Guild", "Guilde"), outsiderLabel: t("Outside guild", "Hors guilde"), moreLabel: t("more", "autres"),
      ...(deathPoints.length ? { deathPoints: deathPoints.slice(0, 200), deathMapLabel: t("Where the party fell", "Où le groupe est tombé") } : {})
    }
  };
}
