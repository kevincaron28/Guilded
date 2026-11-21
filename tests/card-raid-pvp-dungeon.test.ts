import { describe, expect, it, vi } from "vitest";

vi.mock("../src/database.js", () => ({ prisma: {} }));
vi.mock("../src/hosted-pilot.js", () => ({ pilotGuildScope: {} }));

import { mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { assertCardRules } from "../src/services/card-kit.js";
import { renderDungeonCard, type DungeonPartyRow } from "../src/services/card-layouts-next.js";
import { cardBackdropArt } from "../src/services/card-backdrop.js";
import { dungeonBackdrop } from "../src/services/dungeon-backdrop.js";
import { dungeonRunCard } from "../src/services/dungeon-card.js";
import type { DungeonImportResult } from "../src/services/dungeon-import.js";
import { raidEndCard } from "../src/services/end-cards.js";
import { pvpGroupCard, type PvpPostData } from "../src/services/pvp-group-post.js";
import { scoreCardPng } from "../src/services/score-card.js";
import { seasonEndCard } from "../src/services/season-cards.js";

// Sample names only. CARD_RENDER_DIR also writes the PNGs for review.
const OUT = process.env["CARD_RENDER_DIR"];
const save = (name: string, png: Buffer) => { if (OUT) { mkdirSync(OUT, { recursive: true }); writeFileSync(`${OUT}/${name}.png`, png); } };
const size = async (png: Buffer | null) => { const meta = await sharp(png!).metadata(); return [meta.width, meta.height]; };

describe("dungeon run table (16 Nov 2026)", () => {
  const art = () => dungeonBackdrop({ a: "#0e3a2c", b: "#2f7a4d", motif: "cave", seed: 1, scene: "wailing" });
  const base = { label: "DUNGEON · NORMAL", title: "Wailing Caverns", hero: "23:41", facts: ["Deaths 2"], columns: { level: "Lv", guild: "Guild", gain: "This run", total: "Season (role)" } };
  const row = (name: string, extra: Partial<DungeonPartyRow> = {}): DungeonPartyRow => ({ name, color: "#c79c6e", role: "dps", ...extra });

  it("always draws the Guild column, a dash for a player without one, and hides Lv when nobody has a level", async () => {
    const { report, png } = await renderDungeonCard({ ...base, party: [row("Aldric Stormvale"), row("Brenna Ironwood", { guild: "Les Gardiens de la Lumiere" })], reason: "Dungeon score — Outside season window", art: await art() });
    const texts = report.map((r) => r.text);
    expect(texts).toContain("Guild");
    expect(texts).toContain("—");
    expect(texts).toContain("Les Gardiens de la Lumiere"); // not cut at the old 740 px table
    expect(texts).not.toContain("Lv");
    expect(texts).not.toContain("This run"); // no score anywhere: no empty score columns either
    expect(texts).toContain("Dungeon score — Outside season window");
    assertCardRules(report);
    expect(await size(png)).toEqual([1200, 630]);
  });

  it("shows Lv, the run and the season columns when a player has the figures", async () => {
    const { report } = await renderDungeonCard({ ...base, party: [row("Aldric Stormvale", { level: 24, gain: 18, total: "412", guild: "Quebec Gold" }), row("Brenna Ironwood", { level: 25 })], art: await art() });
    const texts = report.map((r) => r.text);
    expect(texts).toEqual(expect.arrayContaining(["Lv", "Guild", "This run", "Season (role)", "24", "+18", "412"]));
  });

  it("falls back to the posting server's guild for a known member and gives the card a reason line", async () => {
    const detail = (character: string, extra = {}) => ({ character, class: "WARRIOR", role: "DPS", deaths: 0, presentSec: 1100, points: 0, unrankedReason: "Outside season window", ...extra });
    const details = [detail("Aldric"), detail("Thessaly", { guild: "Moonwell Vanguard of the North Reaches" }), detail("Korvin")];
    const run: DungeonImportResult = { runRef: "QG-1", dungeonName: "Wailing Caverns", difficultyId: 1, state: "COMPLETED", valid: true, durationSec: 1421, points: 0, completedBy: "final boss", guildRecord: false, previousGuildBest: null,
      personalRecords: [], players: ["Aldric", "Thessaly", "Korvin"], deaths: 0, unlinked: ["Thessaly", "Korvin"], inGuildPlayers: ["Aldric"], achievements: [], endedAt: 1794000000, playerDetails: details } as never;
    const card = dungeonRunCard(run, "fr", { ownGuild: "Québec Gold" });
    const [a, b, c] = card.dungeon!.party;
    expect(a!.guildName).toBe("Québec Gold"); // a known member of the posting server
    expect(b!.guildName).toBe("Moonwell Vanguard of the No…");
    expect(c!.guildName).toBeUndefined(); // drawn as a dash
    expect(card.stats[3]).toMatchObject({ value: "—", note: "Hors de la période de saison" });
    const png = await scoreCardPng(card);
    expect(await size(png)).toEqual([1200, 630]);
    save("dungeon-unranked-fr", png!);
  }, 60_000);
});

describe("PvP group card (16 Nov 2026)", () => {
  const player = (name: string, role: "TANK" | "HEALER" | "DPS", level?: number) => ({ name, role, color: "#abd473", level });
  const names = ["Aldric Stormvale", "Brenna Ironwood", "Thessaly Moonbright", "Korvin Ashgrove", "Ysolde Fairwind", "Gwendolyn Brightwater", "Cedric Dunmore", "Dara Quickstep", "Eamon Blackthorn", "Fenwick Hale"];
  const data = (over: Partial<PvpPostData> = {}): PvpPostData => ({ id: "g1", title: "Warsong Gulch", size: 10, status: "OPEN", createdAt: new Date("2026-11-16T16:00:00Z"), minLevel: 50, maxLevel: 60, leaderDiscordId: "1", voiceChannelId: null, timeZone: "America/Toronto",
    members: names.map((n, i) => player(n, i === 0 ? "TANK" : i === 1 ? "HEALER" : "DPS", 60 - i)), waiting: [player("Zed", "DPS"), player("Yara", "HEALER")], ...over });

  it("carries the PvP layout, the class colours, the levels, the waiting list and the guild time zone", () => {
    const card = pvpGroupCard(data(), "fr");
    expect(card.dungeon!.pvp).toEqual({ levelLabel: "Niv", waiting: "En attente (2) : Zed, Yara" });
    expect(card.dungeon!.party[0]).toMatchObject({ color: "#abd473", level: 60 });
    expect(card.stats[2]!.value).toMatch(/\d h \d\d H[AN]E$/);
    expect(pvpGroupCard(data({ waiting: [] }), "en").dungeon!.pvp).toEqual({ levelLabel: "Lv" });
  });

  it("draws all ten names in two columns (never '+6 more') with the PvP icon and the queue line", async () => {
    const card = pvpGroupCard(data(), "en");
    const art = (await cardBackdropArt({ kind: "battleground", key: "default" }, "wide"))!;
    const party: DungeonPartyRow[] = card.dungeon!.party.map((m) => ({ name: m.name, color: m.color, role: m.role === "TANK" ? "tank" : m.role === "HEALER" ? "healer" : "dps", level: m.level }));
    const { report, png } = await renderDungeonCard({ label: "BATTLEGROUND", title: card.title, hero: "10/10", facts: [], party: [...party, { name: "+0 more", color: "#ddd" }], pvp: card.dungeon!.pvp!, art });
    const texts = report.map((r) => r.text);
    for (const n of names) expect(texts.some((t) => t.startsWith(n.slice(0, 12))), n).toBe(true);
    expect(texts.some((t) => /^\+\d+ more$/.test(t))).toBe(false);
    expect(texts).toContain("Lv 60");
    expect(texts.some((t) => t.startsWith("Waiting (2)"))).toBe(true);
    assertCardRules(report);
    expect(await size(png)).toEqual([1200, 630]);
  }, 60_000);

  it("draws through scoreCardPng, a small group and a large one", async () => {
    for (const [name, members] of [["pvp-3", data().members.slice(0, 3)], ["pvp-10", data().members]] as const) {
      const png = await scoreCardPng(pvpGroupCard(data({ members: [...members], waiting: [] }), "fr"));
      expect(await size(png)).toEqual([1200, 630]);
      save(`${name}-fr`, png!);
    }
  }, 60_000);
});

describe("raid report card (16 Nov 2026)", () => {
  const at = new Date("2026-12-09T01:00:00Z"), end = new Date("2026-12-09T04:10:00Z");
  const report = { title: "Molten Core", startedAt: at, endedAt: end, durationMinutes: 190, raiders: 22, late: 2, absent: 1, bossesKilled: 3, bossesPlanned: 10, killedNames: ["Lucifron", "Magmadar", "Gehennas"], epAwarded: 100, epRecipients: 22, lootCount: 4, gpSpent: 200, topLoot: [] };

  it("gives each count its own label and value, ticks the killed bosses and never says EP or GP", () => {
    const card = raidEndCard(report, "fr");
    expect(card.checks).toEqual(["Lucifron", "Magmadar", "Gehennas"]);
    expect(card.stats.map((s) => [s.label, s.value])).toEqual([["Boss vaincus", "3/10"], ["Raiders", "22"], ["En retard / absents", "2 / 1"], ["Durée", "3 h 10"]]);
    expect(card.stats.slice(1).every((s) => !s.note)).toBe(true);
    expect(JSON.stringify(card)).not.toMatch(/\b(EP|GP)\b/);
    expect(JSON.stringify(raidEndCard(report, "en"))).not.toMatch(/\b(EP|GP)\b/);
    expect(raidEndCard(report, "en").stats[3]!.value).toBe("3h 10m");
  });

  it("a raid with no named boss shows its attendance rows instead of an empty body", () => {
    const card = raidEndCard({ ...report, bossesKilled: 0, killedNames: [] }, "en");
    expect(card.checks).toBeUndefined();
    expect(card.rows!.map((r) => [r.name, r.right])).toEqual([["Raiders present", "22"], ["Late", "2"], ["Absent", "1"], ["Raid points awarded", "100"]]);
    expect(card.stats.map((s) => s.label)).toEqual(["Bosses defeated", "Duration", "Raid points awarded", "Items handed out"]);
  });

  it("draws 3, 8, 11 bosses and none", async () => {
    const eleven = ["Lucifron", "Magmadar", "Gehennas", "Garr", "Shazzrah", "Baron Geddon", "Sulfuron", "Golemagg", "Majordomo", "Ragnaros", "Onyxia"];
    for (const [name, killedNames] of [["raid-3", report.killedNames], ["raid-8", eleven.slice(0, 8)], ["raid-11", eleven], ["raid-0", []]] as const) {
      const png = await scoreCardPng(raidEndCard({ ...report, killedNames: [...killedNames], bossesKilled: killedNames.length }, "fr"));
      expect(await size(png)).toEqual([1200, 630]);
      save(`${name}-fr`, png!);
    }
  }, 60_000);
});

describe("short states (16 Nov 2026)", () => {
  it("a season with a lone champion fills the card with the season's own facts", () => {
    const info = { name: "Season 1", startsAt: new Date("2026-11-04T23:00:00Z"), endsAt: new Date("2026-12-09T23:00:00Z") };
    const card = seasonEndCard(info, { entries: [{ rank: 1, name: "Aldric", points: 412 }], ranked: 1, moreChampions: 0 }, "fr", new Map());
    expect(card.rows!.map((r) => [r.name, r.right])).toEqual([["Durée de la saison", "35 jours"], ["Score du champion", "412 pts"]]);
    expect(card.stats.map((s) => s.label)).not.toContain("Meilleur score");
  });
});
