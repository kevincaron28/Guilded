import { describe, expect, it } from "vitest";
import { DEFAULT_PROMOTION_RULE, formatPromotionPlan, planPromotions, type PromotionCharacter, type PromotionPerson } from "../src/services/promotion.js";
import { promotionForAddon } from "../src/services/promotion-feed.js";

// 20 Nov 2026: alts and main changes (owner request).
const NO_VOICE = { ...DEFAULT_PROMOTION_RULE, minVoiceMinutes: 0 };
const NOW = new Date("2026-11-20T12:00:00Z");
const days = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const mk = (name: string, rankName: string | null, rankIndex: number | null, isMain: boolean): PromotionCharacter =>
  ({ name, addon: `${name.split(" ")[0]}-Realm`, level: 30, rankName, rankIndex, rankAt: rankName ? days(1) : null, since: days(9), isMain });
const person = (id: string, characters: PromotionCharacter[]): PromotionPerson => ({ discordUserId: id, displayName: id.toUpperCase(), inDiscord: true, characters });
const plan = (people: PromotionPerson[]) => planPromotions({ now: NOW, rule: NO_VOICE, unclaimed: [], people });

describe("alts in the promotion plan", () => {
  it("lists a linked member's non-main in-guild characters as alts, never as ready, and skips the Alt rank itself", () => {
    const result = plan([person("a", [mk("Main One", "Initiate", 4, true), mk("Alt Two", "Initiate", 4, false), mk("Alt Three", "Alt", 5, false), mk("Alt Four", null, null, false)])]);
    expect(result.alts.map((a) => [a.character, a.main, a.rankName])).toEqual([["Alt Two", "Main One", "Initiate"]]);
    expect(result.ready.map((r) => r.character)).toEqual(["Main One"]);
    expect(result.swaps).toEqual([]);
  });
  it("never guesses: without a flagged main nobody is an alt", () => {
    expect(plan([person("a", [mk("Aaa One", "Member", 3, false), mk("Bbb Two", "Member", 3, false)])]).alts).toEqual([]);
  });
});

describe("a main change swaps the ranks", () => {
  it("the new main (junior) takes the old main's rank, the old one goes to Alt, nobody is promoted", () => {
    const result = plan([person("a", [mk("Old Main", "Member", 3, false), mk("New Main", "Initiate", 4, true), mk("Other Alt", "Initiate", 4, false)])]);
    expect(result.swaps).toEqual([{ displayName: "A", newMain: "New Main", newAddon: "New-Realm", newRankName: "Initiate", oldMain: "Old Main", oldAddon: "Old-Realm", oldRankName: "Member" }]);
    expect(result.alts.map((a) => a.character)).toEqual(["Other Alt"]);
    expect(result.ready).toEqual([]);
    expect(result.waiting).toEqual([]);
  });
  it("a new main already at a higher rank is not demoted: no swap, the old main is a plain alt", () => {
    const result = plan([person("a", [mk("Old Main", "Initiate", 4, false), mk("New Main", "Member", 3, true)])]);
    expect(result.swaps).toEqual([]);
    expect(result.alts.map((a) => a.character)).toEqual(["Old Main"]);
  });
  it("a main outside the guild suggests nothing for the other characters", () => {
    const result = plan([person("a", [mk("Gone Main", null, null, true), mk("Left Behind", "Member", 3, false)])]);
    expect(result.alts).toEqual([]);
    expect(result.swaps).toEqual([]);
    expect(result.mainAway).toEqual([{ displayName: "A", main: "Gone Main" }]);
  });
  it("is listed in the text plan, English and French", () => {
    const result = plan([person("a", [mk("Old Main", "Member", 3, false), mk("New Main", "Initiate", 4, true)]), person("b", [mk("Boo Main", "Member", 3, true), mk("Boo Alt", "Initiate", 4, false)]), person("c", [mk("Gone Main", null, null, true), mk("Left Behind", "Member", 3, false)])]);
    const en = formatPromotionPlan(result, NO_VOICE, "en");
    expect(en).toContain("New Main is now A's main: give New Main rank Member and move Old Main to the Alt rank");
    expect(en).toContain("Alts to move to the Alt rank** (1)");
    expect(en).toContain("Boo Alt — alt of Boo Main (Initiate)");
    expect(en).toContain("Main not in the guild");
    const fr = formatPromotionPlan(result, NO_VOICE, "fr");
    expect(fr).toContain("donnez à New Main le rang Member et passez Old Main au rang Alt");
    expect(fr).toContain("Alts à passer au rang Alt");
  });
});

describe("alts and swaps in the addon feed", () => {
  const row = (name: string, rank: string, index: number, isMain: boolean) => ({ name, realm: "Realm", displayName: null, level: 30, guildRankName: rank, guildRankIndex: index, guildRankAt: days(1), isMain, rankSeen: { since: days(8) } });
  const db = (people: unknown[]) => ({
    guildSettings: { findUnique: async () => ({ promotionMinVoiceMinutes: 0 }) }, character: { findMany: async () => [] }, characterRankSeen: { upsert: async () => ({}) },
    member: { findMany: async () => people }, unclaimedCharacter: { findMany: async () => [] }
  }) as never;
  const discord = (ids: string[]) => ({ id: "d1", memberCount: ids.length, members: { cache: new Map(ids.map((u) => [u, {}])), fetch: async () => undefined } }) as never;
  it("carries roster names only, and is absent when there is nothing (old feeds unchanged)", async () => {
    const feed = await promotionForAddon(db([{ discordUserId: "a", displayName: "a", characters: [row("Old Main", "Member", 3, false), row("New Main", "Initiate", 4, true), row("Spare Alt", "Initiate", 4, false)] }]), discord(["a"]), "g1", "forever", NOW);
    expect(feed?.swaps).toEqual([{ to: "New Main", from: "Old Main" }]);
    expect(feed?.alts).toEqual([{ name: "Spare Alt", main: "New Main" }]);
    const plain = await promotionForAddon(db([{ discordUserId: "b", displayName: "b", characters: [row("Solo Player", "Initiate", 4, true)] }]), discord(["b"]), "g1", "forever", NOW);
    expect(plain).not.toHaveProperty("alts");
    expect(plain).not.toHaveProperty("swaps");
  });
});
