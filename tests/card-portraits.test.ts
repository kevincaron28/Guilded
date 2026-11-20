import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { withArmoryCardPortraits } from "../src/services/card-portraits.js";
import { createCharacterPortraits, portraitUrl } from "../src/services/character-portrait.js";
import { dungeonRunCard } from "../src/services/dungeon-card.js";
import type { DungeonImportResult } from "../src/services/dungeon-import.js";
import { achievementUnlockedCard } from "../src/services/end-cards.js";
import { ACTIVE_ACHIEVEMENTS } from "../src/services/achievements-catalogue.js";
import { weeklyHonorsMessage, weeklyPostCardExtra, weeklyRookieCardExtra } from "../src/services/community-honors.js";
import { retiredPicturesRoute } from "../src/services/retired-pages.js";
import { scoreCardPng, type ScoreCard } from "../src/services/score-card.js";

/** A 1600x1200 transparent render with a figure, like the Armory's main-raw.png. */
async function fakeRender(): Promise<Buffer> {
  const body = await sharp({ create: { width: 300, height: 800, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 1 } } }).png().toBuffer();
  const head = await sharp({ create: { width: 120, height: 120, channels: 4, background: { r: 40, g: 200, b: 40, alpha: 1 } } }).png().toBuffer();
  return sharp({ create: { width: 1600, height: 1200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: body, left: 500, top: 300 }, { input: head, left: 420, top: 300 }]).png().toBuffer();
}
const avatar = () => sharp({ create: { width: 256, height: 256, channels: 3, background: "#5865f2" } }).png().toBuffer();
const isPng = (png: Buffer | null) => expect(png?.subarray(1, 4).toString()).toBe("PNG");

const A = "11111111111111111", B = "22222222222222222";
const KEV = 6978517n, MEL = 6691071n;
const characters = [{ name: "Kev", wowId: KEV, discord: A }, { name: "Melodie", wowId: MEL, discord: B }];
const fakeDb = (rows = characters) => ({
  character: {
    findMany: vi.fn(async ({ where }: { where: { OR?: { name?: { equals: string } }[] } }) => {
      const wanted = where.OR?.[0]?.name?.equals?.toLowerCase();
      return rows.filter(c => c.name.toLowerCase() === wanted).map(c => ({ wowId: c.wowId, member: { discordUserId: c.discord } }));
    }),
    findFirst: vi.fn(async ({ where }: { where: { member: { discordUserId: string } } }) => {
      const row = rows.find(c => c.discord === where.member.discordUserId);
      return row ? { name: row.name, wowId: row.wowId } : null;
    })
  },
  armoryRosterEntry: { findFirst: vi.fn(async () => null) }
});
const portraitsFrom = (images: Map<string, Buffer>) => createCharacterPortraits({ fetchImage: async (url) => images.get(url) ?? null });

async function renders(ids: bigint[]) {
  const image = await fakeRender();
  return portraitsFrom(new Map(ids.map(id => [portraitUrl(id, "main-raw.png"), image])));
}

const party = [
  { character: "Kev", full: "Kev Caron", class: "MAGE", role: "DAMAGER" }, { character: "Melodie", full: "Melodie Gagnon", class: "PRIEST", role: "HEALER" },
  { character: "Xaldin", full: "Xaldin Morrow", class: "HUNTER", role: "DAMAGER" }, { character: "Gauthier", full: "Gauthier T", class: "PALADIN", role: "TANK" },
  { character: "Pug", full: "Pug Healson", class: "DRUID", role: "DAMAGER" }
];
const run: DungeonImportResult = {
  runRef: "QG-portraits", dungeonName: "The Deadmines", difficultyId: 1, state: "COMPLETED", valid: true, durationSec: 1302, points: 0, completedBy: "final boss",
  guildRecord: false, previousGuildBest: null, guildRank: { rank: 2, of: 9 }, personalRecords: [], players: party.map(p => p.character), deaths: 3, unlinked: ["Pug"],
  inGuildPlayers: party.slice(0, 4).map(p => p.character), achievements: [], endedAt: 1794000000, startedAt: 1793998800, ratingEnabled: true,
  fullNames: Object.fromEntries(party.map(p => [p.character, p.full])), encounters: [{ id: 1, name: "Edwin VanCleef", success: true, at: 1794000000 }],
  playerDetails: party.map(p => ({ character: p.character, class: p.class, role: p.role, deaths: 0, presentSec: 1100, points: 0 }))
};

vi.setConfig({ testTimeout: 90_000 });

describe("the delivery step: a card about one member", () => {
  const card = async (): Promise<ScoreCard> => ({ ...achievementUnlockedCard("Kev Caron", [ACTIVE_ACHIEVEMENTS[0]!.id], 12, "en"), portrait: (await avatar()).toString("base64") });

  it("shows the main character's Armory picture, replacing the Discord avatar", async () => {
    const before = await card();
    const after = await withArmoryCardPortraits(fakeDb() as never, await renders([KEV]), "g1", before, A);
    expect(after.portrait).toBeTruthy();
    expect(after.portrait).not.toBe(before.portrait);
    isPng(await scoreCardPng(after));
  });

  it("falls back to the Discord avatar without an Armory picture, and to no portrait without either", async () => {
    const before = await card();
    expect(await withArmoryCardPortraits(fakeDb() as never, portraitsFrom(new Map()), "g1", before, A)).toEqual(before);
    expect(await withArmoryCardPortraits(fakeDb([]) as never, await renders([KEV]), "g1", before, A)).toEqual(before);
    const bare: ScoreCard = { ...before }; delete bare.portrait;
    expect((await withArmoryCardPortraits(fakeDb([]) as never, portraitsFrom(new Map()), "g1", bare, A)).portrait).toBeUndefined();
    isPng(await scoreCardPng(bare));
  });

  it("survives a bad image: the card still draws", async () => {
    const before = await card();
    const bad = portraitsFrom(new Map([[portraitUrl(KEV, "main-raw.png"), Buffer.from("not an image")], [portraitUrl(KEV, "avatar.jpg"), Buffer.from("not an image either")]]));
    const after = await withArmoryCardPortraits(fakeDb() as never, bad, "g1", before, A);
    isPng(await scoreCardPng(after));
    isPng(await scoreCardPng({ ...before, portrait: Buffer.from("garbage").toString("base64") }));
  });

  it("never throws or waits past its budget when the database or the Armory hang or fail", async () => {
    const before = await card();
    const broken = { character: { findFirst: async () => { throw new Error("db down"); }, findMany: async () => { throw new Error("db down"); } }, armoryRosterEntry: { findFirst: async () => null } };
    expect(await withArmoryCardPortraits(broken as never, await renders([KEV]), "g1", before, A)).toEqual(before);
    const slow = createCharacterPortraits({ fetchImage: () => new Promise<Buffer | null>(() => { /* never answers */ }) });
    const started = Date.now();
    expect(await withArmoryCardPortraits(fakeDb() as never, slow, "g1", before, A, { budgetMs: 80 })).toEqual(before);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("leaves cards that are not about one member alone", async () => {
    const ladder = { ...(await card()), ladder: { columns: [], boards: [] } } as ScoreCard;
    expect(await withArmoryCardPortraits(fakeDb() as never, await renders([KEV]), "g1", ladder, A)).toBe(ladder);
    expect(await withArmoryCardPortraits(fakeDb() as never, await renders([KEV]), "g1", await card())).toEqual(await card());
  });
});

describe("the weekly honors and rookie cards", () => {
  const board = [A, B, "33333333333333333"].map((userId, i) => ({ userId, points: [241, 224, 112][i]!, balance: 0 }));
  const recap = { points: 577, members: 37, messages: 50, reactions: 9, voiceHours: 0, activities: 0, raids: 0, bossKills: 0, dungeonRuns: 0, newMembers: 1 };
  const names = new Map([[A, "Kev Caron"], [B, "Melodie G."], ["33333333333333333", "Newbie"]]);
  const message = weeklyHonorsMessage("en", { week: "2026-11-09", board, mvps: [A], recap, rookie: board[2]!, names } as never);

  it("the MVP card draws the portrait, with none and with a bad one", async () => {
    const extra = weeklyPostCardExtra("en", message, "2026-11-09", board, [A], board[2]!, names, recap, new Map([[A, 2]])) as unknown as { card: ScoreCard; cardMember: string };
    expect(extra.cardMember).toBe(A);
    const plain = await scoreCardPng(extra.card);
    const portrait = (await withArmoryCardPortraits(fakeDb() as never, await renders([KEV]), "g1", extra.card, A)).portrait!;
    const drawn = await scoreCardPng({ ...extra.card, portrait });
    isPng(drawn);
    expect(Buffer.compare(drawn!, plain!)).not.toBe(0);
    isPng(await scoreCardPng({ ...extra.card, portrait: Buffer.from("garbage").toString("base64") }));
  });

  it("the rookie card draws a round portrait, with none and with a bad one", async () => {
    const extra = weeklyRookieCardExtra("en", message, "2026-11-09", board, board[1], names) as unknown as { card: ScoreCard; cardMember: string };
    const plain = await scoreCardPng(extra.card);
    const portrait = (await withArmoryCardPortraits(fakeDb() as never, await renders([MEL]), "g1", extra.card, extra.cardMember)).portrait!;
    expect(portrait).toBeTruthy();
    const drawn = await scoreCardPng({ ...extra.card, portrait });
    isPng(drawn);
    expect(Buffer.compare(drawn!, plain!)).not.toBe(0);
    const bad = await scoreCardPng({ ...extra.card, portrait: Buffer.from("garbage").toString("base64") });
    isPng(bad);
    expect(bad).toEqual(plain);
  });
});

describe("the delivery step: a dungeon run", () => {
  it("adds a portrait per guild member who has an Armory picture (names resolved without the realm)", async () => {
    const card = dungeonRunCard(run, "en");
    const after = await withArmoryCardPortraits(fakeDb() as never, await renders([KEV, MEL]), "g1", card);
    const shown = after.dungeon!.party.map(member => Boolean(member.portrait));
    expect(shown.slice(0, 2)).toEqual([true, true]);
    expect(shown.slice(2)).toEqual([false, false, false]);
  });

  it("draws with portraits, without, and with a bad one (the table keeps its columns)", async () => {
    const card = dungeonRunCard(run, "en");
    const withFaces = await withArmoryCardPortraits(fakeDb() as never, await renders([KEV, MEL]), "g1", card);
    const plain = await scoreCardPng(card), drawn = await scoreCardPng(withFaces);
    isPng(plain); isPng(drawn);
    expect(Buffer.compare(drawn!, plain!)).not.toBe(0);
    const bad = { ...card, dungeon: { ...card.dungeon!, party: card.dungeon!.party.map(member => ({ ...member, portrait: Buffer.from("garbage").toString("base64") })) } };
    expect(await scoreCardPng(bad)).toEqual(plain);
  });

  it("loads at most three pictures at once and stops starting new ones after the budget", async () => {
    let live = 0, peak = 0;
    const image = await fakeRender();
    const portraits = createCharacterPortraits({ fetchImage: async () => { live++; peak = Math.max(peak, live); await new Promise(r => setTimeout(r, 25)); live--; return image; } });
    const many = Array.from({ length: 5 }, (_, i) => ({ name: `Char${i}`, wowId: BigInt(1000 + i), discord: `u${i}` }));
    const card = dungeonRunCard({ ...run, players: many.map(c => c.name), inGuildPlayers: many.map(c => c.name), playerDetails: many.map(c => ({ character: c.name, class: "MAGE", role: "DAMAGER", deaths: 0, presentSec: 1, points: 0 })), fullNames: {} }, "en");
    const after = await withArmoryCardPortraits(fakeDb(many) as never, portraits, "g1", card);
    expect(peak).toBeLessThanOrEqual(3);
    expect(after.dungeon!.party.filter(member => member.portrait).length).toBe(5);
  });

  it("leaves a battleground group post (PvP) and a party of outsiders alone", async () => {
    const card = dungeonRunCard(run, "en");
    const pvp = { ...card, dungeon: { ...card.dungeon!, pvp: { levelLabel: "Lv" } } };
    expect(await withArmoryCardPortraits(fakeDb() as never, await renders([KEV]), "g1", pvp)).toBe(pvp);
    const outsiders = { ...card, dungeon: { ...card.dungeon!, party: card.dungeon!.party.map(member => ({ ...member, guild: false })) } };
    expect(await withArmoryCardPortraits(fakeDb() as never, await renders([KEV]), "g1", outsiders)).toBe(outsiders);
  });
});

describe("member-uploaded pictures are gone", () => {
  const kit = { page: (status: number, title: string, body: string) => ({ status, headers: {}, body: `${title}${body}` }) } as never;
  const ctx = (path: string, lang = "en") => ({ request: { path, method: "GET" }, lang, t: (en: string, fr: string) => lang === "fr" ? fr : en }) as never;

  it("answers 410 Gone with a short message for the old picture pages and endpoints", async () => {
    for (const path of ["/me/pictures/", "/me/pictures/upload", "/players/pictures/abc/1.webp", "/players/pictures/report", "/api/v1/character-pictures"]) {
      const response = (await retiredPicturesRoute(ctx(path), kit))!;
      expect(response.status).toBe(410);
      expect(JSON.stringify(response)).toContain("Armory");
    }
    expect((await retiredPicturesRoute(ctx("/me/pictures/", "fr"), kit))!.body).toContain("Armory");
    expect(await retiredPicturesRoute(ctx("/me/"), kit)).toBeNull();
  });
});

