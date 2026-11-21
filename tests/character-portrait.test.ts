import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { parseCharacterMedia } from "../src/services/blizzard-armory.js";
import { renderPromotionCard, promotionCard } from "../src/services/card-promotion.js";
import { createCharacterPortraits, findCharacterWowId, headAndShoulders, pickPortrait, portraitUrl, refreshPromotionText, withCharacterPortrait } from "../src/services/character-portrait.js";
import { promotionCongratsText } from "../src/services/promotion.js";

/** A 1600x1200 transparent render with a "figure" (a block with a head) off-centre. */
async function fakeRender(): Promise<Buffer> {
  const body = await sharp({ create: { width: 300, height: 800, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 1 } } }).png().toBuffer();
  const head = await sharp({ create: { width: 120, height: 120, channels: 4, background: { r: 40, g: 200, b: 40, alpha: 1 } } }).png().toBuffer();
  return sharp({ create: { width: 1600, height: 1200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: body, left: 500, top: 300 }, { input: head, left: 420, top: 300 }]).png().toBuffer();
}
const jpeg = () => sharp({ create: { width: 84, height: 84, channels: 3, background: "#336699" } }).jpeg().toBuffer();

describe("portraitUrl", () => {
  it("builds the render path from the character id", () => {
    expect(portraitUrl(6978517n, "avatar.jpg")).toBe("https://render.worldofwarcraft.com/forever-us/character/213/6978517-avatar.jpg");
    expect(portraitUrl(6691071, "main-raw.png")).toBe("https://render.worldofwarcraft.com/forever-us/character/255/6691071-main-raw.png");
  });
});

describe("headAndShoulders", () => {
  it("cuts a square around the head and returns null for an empty picture", async () => {
    const cut = await headAndShoulders(await fakeRender());
    const meta = await sharp(cut!).metadata();
    expect([meta.width, meta.height]).toEqual([256, 256]);
    expect(await headAndShoulders(await sharp({ create: { width: 400, height: 400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer())).toBeNull();
  });
});

describe("createCharacterPortraits", () => {
  it("uses the full-body cut, falls back to the avatar, and caches a miss", async () => {
    const full = await fakeRender(), small = await jpeg();
    const fetchImage = vi.fn(async (url: string) => url.endsWith("main-raw.png") ? full : url.endsWith("avatar.jpg") ? small : null);
    const portraits = createCharacterPortraits({ fetchImage });
    expect((await sharp((await portraits.forId(1n))!).metadata()).width).toBe(256);
    expect(fetchImage).toHaveBeenCalledTimes(1);
    await portraits.forId(1n);
    expect(fetchImage).toHaveBeenCalledTimes(1);
    const noFull = createCharacterPortraits({ fetchImage: async (url) => url.endsWith("avatar.jpg") ? small : null });
    expect(await noFull.forId(2n)).toEqual(small);
    let calls = 0;
    const missing = createCharacterPortraits({ fetchImage: async () => { calls++; return null; } });
    expect(await missing.forId(3n)).toBeNull();
    const first = calls;
    expect(await missing.forId(3n)).toBeNull();
    expect(calls).toBe(first);
  });
  it("looks a character up by full-name slug and needs the Battle.net client for it", async () => {
    const fetchImage = vi.fn(async () => await jpeg());
    const media = vi.fn(async () => ({ id: null, assets: { avatar: "https://render.worldofwarcraft.com/forever-us/character/1/1-avatar.jpg" } }));
    const portraits = createCharacterPortraits({ fetchImage, armory: { fetchForeverCharacterMedia: media } });
    expect(await portraits.forName("Boramuru Bakruk")).not.toBeNull();
    expect(media).toHaveBeenCalledWith("boramuru-bakruk");
    expect(await createCharacterPortraits({ fetchImage }).forName("Boramuru Bakruk")).toBeNull();
  });
});

describe("portrait order", () => {
  it("armory first, then the Discord avatar, then nothing", async () => {
    const a = Buffer.from("armory"), d = Buffer.from("discord");
    expect((await pickPortrait({ armory: async () => a, discord: async () => d }))?.source).toBe("armory");
    expect((await pickPortrait({ armory: async () => null, discord: async () => d }))?.source).toBe("discord");
    expect((await pickPortrait({ armory: async () => { throw new Error("down"); }, discord: async () => d }))?.source).toBe("discord");
    expect(await pickPortrait({ armory: async () => null, discord: async () => { throw new Error("x"); } })).toBeNull();
  });
  it("replaces an earlier avatar with the Armory picture, keeps it otherwise", async () => {
    const card = { ...promotionCard("fr", { name: "Kev", character: "Boramuru Bakruk", rank: "Membre" }), portrait: Buffer.from("old").toString("base64") };
    expect((await withCharacterPortrait(card, { armory: async () => Buffer.from("new"), discord: async () => null })).portrait).toBe(Buffer.from("new").toString("base64"));
    expect((await withCharacterPortrait(card, { armory: async () => null, discord: async () => null })).portrait).toBe(card.portrait);
  });
});

describe("findCharacterWowId", () => {
  const db = (characters: unknown[], armory: unknown) => ({
    character: { findMany: vi.fn(async () => characters) }, armoryRosterEntry: { findFirst: vi.fn(async () => armory) }
  }) as never;
  it("prefers the member's own character, then the Armory roster mirror", async () => {
    const rows = [{ wowId: 1n, member: { discordUserId: "9" } }, { wowId: 2n, member: { discordUserId: "8" } }];
    expect(await findCharacterWowId(db(rows, null), "g", "Kev", "8")).toBe(2n);
    expect(await findCharacterWowId(db(rows, { wowId: 5n }), "g", "Kev", "7")).toBe(5n);
    expect(await findCharacterWowId(db([], null), "g", "Kev")).toBeNull();
  });
});

describe("parseCharacterMedia", () => {
  it("reads the asset links and the character id", () => {
    const m = parseCharacterMedia({ character: { id: 6978517 }, assets: [{ key: "avatar", value: "https://x/a.jpg" }, { key: "main-raw", value: "https://x/m.png" }] });
    expect(m?.id).toBe(6978517n);
    expect(m?.assets["main-raw"]).toBe("https://x/m.png");
    expect(parseCharacterMedia({})).toBeNull();
  });
});

describe("queued promotion text", () => {
  it("is rebuilt from the stored card with the current wording and the member's mention", () => {
    const card = promotionCard("fr", { name: "Kev", character: "Boramuru Bakruk", rank: "Membre" });
    const payload: Record<string, unknown> = { card, message: { content: "Félicitations à @x (Name) (Name), promu·e Membre !" }, cardOnly: { content: "old", embeds: [] } };
    refreshPromotionText(payload, "123456789012345678", "fr", promotionCongratsText);
    const expected = promotionCongratsText("<@123456789012345678>", "Membre", "fr");
    expect((payload["message"] as { content: string }).content).toBe(expected);
    expect((payload["cardOnly"] as { content: string }).content).toBe(expected);
    const none: Record<string, unknown> = { message: { content: "keep" } };
    refreshPromotionText(none, "1", "en", promotionCongratsText);
    expect((none["message"] as { content: string }).content).toBe("keep");
  });
});

describe("promotion card", () => {
  it("draws with a portrait and without", async () => {
    const card = promotionCard("en", { name: "Kev", character: "Boramuru Bakruk", rank: "Member" });
    expect((await renderPromotionCard(card))?.length).toBeGreaterThan(1000);
    expect((await renderPromotionCard({ ...card, portrait: (await jpeg()).toString("base64") }))?.length).toBeGreaterThan(1000);
    expect((await renderPromotionCard({ ...card, portrait: "not-an-image" }))?.length).toBeGreaterThan(1000);
  });
});
