import { describe, expect, it } from "vitest";
import { ChannelType } from "discord.js";
import { findWowChatChannelId, plainChannelName, wowChatChannel, type ChannelLike } from "../src/services/wow-chat.js";
import { promotionCongratsChannel } from "../src/services/promotion.js";
import { announceBankDonations, backfillBankDonations, BACKFILL_GAP_MS, planDonations, DONATION_CARDS_PER_HOUR, DONATION_MIN_COPPER, DONATION_SETTLE_MS, type DonationRow } from "../src/services/bank-donations.js";
import { combinedDonationCard, combinedDonationText, donationCard, donationLines, donationText, renderDonationCard, withDonationIcons, downloadIcon } from "../src/services/card-donation.js";
import { applyGuildBank } from "../src/services/guild-bank.js";
import { unbrandCard } from "../src/services/score-card.js";

const cat = (id: string, name: string): ChannelLike => ({ id, name, type: ChannelType.GuildCategory });
const text = (id: string, name: string, parentId: string | null = null): ChannelLike => ({ id, name, type: ChannelType.GuildText, parentId });

// Québec Gold's layout (21 Nov 2026): chat-wow, chat-guilde and chat-raids under "💬 Chat WoW", plus the community chat.
const QG = [cat("wowcat", "💬 Chat WoW"), text("1552239418855915600", "chat-wow", "wowcat"), text("guilde", "chat-guilde", "wowcat"), text("raids", "chat-raids", "wowcat"),
  cat("comm", "Communauté"), text("cc", "chat-communauté", "comm")];

describe("WoW chat channel", () => {
  it("normalises emoji, separators and accents", () => {
    expect(plainChannelName("🏠︱guild-chat")).toBe("guild-chat");
    expect(plainChannelName("💬・Chat Guildé")).toBe("chat-guilde");
    expect(plainChannelName("💬 Chat WoW")).toBe("chat-wow");
  });
  it("resolves Québec Gold to chat-wow", () => {
    expect(findWowChatChannelId(QG)).toBe("1552239418855915600");
  });
  it("finds emoji-prefixed and accented names, preferring a WoW category", () => {
    expect(findWowChatChannelId([text("a", "🏠︱guild-chat")])).toBe("a");
    expect(findWowChatChannelId([text("a", "💬・chât-guildé")])).toBe("a");
    expect(findWowChatChannelId([cat("w", "World of Warcraft"), text("out", "chat-wow"), text("in", "guild-chat", "w")])).toBe("in");
    expect(findWowChatChannelId([text("b", "guild-chat"), text("a", "wow-chat")])).toBe("a");
    expect(findWowChatChannelId([text("x", "💬・chat-geral"), { id: "v", name: "chat-wow", type: ChannelType.GuildVoice }])).toBeNull();
  });
  it("officer choice first, then names, then community chat, then announcements, then hall of fame", async () => {
    const db = (chosen: string | null, season: string | null = "ann") => ({
      guildSettings: { findUnique: async () => ({ wowChatChannelId: chosen }) },
      communitySeason: { findFirst: async () => season ? { announcementChannelId: season } : null },
      communityHonors: { findUnique: async () => ({ channelId: "fame" }) }
    }) as never;
    expect(await wowChatChannel(db("guilde"), "g", QG)).toBe("guilde");
    expect(await wowChatChannel(db("deleted"), "g", QG)).toBe("1552239418855915600");
    expect(await wowChatChannel(db("chosen"), "g", [])).toBe("chosen");
    expect(await wowChatChannel(db(null), "g", QG)).toBe("1552239418855915600");
    expect(await wowChatChannel(db(null), "g", [cat("comm", "Community"), text("cc", "community-chat", "comm")])).toBe("cc");
    expect(await wowChatChannel(db(null), "g", [])).toBe("ann");
    expect(await wowChatChannel(db(null, null), "g", [])).toBe("fame");
    expect(await promotionCongratsChannel(db(null), "g", QG)).toBe("1552239418855915600");
  });
});

const NOW = new Date("2026-11-21T20:00:00Z");
let n = 0;
const row = (over: Partial<DonationRow> = {}): DonationRow => ({ id: `r${++n}`, kind: "item", type: "deposit", actor: "Kev Caron", itemId: 2589, itemName: "Linen Cloth", count: 20, amount: null,
  at: new Date(NOW.getTime() - 60 * 60_000), createdAt: new Date(NOW.getTime() - 30 * 60_000), ...over });
const gold = (copper: number, over: Partial<DonationRow> = {}) => row({ kind: "money", itemId: null, itemName: null, count: null, amount: BigInt(copper), ...over });
const open = { now: NOW, enabled: true, cardsLeft: DONATION_CARDS_PER_HOUR };

describe("planning donor cards", () => {
  it("groups one donor's items and gold into one card, never withdrawals", () => {
    const rows = [row(), row({ itemId: 4306, itemName: "Silk Cloth", count: 10 }), row(), gold(500_000), row({ type: "withdraw" }), gold(10_000, { type: "repair" })];
    const plan = planDonations(rows, [], open);
    expect(plan.single).toHaveLength(1);
    expect(plan.single[0]!.items).toEqual([{ itemId: 2589, name: "Linen Cloth", count: 40 }, { itemId: 4306, name: "Silk Cloth", count: 10 }]);
    expect(plan.single[0]!.copper).toBe(500_000n);
    expect(plan.seen.sort()).toEqual(rows.map((r) => r.id).sort());
  });
  it("waits while the donor is still depositing", () => {
    const fresh = row({ createdAt: new Date(NOW.getTime() - DONATION_SETTLE_MS + 60_000) });
    const plan = planDonations([row(), fresh], [], open);
    expect(plan.single).toEqual([]);
    expect(plan.seen).toEqual([]);
  });
  it("never announces a deposit dated more than a day before it was received (backlog)", () => {
    const old = row({ at: new Date(NOW.getTime() - 3 * 86_400_000) });
    const plan = planDonations([old], [], open);
    expect(plan.single).toEqual([]);
    expect(plan.seen).toEqual([old.id]);
  });
  it("passes over a line already seen from another upload", () => {
    const first = row({ at: new Date(NOW.getTime() - 5 * 3_600_000) });
    const again = row({ at: new Date(NOW.getTime() - 1 * 3_600_000) });
    const plan = planDonations([again], [first], open);
    expect(plan.single).toEqual([]);
    expect(plan.seen).toEqual([again.id]);
  });
  it("skips trivial gold-only deposits, keeps them with items", () => {
    expect(planDonations([gold(DONATION_MIN_COPPER - 1)], [], open).single).toEqual([]);
    expect(planDonations([gold(DONATION_MIN_COPPER)], [], open).single).toHaveLength(1);
    expect(planDonations([gold(5_000), row({ count: 1 })], [], open).single).toHaveLength(1);
  });
  it("folds donors past the hourly limit into one combined card, and waits when none is left", () => {
    const rows = ["A", "B", "C", "D", "E"].map((actor, i) => row({ actor, at: new Date(NOW.getTime() - (90 - i) * 60_000) }));
    const plan = planDonations(rows, [], { ...open, cardsLeft: 3 });
    expect(plan.single.map((g) => g.actor)).toEqual(["A", "B"]);
    expect(plan.combined.map((g) => g.actor)).toEqual(["C", "D", "E"]);
    const none = planDonations(rows, [], { ...open, cardsLeft: 0 });
    expect(none.single).toEqual([]); expect(none.combined).toEqual([]); expect(none.seen).toEqual([]);
  });
  it("switched off: lines are stamped, nothing is posted", () => {
    const plan = planDonations([row()], [], { ...open, enabled: false });
    expect(plan.single).toEqual([]);
    expect(plan.seen).toHaveLength(1);
  });
});

/** A small in-memory database: bank lines, settings, jobs. */
function memoryDb(settings: Record<string, unknown> = { language: "fr", guildBankDonationCards: true }) {
  const lines: (DonationRow & { guildId: string; tab: number | null; tab2: number | null; reportedById: string | null; donationSeenAt: Date | null; donationBackfill?: boolean })[] = [];
  const jobs = new Map<string, { payload: Record<string, unknown>; createdAt: Date }>();
  const clock = { now: NOW };
  const match = (r: (typeof lines)[number], where: Record<string, unknown>) => {
    if (where["guildId"] && r.guildId !== where["guildId"]) return false;
    if ("donationSeenAt" in where) { const w = where["donationSeenAt"]; if (w === null ? r.donationSeenAt !== null : r.donationSeenAt === null) return false; }
    const at = where["at"] as { gte?: Date } | undefined; if (at?.gte && r.at < at.gte) return false;
    const id = where["id"] as { in?: string[] } | undefined; if (id?.in && !id.in.includes(r.id)) return false;
    const type = where["type"] as { in?: string[] } | undefined; if (type?.in && !type.in.includes(r.type)) return false;
    if ("donationBackfill" in where && !!r.donationBackfill !== where["donationBackfill"]) return false;
    return true;
  };
  const db = {
    lines, jobs, clock,
    guildBankTransaction: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => lines.filter((r) => match(r, where)).map((r) => ({ ...r })),
      findFirst: async ({ where }: { where: Record<string, unknown> }) => lines.find((r) => match(r, where)) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => { lines.push({ id: `l${lines.length + 1}`, itemName: null, createdAt: new Date(), donationSeenAt: null, ...data } as never); return data; },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => { const hit = lines.filter((r) => match(r, where)); for (const r of hit) Object.assign(r, data); return { count: hit.length }; }
    },
    guildBankContents: { findUnique: async () => null, upsert: async () => null },
    guildBankGold: { findMany: async () => [], create: async () => null },
    guildSettings: { findUnique: async () => ({ wowChatChannelId: null, ...settings }) },
    communitySeason: { findFirst: async () => null }, communityHonors: { findUnique: async () => null },
    character: { findMany: async () => [{ name: "Kev", displayName: "Kev Caron", member: { discordUserId: "123456789012345678" } }] },
    discordJob: {
      count: async ({ where }: { where: { key?: { startsWith: string }; createdAt?: { gte: Date } } }) => [...jobs.entries()].filter(([k, j]) => (!where.key || k.startsWith(where.key.startsWith))
        && j.createdAt.getTime() >= (where.createdAt?.gte ?? new Date(NOW.getTime() - 3_600_000)).getTime()).length,
      upsert: async ({ where, create }: { where: { guildId_key: { key: string } }; create: { payload: Record<string, unknown> } }) => { jobs.set(where.guildId_key.key, { payload: create.payload, createdAt: clock.now }); return create; }
    }
  };
  return db;
}
const guild = { channels: { cache: new Map(QG.map((c) => [c.id, c])) } };
const upload = (hoursAgo: number) => ({ itemLog: [{ type: "deposit", name: "Kev", itemId: 2589, itemName: "Linen Cloth", count: 20, at: Math.floor((NOW.getTime() - hoursAgo * 3_600_000) / 1000) }],
  moneyLog: [{ type: "deposit", name: "Kev", amount: 1_250_000, at: Math.floor((NOW.getTime() - hoursAgo * 3_600_000) / 1000) }, { type: "withdraw", name: "Lina", amount: 900_000, at: Math.floor((NOW.getTime() - hoursAgo * 3_600_000) / 1000) }] });

describe("announcing donors end to end", () => {
  it("two officers upload the same log: one card, in chat-wow, never twice", async () => {
    const db = memoryDb();
    const received = new Date(NOW.getTime() - 40 * 60_000);
    await applyGuildBank(db as never, "g", "officer1", upload(1), received);
    await applyGuildBank(db as never, "g", "officer2", upload(2), received); // the second officer's game shows the same lines an hour older
    expect(db.lines).toHaveLength(3);
    for (const line of db.lines) line.createdAt = received;
    expect(await announceBankDonations(db as never, guild, "g", NOW)).toBe(1);
    expect(await announceBankDonations(db as never, guild, "g", NOW)).toBe(0);
    const [key, job] = [...db.jobs.entries()][0]!;
    expect(key.startsWith("bank-donation:")).toBe(true);
    expect(job.payload["channelId"]).toBe("1552239418855915600");
    expect(job.payload["mentionUsers"]).toBeUndefined();
    expect(job.payload["donorUserId"]).toBe("123456789012345678");
    expect((job.payload["message"] as { content: string }).content).toBe("🎁 Merci <@123456789012345678> pour ton don à la banque de guilde !");
    const card = job.payload["card"] as { donation: { name: string; lines: { text: string }[] } };
    expect(card.donation.lines.map((l) => l.text)).toEqual(["125g", "20 × Linen Cloth"]);
    expect(db.lines.every((l) => l.donationSeenAt)).toBe(true);
  });
  it("lines stamped by the migration (the backlog) never post", async () => {
    const db = memoryDb();
    await applyGuildBank(db as never, "g", "o", upload(1), new Date(NOW.getTime() - 40 * 60_000));
    for (const line of db.lines) { line.donationSeenAt = new Date(0); line.createdAt = new Date(NOW.getTime() - 40 * 60_000); }
    expect(await announceBankDonations(db as never, guild, "g", NOW)).toBe(0);
    expect(db.jobs.size).toBe(0);
  });
  it("switched off: nothing is queued and the lines are stamped", async () => {
    const db = memoryDb({ language: "en", guildBankDonationCards: false });
    await applyGuildBank(db as never, "g", "o", upload(1), new Date(NOW.getTime() - 40 * 60_000));
    for (const line of db.lines) line.createdAt = new Date(NOW.getTime() - 40 * 60_000);
    expect(await announceBankDonations(db as never, guild, "g", NOW)).toBe(0);
    expect(db.jobs.size).toBe(0);
    expect(db.lines.every((l) => l.donationSeenAt)).toBe(true);
  });
});

describe("backfill of past donors", () => {
  /** The backlog as the migration leaves it: stamped seen, flagged for the backfill. */
  const backlog = (db: ReturnType<typeof memoryDb>, actor: string, kind: "item" | "money", at: string, extra: Partial<DonationRow> = {}) => db.lines.push({
    id: `b${db.lines.length + 1}`, guildId: "g", kind, type: "deposit", actor, itemId: kind === "item" ? 2589 : null, itemName: kind === "item" ? "Linen Cloth" : null,
    count: kind === "item" ? 5 : null, amount: kind === "money" ? 30_000n : null, at: new Date(at), createdAt: new Date(at), tab: null, tab2: null, reportedById: null,
    donationSeenAt: new Date("2026-11-22T03:45:00Z"), donationBackfill: true, ...extra });

  it("one card per donor, oldest first, everything they gave, paced and never twice", async () => {
    const db = memoryDb({ language: "en", guildBankDonationCards: true });
    db.character.findMany = async () => [];
    backlog(db, "Lina Belle", "money", "2026-11-10T10:00:00Z");
    backlog(db, "Kev Caron", "item", "2026-11-05T10:00:00Z");
    backlog(db, "Kev Caron", "money", "2026-11-12T10:00:00Z", { amount: 5n }); // tiny gold still counts in the backfill
    backlog(db, "Kev Caron", "item", "2026-11-15T10:00:00Z", { count: 7 });
    expect(await backfillBankDonations(db as never, guild, "g", NOW)).toBe(1);
    const [key, job] = [...db.jobs.entries()][0]!;
    expect(key.startsWith("bank-donation:backfill:")).toBe(true);
    expect((job.payload["message"] as { content: string }).content).toBe("🎁 Thank you **Kev Caron** for everything you have given the guild bank!");
    const card = job.payload["card"] as { donation: { name: string; thanks: string; lines: { text: string }[] } };
    expect(card.donation.thanks).toBe("for all your donations to the guild bank");
    expect(card.donation.lines.map((l) => l.text)).toEqual(["5c", "12 × Linen Cloth"]);
    // Same sweep window: the 20-minute gap holds the next card.
    expect(await backfillBankDonations(db as never, guild, "g", NOW)).toBe(0);
    db.clock.now = new Date(NOW.getTime() + BACKFILL_GAP_MS + 1);
    const later = new Date(db.clock.now.getTime() + 1);
    expect(await backfillBankDonations(db as never, guild, "g", later)).toBe(1);
    expect((db.jobs.get([...db.jobs.keys()][1]!)!.payload["message"] as { content: string }).content).toContain("Lina Belle");
    expect(db.lines.every((l) => !l.donationBackfill)).toBe(true);
    expect(await backfillBankDonations(db as never, guild, "g", new Date(later.getTime() + 2 * BACKFILL_GAP_MS))).toBe(0);
    expect(db.jobs.size).toBe(2);
  });
  it("a member's characters share one card", async () => {
    const db = memoryDb({ language: "fr", guildBankDonationCards: true });
    db.character.findMany = async () => [{ name: "Kev", displayName: "Kev Caron", member: { discordUserId: "123456789012345678" } }];
    backlog(db, "Kev Caron", "item", "2026-11-05T10:00:00Z");
    backlog(db, "Kev Alt", "money", "2026-11-06T10:00:00Z");
    expect(await backfillBankDonations(db as never, guild, "g", NOW)).toBe(1);
    const job = [...db.jobs.values()][0]!;
    expect((job.payload["message"] as { content: string }).content).toBe("🎁 Merci <@123456789012345678> pour tout ce que tu as donné à la banque de guilde !");
    expect((job.payload["card"] as { donation: { lines: { text: string }[] } }).donation.lines.map((l) => l.text)).toEqual(["3g", "5 × Linen Cloth"]);
    expect(db.lines.every((l) => !l.donationBackfill)).toBe(true);
  });
  it("new donors go first, the hourly budget is shared, and switched off drops the backlog", async () => {
    const db = memoryDb({ language: "en", guildBankDonationCards: true });
    backlog(db, "Kev Caron", "item", "2026-11-05T10:00:00Z");
    db.lines.push({ ...db.lines[0]!, id: "fresh", donationSeenAt: null, donationBackfill: false });
    expect(await backfillBankDonations(db as never, guild, "g", NOW)).toBe(0);
    db.lines.pop();
    for (let i = 0; i < 3; i++) db.jobs.set(`bank-donation:r${i}`, { payload: {}, createdAt: new Date(NOW.getTime() - 30 * 60_000) });
    expect(await backfillBankDonations(db as never, guild, "g", NOW)).toBe(0);
    const off = memoryDb({ language: "en", guildBankDonationCards: false });
    backlog(off, "Kev Caron", "item", "2026-11-05T10:00:00Z");
    expect(await backfillBankDonations(off as never, guild, "g", NOW)).toBe(0);
    expect(off.lines[0]!.donationBackfill).toBe(false);
    expect(off.jobs.size).toBe(0);
  });
});

describe("donor card", () => {
  const donor = { name: "Kev Caron", character: "Kev Caron", gold: "125g 40s 0c", items: [
    { itemId: 2589, name: "Linen Cloth", count: 40 }, { itemId: 4306, name: "Silk Cloth", count: 20, quality: 1 }, { itemId: 2447, name: "Peacebloom", count: 12 },
    { itemId: 765, name: "Silverleaf", count: 8 }, { itemId: 2770, name: "Copper Ore", count: 5 }, { itemId: 818, name: "Tigerseye", count: 1, quality: 2 }] };
  it("lists gold, the largest items and the rest as a count, in both languages", () => {
    expect(donationLines(donor, "en").map((l) => l.text)).toEqual(["125g 40s 0c", "40 × Linen Cloth", "20 × Silk Cloth", "12 × Peacebloom", "and 3 more items"]);
    expect(donationLines(donor, "fr").at(-1)!.text).toBe("et 3 autres objets");
    expect(donationLines({ gold: "50g 0s 0c", items: [] }, "en")).toEqual([{ kind: "gold", text: "50g 0s 0c" }]);
  });
  it("texts: warm FR/EN lines, combined names", () => {
    expect(donationText("**Kev Caron**", "en")).toBe("🎁 Thank you **Kev Caron** for your donation to the guild bank!");
    expect(donationText("**Kev Caron**", "fr")).toBe("🎁 Merci **Kev Caron** pour ton don à la banque de guilde !");
    expect(combinedDonationText(["A", "B", "C"], "fr")).toBe("🎁 Merci à A, B et C pour vos dons à la banque de guilde !");
    expect(combinedDonationText(["A", "B"], "en")).toBe("🎁 Thank you A and B for your donations to the guild bank!");
  });
  it("carries no product branding", () => {
    for (const card of [donationCard("fr", donor), donationCard("en", donor), combinedDonationCard("en", [donor, { ...donor, name: "Lina" }])]) {
      expect(JSON.stringify(card)).not.toMatch(/guilded/i);
      expect(unbrandCard(card).footer).toBe(card.footer);
    }
  });
  it("adds icons from Blizzard's render host only", async () => {
    const card = donationCard("en", donor);
    const png = Buffer.from("icon");
    const out = await withDonationIcons(card, async (id) => id === 2589 ? "https://render.worldofwarcraft.com/us/icons/56/inv_fabric_linen_01.jpg" : undefined, async () => png);
    expect(out.donation!.lines[1]!.icon).toBe(png.toString("base64"));
    expect(out.donation!.lines[2]!.icon).toBeUndefined();
    expect(await downloadIcon("https://evil.example/x.jpg", (async () => { throw new Error("no fetch"); }) as never)).toBeNull();
    expect(await downloadIcon("http://render.worldofwarcraft.com/x.jpg")).toBeNull();
  });
  it("draws single, gold-only and combined cards", async () => {
    expect((await renderDonationCard(donationCard("fr", donor)))?.length).toBeGreaterThan(1000);
    expect((await renderDonationCard(donationCard("en", { ...donor, items: [] })))?.length).toBeGreaterThan(1000);
    expect((await renderDonationCard(combinedDonationCard("fr", [donor, { ...donor, name: "Lina", items: [] }, { ...donor, name: "Marc", gold: null }])))?.length).toBeGreaterThan(1000);
  }, 60_000);
});

describe("donationGold", () => {
  it("leaves out empty parts", async () => {
    const { donationGold } = await import("../src/services/bank-donations.js");
    expect([donationGold(1_254_000n), donationGold(500_000n), donationGold(7_500n), donationGold(1_250_050n)]).toEqual(["125g 40s", "50g", "75s", "125g 50c"]);
  });
});
