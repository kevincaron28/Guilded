import { describe, expect, it, vi } from "vitest";
// Turns PoE2 tracking on for this file (see tests/helpers/focus-switches.ts).
vi.mock("../companion/active-games.mjs", async (original) => (await import("./helpers/focus-switches.js")).poeTrackingOn(await original()));
import sharp from "sharp";
import { ALL_EMBLEMS, TIERS, check, cutOut, expectedFiles, magentaResidue, prepare } from "../scripts/build-badge-art.mjs";
import { BADGE_IMG_STYLE, badgeIcon, badgeImg, badgeInner, badgeLabel } from "../src/services/achievement-badges.js";
import { ACHIEVEMENTS, generatedAchievements, setGeneratedAchievements } from "../src/services/achievements-catalogue.js";
import { FAMILY_EMBLEM, availableEmblems, badgeCacheEntries, badgeFamily, composeBadge, emblemFor, hasBadgeToken, resetBadgeCache, withBadgeImages } from "../src/services/badge-art.js";
import { achievementUnlockedCard, achievementsCard } from "../src/services/end-cards.js";
import { cardAltText } from "../src/services/card-alt.js";
import { scoreCardPng } from "../src/services/score-card.js";

describe("badge art assets", () => {
  it("the committed set is complete, transparent, free of magenta and small (the CI check)", async () => {
    expect(await check()).toEqual([]);
    expect(expectedFiles()).toHaveLength((TIERS.length + ALL_EMBLEMS.length) * 2);
  });

  it("cuts magenta out cleanly: no pink left on the edge, a dark outline keeps its colour, the picture is trimmed and centred", async () => {
    // A dark disc with a soft edge on a noisy magenta background, a purple ring (must stay) and an enclosed magenta hole.
    const size = 200, raw = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - 100, y - 100), o = (y * size + x) * 4, noise = (x * 7 + y * 13) % 20;
      let rgb = [255 - noise, noise, 255 - noise];                                   // background
      if (d < 60) rgb = [90, 40, 130];                                               // purple metal (r, b above g: must NOT be removed)
      if (d < 30) rgb = [255 - noise, noise, 255 - noise];                           // enclosed pocket of background
      if (d < 20) rgb = [30, 20, 20];                                                // dark centre
      if (d >= 60 && d < 64) { const f = (d - 60) / 4; rgb = [Math.round(30 * (1 - f) + 255 * f), Math.round(20 * (1 - f)), Math.round(20 * (1 - f) + 255 * f)]; } // soft dark outline into magenta
      raw.set([...rgb, 255], o);
    }
    const png = await sharp(raw, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();
    const { data, width, height } = await cutOut(png);
    expect(data[3]).toBe(0);                                              // corner gone
    expect(data[(100 * size + 45) * 4 + 3]).toBe(255);                    // purple ring kept (opaque)
    expect(data[(100 * size + 45) * 4]).toBe(90);                         // and unchanged
    expect(data[(100 * size + 100) * 4 + 3]).toBe(255);                   // dark centre kept
    expect(magentaResidue(data, width, height)).toBeLessThan(0.002);
    const out = await prepare(png, 64);
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height]).toEqual([64, 64]);
    const edge = await sharp(out).ensureAlpha().raw().toBuffer();
    expect(edge[3]).toBe(0);                                              // corner transparent
    expect(edge[(32 * 64 + 32) * 4 + 3]).toBe(255);                       // centre opaque
  });
});

describe("badge families and emblems", () => {
  // A spread of in-game achievements: names that map to a family by keyword, and some that fall back to the in-game star.
  setGeneratedAchievements([
    { achievementId: 1, name: "Deadmines Delver", description: "Clear the Deadmines", categoryName: "Dungeons", points: 10 },
    { achievementId: 2, name: "Honor Rank 5", description: "Reach rank 5", categoryName: "PvP", points: 25 },
    { achievementId: 3, name: "Master Cook", description: "Reach 300 in Cooking", categoryName: "Professions", points: 50 },
    { achievementId: 4, name: "Level 40", description: "Reach level 40", categoryName: "General", points: 5 },
    { achievementId: 5, name: "A Quiet Walk", description: "Take a stroll", categoryName: "Misc", points: 100 }
  ]);
  const generated = generatedAchievements();
  const everything = [...ACHIEVEMENTS, ...generated];

  it("maps every catalogue achievement and every generated in-game achievement to an image or the SVG fallback", () => {
    expect(generated.length).toBeGreaterThan(0);
    for (const def of everything) {
      const emblem = emblemFor(def);
      expect(emblem === null || availableEmblems().has(emblem), def.id).toBe(true);
      expect(emblem, `${def.id} should resolve to an approved emblem`).not.toBeNull();
      // The icon is the painted token, or (art missing) the old SVG: never empty for a visible badge.
      expect(badgeIcon(def, true, true).length, def.id).toBeGreaterThan(10);
    }
  });

  it("puts each metric in its family from the brief, and falls back to the family emblem when an item emblem has no file", () => {
    const byId = (id: string) => ACHIEVEMENTS.find(def => def.id === id)!;
    expect(badgeFamily(byId("dungeon-runs-1"))).toBe("dungeons");
    expect(badgeFamily(byId("raids-1"))).toBe("raids");
    expect(badgeFamily(byId("duel-streak-5"))).toBe("duels");
    expect(badgeFamily({ metric: "honorableKills", en: { name: "x", description: "y" } })).toBe("pvp");
    expect(badgeFamily(byId("messages-100"))).toBe("guild");
    expect(emblemFor(byId("dungeon-runs-25"))).toBe("dungeons-torch");          // a finer approved emblem
    expect(emblemFor(byId("dungeon-runs-1"))).toBe(FAMILY_EMBLEM.dungeons);       // the family emblem otherwise
    expect(emblemFor(byId("messages-100"))).toBe("guild-sun-tablet");
    expect(emblemFor(byId("honorable-kills-500"))).toBe("pvp-drum");
    expect(badgeFamily({ metric: "gameAchievement", en: { name: "Explorer of the Barrens", description: "Discover zones" } })).toBe("ingame");
    expect(badgeFamily({ metric: "gameAchievement", en: { name: "Honor rank", description: "" } })).toBe("pvp");
  });

  it("composes a badge once and serves it from the cache; locked is a darker, greyer picture", async () => {
    resetBadgeCache();
    const earned = await composeBadge("guild-horn", "gold", true, 3, 128);
    expect(badgeCacheEntries()).toBe(1);
    expect(await composeBadge("guild-horn", "gold", true, 3, 128)).toBe(earned);   // same buffer: cached
    expect(badgeCacheEntries()).toBe(1);
    const locked = await composeBadge("guild-horn", "gold", false, 3, 128);
    expect(badgeCacheEntries()).toBe(2);
    const stats = async (png: Buffer) => { const s = await sharp(png).stats(); return { saturation: Math.max(...s.channels.slice(0, 3).map(c => c.mean)) - Math.min(...s.channels.slice(0, 3).map(c => c.mean)), brightness: s.channels.slice(0, 3).reduce((sum, c) => sum + c.mean, 0) }; };
    const a = await stats(earned!), b = await stats(locked!);
    expect(b.brightness).toBeLessThan(a.brightness);
    expect(b.saturation).toBeLessThan(a.saturation);
    expect(await composeBadge("no-such-emblem", "gold", true, undefined, 128)).toBeNull();
  });
});

describe("badges on the cards", () => {
  it("stores a small token on the card definition and draws the picture when the card is rendered", async () => {
    const card = achievementsCard("Aldric", [{ id: "dungeon-runs-1", earnedAt: new Date("2026-11-01"), value: 1 }, { id: "messages-100", earnedAt: null, value: 40 }], "en");
    const icons = (card.rows ?? []).map(row => row.icon ?? "");
    expect(icons.some(hasBadgeToken)).toBe(true);
    expect(JSON.stringify(card).length).toBeLessThan(20_000);                       // tokens, not pictures
    const withImages = await withBadgeImages(card);
    expect(JSON.stringify(withImages)).toContain("data:image/png;base64,");
    expect(JSON.stringify(withImages)).not.toContain("<badge-art");
    expect((await scoreCardPng(card))?.subarray(1, 4).toString()).toBe("PNG");
    const unlock = achievementUnlockedCard("Brenna", ["dungeon-runs-1", "raids-1"], 2, "fr");
    expect((await scoreCardPng(unlock))?.subarray(1, 4).toString()).toBe("PNG");
    expect(cardAltText(unlock)).not.toContain("<badge");
  });

  it("keeps drawing the old SVG badge for a card queued before this change", async () => {
    const def = ACHIEVEMENTS[0]!;
    const old = achievementUnlockedCard("Dara", [def.id], 1, "en");
    const legacy = { ...old, unlocks: old.unlocks?.map(unlock => ({ ...unlock, icon: badgeInner(def, true) })) };
    expect(hasBadgeToken(JSON.stringify(legacy.unlocks))).toBe(false);
    expect((await scoreCardPng(legacy as never))?.subarray(1, 4).toString()).toBe("PNG");
  });
});

describe("badges on the website", () => {
  it("layers the frame and the emblem with width, height, lazy loading and an alt text naming the achievement and tier in both languages", () => {
    const def = ACHIEVEMENTS.find(row => row.id === "dungeon-runs-1")!;
    const en = badgeImg(def, true, "en", 56), fr = badgeImg(def, false, "fr", 56);
    expect(en).toContain('src="/badge-art/frames/bronze-128.webp"');
    expect(en).toContain('src="/badge-art/emblems/dungeons-gate-128.webp"');
    expect(en.match(/width="56" height="56"/g)).toHaveLength(1);
    expect(en.match(/loading="lazy"/g)).toHaveLength(2);
    expect(en).toContain(`alt="${badgeLabel(def, true, "en")}"`);
    expect(en).toContain("First Descent: Bronze, unlocked");
    expect(fr).toContain("Première descente: Bronze, verrouillé");
    expect(fr).toContain("bdg-locked");
    expect(BADGE_IMG_STYLE).toContain("grayscale");
    expect(badgeImg(def, true, "en", 128)).toContain("-256.webp");
  });
});
