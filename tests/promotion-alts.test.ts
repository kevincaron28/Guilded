import { describe, expect, it } from "vitest";
import { DEFAULT_PROMOTION_RULE, formatPromotionPlan, planPromotions, type PromotionCharacter, type PromotionPerson } from "../src/services/promotion.js";
import { promotionForAddon } from "../src/services/promotion-feed.js";

// 20 Nov 2026: alts and main changes. Safety rules from the review: only a CHOSEN main counts, nothing at or above the
// officer-level rank is touched, an "alt" never out-levels its main, an unknown main rank offers nothing.
const NO_VOICE = { ...DEFAULT_PROMOTION_RULE, minVoiceMinutes: 0 };
const NOW = new Date("2026-11-20T12:00:00Z");
const days = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
// Ranks: 0 Guild Master, 1 Officer, 2 Veteran, 3 Member, 4 Initiate (the starting rank), 5 Newbie, 6 Alt. Officer ranks are 0 and 1.
const IDX: Record<string, number> = { "Guild Master": 0, Officer: 1, Veteran: 2, Member: 3, Initiate: 4, Newbie: 5, Alt: 6 };
const mk = (name: string, rankName: string | null, isMain: boolean, chosen = isMain, level = 30, rankIndex: number | null = rankName ? IDX[rankName]! : null): PromotionCharacter =>
  ({ name, addon: `${name.split(" ")[0]}-Realm`, level, rankName, rankIndex, rankAt: rankName ? days(1) : null, since: days(9), isMain, mainChosen: chosen });
const person = (id: string, characters: PromotionCharacter[]): PromotionPerson => ({ discordUserId: id, displayName: id.toUpperCase(), inDiscord: true, characters });
const plan = (people: PromotionPerson[]) => planPromotions({ now: NOW, rule: NO_VOICE, unclaimed: [], people });

describe("alts in the promotion plan", () => {
  it("lists a chosen main's other in-guild characters as alts, never as ready, and skips the Alt rank itself", () => {
    const result = plan([person("a", [mk("Main One", "Initiate", true), mk("Alt Two", "Initiate", false), mk("Alt Three", "Alt", false), mk("Alt Four", null, false)])]);
    expect(result.alts.map((a) => [a.character, a.main, a.rankName])).toEqual([["Alt Two", "Main One", "Initiate"]]);
    expect(result.ready.map((r) => r.character)).toEqual(["Main One"]);
    expect(result.swaps).toEqual([]);
  });
  it("an accidental main (isMain without an explicit choice) gives no alts and no swaps", () => {
    const result = plan([person("a", [mk("Main One", "Initiate", true, false), mk("Alt Two", "Initiate", false), mk("Old Main", "Initiate", false), mk("New Main", "Newbie", false)])]);
    expect(result.alts).toEqual([]);
    expect(result.swaps).toEqual([]);
    expect(result.mainAway).toEqual([]);
  });
  it("never guesses: without a flagged main nobody is an alt", () => {
    expect(plan([person("a", [mk("Aaa One", "Initiate", false), mk("Bbb Two", "Initiate", false)])]).alts).toEqual([]);
  });
  it("never touches an officer-level character (guild master, officer ranks), nor an 'alt' that out-levels its main", () => {
    const result = plan([person("a", [mk("Main One", "Initiate", true), mk("Officer Two", "Officer", false), mk("Master Three", "Guild Master", false), mk("Strong Four", "Initiate", false, false, 60)])]);
    expect(result.alts).toEqual([]);
    expect(result.swaps).toEqual([]);
  });
  it("an ordinary member's Veteran or Member alt is an alt, and a Veteran old main is swapped with a new main at Initiate", () => {
    const alts = plan([person("a", [mk("Main One", "Initiate", true), mk("Vet Two", "Veteran", false), mk("Mem Three", "Member", false)])]);
    expect(alts.swaps.map((w) => w.oldMain)).toEqual(["Vet Two"]);
    expect(alts.alts.map((a) => a.character)).toEqual(["Mem Three"]);
    const swap = plan([person("a", [mk("Old Vet", "Veteran", false), mk("New Main", "Initiate", true)])]);
    expect(swap.swaps).toMatchObject([{ oldMain: "Old Vet", oldRankName: "Veteran", newMain: "New Main" }]);
  });
  it("a rank named like an officer is protected even when its index is not an officer index", () => {
    const named = { ...mk("Named Two", "Officer", false), rankIndex: 4 };
    expect(plan([person("a", [mk("Main One", "Initiate", true), named])]).alts).toEqual([]);
  });
  it("offers nothing when the main's rank index is unknown", () => {
    const result = plan([person("a", [mk("Main One", "Initiate", true, true, 30, null), mk("Alt Two", "Initiate", false), mk("Old Three", "Initiate", false)]), person("b", [mk("Anchor", "Initiate", false)])]);
    expect(result.alts).toEqual([]);
    expect(result.swaps).toEqual([]);
  });
});

describe("a main change swaps the ranks", () => {
  it("the new main (junior) takes the old main's rank, the old one goes to Alt, nobody is promoted", () => {
    const result = plan([person("a", [mk("Old Main", "Initiate", false), mk("New Main", "Newbie", true), mk("Other Alt", "Initiate", false)])]);
    expect(result.swaps).toEqual([{ discordUserId: "a", displayName: "A", newMain: "New Main", newAddon: "New-Realm", newRankName: "Newbie", oldMain: "Old Main", oldAddon: "Old-Realm", oldRankName: "Initiate" }]);
    expect(result.alts.map((a) => a.character)).toEqual(["Other Alt"]);
    expect(result.ready).toEqual([]);
    expect(result.waiting).toEqual([]);
  });
  it("the swap is keyed by the Discord user: a second member with the same display name is still promoted", () => {
    const twin = { ...person("b", [mk("Solo Starter", "Initiate", false)]), displayName: "A" };
    const result = plan([person("a", [mk("Old Main", "Initiate", false), mk("New Main", "Newbie", true)]), twin]);
    expect(result.swaps).toHaveLength(1);
    expect(result.ready.map((r) => r.character)).toEqual(["Solo Starter"]);
  });
  it("a new main already at a higher rank is not demoted: no swap, the old main is a plain alt", () => {
    const result = plan([person("a", [mk("Old Main", "Newbie", false), mk("New Main", "Initiate", true)])]);
    expect(result.swaps).toEqual([]);
    expect(result.alts.map((a) => a.character)).toEqual(["Old Main"]);
  });
  it("a main outside the guild suggests nothing for the other characters", () => {
    const result = plan([person("a", [mk("Gone Main", null, true), mk("Left Behind", "Initiate", false)]), person("b", [mk("Anchor", "Initiate", false)])]);
    expect(result.alts).toEqual([]);
    expect(result.swaps).toEqual([]);
    expect(result.mainAway).toEqual([{ displayName: "A", main: "Gone Main" }]);
  });
  it("is listed in the text plan, English and French", () => {
    const result = plan([person("a", [mk("Old Main", "Initiate", false), mk("New Main", "Newbie", true)]), person("b", [mk("Boo Main", "Initiate", true), mk("Boo Alt", "Newbie", false)]), person("c", [mk("Gone Main", null, true), mk("Left Behind", "Initiate", false)])]);
    const en = formatPromotionPlan(result, NO_VOICE, "en");
    expect(en).toContain("New Main is now A's main: give New Main rank Initiate and move Old Main to the Alt rank");
    expect(en).toContain("Alts to move to the Alt rank** (1)");
    expect(en).toContain("Boo Alt — alt of Boo Main (Newbie)");
    expect(en).toContain("Main not in the guild");
    const fr = formatPromotionPlan(result, NO_VOICE, "fr");
    expect(fr).toContain("donne à New Main le rang Initiate et passe Old Main au rang Alt");
    expect(fr).toContain("Alts à passer au rang Alt");
  });
});

describe("alts and swaps in the addon feed", () => {
  const NOT_CHOSEN = null;
  const row = (name: string, rank: string, isMain: boolean, mainChosenAt: Date | null = isMain ? days(5) : null) =>
    ({ name, realm: "Realm", displayName: null, level: 30, guildRankName: rank, guildRankIndex: IDX[rank]!, guildRankAt: days(1), isMain, mainChosenAt, rankSeen: { since: days(8) } });
  const db = (people: unknown[]) => ({
    guildSettings: { findUnique: async () => ({ promotionMinVoiceMinutes: 0 }) }, character: { findMany: async () => [] }, characterRankSeen: { upsert: async () => ({}) },
    member: { findMany: async () => people }, unclaimedCharacter: { findMany: async () => [] }
  }) as never;
  const discord = (ids: string[]) => ({ id: "d1", memberCount: ids.length, members: { cache: new Map(ids.map((u) => [u, {}])), fetch: async () => undefined } }) as never;
  it("carries roster names only, and is absent when there is nothing (old feeds unchanged)", async () => {
    const feed = await promotionForAddon(db([{ discordUserId: "a", displayName: "a", characters: [row("Old Main", "Initiate", false), row("New Main", "Newbie", true), row("Spare Alt", "Initiate", false)] }]), discord(["a"]), "g1", "forever", NOW);
    expect(feed?.swaps).toEqual([{ to: "New Main", from: "Old Main" }]);
    expect(feed?.alts).toEqual([{ name: "Spare Alt", main: "New Main" }]);
    const plain = await promotionForAddon(db([{ discordUserId: "b", displayName: "b", characters: [row("Solo Player", "Initiate", true)] }]), discord(["b"]), "g1", "forever", NOW);
    expect(plain).not.toHaveProperty("alts");
    expect(plain).not.toHaveProperty("swaps");
  });
  it("sends nothing for an accidental main (no mainChosenAt)", async () => {
    const feed = await promotionForAddon(db([{ discordUserId: "a", displayName: "a", characters: [row("Old Main", "Initiate", false), row("New Main", "Newbie", true, NOT_CHOSEN), row("Spare Alt", "Initiate", false)] }]), discord(["a"]), "g1", "forever", NOW);
    expect(feed).not.toHaveProperty("alts");
    expect(feed).not.toHaveProperty("swaps");
  });
});
