import type { PrismaClient } from "../generated/prisma/client.js";
import type { DiscordIdentity } from "./web-auth.js";
import type { ListingFields, PublicCard, PublicListing } from "./recruitment.js";

// What the website pages read and write. One Prisma implementation (below) and an in-memory one
// in the tests, so the page flows are tested without a database.

export interface WebAccountView { id: string; discordUserId: string; username: string; displayName: string | null }
export type ApplicationStatus = "PENDING" | "ACCEPTED" | "DECLINED" | "SPAM";
export interface NewApplication { listingId: string; accountId: string; character: string; className: string; role: string; message: string }
export interface MyApplication { id: string; guildName: string; coreName: string | null; character: string; status: string; createdAt: Date }
export interface CardFields {
  character: string; className: string; role: string; level: number | null; realm: string | null; faction: string | null;
  language: string | null; raidDays: string[]; note: string | null; showDiscord: boolean;
}
export interface DecisionView {
  id: string; status: string; character: string; className: string; role: string; message: string;
  guildDiscordId: string; guildName: string; coreName: string | null; discordUserId: string; username: string; inviteUrl: string | null;
}

export interface WebStore {
  upsertAccount(identity: DiscordIdentity, now: Date): Promise<{ id: string }>;
  createSession(accountId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  sessionAccount(tokenHash: string, now: Date): Promise<WebAccountView | null>;
  deleteSession(tokenHash: string): Promise<void>;

  openListings(): Promise<PublicListing[]>;
  listing(id: string): Promise<PublicListing | null>;
  applicationsSince(accountId: string, since: Date): Promise<number>;
  hasPendingApplication(accountId: string, listingId: string): Promise<boolean>;
  markedAsSpam(accountId: string, guildDiscordId: string): Promise<boolean>;
  createApplication(input: NewApplication): Promise<{ id: string }>;
  setApplicationMessage(id: string, channelId: string, messageId: string): Promise<void>;
  deleteApplication(id: string): Promise<void>;
  myApplications(accountId: string): Promise<MyApplication[]>;
  applicationForDecision(id: string): Promise<DecisionView | null>;
  decideApplication(id: string, status: Exclude<ApplicationStatus, "PENDING">, decidedBy: string, now: Date): Promise<boolean>;

  card(accountId: string): Promise<(CardFields & { id: string; expiresAt: Date; hidden: boolean }) | null>;
  saveCard(accountId: string, fields: CardFields, expiresAt: Date): Promise<void>;
  deleteCard(accountId: string): Promise<void>;
  visibleCards(now: Date): Promise<PublicCard[]>;
  cardExists(id: string): Promise<boolean>;
  reportsSince(accountId: string, since: Date): Promise<number>;
  addReport(accountId: string, targetType: "listing" | "card", targetId: string, reason: string | null): Promise<boolean>;
  reportCount(targetType: "listing" | "card", targetId: string): Promise<number>;
  hideCard(id: string): Promise<void>;
}

const LISTING_INCLUDE = {
  guild: { select: { name: true, discordId: true, page: { select: { slug: true, published: true, inviteUrl: true } } } },
  core: { select: { name: true, schedule: true } }
} as const;

type ListingRow = ListingFields & {
  id: string; updatedAt: Date;
  guild: { name: string; discordId: string; page: { slug: string; published: boolean; inviteUrl: string | null } | null };
  core: { name: string; schedule: string | null } | null;
};

function publicListing(row: ListingRow): PublicListing {
  const page = row.guild.page?.published ? row.guild.page : null;
  return {
    id: row.id, open: row.open, classes: row.classes, roles: row.roles, raidDays: row.raidDays, raidTimes: row.raidTimes,
    language: row.language, faction: row.faction, realm: row.realm, note: row.note, updatedAt: row.updatedAt,
    guildName: row.guild.name, guildDiscordId: row.guild.discordId, pageSlug: page?.slug ?? null, inviteUrl: page?.inviteUrl ?? null,
    core: row.core ? { name: row.core.name, schedule: row.core.schedule } : null
  };
}

export function prismaWebStore(database: PrismaClient): WebStore {
  return {
    async upsertAccount(identity, now) {
      return database.webAccount.upsert({
        where: { discordUserId: identity.id },
        create: { discordUserId: identity.id, username: identity.username, displayName: identity.displayName, lastSeenAt: now },
        update: { username: identity.username, displayName: identity.displayName, lastSeenAt: now },
        select: { id: true }
      });
    },
    async createSession(accountId, tokenHash, expiresAt) {
      await database.webSession.create({ data: { accountId, tokenHash, expiresAt } });
      // Old sessions of everyone are cleaned up as new ones are made.
      await database.webSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    },
    async sessionAccount(tokenHash, now) {
      const session = await database.webSession.findUnique({ where: { tokenHash }, select: { expiresAt: true, account: { select: { id: true, discordUserId: true, username: true, displayName: true } } } });
      return session && session.expiresAt > now ? session.account : null;
    },
    async deleteSession(tokenHash) { await database.webSession.deleteMany({ where: { tokenHash } }); },

    async openListings() {
      const rows = await database.recruitmentListing.findMany({ where: { open: true }, include: LISTING_INCLUDE, orderBy: { updatedAt: "desc" }, take: 300 });
      return rows.map(publicListing);
    },
    async listing(id) {
      const row = await database.recruitmentListing.findUnique({ where: { id }, include: LISTING_INCLUDE });
      return row ? publicListing(row) : null;
    },
    applicationsSince: (accountId, since) => database.recruitmentApplication.count({ where: { accountId, createdAt: { gte: since } } }),
    async hasPendingApplication(accountId, listingId) {
      return (await database.recruitmentApplication.count({ where: { accountId, listingId, status: "PENDING" } })) > 0;
    },
    async markedAsSpam(accountId, guildDiscordId) {
      return (await database.recruitmentApplication.count({ where: { accountId, status: "SPAM", listing: { guild: { discordId: guildDiscordId } } } })) > 0;
    },
    createApplication: (input) => database.recruitmentApplication.create({ data: input, select: { id: true } }),
    async setApplicationMessage(id, channelId, messageId) { await database.recruitmentApplication.update({ where: { id }, data: { channelId, messageId } }); },
    async deleteApplication(id) { await database.recruitmentApplication.deleteMany({ where: { id } }); },
    async myApplications(accountId) {
      const rows = await database.recruitmentApplication.findMany({
        where: { accountId }, orderBy: { createdAt: "desc" }, take: 20,
        select: { id: true, character: true, status: true, createdAt: true, listing: { select: { guild: { select: { name: true } }, core: { select: { name: true } } } } }
      });
      return rows.map((row) => ({ id: row.id, character: row.character, status: row.status, createdAt: row.createdAt, guildName: row.listing.guild.name, coreName: row.listing.core?.name ?? null }));
    },
    async applicationForDecision(id) {
      const row = await database.recruitmentApplication.findUnique({
        where: { id },
        include: { account: { select: { discordUserId: true, username: true } }, listing: { include: LISTING_INCLUDE } }
      });
      if (!row) return null;
      return {
        id: row.id, status: row.status, character: row.character, className: row.className, role: row.role, message: row.message,
        guildDiscordId: row.listing.guild.discordId, guildName: row.listing.guild.name, coreName: row.listing.core?.name ?? null,
        discordUserId: row.account.discordUserId, username: row.account.username, inviteUrl: row.listing.guild.page?.inviteUrl ?? null
      };
    },
    async decideApplication(id, status, decidedBy, now) {
      const result = await database.recruitmentApplication.updateMany({ where: { id, status: "PENDING" }, data: { status, decidedBy, decidedAt: now } });
      return result.count === 1;
    },

    async card(accountId) {
      const row = await database.playerCard.findUnique({ where: { accountId } });
      return row ? { id: row.id, character: row.character, className: row.className, role: row.role, level: row.level, realm: row.realm, faction: row.faction, language: row.language, raidDays: row.raidDays, note: row.note, showDiscord: row.showDiscord, expiresAt: row.expiresAt, hidden: row.hidden } : null;
    },
    async saveCard(accountId, fields, expiresAt) {
      await database.playerCard.upsert({ where: { accountId }, create: { accountId, ...fields, expiresAt }, update: { ...fields, expiresAt } });
    },
    async deleteCard(accountId) { await database.playerCard.deleteMany({ where: { accountId } }); },
    async visibleCards(now) {
      const rows = await database.playerCard.findMany({ where: { hidden: false, expiresAt: { gt: now } }, orderBy: { updatedAt: "desc" }, take: 200, include: { account: { select: { username: true } } } });
      return rows.map((row) => ({
        id: row.id, character: row.character, className: row.className, role: row.role, level: row.level, realm: row.realm, faction: row.faction,
        language: row.language, raidDays: row.raidDays, note: row.note, discord: row.showDiscord ? row.account.username : null, updatedAt: row.updatedAt
      }));
    },
    async cardExists(id) { return (await database.playerCard.count({ where: { id } })) > 0; },
    reportsSince: (accountId, since) => database.recruitmentReport.count({ where: { accountId, createdAt: { gte: since } } }),
    async addReport(accountId, targetType, targetId, reason) {
      const existing = await database.recruitmentReport.findUnique({ where: { accountId_targetType_targetId: { accountId, targetType, targetId } } });
      if (existing) return false;
      await database.recruitmentReport.create({ data: { accountId, targetType, targetId, reason } });
      return true;
    },
    reportCount: (targetType, targetId) => database.recruitmentReport.count({ where: { targetType, targetId } }),
    async hideCard(id) { await database.playerCard.updateMany({ where: { id }, data: { hidden: true } }); }
  };
}
