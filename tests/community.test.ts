import { describe, expect, it, vi } from "vitest";
import { Collection, PermissionFlagsBits, type GuildMember } from "discord.js";
import { canAccessCommunity, communityCard } from "../src/commands/community.js";
import { createCommunityService } from "../src/services/community.js";
import type { CommunityActivity, CommunitySeason } from "@prisma/client";
import { commands } from "../src/commands/index.js";
import { assertLotteryGame, dicePoints, drawWinners, evidenceReference, lotteryRules, standings } from "../src/services/community-rules.js";

const now = new Date("2026-10-01T12:00:00Z");
const endsAt = new Date("2026-10-02T12:00:00Z");
const rules = { mode: "POINTS", cost: 10, prize: "A cosmetic prize", currency: "points", realm: "", winners: 2, maxTickets: 10 };
const season = { id: "season", guildId: "guild", game: "DISCORD", name: "October", number: 1, announcementChannelId: null, monthly: true, status: "ACTIVE", channelId: "channel", audienceRoleId: null, createdBy: "officer", createdAt: now, endedAt: null, finalStandings: null };
const activity: CommunityActivity & { season: CommunitySeason } = { id: "activity", seasonId: season.id, season, kind: "LOTTERY", title: "Draw", rules, status: "OPEN", startsAt: null, endsAt, createdBy: "officer", createdAt: now, messageId: null, postedChannelId: null, reminderAt: null, result: null };
const member = (roles: string[], officer = false, bot = false) => ({ user: { bot }, roles: { cache: new Collection(roles.map(id => [id, { id, name: id }])) }, permissions: { has: (permission: unknown) => officer && permission === "Administrator", bitfield: officer ? PermissionFlagsBits.Administrator : 0n } }) as unknown as GuildMember;

function store(row = activity) {
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    communitySeasonCounter: { upsert: vi.fn(async () => ({ nextNumber: 2 })) },
    auditLog: { create: vi.fn(async args => args.data) },
    communitySeason: { findFirst: vi.fn(async () => season), update: vi.fn(async ({ data }) => ({ ...season, ...data })), create: vi.fn(async ({ data }) => ({ ...season, ...data })) },
    communityActivity: {
      findFirst: vi.fn(async ({ where }) => where.season?.guildId && where.season.guildId !== season.guildId ? null : row),
      findMany: vi.fn(async () => []), count: vi.fn(async () => 0),
      create: vi.fn(async ({ data }) => ({ ...row, ...data })), update: vi.fn(async ({ data }) => ({ ...row, ...data }))
    },
    communityEntry: { findUnique: vi.fn(async (): Promise<Record<string, unknown> | null> => null), findFirst: vi.fn(async (): Promise<Record<string, unknown> | null> => null), findMany: vi.fn(async () => [] as Record<string, unknown>[]), count: vi.fn(async () => 0), create: vi.fn(async ({ data }) => ({ id: "entry", ...data })), update: vi.fn(async ({ data }) => ({ id: "entry", ...data })), upsert: vi.fn(async ({ create }) => ({ id: "entry", ...create })) },
    communityPoint: { aggregate: vi.fn(async () => ({ _sum: { amount: 100 } })), create: vi.fn(async ({ data }) => data), findMany: vi.fn(async () => [] as Record<string, unknown>[]) },
    communityKudos: { count: vi.fn(async () => 0) },
    discordJob: { upsert: vi.fn(async args => args.create), updateMany: vi.fn(async () => ({ count: 1 })) },
    guildSettings: { findUnique: vi.fn(async () => ({ language: "fr" })) }
  };
  const db = { ...tx, $transaction: vi.fn(async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx)) };
  return { tx, service: createCommunityService(db as never) };
}

describe("community accounting and lottery rules", () => {
  it("spending changes the wallet while the earned leaderboard stays intact", () => {
    expect(standings([{ userId: "a", amount: 100, kind: "AWARD" }, { userId: "a", amount: -30, kind: "SPEND" }, { userId: "a", amount: 10, kind: "REFUND" }, { userId: "a", amount: -20, kind: "REVERSAL" }])).toEqual([{ userId: "a", points: 80, balance: 60 }]);
  });
  it("draws by ticket weight and removes all of a winner's tickets", () => {
    const entries = [{ userId: "a", quantity: 3, status: "CONFIRMED" }, { userId: "b", quantity: 1, status: "CONFIRMED" }, { userId: "pending", quantity: 1000, status: "PENDING" }];
    const rng = vi.fn().mockReturnValueOnce(2).mockReturnValueOnce(0);
    expect(drawWinners(entries, 3, rng)).toEqual(["a", "b"]);
    expect(rng.mock.calls.map(call => call[0])).toEqual([4, 1]);
    expect(drawWinners([], 1)).toEqual([]);
  });
  it("selects the next person at the exact ticket boundary", () => {
    expect(drawWinners([{ userId: "a", quantity: 3, status: "CONFIRMED" }, { userId: "b", quantity: 2, status: "CONFIRMED" }], 1, () => 3)).toEqual(["b"]);
  });
  it("rejects invalid weights, duplicated users and unlimited winners", () => {
    expect(() => drawWinners([{ userId: "a", quantity: 0, status: "CONFIRMED" }], 1)).toThrow();
    expect(() => drawWinners([{ userId: "a", quantity: 1, status: "CONFIRMED" }, { userId: "a", quantity: 2, status: "CONFIRMED" }], 1)).toThrow();
    expect(() => drawWinners([], 100)).toThrow();
  });
  it("requires realm/league and currency for external payments and one free ticket", () => {
    expect(lotteryRules.safeParse({ ...rules, mode: "POE_CURRENCY" }).success).toBe(false);
    expect(lotteryRules.safeParse({ ...rules, mode: "FREE", cost: 0, maxTickets: 1 }).success).toBe(true);
    expect(lotteryRules.safeParse({ ...rules, mode: "FREE", cost: 0 }).success).toBe(false);
    expect(() => assertLotteryGame("POE2", "WOW_GOLD")).toThrow();
    expect(() => assertLotteryGame("WOW", "POE_CURRENCY")).toThrow();
  });
  it("records HTTPS references without fetching untrusted evidence", () => {
    expect(evidenceReference("https://example.com/proof.png")).toBe("https://example.com/proof.png");
    expect(() => evidenceReference("http://example.com/proof")).toThrow();
    expect(() => evidenceReference("https://user:password@example.com/")).toThrow();
  });
});

describe("community state transitions", () => {
  it.each([
    ["EVENT", { capacity: 8 }, 25],
    ["CHALLENGE", { instructions: "Help the group; provide proof" }, 30]
  ])("saves the new %s reward default when creating an activity", async (kind, rules, expected) => {
    const s = store();
    const created = await s.service.create("guild", "season", { kind, title: "Cooperative activity", rules, startsAt: new Date(now.getTime() + 60_000), endsAt, actorId: "officer" }, now);
    expect(created.rules).toMatchObject({ points: expected });
  });
  it("awards the new dice rate once and freezes the round's rules", async () => {
    const s = store();
    s.tx.communityActivity.findFirst.mockResolvedValueOnce(null);
    const entry = await s.service.dice("guild", "season", "member", "2026-10-01", now);
    const expected = Number(entry.evidence) >= 90 ? 5 : 2;
    expect(entry.awardedPoints).toBe(expected);
    expect(s.tx.communityPoint.create).toHaveBeenCalledWith({ data: expect.objectContaining({ amount: expected }) });
    expect(s.tx.communityActivity.create).toHaveBeenCalledWith({ data: expect.objectContaining({ rules: { participation: 2, bonus: 3, threshold: 90 } }) });
  });
  it("keeps legacy dice rewards for later players in an existing round", async () => {
    const s = store({ ...activity, kind: "DICE", rules: { participation: 5, bonus: 10, threshold: 90 } });
    const entry = await s.service.dice("guild", "season", "member", "2026-10-01", now);
    expect(entry.awardedPoints).toBe(Number(entry.evidence) >= 90 ? 15 : 5);
    expect(s.tx.communityPoint.create).toHaveBeenCalledWith({ data: expect.objectContaining({ amount: entry.awardedPoints }) });
    expect(dicePoints(89, { participation: 2, bonus: 3, threshold: 90 })).toBe(2);
    expect(dicePoints(90, { participation: 2, bonus: 3, threshold: 90 })).toBe(5);
  });
  it("renames a season without changing its identity and refreshes existing activity posts", async () => {
    const s = store();
    s.tx.communityActivity.findMany.mockResolvedValue([activity] as never);
    const updated = await s.service.configureSeason("guild", "season", "officer", { name: "Automne", announcementChannelId: "activities" });
    expect(updated).toMatchObject({ id: "season", number: 1, name: "Automne", channelId: "channel", announcementChannelId: "activities" });
    expect(s.tx.communityPoint.create).not.toHaveBeenCalled();
    expect(s.tx.auditLog.create).toHaveBeenCalledOnce();
    expect(s.tx.discordJob.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ kind: "COMMUNITY_POST" }) }));
  });
  it("debits points once and queues publication with the same transaction", async () => {
    const s = store();
    const entry = await s.service.enterLottery("guild", "activity", "member", 3, now);
    expect(entry.status).toBe("CONFIRMED");
    expect(s.tx.communityPoint.create).toHaveBeenCalledWith({ data: expect.objectContaining({ amount: -30, kind: "SPEND", reference: "lottery:activity:member" }) });
    expect(s.tx.discordJob.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ kind: "COMMUNITY_POST", guildId: "guild" }) }));
    s.tx.communityEntry.findUnique.mockResolvedValue(entry);
    await s.service.enterLottery("guild", "activity", "member", 3, now);
    expect(s.tx.communityPoint.create).toHaveBeenCalledTimes(1);
  });
  it("rejects insufficient balances before creating tickets", async () => {
    const s = store();
    s.tx.communityPoint.aggregate.mockResolvedValue({ _sum: { amount: 5 } });
    await expect(s.service.enterLottery("guild", "activity", "member", 1, now)).rejects.toThrow(/Points insuffisants/);
    expect(s.tx.communityEntry.create).not.toHaveBeenCalled();
    expect(s.tx.communityPoint.create).not.toHaveBeenCalled();
  });
  it("fails cross-guild activity IDs before any writes", async () => {
    const s = store();
    await expect(s.service.enterLottery("other", "activity", "member", 1, now)).rejects.toThrow(/introuvable/);
    expect(s.tx.communityEntry.create).not.toHaveBeenCalled();
  });
  it("does not accept entries or payments at the closing boundary", async () => {
    const s = store();
    await expect(s.service.enterLottery("guild", "activity", "member", 1, endsAt)).rejects.toThrow(/fermées/);
    await expect(s.service.confirmPayment("guild", "activity", "member", "officer", "Trade", endsAt)).rejects.toThrow(/fermées/);
  });
  it("stores external payment requests without awarding eligible tickets", async () => {
    const s = store({ ...activity, rules: { ...rules, mode: "WOW_GOLD", currency: "gold", realm: "Realm A / Alliance" } });
    expect((await s.service.enterLottery("guild", "activity", "member", 2, now)).status).toBe("PENDING");
    expect(s.tx.communityPoint.create).not.toHaveBeenCalled();
    await expect(s.service.confirmPayment("guild", "activity", "member", "member", "Trade", now)).rejects.toThrow(/autre organisateur/);
    s.tx.communityEntry.findUnique.mockResolvedValue({ id: "entry", status: "PENDING" });
    await s.service.confirmPayment("guild", "activity", "member", "officer", "20 gold traded", now);
    expect(s.tx.communityEntry.update).toHaveBeenCalledWith({ where: { id: "entry" }, data: { status: "CONFIRMED", reviewedBy: "officer", reviewNote: "20 gold traded" } });
  });
  it("prevents early lottery draws and reuses closed results", async () => {
    const s = store();
    await expect(s.service.close("guild", "activity", false, now)).rejects.toThrow(/fermeture annoncée/);
    s.tx.communityActivity.findFirst.mockResolvedValue({ ...activity, status: "CLOSED", result: { winners: ["winner"] } } as never);
    expect((await s.service.close("guild", "activity", false, endsAt)).result).toEqual({ winners: ["winner"] });
    expect(s.tx.communityActivity.update).not.toHaveBeenCalled();
  });
  it("refunds confirmed points tickets when cancelling", async () => {
    const s = store();
    s.tx.communityEntry.findMany.mockResolvedValue([{ userId: "member", quantity: 3, status: "CONFIRMED" }]);
    await s.service.close("guild", "activity", true, now);
    expect(s.tx.communityPoint.create).toHaveBeenCalledWith({ data: expect.objectContaining({ amount: 30, kind: "REFUND", reference: "refund:activity:member" }) });
  });
  it("preserves a list of external refunds without claiming to refund game currency", async () => {
    const s = store({ ...activity, rules: { ...rules, mode: "POE_CURRENCY", currency: "Divine Orb", realm: "League A / trade" } });
    s.tx.communityEntry.findMany.mockResolvedValue([{ userId: "member", quantity: 3, status: "CONFIRMED" }]);
    const closed = await s.service.close("guild", "activity", true, now);
    expect(closed.result).toEqual({ externalRefundsRequired: [{ userId: "member", amount: 30 }] });
    expect(s.tx.communityPoint.create).not.toHaveBeenCalled();
  });
  it("waitlists a full event and promotes the earliest waiting member", async () => {
    const s = store({ ...activity, kind: "EVENT", startsAt: endsAt, endsAt: new Date("2026-10-02T15:00:00Z"), rules: { capacity: 1, points: 10 } as never });
    s.tx.communityEntry.count.mockResolvedValue(1);
    expect((await s.service.signup("guild", "activity", "member", "JOINED", now)).status).toBe("WAITLISTED");
    s.tx.communityEntry.findUnique.mockResolvedValue({ id: "entry", status: "JOINED" });
    s.tx.communityEntry.findFirst.mockResolvedValue({ id: "waiting", status: "WAITLISTED" });
    await s.service.signup("guild", "activity", "member", "ABSENT", now);
    expect(s.tx.communityEntry.update).toHaveBeenCalledWith({ where: { id: "waiting" }, data: { status: "JOINED" } });
  });
  it("edits a future gaming night without changing attendance or points and retires its old reminder", async () => {
    const s = store({ ...activity, kind: "EVENT", startsAt: endsAt, endsAt: new Date("2026-10-02T15:00:00Z"), rules: { capacity: 8, points: 10 } });
    const moved = new Date("2026-10-03T12:00:00Z");
    const saved = await s.service.editEvent("guild", "activity", { title: "New night", startsAt: moved, endsAt: new Date("2026-10-03T15:00:00Z"), voiceChannelId: "voice" }, now);
    expect(saved.title).toBe("New night");
    expect(s.tx.communityActivity.update).toHaveBeenCalledWith({ where: { id: "activity" }, data: expect.objectContaining({ startsAt: moved, reminderAt: null, rules: { capacity: 8, points: 10, voiceChannelId: "voice" } }) });
    expect(s.tx.discordJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { guildId: "guild", key: "community-reminder:activity", status: "PENDING" } }));
    expect(s.tx.communityEntry.update).not.toHaveBeenCalled();
    expect(s.tx.communityPoint.create).not.toHaveBeenCalled();
    expect(s.tx.discordJob.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ kind: "COMMUNITY_POST" }) }));
  });
  it("rejects gaming-night edits with invalid dates or once the night started", async () => {
    const s = store({ ...activity, kind: "EVENT", startsAt: endsAt, endsAt: new Date("2026-10-02T15:00:00Z"), rules: { capacity: 8, points: 10 } });
    await expect(s.service.editEvent("guild", "activity", { endsAt: now }, now)).rejects.toThrow(/date invalide/);
    await expect(s.service.editEvent("guild", "activity", { title: "Changed" }, endsAt)).rejects.toThrow(/soirées à venir/);
    expect(s.tx.communityActivity.update).not.toHaveBeenCalled();
  });
  it("attendance awards require a real signup and another organizer", async () => {
    const s = store({ ...activity, kind: "EVENT", startsAt: now, rules: { capacity: 10, points: 10 } as never });
    await expect(s.service.attendance("guild", "activity", "member", "member", now)).rejects.toThrow(/autre organisateur/);
    await expect(s.service.attendance("guild", "activity", "member", "officer", now)).rejects.toThrow(/Inscription/);
    s.tx.communityEntry.findUnique.mockResolvedValue({ id: "entry", status: "JOINED" });
    const entry = await s.service.attendance("guild", "activity", "member", "officer", now);
    s.tx.communityEntry.findUnique.mockResolvedValue(entry);
    await s.service.attendance("guild", "activity", "member", "officer", now);
    expect(s.tx.communityPoint.create).toHaveBeenCalledTimes(1);
  });
  it("cannot self-approve a claim and reverses with an appended ledger entry", async () => {
    const s = store({ ...activity, kind: "CHALLENGE", rules: { instructions: "Finish with proof", points: 20 } as never });
    await expect(s.service.review("guild", "activity", "member", "member", "APPROVE", "Confirmed")).rejects.toThrow(/ton résultat/);
    s.tx.communityEntry.findUnique.mockResolvedValue({ id: "entry", status: "PENDING" });
    const entry = await s.service.review("guild", "activity", "member", "officer", "APPROVE", "Confirmed");
    s.tx.communityEntry.findUnique.mockResolvedValue(entry);
    await s.service.review("guild", "activity", "member", "officer", "APPROVE", "Confirmed");
    await s.service.review("guild", "activity", "member", "officer", "REVERSE", "Incorrect proof");
    expect(s.tx.communityPoint.create.mock.calls.map(call => call[0].data.amount)).toEqual([20, -20]);
  });
  it("does not grant quiz authors points and keeps repeated answers idempotent", async () => {
    const s = store({ ...activity, kind: "QUIZ", rules: { choices: ["One", "Two", "Three", "Four"], correct: 0, points: 10 } as never });
    await expect(s.service.answerQuiz("guild", "activity", "officer", 0, now)).rejects.toThrow(/auteur/);
    const entry = await s.service.answerQuiz("guild", "activity", "member", 0, now);
    s.tx.communityEntry.findUnique.mockResolvedValue(entry);
    await s.service.answerQuiz("guild", "activity", "member", 1, now);
    expect(s.tx.communityPoint.create).toHaveBeenCalledTimes(1);
  });
  it("returns a previous daily roll rather than rewarding a second click", async () => {
    const s = store({ ...activity, kind: "DICE", rules: { participation: 5, bonus: 10, threshold: 90 } });
    s.tx.communityEntry.findUnique.mockResolvedValue({ id: "entry", status: "PLAYED", evidence: "95" });
    expect(await s.service.dice("guild", "season", "member", "2026-10-01", now)).toMatchObject({ evidence: "95", awardedPoints: 15 });
    expect(s.tx.communityPoint.create).not.toHaveBeenCalled();
  });
  it("will not archive open activities or pending evidence", async () => {
    const s = store();
    s.tx.communityActivity.count.mockResolvedValue(1);
    await expect(s.service.endSeason("guild", "season")).rejects.toThrow(/Ferme les activités/);
    s.tx.communityActivity.count.mockResolvedValue(0);
    s.tx.communityEntry.count.mockResolvedValue(1);
    await expect(s.service.endSeason("guild", "season")).rejects.toThrow(/preuves en attente/);
    s.tx.communityEntry.count.mockResolvedValue(0);
    s.tx.communityKudos.count.mockResolvedValue(1);
    await expect(s.service.endSeason("guild", "season")).rejects.toThrow(/nominations/);
    expect(s.tx.communitySeason.update).not.toHaveBeenCalled();
  });
});

describe("community visibility and French UI", () => {
  it("fits the Discord command text limit in both French and English", () => {
    type Node = { name?: string; description?: string; description_localizations?: { fr?: string }; value?: string; options?: Node[]; choices?: Node[] };
    const size = (node: Node, lang: "fr" | "en"): number => (node.name?.length ?? 0) + (lang === "fr" ? node.description_localizations?.fr ?? node.description ?? "" : node.description ?? "").length + (typeof node.value === "string" ? node.value.length : 0) + [...(node.options ?? []), ...(node.choices ?? [])].reduce((total, child) => total + size(child, lang), 0);
    const command = commands.find(command => command.name === "community")!.toJSON() as Node;
    expect(size(command, "fr")).toBeLessThanOrEqual(4000);
    expect(size(command, "en")).toBeLessThanOrEqual(4000);
  });
  it("requires the selected game role and channel visibility; bots cannot play", () => {
    expect(canAccessCommunity(member(["wow"]), { audienceRoleId: "poe" }, true)).toBe(false);
    expect(canAccessCommunity(member(["poe"]), { audienceRoleId: "poe" }, true)).toBe(true);
    expect(canAccessCommunity(member([], true), { audienceRoleId: "poe" }, false)).toBe(false);
    expect(canAccessCommunity(member([], true), { audienceRoleId: "poe" }, true)).toBe(true);
    expect(canAccessCommunity(member(["poe"], false, true), { audienceRoleId: "poe" }, true)).toBe(false);
  });
  it("does not leak the quiz answer into its public message while open", () => {
    const quiz = { ...activity, kind: "QUIZ", endsAt: new Date("2099-10-01T12:00:00Z"), rules: { choices: ["One", "Two", "Three", "Four"], correct: 2, points: 10 } };
    const card = communityCard(quiz as never, [], "fr");
    expect(card.embeds[0]!.data.description).toContain("Un essai");
    expect(card.embeds[0]!.data.description).not.toContain("Réponse : C");
    expect(card.components[0]!.components).toHaveLength(4);
    expect(communityCard({ ...quiz, status: "CLOSED" } as never, [], "fr").embeds[0]!.data.description).toContain("Réponse : C");
  });
  it("shows payment confirmation rules without publishing private receipts", () => {
    const card = communityCard({ ...activity, rules: { ...rules, mode: "WOW_GOLD", currency: "gold", realm: "Realm A" } } as never, [{ userId: "member", status: "PENDING", quantity: 5 }], "fr");
    expect(card.embeds[0]!.data.description).toContain("0 billets confirmés");
    expect(card.embeds[0]!.data.description).toContain("Un organisateur confirme");
    expect(card.allowedMentions.parse).toEqual([]);
  });
});
