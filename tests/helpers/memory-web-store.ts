import type { PublicListing } from "../../src/services/recruitment.js";
import type { CardFields, DecisionView, WebAccountView, WebStore } from "../../src/services/web-store.js";

// The website store in memory, for page-flow tests without a database.
export function memoryWebStore() {
  let next = 0;
  const id = () => `c${String(++next).padStart(24, "0")}`;
  const accounts = new Map<string, WebAccountView>();
  const sessions = new Map<string, { accountId: string; expiresAt: Date }>();
  const listings = new Map<string, PublicListing>();
  const applications = new Map<string, { id: string; listingId: string; accountId: string; character: string; className: string; role: string; message: string; status: string; createdAt: Date; channelId?: string; messageId?: string }>();
  const cards = new Map<string, CardFields & { id: string; accountId: string; expiresAt: Date; hidden: boolean; updatedAt: Date }>();
  const reports: { accountId: string; targetType: string; targetId: string; createdAt: Date }[] = [];
  let clock = () => new Date();

  const store: WebStore = {
    async upsertAccount(identity) {
      const existing = [...accounts.values()].find((account) => account.discordUserId === identity.id);
      if (existing) { existing.username = identity.username; existing.displayName = identity.displayName; return { id: existing.id }; }
      const account = { id: id(), discordUserId: identity.id, username: identity.username, displayName: identity.displayName };
      accounts.set(account.id, account);
      return { id: account.id };
    },
    async createSession(accountId, tokenHash, expiresAt) { sessions.set(tokenHash, { accountId, expiresAt }); },
    async sessionAccount(tokenHash, now) {
      const session = sessions.get(tokenHash);
      return session && session.expiresAt > now ? accounts.get(session.accountId) ?? null : null;
    },
    async deleteSession(tokenHash) { sessions.delete(tokenHash); },
    async openListings() { return [...listings.values()].filter((listing) => listing.open); },
    async listing(listingId) { return listings.get(listingId) ?? null; },
    async applicationsSince(accountId, since) { return [...applications.values()].filter((row) => row.accountId === accountId && row.createdAt >= since).length; },
    async hasPendingApplication(accountId, listingId) { return [...applications.values()].some((row) => row.accountId === accountId && row.listingId === listingId && row.status === "PENDING"); },
    async markedAsSpam(accountId, guildDiscordId) {
      return [...applications.values()].some((row) => row.accountId === accountId && row.status === "SPAM" && listings.get(row.listingId)?.guildDiscordId === guildDiscordId);
    },
    async createApplication(input) {
      const row = { ...input, id: id(), status: "PENDING", createdAt: clock() };
      applications.set(row.id, row);
      return { id: row.id };
    },
    async setApplicationMessage(appId, channelId, messageId) { Object.assign(applications.get(appId)!, { channelId, messageId }); },
    async deleteApplication(appId) { applications.delete(appId); },
    async myApplications(accountId) {
      return [...applications.values()].filter((row) => row.accountId === accountId).map((row) => {
        const listing = listings.get(row.listingId)!;
        return { id: row.id, guildName: listing.guildName, coreName: listing.core?.name ?? null, character: row.character, status: row.status, createdAt: row.createdAt };
      });
    },
    async applicationForDecision(appId): Promise<DecisionView | null> {
      const row = applications.get(appId);
      if (!row) return null;
      const listing = listings.get(row.listingId)!;
      const account = accounts.get(row.accountId)!;
      return { id: row.id, status: row.status, character: row.character, className: row.className, role: row.role, message: row.message, guildDiscordId: listing.guildDiscordId, guildName: listing.guildName, coreName: listing.core?.name ?? null, discordUserId: account.discordUserId, username: account.username, inviteUrl: listing.inviteUrl };
    },
    async decideApplication(appId, status) {
      const row = applications.get(appId);
      if (!row || row.status !== "PENDING") return false;
      row.status = status;
      return true;
    },
    async card(accountId) { const card = cards.get(accountId); return card ? { ...card } : null; },
    async saveCard(accountId, fields, expiresAt) {
      const existing = cards.get(accountId);
      cards.set(accountId, { ...fields, id: existing?.id ?? id(), accountId, expiresAt, hidden: existing?.hidden ?? false, updatedAt: clock() });
    },
    async deleteCard(accountId) { cards.delete(accountId); },
    async visibleCards(now) {
      return [...cards.values()].filter((card) => !card.hidden && card.expiresAt > now).map((card) => ({
        id: card.id, character: card.character, className: card.className, role: card.role, level: card.level, realm: card.realm, faction: card.faction,
        language: card.language, raidDays: card.raidDays, note: card.note, discord: card.showDiscord ? accounts.get(card.accountId)!.username : null, updatedAt: card.updatedAt
      }));
    },
    async cardExists(cardId) { return [...cards.values()].some((card) => card.id === cardId); },
    async reportsSince(accountId, since) { return reports.filter((row) => row.accountId === accountId && row.createdAt >= since).length; },
    async addReport(accountId, targetType, targetId) {
      if (reports.some((row) => row.accountId === accountId && row.targetType === targetType && row.targetId === targetId)) return false;
      reports.push({ accountId, targetType, targetId, createdAt: clock() });
      return true;
    },
    async reportCount(targetType, targetId) { return reports.filter((row) => row.targetType === targetType && row.targetId === targetId).length; },
    async hideCard(cardId) { for (const card of cards.values()) if (card.id === cardId) card.hidden = true; }
  };

  function addListing(over: Partial<PublicListing> = {}): PublicListing {
    const listing: PublicListing = {
      id: id(), open: true, classes: [], roles: [], raidDays: ["wednesday"], raidTimes: "20:00-23:00 ET", language: "fr", faction: "ALLIANCE", realm: "Doomhowl", note: null,
      guildName: "Quebec Gold", guildDiscordId: "111111111111111111", pageSlug: "quebec-gold", inviteUrl: "https://discord.gg/abc123", core: null, updatedAt: new Date(), ...over
    };
    listings.set(listing.id, listing);
    return listing;
  }
  return { store, accounts, sessions, listings, applications, cards, reports, addListing, setClock(fn: () => Date) { clock = fn; } };
}
