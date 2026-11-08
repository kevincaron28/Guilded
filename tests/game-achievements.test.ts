import { beforeEach, describe, expect, it, vi } from "vitest";
import { importMilestones } from "../src/services/duels.js";
import { exportMilestones } from "../companion/lua-export-content.mjs";
import { parseAddonSnapshot } from "../src/integrations/addon.js";
import { achievementById, generatedAchievements, setGeneratedAchievements, tierForPoints, isGeneratedAchievementId, ACHIEVEMENTS } from "../src/services/achievements-catalogue.js";
import { earnedGameAchievements, forgetGeneratedAchievements, loadGeneratedAchievements } from "../src/services/game-achievements.js";
import { syncMemberAchievements } from "../src/services/achievements.js";
import { badgeInner, badgeSvg, generatedGlyph, GLYPHS } from "../src/services/achievement-badges.js";
import { achievementUnlockedCard, achievementsCard } from "../src/services/end-cards.js";

// WoW Forever's in-game achievements: the addon reports them as milestones of kind "ach", the bot generates the catalogue from
// the names in those reports (no hand-written list) and shows them as badges. Roadmap item 8.

type Row = { ref?: string; memberId?: string; achievementId?: number; name?: string; [key: string]: unknown };
const own = [{ name: "Kev" }];
const now = new Date("2026-11-08T12:00:00Z");
const at = 1_793_000_000;
const row = (id: number, extra: Record<string, unknown> = {}) => ({ character: "Kev", realm: "R", kind: "ach", ref: `ach:${id}`, value: 1, at, label: `Achievement ${id}`, desc: "Do the thing.", category: "Druid", points: 10, ...extra });

function fakeTx() {
  const milestones: Row[] = [];
  const catalogue: Row[] = [];
  return {
    milestones, catalogue,
    tx: {
      memberMilestone: { createMany: async ({ data }: { data: Row[] }) => { let count = 0; for (const d of data) if (!milestones.some(m => m.ref === d.ref && m.memberId === d.memberId)) { milestones.push(d); count++; } return { count }; } },
      gameAchievement: { createMany: async ({ data }: { data: Row[] }) => { let count = 0; for (const d of data) if (!catalogue.some(c => c.achievementId === d.achievementId)) { catalogue.push(d); count++; } return { count }; } }
    }
  };
}

beforeEach(() => { setGeneratedAchievements([]); forgetGeneratedAchievements(); });

describe("upload: in-game achievements as milestones", () => {
  it("stores the record and builds the catalogue from the reported names, first report winning", async () => {
    const { tx, milestones, catalogue } = fakeTx();
    const result = await importMilestones(tx as never, "g", "forever", "m1", own, [row(101), row(102, { label: "  Second\n one ", points: 25 }), row(101, { label: "Renamed" })], now);
    expect(result).toEqual({ recorded: 2, rejected: 0 });
    expect(milestones.map(m => m.ref)).toEqual(["ach:101", "ach:102"]);
    expect(catalogue).toEqual([
      { gameEdition: "forever", achievementId: 101, name: "Achievement 101", description: "Do the thing.", categoryName: "Druid", points: 10 },
      { gameEdition: "forever", achievementId: 102, name: "Second one", description: "Do the thing.", categoryName: "Druid", points: 25 }
    ]);
    // A later upload can never rename an id (the database keeps the first one: skipDuplicates).
    await importMilestones(tx as never, "g", "forever", "m1", own, [row(101, { label: "Renamed" })], now);
    expect(catalogue.find(c => c.achievementId === 101)?.name).toBe("Achievement 101");
  });

  it("rejects an achievement without a name or a numeric id, someone else's character, and a future date", async () => {
    const { tx, milestones } = fakeTx();
    const result = await importMilestones(tx as never, "g", "forever", "m1", own, [row(103, { label: undefined }), row(104, { label: "   " }), { ...row(105), ref: "ach:abc" }, row(106, { character: "Bob" }), row(107, { at: Math.floor(now.getTime() / 1000) + 99_999 }), row(108)], now);
    expect(result).toEqual({ recorded: 1, rejected: 5 });
    expect(milestones.map(m => m.ref)).toEqual(["ach:108"]);
  });

  it("keeps working on a database without the catalogue table (older test doubles)", async () => {
    const { tx, milestones } = fakeTx();
    const result = await importMilestones({ memberMilestone: tx.memberMilestone } as never, "g", "forever", "m1", own, [row(101)], now);
    expect(result.recorded).toBe(1);
    expect(milestones).toHaveLength(1);
  });

  it("the companion export carries the text, drops an unnamed achievement and keeps the other kinds", () => {
    const database = { milestones: { chars: { "Kev-R": { name: "Kev", realm: "R", log: [
      { kind: "ach", ref: "ach:101", value: 1, at, label: "Moonkin  Form\n", desc: "Learn it.", category: "Druid", points: 10, secret: "x" },
      { kind: "ach", ref: "ach:102", value: 1, at },
      { kind: "hk", ref: "hk:100", value: 100, at: at - 5 }
    ] } } } };
    expect(exportMilestones(database)).toEqual([
      { character: "Kev", realm: "R", kind: "ach", ref: "ach:101", value: 1, at, label: "Moonkin Form", desc: "Learn it.", category: "Druid", points: 10 },
      { character: "Kev", realm: "R", kind: "hk", ref: "hk:100", value: 100, at: at - 5 }
    ]);
  });

  it("the snapshot accepts up to 600 milestone rows", () => {
    const base = { guild: { name: "G", realm: "R" }, exportedAt: at, protocol: 2 } as Record<string, unknown>;
    const rows = Array.from({ length: 600 }, (_, i) => row(i + 1));
    expect(() => parseAddonSnapshot({ ...base, milestones: rows })).not.toThrow(/too_big|600/);
  });
});

describe("generated catalogue rows", () => {
  it("become WoW Forever badges by id, tiered by points, never part of the static catalogue", () => {
    setGeneratedAchievements([{ achievementId: 101, name: "Moonkin Form", description: "Learn it.", categoryName: "Druid", points: 10 }, { achievementId: 202, name: "Grand Tour", description: "", categoryName: "Explorer", points: 50 }]);
    const def = achievementById("forever-ach-101")!;
    expect(def).toMatchObject({ id: "forever-ach-101", game: "wow", edition: "forever", tier: "gold", metric: "gameAchievement", threshold: 1 });
    expect(def.en.name).toBe("Moonkin Form");
    expect(achievementById("forever-ach-202")?.tier).toBe("epic");
    expect(achievementById("forever-ach-202")?.en.description).toBe("Explorer");
    expect(isGeneratedAchievementId("forever-ach-1")).toBe(true);
    expect(generatedAchievements()).toHaveLength(2);
    expect(ACHIEVEMENTS.some(row => row.id.startsWith("forever-ach-"))).toBe(false);
    expect([0, 4, 5, 10, 25, 50, 100].map(tierForPoints)).toEqual(["bronze", "bronze", "silver", "gold", "platinum", "epic", "legendary"]);
  });

  it("draw a badge: a keyword picks the glyph, otherwise the id does, the same every time", () => {
    setGeneratedAchievements([
      { achievementId: 1, name: "Deadmines Delver", description: "Clear the dungeon.", categoryName: "", points: 5 },
      { achievementId: 2, name: "Plain Name", description: "Nothing special.", categoryName: "", points: 5 },
      { achievementId: 3, name: "Plain Name", description: "Nothing special.", categoryName: "", points: 5 }
    ]);
    expect(generatedGlyph(achievementById("forever-ach-1")!)).toBe("door");
    const plain = generatedGlyph(achievementById("forever-ach-2")!);
    expect(GLYPHS[plain]).toBeTruthy();
    expect(generatedGlyph(achievementById("forever-ach-2")!)).toBe(plain);
    expect(generatedGlyph(achievementById("forever-ach-3")!)).not.toBe(plain);
    for (const id of [1, 2, 3]) {
      const def = achievementById(`forever-ach-${id}`)!;
      expect(badgeInner(def, true)).toContain("<g");
      expect(badgeSvg(def, false, { label: "x" })).toContain("<svg");
    }
  });

  it("show on the achievements card and the unlock card", () => {
    setGeneratedAchievements([{ achievementId: 101, name: "Moonkin Form", description: "Learn it.", categoryName: "Druid", points: 10 }]);
    const card = achievementsCard("Kev", [{ id: "forever-ach-101", earnedAt: new Date("2026-11-02T12:00:00Z"), value: 1 }, { id: "dungeon-runs-1", earnedAt: null, value: 0 }]);
    expect(card.rows!.map(r => r.name)).toContain("Moonkin Form");
    expect(card.rows!.find(r => r.name === "Moonkin Form")?.sub).toContain("WoW Forever");
    const unlock = achievementUnlockedCard("Kev", ["forever-ach-101"], 1);
    expect(unlock.stats?.[0]?.value).toBe("+1");
  });
});

describe("evaluator: stored from the addon record", () => {
  function db(rows: { ref: string; reachedAt: Date }[]) {
    const stored: { key: string; earnedAt: Date; value: number; memberId?: string }[] = [];
    const empty = vi.fn(async () => []);
    return {
      stored,
      db: {
        gameAchievement: { findMany: vi.fn(async () => [{ achievementId: 101, name: "Moonkin Form", description: "Learn it.", categoryName: "Druid", points: 10 }]) },
        member: { findFirst: vi.fn(async () => ({ discordUserId: "u1" })) },
        character: { findMany: empty }, dungeonRunPlayer: { findMany: empty }, raidAttendance: { findMany: empty }, communityParticipationDay: { findMany: empty },
        memberActivityTotal: { findUnique: vi.fn(async () => null) }, communityPoint: { aggregate: vi.fn(async () => ({ _sum: { amount: 0 } })), count: vi.fn(async () => 0) },
        epgpTransaction: { aggregate: vi.fn(async () => ({ _sum: { epAmount: 0 } })) }, communityHonorAward: { findMany: empty }, professionSkill: { findMany: empty },
        poeLevelReached: { findMany: empty }, poeMapVisit: { findMany: empty },
        memberMilestone: { aggregate: vi.fn(async () => ({ _max: { value: null } })), findMany: vi.fn(async ({ where }: { where: { kind?: string } }) => where.kind === "ach" ? rows : []) },
        craftRequest: { findMany: empty }, recipeKnown: { findMany: empty }, duelResult: { findMany: empty, groupBy: empty },
        memberAchievement: {
          findMany: vi.fn(async () => stored.map(r => ({ ...r }))),
          createMany: vi.fn(async ({ data }: { data: { key: string; earnedAt: Date; value: number }[] }) => { let count = 0; for (const r of data) if (!stored.some(s => s.key === r.key)) { stored.push(r); count++; } return { count }; })
        }
      } as never
    };
  }

  it("stores a reported achievement with the game's date, once, and ignores ids nobody named", async () => {
    const reached = new Date("2026-11-02T12:00:00Z");
    const { db: fake, stored } = db([{ ref: "ach:101", reachedAt: reached }, { ref: "ach:101", reachedAt: new Date("2026-11-05T12:00:00Z") }, { ref: "ach:999", reachedAt: reached }, { ref: "prof:alchemy-75", reachedAt: reached }]);
    const view = await syncMemberAchievements(fake, "g", "m", now);
    expect(view.newlyEarned).toContain("forever-ach-101");
    expect(view.newlyEarned).not.toContain("forever-ach-999");
    expect(stored.find(r => r.key === "forever-ach-101")).toMatchObject({ earnedAt: reached, value: 1 });
    expect(view.results.find(r => r.def.id === "forever-ach-101")).toMatchObject({ earned: true, earnedAt: reached });
    const again = await syncMemberAchievements(fake, "g", "m", now);
    expect(again.newlyEarned).not.toContain("forever-ach-101");
    expect(stored.filter(r => r.key === "forever-ach-101")).toHaveLength(1);
  });

  it("clamps a date from the future and survives a database without the catalogue", async () => {
    const { db: fake, stored } = db([{ ref: "ach:101", reachedAt: new Date("2030-01-01T00:00:00Z") }]);
    await syncMemberAchievements(fake, "g", "m", now);
    expect(stored.find(r => r.key === "forever-ach-101")?.earnedAt).toEqual(now);
    expect(await earnedGameAchievements({}, "g", "m")).toEqual([]);
    await expect(loadGeneratedAchievements({})).resolves.toBeUndefined();
  });
});
