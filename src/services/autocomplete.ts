import type { PrismaClient, RaidStatus } from "@prisma/client";
import { formatRaidTime } from "./raid-time.js";

// Suggestions for ID options: people type a name, pick from the list, and
// the command receives the ID. Discord allows 25 choices, 100 chars each.

export interface Choice { name: string; value: string }

const MAX = 25;
const clip = (text: string) => (text.length > 100 ? `${text.slice(0, 99)}…` : text);
const matches = (query: string, ...fields: (string | null | undefined)[]) => {
  const needle = query.trim().toLowerCase();
  return !needle || fields.some((field) => field?.toLowerCase().includes(needle));
};

// Which raids make sense for each /raid subcommand.
export function raidStatusesFor(subcommand: string | null): RaidStatus[] {
  switch (subcommand) {
    case "signup": case "cancel-signup": case "edit": case "cancel": case "start": return ["PLANNED"];
    case "end": return ["ACTIVE"];
    case "attendance": case "boss": return ["ACTIVE", "COMPLETED"];
    default: return ["PLANNED", "ACTIVE", "COMPLETED"];
  }
}

export async function raidChoices(
  database: Pick<PrismaClient, "raid">,
  input: { guildId: string; query: string; statuses: RaidStatus[]; testOnly?: boolean; timeZone: string; language: string }
): Promise<Choice[]> {
  const raids = await database.raid.findMany({
    where: {
      guildId: input.guildId,
      status: { in: input.statuses },
      ...(input.testOnly ? { isTest: true } : {}),
      // Upcoming raids plus the last 60 days.
      scheduledAt: { gte: new Date(Date.now() - 60 * 86_400_000) }
    },
    orderBy: { scheduledAt: "asc" },
    take: 100
  });
  const now = Date.now();
  // Upcoming first (soonest first), then past (most recent first).
  const time = (raid: { scheduledAt: Date }) => raid.scheduledAt.getTime();
  const upcoming = raids.filter((raid) => time(raid) >= now).sort((a, b) => time(a) - time(b));
  const past = raids.filter((raid) => time(raid) < now).sort((a, b) => time(b) - time(a));
  return [...upcoming, ...past]
    .filter((raid) => matches(input.query, raid.title, raid.id))
    .slice(0, MAX)
    .map((raid) => ({
      name: clip(`${raid.title} — ${formatRaidTime(raid.scheduledAt, input.timeZone, input.language)} (${raid.status.toLowerCase()})`),
      value: raid.id
    }));
}

export async function coreChoices(database: Pick<PrismaClient, "raidCore">, guildId: string, query: string, separatePoolOnly = false): Promise<Choice[]> {
  const cores = await database.raidCore.findMany({ where: { guildId, ...(separatePoolOnly ? { separatePool: true } : {}) }, orderBy: { name: "asc" }, take: 50 });
  return cores.filter((core) => matches(query, core.name)).slice(0, MAX).map((core) => ({ name: clip(core.name), value: core.name }));
}

export async function auctionChoices(database: Pick<PrismaClient, "auction">, guildId: string, query: string): Promise<Choice[]> {
  const auctions = await database.auction.findMany({ where: { guildId, status: "ACTIVE" }, orderBy: { closesAt: "asc" }, take: 50 });
  return auctions.filter((auction) => matches(query, auction.itemName, auction.id)).slice(0, MAX)
    .map((auction) => ({ name: clip(`${auction.itemName} (min ${auction.minimumBid} GP)`), value: auction.id }));
}

export async function bankChoices(
  database: Pick<PrismaClient, "bankRequest">, guildId: string, query: string, memberId: string | null
): Promise<Choice[]> {
  const requests = await database.bankRequest.findMany({
    where: { guildId, status: { in: ["PENDING", "APPROVED"] }, ...(memberId ? { memberId } : {}) },
    include: { member: true },
    orderBy: { createdAt: "asc" },
    take: 50
  });
  return requests.filter((r) => matches(query, r.item, r.member.displayName, r.id)).slice(0, MAX)
    .map((r) => ({ name: clip(`${r.quantity} × ${r.item} — ${r.member.displayName} (${r.status.toLowerCase()})`), value: r.id }));
}

// claim: open requests from others; done/release: ones I claimed; cancel: mine.
export async function craftChoices(
  database: Pick<PrismaClient, "craftRequest">, guildId: string, query: string, subcommand: string, memberId: string
): Promise<Choice[]> {
  const where = subcommand === "claim"
    ? { guildId, status: "OPEN" as const, requesterId: { not: memberId } }
    : subcommand === "cancel"
      ? { guildId, status: { in: ["OPEN" as const, "CLAIMED" as const] }, requesterId: memberId }
      : { guildId, status: "CLAIMED" as const, crafterId: memberId };
  const requests = await database.craftRequest.findMany({ where, include: { requester: true }, orderBy: { createdAt: "asc" }, take: 50 });
  return requests.filter((r) => matches(query, r.item, r.profession, r.requester.displayName, r.id)).slice(0, MAX)
    .map((r) => ({ name: clip(`${r.quantity} × ${r.item} for ${r.requester.displayName}`), value: r.id }));
}

export async function epgpEntryChoices(database: Pick<PrismaClient, "epgpTransaction">, guildId: string, query: string): Promise<Choice[]> {
  const entries = await database.epgpTransaction.findMany({
    where: { guildId, type: { not: "REVERSAL" } },
    include: { member: true },
    orderBy: { createdAt: "desc" },
    take: 100
  });
  return entries.filter((e) => matches(query, e.member.displayName, e.reason, e.id)).slice(0, MAX).map((e) => {
    const change = [e.epAmount ? `${e.epAmount > 0 ? "+" : ""}${e.epAmount} EP` : "", e.gpAmount ? `${e.gpAmount > 0 ? "+" : ""}${e.gpAmount} GP` : ""].filter(Boolean).join(", ");
    return { name: clip(`${e.member.displayName}: ${change} — ${e.reason} (${e.createdAt.toISOString().slice(0, 10)})`), value: e.id };
  });
}

export async function applicationChoices(database: Pick<PrismaClient, "application">, guildId: string, query: string): Promise<Choice[]> {
  const applications = await database.application.findMany({
    where: { guildId, status: { in: ["PENDING", "TRIAL"] } },
    orderBy: { createdAt: "asc" },
    take: 50
  });
  return applications.filter((a) => matches(query, a.character, a.className, a.id)).slice(0, MAX)
    .map((a) => ({ name: clip(`${a.character} — ${a.className} ${a.spec} (${a.status.toLowerCase()})`), value: a.id }));
}

export async function importChoices(database: Pick<PrismaClient, "addonImport">, guildId: string, query: string): Promise<Choice[]> {
  const imports = await database.addonImport.findMany({ where: { guildId, status: "PREVIEWED" }, orderBy: { createdAt: "desc" }, take: 25 });
  return imports.filter((i) => matches(query, i.source, i.id)).map((i) => ({
    name: clip(`${i.source} upload from ${i.createdAt.toISOString().replace("T", " ").slice(0, 16)} UTC`),
    value: i.id
  }));
}
