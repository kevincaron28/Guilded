import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { localClassName, localRaceName } from "../src/services/character-display.js";
import { achievementUnlockedCard, cardName, raidEndCard, serverAnniversaryCard } from "../src/services/end-cards.js";
import { characterWithMember } from "../src/services/dungeon-stats.js";
import { hallCard, raceCard } from "../src/services/race-board.js";
import { buildReadinessLines, queueDailyReadiness } from "../src/services/readiness-board.js";
import { rosterVisualCard, buildRosterVisual } from "../src/services/roster-visual.js";
import { scoreCardPng, type ScoreCard } from "../src/services/score-card.js";
import { ACTIVE_ACHIEVEMENTS } from "../src/services/achievements-catalogue.js";
import { serverStatsCard } from "../src/services/stats-card.js";

// The 9.0.4 polish pass after reading the live Discord: cards that failed to draw, text that ran past its panel,
// English words on French cards and posts, and names shown twice or as a bare Discord tag.

const at = new Date("2026-11-07T14:00:00Z");
const pixelsDiffer = async (a: Buffer, b: Buffer) => Buffer.compare(await sharp(a).raw().toBuffer(), await sharp(b).raw().toBuffer()) !== 0;

describe("cards that used to fail", () => {
  it("draws a value the card font cannot show (an emoji alone) instead of failing the whole card", async () => {
    const card = serverAnniversaryCard({ serverName: "⚜Quebec Gold⚜", years: 2, founded: new Date("2024-11-07"), members: 40, achievementsEarned: 12,
      oldestMembers: [{ displayName: "Mélodie Gagnon", createdAt: new Date("2024-11-07") }] }, "fr");
    expect(card.rows?.[0]?.right).toBe("🎂");
    expect(await scoreCardPng(card)).not.toBeNull();
  });
  it("draws /stats server, whose bar column has no header", async () => {
    const day = { day: "2026-11-06", discordMembers: 140, activeMembers: 60, linkedMembers: 30, rosterSize: 120, onlinePeak: 20, level60: 2, messages: 1, voiceMinutes: 1, raids: 0, dungeonRuns: 3,
      levelBands: {}, classCounts: { Warlock: 16, Shaman: 15 } };
    const card = serverStatsCard([day], "Quebec Gold", "fr")!;
    expect(card.ladder!.boards[0]!.rows.map(row => row.name)).toEqual(["Démoniste", "Chaman"]);
    expect(await scoreCardPng(card)).not.toBeNull();
  }, 20_000);
});

describe("text stays inside its space", () => {
  it("keeps a long title out of the achievements panel: it is drawn smaller or cut, never wider", async () => {
    const plain = (name: string): ScoreCard => ({ ...achievementUnlockedCard(name, ACTIVE_ACHIEVEMENTS.slice(0, 2).map(def => def.id), 2, "en"), footer: "" });
    // The header column is 500 px wide: past it, a longer title must not change a single pixel of the right panel.
    const short = await scoreCardPng(plain("Kev")), long = await scoreCardPng(plain("Johnnysinz Johnnysinzington the Unstoppable"));
    const panel = async (png: Buffer) => sharp(png).extract({ left: 560, top: 20, width: 600, height: 150 }).raw().toBuffer();
    expect(Buffer.compare(await panel(short!), await panel(long!))).toBe(0);
  }, 20_000);
  it("drops a nickname's bracketed part on a celebration card once the name is long", () => {
    expect(cardName("Banished Zakarum (Banished Zakarum)")).toBe("Banished Zakarum");
    expect(cardName("Détergents (Déter Gents)")).toBe("Détergents (Déter Gents)");
    expect(cardName("  Kev  ")).toBe("Kev");
    expect(achievementUnlockedCard("Banished Zakarum (Banished Zakarum)", [], 0, "fr").title).toBe("Banished Zakarum");
  });
});

describe("French cards speak French", () => {
  it("names classes and races in French", () => {
    expect(localClassName("WARLOCK", "fr")).toBe("Démoniste");
    expect(localClassName("Priest", "en")).toBe("Priest");
    expect(localClassName("Something new", "fr")).toBe("Something new");
    expect(localRaceName("Night Elf", "fr")).toBe("Elfe de la nuit");
    expect(localRaceName("Scourge", "fr")).toBe("Mort-vivant");
    expect(localRaceName("Undead", "en")).toBe("Undead");
  });
  it("puts French class, race and profession names on the race board and the Hall of Fame card", () => {
    const row = { key: "k", name: "Hulke Hogan", className: "Druid", race: "Tauren", level: 24, reachedMaxAt: null, firstSeenAt: at, weekGain: 6, memberId: null, discordId: null, professions: [], lastSeenAt: at };
    const card = raceCard({ rows: [row], total: 1, finished: 0, edition: "forever" }, "fr", 50, new Map(), at);
    expect(card.ladder!.boards[0]!.rows[0]!.sub).toBe("Druide · Tauren");
    expect(raceCard({ rows: [], total: 0, finished: 0, edition: "forever" }, "fr", 50, new Map(), at).ladder!.empty).toContain("Aucun personnage");
    const hall = hallCard({ order: 1, name: "Grok Solidtusk", className: "Warrior", race: "Orc", reachedAt: at, firstSeenAt: at, professions: "Mining 300, Blacksmithing 285", memberDiscordId: null }, "fr");
    expect(hall.subtitle).toBe("Guerrier Orc · niveau 60");
    expect(hall.rows!.map(r => r.name)).toEqual(["Guerrier", "Minage", "Forge"]);
  });
  it("names classes and professions in French on the roster card", () => {
    const card = rosterVisualCard(buildRosterVisual([{ className: "Warlock", level: 30 }], [{ profession: "Leatherworking", skillLevel: 80, characterId: "a" }], 1), "fr", "QG");
    expect(card.roster!.classes.map(c => c.name)).toContain("Démoniste");
    expect(card.roster!.professions.map(p => p.name)).toContain("Travail du cuir");
  });
  it("writes one absent, not 'absents'", () => {
    const report = { title: "Raid", startedAt: at, endedAt: at, durationMinutes: 60, raiders: 10, late: 0, absent: 1, bossesKilled: 1, bossesPlanned: 1, killedNames: [], epAwarded: 0, epRecipients: 0, lootCount: 0, gpSpent: 0, topLoot: [] };
    expect(raidEndCard(report, "fr").stats[2]!.note).toBe("1 absent");
    expect(raidEndCard({ ...report, absent: 3 }, "fr").stats[2]!.note).toBe("3 absents");
  });
  it("posts the daily raid readiness board in French for a French guild", async () => {
    const checks = [{ status: "READY", character: { name: "Espionne", level: 30, className: "Warlock" }, inspectedAt: at, findings: [] }];
    const db = { member: { findMany: async () => [{ id: 0, displayName: "kev" }, { id: 1, displayName: "pending" }] },
      inspectedCharacterSnapshot: { findFirst: async ({ where }: { where: { memberId: number } }) => checks[where.memberId] ?? null } };
    const lines = await buildReadinessLines(db as never, "guild", { now: at, lang: "fr" });
    const text = lines.join("\n");
    expect(lines[0]).toBe("**0 équipement prêt · 0 à corriger · 1 en montée de niveau · 1 à synchroniser**");
    expect(text).toContain("Niveau 30/60 — encore 30 niveaux.");
    expect(text).toContain("En montée de niveau — pas encore admissibles (1)");
    expect(text).toContain("Aucune vérification d'équipement envoyée (1)");
    expect(text).not.toMatch(/levels to go|gear ready|No gear check/);
    let payload: { message: { embeds: { title: string; description: string }[] } } | null = null;
    await queueDailyReadiness({ discordJob: { upsert: async (args: { create: { payload: typeof payload } }) => { payload = args.create.payload; return {}; } } } as never, "guild", "America/Toronto", lines, at, "fr");
    expect(payload!.message.embeds[0]!.title).toBe("Préparation au raid · niveau 60");
    expect(payload!.message.embeds[0]!.description).toContain("Rapport complet : `/lead readiness-raid`.");
  });
});

describe("names", () => {
  it("shows Character (Discord name) without doubled brackets", () => {
    expect(characterWithMember("Crashing Pally", "Simon")).toBe("Crashing Pally (Simon)");
    expect(characterWithMember("Maxle Druide", "Maxle (class)")).toBe("Maxle Druide (Maxle)");
    expect(characterWithMember("El Pirata", "El Pirata Qc")).toBe("El Pirata (El Pirata Qc)");
    expect(characterWithMember("El Pirata", "el pirata")).toBe("El Pirata");
    expect(characterWithMember("Grok Solidtusk", "simplyfrank3368 (Grok)")).toBe("Grok Solidtusk (simplyfrank3368)");
    expect(characterWithMember(undefined, "kev")).toBe("kev");
  });
});

it("draws a long French footer (shrunk to fit) rather than cutting it at a character count", async () => {
  const base: ScoreCard = { title: "Duels", subtitle: "x", stats: [], footer: "Score : 10 par victoire, +2 par niveau de l'adversaire au-dessus de vous, -2 par niveau en dessous (0-20) · 5 duels par paire et par jour au plus · aucune récompense" };
  const short = await scoreCardPng({ ...base, footer: "court" }), long = await scoreCardPng(base);
  expect(await pixelsDiffer(short!, long!)).toBe(true);
}, 20_000);
