import type { PrismaClient } from "../generated/prisma/client.js";
import { escapeHtml as h } from "./web-layout.js";
import { healthCharacters, LEVEL_BANDS } from "./guild-health.js";
import { classColor, type ScoreCard } from "./score-card.js";
import { localClassName } from "./character-display.js";
import { professionName } from "./profession-style.js";

// 8.5 track C3: the visual guild roster. One data object (class counts by level band, a profession grid) drawn two
// ways: a share-card image (score-card.ts, shown by /report guild) and inline SVG charts on the roster dashboard.
// The class and level numbers come from the same query and the same level bands as /report guild (guild-health.ts),
// so the picture and the text always agree.

export interface RosterVisualClass { name: string; color: string; total: number; byBand: number[] }
export interface RosterVisualProfession { name: string; crafters: number; maxSkill: number }
export interface RosterVisual {
  characters: number;
  members: number;
  bands: string[];
  classes: RosterVisualClass[];
  /** Characters with no level reported (not in any band, as in /report guild). */
  unknownLevel: number;
  professions: RosterVisualProfession[];
}

// Forever's professions, in the order the grid shows them. A profession nobody has is a gap (0 crafters).
export const GRID_PROFESSIONS = ["Alchemy", "Blacksmithing", "Enchanting", "Engineering", "Herbalism", "Leatherworking", "Mining", "Skinning", "Tailoring", "Cooking", "First Aid", "Fishing"];

export function buildRosterVisual(
  characters: readonly { className: string; level: number | null }[],
  skills: readonly { profession: string; skillLevel: number; characterId: string }[],
  members: number
): RosterVisual {
  const byClass = new Map<string, RosterVisualClass>();
  for (const character of characters) {
    const name = character.className;
    if (!name) continue;
    const entry = byClass.get(name) ?? { name, color: classColor(name), total: 0, byBand: LEVEL_BANDS.map(() => 0) };
    entry.total++;
    const band = character.level === null ? -1 : LEVEL_BANDS.findIndex(([, low, high]) => character.level! >= low && character.level! <= high);
    if (band >= 0) entry.byBand[band]!++;
    byClass.set(name, entry);
  }
  const classes = [...byClass.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const professions = new Map<string, { name: string; people: Set<string>; maxSkill: number }>();
  for (const name of GRID_PROFESSIONS) professions.set(name.toLowerCase(), { name, people: new Set(), maxSkill: 0 });
  for (const skill of skills) {
    const key = skill.profession.trim().toLowerCase();
    if (!key) continue;
    const entry = professions.get(key) ?? { name: skill.profession.trim(), people: new Set<string>(), maxSkill: 0 };
    entry.people.add(skill.characterId);
    entry.maxSkill = Math.max(entry.maxSkill, skill.skillLevel);
    professions.set(key, entry);
  }
  const grid = [...professions.values()].map((entry) => ({ name: entry.name, crafters: entry.people.size, maxSkill: entry.maxSkill }));
  const order = new Map(GRID_PROFESSIONS.map((name, index) => [name.toLowerCase(), index]));
  grid.sort((a, b) => (order.get(a.name.toLowerCase()) ?? 99) - (order.get(b.name.toLowerCase()) ?? 99) || a.name.localeCompare(b.name));
  return {
    characters: characters.length, members, bands: LEVEL_BANDS.map(([label]) => label), classes,
    unknownLevel: characters.filter((c) => c.level === null).length, professions: grid
  };
}

export async function loadRosterVisual(db: Pick<PrismaClient, "character" | "professionSkill" | "member">, guildId: string): Promise<RosterVisual> {
  const [characters, skills, members] = await Promise.all([
    healthCharacters(db, guildId),
    db.professionSkill.findMany({ where: { character: { member: { guildId, status: "ACTIVE", isTest: false } } }, select: { profession: true, skillLevel: true, characterId: true } }),
    db.member.count({ where: { guildId, isTest: false, status: { not: "LEFT" } } })
  ]);
  return buildRosterVisual(characters, skills, members);
}

const BAND_OPACITY = [0.35, 0.55, 0.78, 1];

/** The share card (1200x630): class rows with level-band segments on the left, the profession grid on the right. */
export function rosterVisualCard(visual: RosterVisual, lang: "en" | "fr", title: string): ScoreCard {
  const fr = lang === "fr";
  return {
    eyebrow: "Guilded", title, subtitle: fr ? `${visual.characters} personnages · ${visual.members} membres` : `${visual.characters} characters · ${visual.members} members`,
    stats: [{ label: fr ? "Personnages" : "Characters", value: String(visual.characters) }], footer: fr ? "Personnages liés des membres actifs · mêmes chiffres que /report guild" : "Linked characters of active members · same numbers as /report guild",
    // Class and profession names in the guild's language (the data keeps the English names).
    roster: { ...visual, classes: visual.classes.map(c => ({ ...c, name: localClassName(c.name, lang) })), professions: visual.professions.map(p => ({ ...p, name: professionName(p.name, lang) })) },
    backdrop: { kind: "roster", key: "default" },
    rosterProfessionsLabel: fr ? "Métiers · artisans et compétence max" : "Professions · crafters and top skill"
  };
}

/** Inline SVG charts for the roster dashboard (no script: the page's content policy allows none). */
export function rosterVisualSvg(visual: RosterVisual, lang: "en" | "fr"): string {
  const fr = lang === "fr";
  const rowH = 26, left = 120, barW = 420, top = 28;
  const max = Math.max(1, ...visual.classes.map((c) => c.total));
  const chartH = top + Math.max(1, visual.classes.length) * rowH + 8;
  const classRows = visual.classes.map((c, index) => {
    const y = top + index * rowH;
    let x = left;
    const segments = c.byBand.map((count, band) => {
      const w = Math.round((count / max) * barW);
      const rect = count ? `<rect x="${x}" y="${y}" width="${w}" height="18" fill="${c.color}" fill-opacity="${BAND_OPACITY[band] ?? 1}"><title>${h(c.name)} ${h(visual.bands[band] ?? "")}: ${count}</title></rect>` : "";
      x += w;
      return rect;
    }).join("");
    return `<text x="${left - 8}" y="${y + 14}" text-anchor="end" font-size="13" fill="currentColor">${h(c.name)}</text>${segments}<text x="${x + 6}" y="${y + 14}" font-size="12" fill="currentColor">${c.total}</text>`;
  }).join("");
  const legend = visual.bands.map((band, i) => `<rect x="${left + i * 90}" y="6" width="12" height="12" fill="#c79c6e" fill-opacity="${BAND_OPACITY[i] ?? 1}"/><text x="${left + i * 90 + 17}" y="16" font-size="12" fill="currentColor">${h(band)}</text>`).join("");
  const classChart = `<svg role="img" aria-label="${fr ? "Personnages par classe et tranche de niveau" : "Characters by class and level band"}" viewBox="0 0 ${left + barW + 60} ${chartH}" width="100%" style="max-width:640px">${legend}${classRows || `<text x="${left}" y="${top + 14}" font-size="13" fill="currentColor">${fr ? "Aucun personnage" : "No characters"}</text>`}</svg>`;
  const tile = 150, gap = 8, cols = 4;
  const tiles = visual.professions.map((p, i) => {
    const x = (i % cols) * (tile + gap), y = Math.floor(i / cols) * 56;
    const gapTile = p.crafters === 0;
    return `<rect x="${x}" y="${y}" width="${tile}" height="48" rx="6" fill="${gapTile ? "#7a1f14" : "#2e4a2a"}" fill-opacity=".35" stroke="${gapTile ? "#ff6a52" : "#6fdc4f"}"/>`
      + `<text x="${x + 8}" y="${y + 19}" font-size="13" font-weight="bold" fill="currentColor">${h(p.name)}</text>`
      + `<text x="${x + 8}" y="${y + 38}" font-size="12" fill="currentColor">${gapTile ? (fr ? "aucun artisan" : "no crafter") : `${p.crafters} ${fr ? "artisan(s)" : p.crafters === 1 ? "crafter" : "crafters"} · ${p.maxSkill}`}</text>`;
  }).join("");
  const rows = Math.ceil(Math.max(1, visual.professions.length) / cols);
  const grid = `<svg role="img" aria-label="${fr ? "Métiers de la guilde" : "Guild professions"}" viewBox="0 0 ${cols * (tile + gap)} ${rows * 56}" width="100%" style="max-width:640px">${tiles}</svg>`;
  return `<section class="card"><h2>${fr ? "Classes par tranche de niveau" : "Classes by level band"}</h2>${classChart}<p>${fr ? "Personnages sans niveau connu" : "Characters with no level reported"}: ${visual.unknownLevel}</p></section>`
    + `<section class="card"><h2>${fr ? "Métiers (artisans · compétence max)" : "Professions (crafters · top skill)"}</h2>${grid}</section>`;
}
