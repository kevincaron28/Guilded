import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PROMOTION_RULE, formatPromotionPlan, observeRanks, planPromotions, ruleFrom, type PromotionCharacter, type PromotionPerson } from "../src/services/promotion.js";
import { noteIsWritable, professionNoteTag } from "../src/services/profession-note.js";
import { rosterProfessionSkills } from "../src/services/roster-dashboard-store.js";

const NOW = new Date("2026-11-20T12:00:00Z");
const days = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const char = (over: Partial<PromotionCharacter> = {}): PromotionCharacter => ({ name: "Halidor Galemorne", level: 20, rankName: "Initiate", rankAt: days(1), since: days(9), isMain: true, ...over });
const person = (id: string, characters: PromotionCharacter[], inDiscord = true): PromotionPerson => ({ discordUserId: id, displayName: id.toUpperCase(), inDiscord, characters });

describe("promotion plan", () => {
  it("lists Initiates of 7+ days who are in Discord, longest first", () => {
    const plan = planPromotions({ now: NOW, rule: DEFAULT_PROMOTION_RULE, unclaimed: [], people: [
      person("a", [char({ since: days(8) })]), person("b", [char({ name: "Old Timer", since: days(30) })]), person("c", [char({ since: days(3) })]),
      person("d", [char({ rankName: "Member" })]), person("e", [char({ rankName: "initiate", since: days(10) })])] });
    expect(plan.ready.map((r) => r.displayName)).toEqual(["B", "E", "A"]);
    expect(plan.waiting).toEqual([{ displayName: "C", character: "Halidor Galemorne", daysLeft: 4 }]);
  });
  it("applies the optional minimum level and ignores a stale rank", () => {
    const rule = { ...DEFAULT_PROMOTION_RULE, minLevel: 30 };
    const plan = planPromotions({ now: NOW, rule, unclaimed: [], people: [person("a", [char({ level: 20 })]), person("b", [char({ level: 31 })]), person("c", [char({ level: 40, rankAt: days(30) })])] });
    expect(plan.ready.map((r) => r.displayName)).toEqual(["B"]);
  });
  it("reports linked members who left the server and unclaimed Initiates as not in Discord yet", () => {
    const plan = planPromotions({ now: NOW, rule: DEFAULT_PROMOTION_RULE,
      people: [person("gone", [char()], false)],
      unclaimed: [{ name: "Lone Wolf", level: 12, rankName: "Initiate", rankAt: days(2) }, { name: "Vet One", level: 60, rankName: "Member", rankAt: days(2) }, { name: "Stale One", level: 5, rankName: "Initiate", rankAt: days(40) }] });
    expect(plan.ready).toEqual([]);
    expect(plan.left.map((r) => r.displayName)).toEqual(["GONE"]);
    expect(plan.unclaimed).toEqual([{ name: "Lone Wolf", level: 12 }]);
    const text = formatPromotionPlan(plan, DEFAULT_PROMOTION_RULE, "fr");
    expect(text).toContain("Prêts à être promus");
    expect(text).toContain("Lone Wolf");
  });
  it("is on by default with Initiate and 7 days", () => {
    expect(ruleFrom(null)).toEqual({ enabled: true, fromRank: "Initiate", minDays: 7, minLevel: null });
    expect(ruleFrom({ promotionEnabled: false, promotionMinLevel: 10 })).toMatchObject({ enabled: false, minLevel: 10 });
  });
  it("starts the clock at the link date for a new rank record and again when the rank changes", async () => {
    const upsert = vi.fn(async () => ({}));
    const db = { character: { findMany: async () => [
      { id: "new", guildRankName: "Initiate", createdAt: days(12), rankSeen: null },
      { id: "same", guildRankName: "Initiate", createdAt: days(40), rankSeen: { rankName: "Initiate" } },
      { id: "promoted", guildRankName: "Member", createdAt: days(40), rankSeen: { rankName: "Initiate" } }] }, characterRankSeen: { upsert } };
    await observeRanks(db as never, "g1", NOW);
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { characterId: "new", rankName: "Initiate", since: days(12) } }));
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { rankName: "Member", since: NOW } }));
  });
});

describe("profession tags and roster skills", () => {
  it("builds a tag of at most 31 characters, highest skill first", () => {
    expect(professionNoteTag([{ name: "Herbalism", skill: 300 }, { name: "Alchemy", skill: 300 }, { name: "Cooking", skill: 150 }])).toBe("Alch300 Herb300 Cook150");
    const many = ["Alchemy", "Blacksmithing", "Enchanting", "Engineering", "Herbalism", "Leatherworking", "Mining"].map((name, i) => ({ name, skill: 300 - i }));
    expect(professionNoteTag(many).length).toBeLessThanOrEqual(31);
    expect(professionNoteTag([])).toBe("");
  });
  it("only overwrites notes that are empty or already a tag", () => {
    expect(noteIsWritable("")).toBe(true);
    expect(noteIsWritable(null)).toBe(true);
    expect(noteIsWritable("Alch300 Herb300")).toBe(true);
    expect(noteIsWritable("Alt of Kevin")).toBe(false);
    expect(noteIsWritable("Alch300 raid lead")).toBe(false);
  });
  it("keeps each profession's best skill from linked or discovered records", () => {
    expect(rosterProfessionSkills([{ profession: "Mining", skillLevel: 150 }, { name: "Mining", skillLevel: 225 }, { name: "Herbalism" }])).toEqual([{ name: "Herbalism", skill: null }, { name: "Mining", skill: 225 }]);
    expect(rosterProfessionSkills(null)).toEqual([]);
  });
});
