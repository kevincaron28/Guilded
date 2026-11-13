import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { BACKDROP_BUDGET_BYTES, backdropCacheBytes, backdropFor, cardBackdropArt, resetBackdropCache, textContrast } from "../src/services/card-backdrop.js";
import { duelBoardCard } from "../src/services/duel-board.js";
import { raidEndCard } from "../src/services/end-cards.js";
import { scoreCardPng, type ScoreCard } from "../src/services/score-card.js";

// Test pictures live in a kind folder of their own that is removed afterwards; no real artwork is added to the repository.
const KIND = "zztest";
const dir = fileURLToPath(new URL(`../site/card-art/${KIND}/`, import.meta.url));
const hash = (png: Buffer) => createHash("sha256").update(png).digest("hex");

/** A bright, noisy 1600x900 picture: the worst case for text contrast. */
async function brightPicture(): Promise<Buffer> {
  const noise = Buffer.alloc(1600 * 900 * 3);
  for (let i = 0; i < noise.length; i++) noise[i] = 200 + ((i * 7919) % 56);
  return sharp(noise, { raw: { width: 1600, height: 900, channels: 3 } }).jpeg({ quality: 80 }).toBuffer();
}
const ladder = (backdrop?: ScoreCard["backdrop"]): ScoreCard => ({
  eyebrow: "Guilded · PvP", title: "Guild duels", subtitle: "12 counted duels", stats: [], footer: "footer",
  ...(backdrop ? { backdrop } : {}),
  ladder: { columns: [{ label: "Score", width: 52, primary: true }], boards: [{ rows: [{ rank: 1, name: "Tester", color: "#c79c6e", values: ["10"] }] }] }
});

beforeEach(() => resetBackdropCache());
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("card backdrops", () => {
  it("returns null for unknown or malformed keys, and the card is drawn as before", async () => {
    expect(await backdropFor("board", "no-such-picture", "banner")).toBeNull();
    expect(await backdropFor("../etc", "passwd", "full")).toBeNull();
    expect(await backdropFor("board", "A/../b", "full")).toBeNull();
    expect(await cardBackdropArt(undefined, "full")).toBeNull();
  });

  it("draws a card with no approved art pixel-identically to a card that asks for no art", async () => {
    const plain = await scoreCardPng(ladder());
    const asking = await scoreCardPng(ladder({ kind: "board", key: "missing-art" }));
    expect(plain && asking).toBeTruthy();
    expect(hash(asking!)).toBe(hash(plain!));
    // The same holds for the default two-column layout, and a card queued before `backdrop` existed has no such field at all.
    const raid = raidEndCard({ title: "Raid", bossesPlanned: 1, bossesKilled: 1, killedNames: ["Boss"], topLoot: [], raiders: 10, late: 0, absent: 0, durationMinutes: 60, lootCount: 0, gpSpent: 0, epAwarded: 0, epRecipients: 0, startedAt: new Date(0), endedAt: new Date(1000) } as never);
    const queued: ScoreCard = { ...raid };
    delete queued.backdrop;
    expect(hash((await scoreCardPng(raid))!)).toBe(hash((await scoreCardPng(queued))!));
    expect(duelBoardCard({ standings: [], duels: 0, recent: [], edition: "forever" }, "en").backdrop).toEqual({ kind: "board", key: "duel" });
  });

  it("draws a card with a fixture picture, keeps muted text readable, and fits the size", async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}bright.jpg`, await brightPicture());
    const banner = await backdropFor(KIND, "bright", "banner"), full = await backdropFor(KIND, "bright", "full");
    expect(banner && full).toBeTruthy();
    expect((await sharp(banner!).metadata())).toMatchObject({ width: 1200, height: 176 });
    expect((await sharp(full!).metadata())).toMatchObject({ width: 1200, height: 630 });
    expect(await textContrast(banner!, "banner")).toBeGreaterThanOrEqual(4.5);
    expect(await textContrast(full!, "full")).toBeGreaterThanOrEqual(4.5);
    const wide = await backdropFor(KIND, "bright", "wide");
    expect(await textContrast(wide!, "wide")).toBeGreaterThanOrEqual(4.5);
    const withArt = await scoreCardPng(ladder({ kind: KIND, key: "bright" })), plain = await scoreCardPng(ladder());
    expect(hash(withArt!)).not.toBe(hash(plain!));
    expect(await sharp(withArt!).metadata()).toMatchObject({ width: 1200 });
    // The fallback key is used when the first key has no file.
    expect(await cardBackdropArt({ kind: KIND, key: "nope", fallbackKey: "bright" }, "full")).toBeTruthy();
  });

  it("lays a transparent picture on the card background, not black", async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}clear.png`, await sharp({ create: { width: 1200, height: 630, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer());
    const art = await backdropFor(KIND, "clear", "full");
    const { data } = await sharp(art!).extract({ left: 900, top: 300, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]! + data[1]! + data[2]!).toBeGreaterThan(0);
  });

  it("never holds more than its byte budget", async () => {
    mkdirSync(dir, { recursive: true });
    const picture = await brightPicture();
    for (let i = 0; i < 40; i++) writeFileSync(`${dir}p${i}.jpg`, picture);
    for (let i = 0; i < 40; i++) {
      await backdropFor(KIND, `p${i}`, "full");
      expect(backdropCacheBytes()).toBeLessThanOrEqual(BACKDROP_BUDGET_BYTES);
    }
    expect(backdropCacheBytes()).toBeGreaterThan(0);
  }, 120_000);

  it("falls back on an unreadable file", async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}broken.jpg`, "not a picture");
    expect(await backdropFor(KIND, "broken", "full")).toBeNull();
    expect(hash((await scoreCardPng(ladder({ kind: KIND, key: "broken" })))!)).toBe(hash((await scoreCardPng(ladder()))!));
  });
});
