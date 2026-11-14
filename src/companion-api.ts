import { createPugWeb } from "./services/pug-web.js";
import { issueDuelChallenge } from "./services/duel-integrity.js";
import { cachedOfficerCheck, meSection, type MeSectionInput } from "./services/me-layout.js";
import { revokeCompanionCredential } from "./services/companion-revoke.js";
import { createWebCommunityBadges } from "./services/web-community-badges.js";
import { guildWhere, loadGuildScope, runInGuildScope, withGuildScope } from "./services/guild-scope.js";
import { hostedPilot } from "./hosted-pilot.js";
import { assertForeverEdition, GameEditionError, gameEditionOf } from "./services/game-edition.js";
import { withEdition } from "./services/edition-context.js";
import { addonName } from "./services/addon-name.js";
import { characterKey, realmKey } from "../companion/character-identity.mjs";
import { relayProfessions } from "./services/profession-relay.js";
import { retiredAvailabilityRoute } from "./services/retired-pages.js";
import { autoLinkUnclaimed } from "./services/character-autolink.js";
import { linkUploaderCharacters, repairMissingLinks } from "./services/upload-linking.js";
import { linkedCharacterCount, scheduleLinkedCharacters } from "./services/companion-link-dm.js";
import { companionMe } from "./services/companion-me.js";
import { albumFor } from "./services/companion-album.js";
import { applyWorldPvpUpload, parseWorldPvpUploads } from "./services/world-pvp.js";
import { scheduleBgLadderRefresh } from "./services/pvp-board-refresh.js";
import { applyGuildMapUpload, guildMapFor, parseGuildMapUpload, setMapSharing } from "./services/guild-map.js";
import { liveNewsFeed } from "./services/news-feed.js";
import { updateProfessionDirectory } from "./services/profession-directory.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { config } from "./config.js";
import { createDevicePages, prismaDeviceStore } from "./services/companion-devices.js";
import { memberLinkStatus } from "./services/link-status.js";
import { charactersMeSection, legacyBattleNetRedirect, meCharacterList } from "./services/me-characters.js";
import { prisma } from "./database.js";
import { createAddonImportService } from "./services/addon-import.js";
import { createEpgpService } from "./services/epgp.js";
import { addonDungeonBoard } from "./services/dungeon-stats.js";
import { nextRaidRoster } from "./services/raid-roster.js";
import { itemInsights } from "./services/item-insights.js";
import { lootRulesForAddon } from "./services/loot-rules-export.js";
import { upcomingRaidsForAddon } from "./services/calendar-sync.js";
import { publicRaids } from "./services/public-raids.js";
import { createPlayerProfiles, prismaProfileStore } from "./services/player-profiles.js";
import { createAchievementsWeb } from "./services/achievements-web.js";
import { publicPictures } from "./services/public-pictures.js";
import { createGuildDirectory, prismaGuildDirectoryStore } from "./services/guild-directory.js";
import { calendarEventsWithin, discordCalendarEvents, mergeCalendarEvents } from "./services/discord-calendar.js";
import { createAuditService } from "./services/audit.js";
import { followUpImport } from "./services/import-followup.js";
import { applyAttempts, applyFailureLogLine, applyWithRetry, classifyApplyFailure, type ApplyFailure } from "./services/import-apply-failure.js";
import { exchangeCharacterPairingCode, findPairingServer, hashCompanionSecret, issueMemberCredential } from "./services/character-pairing.js";
import { linkVerifiedCharacters, tellVerified } from "./services/character-verify.js";
import { tellLinkConflicts } from "./services/link-conflict-dm.js";
import { applyGuildmateRelay } from "./services/guildmate-relay.js";
import { applyGuildData } from "./services/guild-data.js";
import { applyGuildBank } from "./services/guild-bank.js";
import { serverKnowsWowGuild } from "./services/wow-guilds.js";
import { RETRY_OUTCOME } from "./services/dungeon-import.js";
import { retryWriteConflict, serializeByKey } from "./services/transaction-retry.js";
import { alertLowStock, bankForAddon, parseAddonBankRequests, postRequestCard } from "./services/guild-bank-member.js";
import { createBankService } from "./services/bank.js";
import { applyOrderActions, applyOrderRequests, craftOrdersForAddon, parseAddonOrderActions, parseAddonOrderRequests, unpostedGameRequests } from "./services/craft-orders.js";
import { applyBoardVotes, applyRelayedBoardVotes, boardEnabled, boardForAddon, createBoardService, myBoardVotes, parseAddonBoardPosts, parseAddonBoardVotes } from "./services/guild-board.js";
import { asLang } from "./i18n.js";
import { serveCompanionWeb } from "./services/companion-redirect.js";
import { createGuildPageServer, loadGuildPageView } from "./services/guild-page.js";
import type { Client } from "discord.js";
import { companionAccess, personalSnapshot } from "./services/companion-access.js";
import { createMemberData, memberDataStore } from "./services/member-data.js";
import { createPicturePages, prismaPictureStore } from "./services/character-picture.js";
import { deleteMyData, deleteMyDataByCredential } from "./services/data-deletion.js";
import { createPersonalCalendar, personalCalendarStore } from "./services/personal-calendar.js";
import { createOfficerHandover, officerHandoverStore } from "./services/officer-handover.js";
import { promotionForAddon } from "./services/promotion-feed.js";
import { raidPlanningStore } from "./services/raid-planning.js";
import { createRaidPlanning } from "./services/raid-planning-page.js";
import { readFileSync } from "node:fs";
import { ZodError } from "zod";
import { addonCharacterSchema } from "./integrations/addon.js";
import type { PrismaClient } from "./generated/prisma/client.js";
import { GAME_ON_HOLD_NOTE, POE_TRACKING_ENABLED } from "../companion/active-games.mjs";
import { createPoeMappingService, poeAreaName, PoeMappingError } from "./services/poe-mapping.js";
import { notify } from "./services/notify.js";
import { allowManageWrite, createCompanionManage, ManageError } from "./services/companion-manage.js";
import { createCompanionHub } from "./services/companion-hub.js";
import { baselineAchievements } from "./services/achievement-announce.js";
import { setupChecks } from "./services/setup-status.js";
import { syncCoreRoster } from "./services/raid-core.js";
import { createWebApp, isWebPath, webFormLimit, type WebRoute } from "./services/web-app.js";
import { createRosterDashboard } from "./services/roster-dashboard.js";
import { prismaRosterPlanWriter } from "./services/roster-plan-store.js";
import { createRosterReview } from "./services/roster-review.js";
import { prismaRosterDashboardStore } from "./services/roster-dashboard-store.js";
import { guildDashboardAccess } from "./services/guild-dashboard-access.js";
import { createWebLootLists, prismaLootListStore } from "./services/web-loot-lists.js";
import { prismaGuildToolsStore } from "./services/guild-tools-store.js";
import { createGuildToolsPages } from "./services/guild-tools-pages.js";
import { createStatsPage } from "./services/stats-page.js";
import { createGuildBankPage } from "./services/guild-bank-page.js";
import { feedAccess, recentSnapshots, statsCsv, MAX_FEED_DAYS } from "./services/stat-snapshots.js";
import { collectionFor, craftCard, openPack, tcgAllowed, TcgError } from "./services/tcg-store.js";
import { markSeenInApp } from "./services/tcg-presence.js";
import { DUEL_ROUTES, handleDuelRoute } from "./services/tcg-duel-api.js";
import { cancelTrade, confirmTrade, editTrade, getTrade, listTrades, offerTrade, setTradingOff, tradableCards, tradePartners } from "./services/tcg-trade.js";
import { concedeMatch, getMatch, isAiLevel, isClassKey, listMatches, parseIntent, pveProgress, startMatch, submitIntent } from "./services/tcg-match.js";
import { createArtisansGallery } from "./services/artisans-gallery.js";
import { withDeadline } from "./services/blizzard-items.js";
import { itemData } from "./item-data.js";
import { announceOrderChanges, postCraftRequest } from "./commands/craft-board.js";
import { webAuthConfig } from "./services/web-auth.js";
import { prismaWebStore } from "./services/web-store.js";
import { postWebApplication } from "./services/recruitment-discord.js";
import { createLeaderboardPages, guildDungeonSummary, prismaLeaderboardStore } from "./services/public-leaderboard.js";
import { exchangePersonalCode, isPersonalCode, issuePersonalCredential, personalAccess, prismaPersonalStore } from "./services/personal-pairing.js";
import { claimDevice, DEVICE_FEATURES, DEVICE_LIMITS, networkKey, DeviceError, deviceFor, handleDeviceUpload, memberForCredential, pickServer, prismaInstallStore, registerDevice, windowLimiter } from "./services/companion-device.js";
import { loadOfficialWindows } from "./services/official-seasons.js";
import { companionSignInRoute, createCompanionSignIn } from "./services/companion-signin.js";
import { ingestPublicRuns, ownPlayersFilter, pickScoreCharacter, PUBLIC_LIMITS, prismaPublicRunStore, PublicUploadError } from "./services/public-runs.js";
import { publicAddonBoard } from "./services/public-addon-board.js";
import { publicSeasons } from "./services/public-score.js";
import { inviteListForAddon, pendingInvites } from "./services/invite-queue.js";
import { backCheckInvites, completeInvitesFromRoster } from "./services/invite-channel.js";
import { prelinkInvitedCharacters, tellPrelinked } from "./services/invite-prelink.js";
import { COMPANION_FEATURES, markGuildChanged, standingsFeed, type FeedParts } from "./services/standings-feed.js";
import { commandRegistration } from "./services/command-registration.js";
import { deriveSealKey } from "./services/run-challenge.js";
const BOT_VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version as string;

const importService = createAddonImportService(prisma);

/** After an upload: link the characters people asked to be invited as (invite-prelink.ts), tell them, never fail the upload. */
async function prelinkAfterUpload(client: Client, database: typeof prisma, guild: { id: string; discordId: string }, seen: Parameters<typeof prelinkInvitedCharacters>[2]): Promise<void> {
  try {
    const results = await prelinkInvitedCharacters(database, guild.id, seen);
    if (!results.length) return;
    markGuildChanged(guild.id);
    const language = await database.guildSettings.findUnique({ where: { guildId: guild.id }, select: { language: true } });
    await tellPrelinked(client, guild.discordId, language?.language, results);
  } catch (error) { console.warn("Invite pre-link failed", error); }
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

/** Guild-only answers (the guildmate map): never stored by a cache or proxy. */
function privateJson(response: ServerResponse, body: unknown): void {
  response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store" });
  response.end(JSON.stringify(body));
}

// Failed-login throttle, because on a server this API is reachable from the
// internet: 10 bad tokens from one address in 10 minutes locks it out for
// the rest of that window. `x-forwarded-for` is trusted as the client address
// only when the direct connection itself comes from loopback — per
// docs/DEPLOY_ORACLE.md, Caddy is the only thing allowed to reach this API
// (COMPANION_API_HOST=127.0.0.1), so a real remote peer can never be
// loopback. This stops a direct client from picking its own throttle key.
const FAILURE_WINDOW_MS = 10 * 60_000;
const MAX_FAILURES = 10;
const MAX_TRACKED_ADDRESSES = 5_000;
const failures = new Map<string, number[]>();
const revocationRequests = new Map<string, { startedAt: number; count: number }>();

export function allowCompanionRevocation(address: string, now = Date.now()): boolean {
  let bucket = revocationRequests.get(address);
  if (!bucket || now - bucket.startedAt >= 60_000) {
    if (!bucket && revocationRequests.size >= MAX_TRACKED_ADDRESSES) revocationRequests.delete(revocationRequests.keys().next().value!);
    bucket = { startedAt: now, count: 0 };
    revocationRequests.set(address, bucket);
  }
  if (bucket.count >= 30) return false;
  bucket.count++;
  return true;
}

function isTrustedProxyPeer(remoteAddress: string | undefined): boolean {
  const address = remoteAddress?.replace(/^::ffff:/, "");
  return address === "127.0.0.1" || address === "::1";
}

export function clientAddress(request: IncomingMessage): string {
  const peer = request.socket.remoteAddress;
  if (isTrustedProxyPeer(peer)) {
    const forwarded = request.headers["x-forwarded-for"];
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
    if (first) return first;
  }
  return peer || "unknown";
}

export function isLockedOut(address: string, now = Date.now()): boolean {
  const recent = (failures.get(address) ?? []).filter((at) => now - at < FAILURE_WINDOW_MS);
  if (recent.length === 0) failures.delete(address);
  else failures.set(address, recent);
  return recent.length >= MAX_FAILURES;
}

export function recordFailure(address: string, now = Date.now()): void {
  const recent = [...(failures.get(address) ?? []).filter((at) => now - at < FAILURE_WINDOW_MS), now];
  if (!failures.has(address) && failures.size >= MAX_TRACKED_ADDRESSES) {
    const oldest = failures.keys().next().value;
    if (oldest !== undefined) failures.delete(oldest);
  }
  failures.set(address, recent);
}

export function resetFailures(): void {
  failures.clear();
  revocationRequests.clear();
}

// Uploads are at most 1 MB as sent. A gzip upload (newer companions) may unpack to 8 MB.
const MAX_BODY_BYTES = 1_000_000;
const MAX_UNPACKED_BYTES = 8_000_000;
export class BodyTooLargeError extends Error {}

export async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += Buffer.byteLength(chunk);
    chunks.push(Buffer.from(chunk));
    if (size > MAX_BODY_BYTES) throw new BodyTooLargeError("Request body is too large.");
  }
  let raw = Buffer.concat(chunks);
  const encoding = String(request.headers["content-encoding"] ?? "").trim().toLowerCase();
  // JSON never starts with the gzip magic bytes, so a proxy that drops the header changes nothing.
  const gzipped = raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b;
  if (encoding === "gzip" || (!encoding && gzipped)) {
    try { raw = gunzipSync(raw, { maxOutputLength: MAX_UNPACKED_BYTES }); }
    catch (error) {
      if (error instanceof RangeError || (error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") throw new BodyTooLargeError("Request body is too large.");
      throw new SyntaxError("The compressed upload could not be read.", { cause: error });
    }
  } else if (encoding && encoding !== "identity") {
    throw new SyntaxError("Unsupported content encoding.");
  }
  return JSON.parse(raw.toString("utf8"));
}

const auditService = createAuditService(prisma);
const manage = createCompanionManage(prisma);
const hub = createCompanionHub(prisma, { baselineAchievements: (guildId) => baselineAchievements(prisma, guildId) });
// Public guild pages (/g/<slug>/): read-only HTML, no pairing needed.
// A guild that publishes its runs also shows its members' top scores, recent runs and records there.
const guildPageRuns = prismaLeaderboardStore(prisma, (id) => hostedPilot.allows(id));
const guildPages = createGuildPageServer(async (slug) => {
  const view = await loadGuildPageView(prisma, slug, (id) => hostedPilot.allows(id));
  if (view?.dungeonPage && view.guildId) {
    const guildId = view.guildId;
    view.dungeons = await withEdition(gameEditionOf({ gameEdition: view.edition ?? "forever" }), async () => guildDungeonSummary(guildPageRuns, guildId, await loadOfficialWindows(prisma)))
      .catch((error: unknown) => { console.warn("Guild page dungeon section failed:", error); return null; });
  }
  return view;
});

// The website's signed-in pages (/auth/, /recruitment/, /me/, /leaderboards/), served through the Worker.
async function readForm(request: IncomingMessage, path: string): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += Buffer.byteLength(chunk);
    if (size > webFormLimit(path)) throw new BodyTooLargeError("Form is too large.");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
const headerOf = (request: IncomingMessage, name: string) => { const value = request.headers[name]; return Array.isArray(value) ? value[0] : value; };

const personalStore = prismaPersonalStore(prisma);
const publicRuns = prismaPublicRunStore(prisma);
// Personal companions' public-run uploads, per account and hour (on top of the per-run limit).
const publicUploads = new Map<string, number[]>();
export function allowPublicUpload(accountId: string, now = Date.now()): boolean {
  const recent = (publicUploads.get(accountId) ?? []).filter((at) => now - at < 3_600_000);
  if (recent.length >= PUBLIC_LIMITS.requestsPerHour) { publicUploads.set(accountId, recent); return false; }
  publicUploads.set(accountId, [...recent, now]);
  if (publicUploads.size > 5_000) publicUploads.delete(publicUploads.keys().next().value!);
  return true;
}

// Zero-setup companion (docs/ZERO_SETUP_COMPANION.md): device keys without Discord sign-in, rate-limited
// per IP and per device. Their uploads only ever store reported characters (companion-device.ts).
const deviceRegistrations = windowLimiter(DEVICE_LIMITS.registrationsPerIpPerHour, 3_600_000);
const deviceUploadsPerDevice = windowLimiter(DEVICE_LIMITS.uploadsPerDevicePerHour, 3_600_000);
const deviceUploadsPerIp = windowLimiter(DEVICE_LIMITS.uploadsPerIpPerHour, 3_600_000);
// (9.3.1) Runs-only uploads (a parked guild's runs) have their own hourly budget, so they never use up the loaded guild's.
const deviceRunsOnlyPerDevice = windowLimiter(DEVICE_LIMITS.runsOnlyPerDevicePerHour, 3_600_000);
const deviceHeader = (request: IncomingMessage) => headerOf(request, "x-companion-device");

// The companion's "Sign in with Discord" (7.2): pending requests, shared by the page and the API.
const companionSignIn = createCompanionSignIn();
const signInStarts = new Map<string, number[]>();
export function allowSignInStart(address: string, now = Date.now()): boolean {
  const recent = (signInStarts.get(address) ?? []).filter((at) => now - at < 3_600_000);
  if (recent.length >= 30) { signInStarts.set(address, recent); return false; }
  signInStarts.set(address, [...recent, now]);
  if (signInStarts.size > 5_000) signInStarts.delete(signInStarts.keys().next().value!);
  return true;
}

// Approved servers the bot is in, where this Discord user is a member right now.
async function signInServers(client: Client | undefined, discordUserId: string) {
  if (!client?.isReady()) return [];
  const guilds = await prisma.guild.findMany({ select: { id: true, discordId: true, name: true, gameEdition: true, wowSpace: { select: { memberRoleId: true } } } });
  const found: { discordId: string; name: string; wowGuildId: string; gameEdition: string }[] = [];
  for (const guild of guilds) {
    if (!hostedPilot.allows(guild.discordId)) continue;
    const discordGuild = client.guilds.cache.get(guild.discordId);
    // Cache when the gateway already has this member. The chosen server is
    // checked again with a fresh fetch before a credential is issued.
    const member = discordGuild ? await discordGuild.members.fetch({ user: discordUserId }).catch(() => null) : null;
    if (member && (!guild.wowSpace?.memberRoleId || member.permissions.has("Administrator") || member.roles.cache.has(guild.wowSpace.memberRoleId))) found.push({ discordId: guild.discordId, wowGuildId: guild.id, gameEdition: guild.gameEdition, name: `${discordGuild!.name} / ${guild.name} · ${guild.gameEdition}` });
  }
  return found;
}

async function signInGuildCredential(client: Client | undefined, account: { discordUserId: string; username: string; displayName: string | null }, guildDiscordId: string, wowGuildId?: string, deviceName?: string) {
  if (!client || !(await signInServers(client, account.discordUserId)).some((server) => server.discordId === guildDiscordId && (!wowGuildId || server.wowGuildId === wowGuildId))) return null;
  const guild = await prisma.guild.findFirst({ where: wowGuildId ? { id: wowGuildId, discordId: guildDiscordId } : { discordId: guildDiscordId, scopeKey: "default" }, select: { id: true, wowSpace: { select: { memberRoleId: true } } } });
  if (!guild) return null;
  // One fresh lookup for the server they picked, not one per guild in the list.
  const discordGuild = client.guilds.cache.get(guildDiscordId) ?? await client.guilds.fetch(guildDiscordId).catch(() => null);
  const live = discordGuild ? await discordGuild.members.fetch({ user: account.discordUserId, force: true }).catch(() => null) : null;
  if (!live || (guild.wowSpace?.memberRoleId && !live.permissions.has("Administrator") && !live.roles.cache.has(guild.wowSpace.memberRoleId))) return null;
  const member = await prisma.member.upsert({
    where: { guildId_discordUserId: { guildId: guild.id, discordUserId: account.discordUserId } },
    create: { guildId: guild.id, discordUserId: account.discordUserId, displayName: account.displayName ?? account.username },
    update: {}
  });
  // Same rule as companionAccess: only active members get (and keep) companion access.
  if (member.status !== "ACTIVE") return null;
  return issueMemberCredential(prisma, member.id, deviceName);
}

export function createSiteApp(client?: Client) {
  const rosterStore = prismaRosterDashboardStore(prisma, client, id => hostedPilot.allows(id));
  const roster = createRosterDashboard(rosterStore);
  const guildTools = createGuildToolsPages(prismaGuildToolsStore(prisma, guildDashboardAccess(prisma, client, id => hostedPilot.allows(id))));
  const gallery = createArtisansGallery({ db: prisma, access: guildDashboardAccess(prisma, client, id => hostedPilot.allows(id), "member"), items: withDeadline(itemData, 1_500),
    post: async (guildId, requestId, askCrafter) => {
      const record = await prisma.guild.findUnique({ where: { id: guildId }, select: { discordId: true } });
      const discordGuild = record && client ? await client.guilds.fetch(record.discordId).catch(() => null) : null;
      return discordGuild ? (await withGuildScope(prisma, guildId, () => postCraftRequest(discordGuild, requestId, askCrafter))).posted : false;
    } });
  const openPictures = publicPictures(prisma, id => hostedPilot.allows(id));
  const achievementsWeb = createAchievementsWeb(prisma, hostedPilot.allows, (discordUserId, own) => openPictures.byAccount(discordUserId, own));
  const pictures = createPicturePages(prismaPictureStore(prisma), guildDashboardAccess(prisma, client, id => hostedPilot.allows(id), "member"), {
    // A "Report this picture" goes to that guild's officer log, with the command that removes it.
    report: async ({ guildId, characterId, reporter }) => {
      const character = await prisma.character.findUnique({ where: { id: characterId }, select: { name: true, displayName: true, member: { select: { displayName: true, guild: { select: { discordId: true } } } } } });
      const discordGuild = character && client ? await client.guilds.fetch(character.member.guild.discordId).catch(() => null) : null;
      if (!character || !discordGuild) return false;
      const name = character.displayName ?? character.name;
      await withGuildScope(prisma, guildId, () => notify(discordGuild, (lang) => lang === "fr"
        ? `🚩 ${reporter} a signalé l'image du personnage **${name}** (${character.member.displayName}). Pour la retirer : \`/officer character picture action:remove name:${name}\`.`
        : `🚩 ${reporter} reported the picture of **${name}** (${character.member.displayName}). To remove it: \`/officer character picture action:remove name:${name}\`.`, "officer"));
      return true;
    }
  });
  const profiles = createPlayerProfiles(prismaProfileStore(prisma, hostedPilot.allows), achievementsWeb, pictures, openPictures);
  const directory = createGuildDirectory(prismaGuildDirectoryStore(prisma, (id) => hostedPilot.allows(id)));
  const leaderboards = createLeaderboardPages({ store: prismaLeaderboardStore(prisma, (id) => hostedPilot.allows(id)), personal: personalStore, calendar: () => loadOfficialWindows(prisma), picture: (name, realm) => openPictures.byCharacter(name, realm) });
  // Warm the leaderboards landing page once the bot is ready, then refresh it every 50 s (before its 60 s cache expires), so no visitor pays the cold load.
  const warmLeaderboards = () => { if (client && !client.isReady()) return; void leaderboards.warm().catch((error) => console.warn("Leaderboard warm-up failed", error instanceof Error ? error.message : error)); };
  setTimeout(warmLeaderboards, 20_000).unref();
  setInterval(warmLeaderboards, 50_000).unref();
  const signInPage = companionSignInRoute({
    signIn: companionSignIn,
    servers: (discordUserId) => signInServers(client, discordUserId),
    issueGuild: (account, guildDiscordId, wowGuildId, deviceName) => signInGuildCredential(client, account, guildDiscordId, wowGuildId, deviceName),
    knowsGuild: async (server, guildKey) => {
      if (!server.wowGuildId) return false;
      const row = await prisma.guild.findUnique({ where: { id: server.wowGuildId }, select: { id: true, name: true } });
      return row ? (await serverKnowsWowGuild(prisma, row, guildKey))?.known === true : false;
    },
    issuePersonal: async (accountId, deviceName) => (await issuePersonalCredential(personalStore, accountId, deviceName)).companionCredential
  });
  const badges = createWebCommunityBadges(prisma, client, id => hostedPilot.allows(id));
  const devices = createDevicePages(prismaDeviceStore(prisma));
  const memberData = createMemberData(memberDataStore(prisma, guildDashboardAccess(prisma, client, id => hostedPilot.allows(id), "member")), discordUserId => deleteMyData(prisma, discordUserId));
  const raidPlanning = createRaidPlanning(raidPlanningStore(prisma, guildDashboardAccess(prisma, client, id => hostedPilot.allows(id), "member"), guildDashboardAccess(prisma, client, id => hostedPilot.allows(id)), client));
  const handover = createOfficerHandover(officerHandoverStore(prisma, guildDashboardAccess(prisma, client, id => hostedPilot.allows(id))));
  const lootLists = createWebLootLists(prismaLootListStore(prisma, guildDashboardAccess(prisma, client, id => hostedPilot.allows(id), "member")));
  const personalCalendar = createPersonalCalendar(personalCalendarStore(prisma, guildDashboardAccess(prisma, client, id => hostedPilot.allows(id), "member"), client));
  const routes: WebRoute[] = [badges.route, signInPage, retiredAvailabilityRoute, roster.route, createRosterReview(rosterStore, prismaRosterPlanWriter(prisma, guildDashboardAccess(prisma, client, id => hostedPilot.allows(id)))), guildTools.route, createStatsPage(prisma, guildDashboardAccess(prisma, client, id => hostedPilot.allows(id))).route, createGuildBankPage(prisma, guildDashboardAccess(prisma, client, id => hostedPilot.allows(id)), guildDashboardAccess(prisma, client, id => hostedPilot.allows(id), "member")).route, gallery.route, leaderboards.route, liveNewsFeed().route, directory.route, achievementsWeb.route, achievementsWeb.ownerRoute, profiles.route, createPugWeb(prisma, id => hostedPilot.allows(id)).route];
  const isOfficer = cachedOfficerCheck(rosterStore.guilds);
  const meSections: MeSectionInput[] = [
    meSection({ id: "profile", group: "overview", render: profiles.meSection, fold: { en: "Privacy and details", fr: "Confidentialité et détails" } }),
    meSection({ id: "characters", group: "overview", render: charactersMeSection(discordUserId => memberLinkStatus(prisma, discordUserId), meCharacterList(prisma)) }),
    meSection({ id: "pictures", group: "overview", render: pictures.meSection }),
    meSection({ id: "achievements", group: "play", render: achievementsWeb.meSection }),
    meSection({ id: "badges", group: "play", render: badges.meSection }),
    meSection({ id: "calendar", group: "play", render: personalCalendar.meSection }),
    meSection({ id: "raid-planning", group: "play", render: raidPlanning.meSection }),
    meSection({ id: "raid-loot", group: "play", render: lootLists.meSection }),
    meSection({ id: "leaderboards", group: "play", render: leaderboards.meSection, fold: { en: "How to connect the companion", fr: "Comment connecter le compagnon" } }),
    meSection({ id: "guild-tools", group: "guild", render: guildTools.meSection }),
    meSection({ id: "artisans", group: "guild", render: gallery.meSection }),
    meSection({ id: "roster", group: "guild", render: roster.meSection, officer: true, visible: isOfficer }),
    meSection({ id: "handover", group: "guild", render: handover.meSection, officer: true, visible: isOfficer }),
    meSection({ id: "connections", group: "account", render: devices.meSection }),
    meSection({ id: "your-data", group: "account", render: memberData.meSection })
  ];
  routes.unshift(pictures.route, devices.route, legacyBattleNetRedirect, memberData.route, personalCalendar.route, handover.route, raidPlanning.route, lootLists.route);
  return createWebApp({
    publicRaids: now => publicRaids(prisma, hostedPilot.allows, now),
    store: prismaWebStore(prisma), auth: webAuthConfig(config), allows: (id) => hostedPilot.allows(id), routes, meSections,
    postApplication: (view) => view.guildId ? withGuildScope(prisma, view.guildId, () => postWebApplication(client, view)) : postWebApplication(client, view),
    tellOwner: async (text) => {
      const channel = client && config.ERROR_LOG_CHANNEL_ID ? await client.channels.fetch(config.ERROR_LOG_CHANNEL_ID).catch(() => null) : null;
      if (channel?.isSendable()) await channel.send({ content: text.slice(0, 1900), allowedMentions: { parse: [] } });
    }
  });
}

// A failed automatic import is told to the officers once an hour per cause, not on every upload.
const APPLY_FAILURE_REPEAT_MS = 60 * 60_000;
const applyFailureTold = new Map<string, number>();
export function shouldTellApplyFailure(key: string, now = Date.now()): boolean {
  const last = applyFailureTold.get(key);
  if (last !== undefined && now - last < APPLY_FAILURE_REPEAT_MS) return false;
  if (applyFailureTold.size > 500) applyFailureTold.clear();
  applyFailureTold.set(key, now);
  return true;
}

type AutoApplied = { epgp: number; discovered: number; held: number; voided: number; rejected: number };
interface AutoApplyInput { guildId: string; discordId: string; importId: string; createdBy: string; since: Date; retried: boolean; onApplied?: () => void; client?: Client | undefined }

// Applies a stored upload, then records and follows it up. `onApplied` runs once the import has
// committed: a later follow-up failure must not be reported as "not applied".
export async function autoApplyImportWith(input: AutoApplyInput): Promise<AutoApplied> {
  const result = await importService.apply(input.guildId, input.importId, input.createdBy);
  input.onApplied?.();
  markGuildChanged(input.guildId);
  await auditService.record({
    guildId: input.guildId, actorId: input.createdBy, action: "IMPORT_APPLIED", entityId: input.importId,
    metadata: { auto: true, ...(input.retried ? { retried: true } : {}), epgpTransactionCount: result.epgpTransactions.length, readinessSnapshotCount: result.readinessSnapshots.length, discovered: result.discovery.discovered }
  });
  // The follow-up is all Discord (cards, notices, directory, boards): the response carries only the counts below.
  inGuildBackground(input.guildId, "Follow-up of an addon import", async (overCap) => {
    const discordGuild = input.client ? await input.client.guilds.fetch(input.discordId).catch(() => null) : null;
    await followUpImport(discordGuild, input.guildId, result, { since: input.since, refresh: !overCap });
  });
  return { epgp: result.epgpTransactions.length, discovered: result.discovery.discovered, held: result.held.rows.length, voided: result.voided, rejected: result.rejected.length };
}

// Background retries after a transient database failure (P2028 and friends), outside the upload
// request: the Worker gives up on a request after 20 seconds. One pending retry per import.
const APPLY_RETRY_DELAYS_MS = [30_000, 120_000] as const;
const pendingApplyRetries = new Set<string>();
function retryApplyLaterWith(input: Omit<AutoApplyInput, "retried" | "onApplied"> & { officer: boolean; tellOfficers: (failure: ApplyFailure, attempts: number) => Promise<void> }): void {
  if (pendingApplyRetries.has(input.importId) || pendingApplyRetries.size > 200) return;
  pendingApplyRetries.add(input.importId);
  const startedAt = Date.now();
  const run = async () => {
    let committed = false;
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, APPLY_RETRY_DELAYS_MS[0]).unref?.());
      const { attempts } = await applyWithRetry(() => autoApplyImportWith({ ...input, retried: true, onApplied: () => { committed = true; } }),
        { delaysMs: APPLY_RETRY_DELAYS_MS.slice(1) });
      console.info(`import-apply-retried import=${input.importId.slice(-8)} attempts=${attempts + 1} ms=${Date.now() - startedAt}`);
    } catch (error) {
      if (committed) { console.error("Follow-up of a retried addon import failed", error); return; }
      const failure = classifyApplyFailure(error);
      if (failure.reason === "already-applied") return; // the companion's resend got there first
      const attempts = applyAttempts(error) + 1;
      console.info(applyFailureLogLine({ guildId: input.guildId, importId: input.importId, failure, attempts, ms: Date.now() - startedAt, officer: input.officer, retriedDuplicate: false }));
      await input.tellOfficers(failure, attempts).catch((notifyError: unknown) => console.error("Officer notice for a failed import failed", notifyError));
    } finally {
      pendingApplyRetries.delete(input.importId);
    }
  };
  void run();
}

// The references the addon needs back: its own ledger entries the bot has stored (so they stop
// counting as "not sent yet"), everyone's recent ones (other officers' awards shared in game)
// and `void:<ref>` for entries reversed after a /guilded void. Not the whole guild's history.
const RECENT_REF_DAYS = 30;
const MAX_REFS = 5_000;
export async function ledgerRefsFor(database: Pick<PrismaClient, "epgpTransaction" | "character">, guildId: string, memberId: string, now = new Date()): Promise<string[]> {
  const mine = await database.character.findMany({ where: { memberId }, select: { name: true, realm: true, gameEdition: true } });
  const rows = await database.epgpTransaction.findMany({
    where: { guildId, OR: [
      { sourceRef: { startsWith: "addon:" }, createdAt: { gte: new Date(now.getTime() - RECENT_REF_DAYS * 86_400_000) } },
      ...mine.map((character) => ({ sourceRef: { startsWith: `addon:qg:${addonName(character.name, character.realm, gameEditionOf(character))}-` } }))
    ] },
    select: { sourceRef: true }, orderBy: { createdAt: "desc" }, take: MAX_REFS
  });
  const reversals = await database.epgpTransaction.findMany({
    where: { guildId, type: "REVERSAL", sourceRef: { startsWith: "reversal:" } },
    select: { sourceRef: true }, orderBy: { createdAt: "desc" }, take: 1_000
  });
  const reversedIds = reversals.flatMap((row) => row.sourceRef ? [row.sourceRef.slice("reversal:".length)] : []);
  const voided = reversedIds.length ? await database.epgpTransaction.findMany({
    where: { guildId, id: { in: reversedIds }, sourceRef: { startsWith: "addon:" } }, select: { sourceRef: true }
  }) : [];
  return [...rows.flatMap((row) => row.sourceRef ? [row.sourceRef] : []), ...voided.map((row) => `void:${row.sourceRef}`)];
}

// Loot rows the bot has recorded from addon uploads, so the companion stops resending them.
// A row not listed here (older, or held back) is simply sent again; the bot skips duplicates.
export async function lootRefsFor(database: Pick<PrismaClient, "lootAward">, guildId: string): Promise<string[]> {
  const rows = await database.lootAward.findMany({
    where: { guildId, sourceRef: { startsWith: "qg-loot:" } },
    select: { sourceRef: true }, orderBy: { awardedAt: "desc" }, take: MAX_REFS
  });
  return rows.flatMap((row) => row.sourceRef ? [row.sourceRef] : []);
}

// The public Worker aborts the origin after 20s. A cold standings read must
// finish inside that, including time spent waiting for a pool connection.
export const STANDINGS_READ_BUDGET_MS = { query: 15_000, poolWait: 3_000, workerAbort: 20_000 } as const;

/**
 * One log line per standings request (hotfix 2, 8.5): status, time, bytes, the guild as a short
 * hash, whether it was a long poll. A client that hangs up first (the companion's or the website
 * proxy's 20 s limit) is logged as "closed". Never the credential, never the Discord id itself.
 */
export function standingsTimingLine(input: { guild: string | null; status: number | "closed"; ms: number; bytes: number; wait: string | null; conditional: boolean }): string {
  const guild = input.guild ? createHash("sha256").update(input.guild).digest("hex").slice(0, 8) : "none";
  return `standings guild=${guild} status=${input.status} ms=${Math.round(input.ms)} bytes=${input.bytes} wait=${input.wait ?? 0} conditional=${input.conditional ? 1 : 0}`;
}
function logStandingsTiming(request: IncomingMessage, response: ServerResponse, url: URL, startedAt: number): void {
  let bytes = 0;
  const end = response.end.bind(response) as (...args: unknown[]) => ServerResponse;
  (response as unknown as { end: (...args: unknown[]) => ServerResponse }).end = (...args: unknown[]) => {
    const chunk = args[0];
    if (typeof chunk === "string") bytes += Buffer.byteLength(chunk);
    else if (chunk instanceof Uint8Array) bytes += chunk.byteLength;
    return end(...args);
  };
  let logged = false;
  const log = (status: number | "closed") => {
    if (logged) return;
    logged = true;
    console.info(standingsTimingLine({ guild: url.searchParams.get("guild"), status, ms: Date.now() - startedAt, bytes, wait: url.searchParams.get("wait"),
      conditional: typeof request.headers["if-none-match"] === "string" || url.searchParams.has("since") }));
  };
  response.on("finish", () => log(response.statusCode));
  response.on("close", () => { if (!response.writableFinished) log("closed"); });
}

async function officerPromotionFeed(client: Client, guild: { id: string; discordId: string }) {
  const discordGuild = client.guilds.cache.get(guild.discordId);
  if (!discordGuild) return null;
  const edition = (await prisma.guild.findUnique({ where: { id: guild.id }, select: { gameEdition: true } }))?.gameEdition ?? "forever";
  return Promise.race([promotionForAddon(prisma, discordGuild, guild.id, edition), new Promise<null>((resolve) => setTimeout(() => resolve(null), 4_000))]);
}

// Read-only EP/GP/PR per linked character and what goes with it. The companion writes it
// into the addon folder so /guilded standings shows the bot's numbers.
async function standingsParts(guild: { id: string; discordId: string }, access: { memberId: string; actorId: string; officer?: boolean }, client?: Client): Promise<FeedParts> {
  // Officers only: who the promotion rule says is ready (never in the shared part, never for members).
  const promotion = access.officer && client ? await officerPromotionFeed(client, guild).catch(() => null) : null;
  // How each raid core decides loot, with its item prices and own-pool standings. Configuration,
  // read outside the transaction below: its per-core queries ran the 15 s budget out (P2028, 7 Nov).
  const lootRead = lootRulesForAddon(prisma, guild.id, async (coreId, coreBaseGp) =>
    (await createEpgpService(prisma).getGuildStandings(guild.id, coreBaseGp, coreId)).map((row) => ({ character: addonName(row.character, row.realm), ...(row.displayName ? { displayName: row.displayName } : {}), main: row.main, ep: row.ep, gp: row.gp })));
  lootRead.catch(() => undefined);
  // At most 4 s (hotfix 2): otherwise the member's last known events (discord-calendar.ts).
  const scheduledEvents = await calendarEventsWithin(() => discordCalendarEvents(client, guild.discordId, access.actorId),
    `${guild.discordId}:${access.actorId}`).catch(() => {
    console.warn("Discord calendar events could not be fetched; exporting bot raids only.");
    return [];
  });
  // Reads that need no snapshot consistency with the standings and ledger: plain client, in
  // parallel, before the transaction. Inside it they ran the 15 s budget out under load (P2028,
  // 7 Nov, the same fix as #487 for loot rules). A failing one fails the answer as before
  // (items keep their empty fallback), so a transient error never writes empty data.
  const [loot, dungeonBoard, nextRaid, items, botRaids, board, bank, officerInvites, pilotRaids, craftOrders] = await Promise.all([
    lootRead,
    addonDungeonBoard(prisma, guild.id),
    nextRaidRoster(prisma, guild.id),
    itemInsights(prisma, guild.id).catch(() => []),
    upcomingRaidsForAddon(prisma, guild.id),
    // 9.1 in-game guild board (guild-board.ts): news and open polls with counts; small and the same for everyone.
    boardForAddon(prisma, guild.id),
    // 9.1 guild bank (guild-bank-member.ts): contents to search in game, the low list, this member's requests.
    bankForAddon(prisma, guild.id, access.memberId, !!access.officer),
    // Officers only (8.5 batch 3): the names waiting for a guild invite, for the addon's "To invite" panel. The bot does not
    // know which guild ranks hold the invite right, so members' files never carry applicants' names.
    access.officer ? pendingInvites(prisma, guild.id).then(inviteListForAddon) : Promise.resolve(null),
    publicRaids(prisma, hostedPilot.allows),
    // Crafting orders in game (craft-orders.ts): Discord craft requests for the addon's Orders page; the same for everyone.
    craftOrdersForAddon(prisma, guild.id)
  ]);
  // 9.1 guild board: this member's own picks on the open polls.
  const boardVotes = board.enabled ? await myBoardVotes(prisma, guild.id, access.memberId) : null;
  const raids = mergeCalendarEvents(botRaids, scheduledEvents);
  const consistent = await prisma.$transaction((transaction) => standingsConsistentReads(transaction as unknown as PrismaClient, guild.id, access.memberId),
    { isolationLevel: "RepeatableRead", timeout: STANDINGS_READ_BUDGET_MS.query, maxWait: STANDINGS_READ_BUDGET_MS.poolWait });
  const { accounts, baseGp, standings, acceptedLedgerRefs, acceptedLootRefs, acceptedRunRefs, runNotes, pendingRunNotes } = consistent;
  // Shared: the same for every member, so it sets the stamp. Discord events are filtered
  // per member and dungeon/ledger acknowledgements do not change what the addon shows.
  return {
    shared: { accounts, baseGp, board, craftOrders, dungeonBoard, nextRaid, items, loot: loot ? { ...loot, cores: loot.cores.map((core) => ({ ...core, accounts })) } : null, standings },
    personal: { acceptedLedgerRefs, acceptedLootRefs, acceptedRunRefs, runNotes, ...(Object.keys(pendingRunNotes).length ? { pendingRunNotes } : {}), raids, ...(promotion ? { promotion } : {}),
      ...(officerInvites ? { officerInvites } : {}),
      bank,
      ...(boardVotes ? { boardVotes } : {}),
      publicRaids: { fetchedAt: new Date().toISOString(), raids: pilotRaids } },
    stampOnly: { botRaids }
  };
}

/**
 * The only reads inside the standings transaction (RepeatableRead): what must agree with each other
 * in one snapshot, the standings with the base GP and the characters' accounts, and the ledger, loot
 * and run refs the addon uses to stop resending what the bot has. Everything else is read before.
 */
export async function standingsConsistentReads(database: PrismaClient, guildId: string, memberId: string) {
  const baseGp = (await database.guildSettings.findUnique({ where: { guildId } }))?.baseGp ?? 0;
  // Dungeon runs the bot has stored lately, so the addon can mark them as synced (roadmap D3).
  // 9.0.8: plus every ref an upload brought (receipts: copies of a stored run and refused runs too, which
  // used to wait in the addon forever), the most recently uploaded first so a run still being resent is
  // always in the list. `runNotes` says in a few words why a run earned nothing.
  const since = new Date(Date.now() - 45 * 86_400_000);
  const receiptTable = (database as Partial<Pick<PrismaClient, "dungeonRunReceipt">>).dungeonRunReceipt;
  const receipts = receiptTable ? await receiptTable.findMany({
    // (9.3) A "retry" receipt is not an acknowledgement: the addon keeps that run and sends it again after an update.
    where: { guildId, seenAt: { gte: since }, outcome: { not: RETRY_OUTCOME } },
    select: { runRef: true, reason: true },
    orderBy: { seenAt: "desc" },
    take: 1000
  }) : [];
  // (9.3) Runs received but not counted yet (a retry receipt: unreadable, or waiting for a guildmate's own copy): answered apart,
  // never as accepted, so the companion's sync line says why instead of counting them "unconfirmed" (same as the device answer).
  const waiting = receiptTable ? await receiptTable.findMany({
    where: { guildId, seenAt: { gte: since }, outcome: RETRY_OUTCOME },
    select: { runRef: true, reason: true },
    orderBy: { seenAt: "desc" },
    take: 300
  }) : [];
  const storedRefs = (await database.dungeonRun.findMany({
    where: { guildId, createdAt: { gte: since } },
    select: { runRef: true },
    orderBy: { createdAt: "desc" },
    take: 500
  })).map((row) => row.runRef);
  // A ref whose receipt says "retry" is not held even when a (unfinished) run is stored under it: the addon keeps and resends it.
  const waitingRefs = new Set(waiting.map((row) => row.runRef));
  const acceptedRunRefs = [...new Set([...receipts.map((row) => row.runRef), ...storedRefs])].filter((ref) => !waitingRefs.has(ref)).slice(0, 1200);
  const runNotes = Object.fromEntries(receipts.flatMap((row) => row.reason ? [[row.runRef, row.reason] as const] : []).slice(0, 300));
  const pendingRunNotes: Record<string, string> = Object.fromEntries(waiting.flatMap((row) => row.reason && !acceptedRunRefs.includes(row.runRef) ? [[row.runRef, row.reason.slice(0, 80)] as const] : []));
  const accounts = Object.fromEntries((await database.character.findMany({ where: { member: { guildId } }, select: { name: true, realm: true, memberId: true } })).map((c) => [addonName(c.name, c.realm), c.memberId]));
  const acceptedLedgerRefs = await ledgerRefsFor(database, guildId, memberId);
  const acceptedLootRefs = await lootRefsFor(database, guildId);
  const standings = (await createEpgpService(database).getGuildStandings(guildId, baseGp)).map(row => ({ ...row, character: addonName(row.character, row.realm) }));
  return { accounts, baseGp, standings, acceptedLedgerRefs, acceptedLootRefs, acceptedRunRefs, runNotes, pendingRunNotes };
}

// The guild board part of an upload: in-game votes (own and relayed) and officers' in-game news.
/**
 * A side effect nobody waits for (a Discord post, DM, role or directory refresh): started now, its failure only logged.
 * The upload response never waits on Discord (12 Nov 2026: uploads passed the Worker's 20 s limit while the database was idle).
 */
export function inBackground(label: string, task: () => Promise<unknown>): void {
  void Promise.resolve().then(task).catch((error: unknown) => console.warn(`${label} failed`, error));
}

// Background Discord work for one guild runs one task at a time (boards, directories and cards are find-or-post, so two
// at once could each post a new one). At most BACKGROUND_CAP wait per guild; past that, a task is told to skip its idempotent
// refresh parts (the next one catches up) but still does its per-import parts, in order.
const BACKGROUND_CAP = 5;
const backgroundDepth = new Map<string, number>();
export function inGuildBackground(guildId: string, label: string, task: (overCap: boolean) => Promise<unknown>): void {
  const depth = backgroundDepth.get(guildId) ?? 0;
  const overCap = depth >= BACKGROUND_CAP;
  backgroundDepth.set(guildId, depth + 1);
  inBackground(label, () => serializeByKey(`followup:${guildId}`, () => task(overCap)).finally(() => {
    const left = (backgroundDepth.get(guildId) ?? 1) - 1;
    if (left <= 0) backgroundDepth.delete(guildId); else backgroundDepth.set(guildId, left);
  }));
}

/** A request made in game is posted once: a task that waited its turn skips one another upload already posted (or that was closed). */
export async function craftRequestNeedsPost(id: string): Promise<boolean> {
  const row = await prisma.craftRequest.findUnique({ where: { id }, select: { threadId: true, orderMessageId: true, status: true } }).catch(() => null);
  return !!row && !row.threadId && !row.orderMessageId && row.status === "OPEN";
}

// An apply of a big officer import takes longer than the companion waits. The response never waits for more than this
// (10 s after the handler started, never past 12 s); the same apply keeps running in the background.
const APPLY_DEADLINE_MS = 10_000;
const APPLY_DEADLINE_MAX_MS = 12_000;
const applyLanes = new Map<string, { pending: unknown }>();

/**
 * One apply at a time per lane (guild + uploader). While one runs, a newer job only replaces the one waiting (latest wins) and
 * null comes back: the caller answers "received" at once. When the running apply ends, the waiting job runs once, and its
 * outcome goes to `onNext`. `run` must not throw (it returns its outcome).
 */
export function startApplyLane<J, O>(key: string, job: J, run: (job: J) => Promise<O>, onNext: (outcome: O, job: J) => void, onSuperseded?: (job: J) => void): Promise<O> | null {
  const running = applyLanes.get(key);
  if (running) {
    const replaced = running.pending as J | null;
    running.pending = job;
    if (replaced) onSuperseded?.(replaced);
    return null;
  }
  const lane: { pending: unknown } = { pending: null };
  applyLanes.set(key, lane);
  const first = run(job);
  void first.then(async () => {
    try {
      for (let next = lane.pending as J | null; next; next = lane.pending as J | null) {
        lane.pending = null;
        onNext(await run(next), next);
      }
    } finally { applyLanes.delete(key); }
  });
  return first;
}

/** The outcome of `first`, or null when it has not finished `waitMs` from now (it keeps running either way). */
export async function raceDeadline<O>(first: Promise<O>, waitMs: number): Promise<O | null> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), Math.max(0, waitMs)); });
  try { return await Promise.race([first, timeout]); } finally { clearTimeout(timer); }
}

/**
 * Phase timer for one upload: one journal line with the phases over 200 ms (no names, no Discord ids). Gap-free: `mark(name)`
 * attributes everything since the previous mark (or since `startedAt`, the request handler's first line) to `name`, and `time`
 * marks the wait before its task as `before:<name>`, so the printed phases plus `other` (what is left after the last mark: the
 * response and its close) always add up to `total`.
 */
export function createUploadTimer(startedAt = Date.now()) {
  const phases: Array<[string, number]> = [];
  let last = startedAt;
  const mark = (name: string, at = Date.now()) => { phases.push([name, at - last]); last = at; };
  return {
    mark,
    async time<T>(name: string, task: () => Promise<T>): Promise<T> {
      mark(`before:${name}`);
      try { return await task(); } finally { mark(name); }
    },
    line(guildId: string, bytes: number, officer: boolean): string {
      const total = Date.now() - startedAt;
      const spent = phases.reduce((sum, [, ms]) => sum + ms, 0);
      const slow = phases.filter(([, ms]) => ms > 200).map(([name, ms]) => `${name}:${ms}`);
      slow.push(`other:${Math.max(0, total - spent)}`);
      return `upload guild=${createHash("sha256").update(guildId).digest("hex").slice(0, 8)} total=${total} bytes=${bytes} officer=${officer ? 1 : 0} phases=${slow.join(",")}`;
    }
  };
}

// Craft requests being posted to Discord right now, so a later upload does not post the same one twice.
const postingCraftRequests = new Set<string>();

async function applyGuildBoardUpload(guildId: string, memberId: string, officer: boolean, snapshot: { boardVotes: unknown[]; boardRelayVotes: unknown[]; boardPosts: unknown[];
  character?: { name: string; displayName?: string | null | undefined } | undefined }, client?: Client): Promise<boolean> {
  const own = parseAddonBoardVotes(snapshot.boardVotes);
  const relayed = parseAddonBoardVotes(snapshot.boardRelayVotes, true);
  const posts = officer ? parseAddonBoardPosts(snapshot.boardPosts) : [];
  if (!own.length && !relayed.length && !posts.length) return false;
  if (!await boardEnabled(prisma, guildId)) return false;
  const polls = new Set([...await applyBoardVotes(prisma, guildId, memberId, own), ...await applyRelayedBoardVotes(prisma, guildId, memberId, relayed)]);
  const author = snapshot.character?.displayName || snapshot.character?.name || "Officer";
  const created = posts.length ? await createBoardService(prisma).fromAddon(guildId, memberId, author, posts) : [];
  if (client && (polls.size || created.length)) {
    // Loaded only when needed: the poll command module is not part of the API's start-up.
    inGuildBackground(guildId, "Game board Discord update", async (overCap) => {
      const { postGameNews, syncPollById } = await import("./commands/poll.js");
      if (!overCap) for (const pollId of polls) await syncPollById(client, pollId).catch((error: unknown) => console.warn("Poll refresh after game votes failed", error));
      for (const post of created) await postGameNews(client, guildId, post).catch((error: unknown) => console.warn("Game news post failed", error));
    });
  }
  return polls.size > 0 || created.length > 0;
}

// `client` lets an upload be applied and announced by the bot itself (auto-apply).
export function startCompanionApi(client?: Client): ReturnType<typeof createServer> {
  const autoApplyImport = (input: Omit<AutoApplyInput, "client">) => autoApplyImportWith({ ...input, client });
  const retryApplyLater = (input: Omit<Parameters<typeof retryApplyLaterWith>[0], "client">) => retryApplyLaterWith({ ...input, client });
  const site = createSiteApp(client);
  const server = createServer(async (request, response) => {
    const requestStartedAt = Date.now();
    try {
      response.setHeader("cache-control", "no-store");
      response.setHeader("x-content-type-options", "nosniff");
      if (request.method === "GET" && request.url === "/health") {
        json(response, client?.isReady() ? 200 : 503, { ok: client?.isReady() ?? false, botVersion: BOT_VERSION, protocolVersion: 2, features: COMPANION_FEATURES, commands: commandRegistration.state() });
        return;
      }
      const url = new URL(request.url ?? "/", "http://localhost");
      if (await serveCompanionWeb(request, response, url.pathname)) return;
      if (isWebPath(url.pathname)) {
        const answer = await site.respond({
          method: request.method ?? "GET", path: url.pathname, query: url.searchParams,
          headers: Object.fromEntries(["cookie", "origin", "referer", "accept-language", "content-type", "user-agent"].map((name) => [name, headerOf(request, name)])),
          ...(request.method === "POST" ? { body: await readForm(request, url.pathname) } : {})
        });
        if (answer) {
          response.writeHead(answer.status, answer.headers);
          response.end(request.method === "HEAD" ? undefined : answer.binaryBody ?? answer.body);
          return;
        }
      }
      const page = await guildPages.respond(request.method ?? "GET", url.pathname);
      if (page) {
        response.writeHead(page.status, page.headers);
        response.end(request.method === "HEAD" ? undefined : page.body);
        return;
      }
      // 8.5 track G: the Google Sheets feed. The key is in the address (IMPORTDATA cannot send headers); it is never logged
      // here, and a wrong key answers 404 exactly like a missing feed, with the shared failure counter.
      if (request.method === "GET" && url.pathname === "/api/v1/stats-feed") {
        const address = clientAddress(request);
        if (isLockedOut(address)) { json(response, 429, { error: "Too many failed attempts. Try again in a few minutes." }); return; }
        const guildId = url.searchParams.get("guild") ?? "";
        if (!await feedAccess(prisma, guildId, url.searchParams.get("key") ?? "")) { recordFailure(address); json(response, 404, { error: "Not found" }); return; }
        const csv = statsCsv(await recentSnapshots(prisma, guildId, Number(url.searchParams.get("days")) || MAX_FEED_DAYS));
        response.writeHead(200, { "content-type": "text/csv; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer", "x-robots-tag": "noindex" });
        response.end(csv);
        return;
      }
      const isImport = request.method === "POST" && url.pathname === "/api/v1/addon-imports";
      const isPairing = request.method === "POST" && url.pathname === "/api/v1/addon-pairings";
      const isStandings = request.method === "GET" && url.pathname === "/api/v1/standings";
      if (isStandings) logStandingsTiming(request, response, url, requestStartedAt);
      const isPoeUpload = request.method === "POST" && url.pathname === "/api/v1/poe/visits";
      const isPoeLevels = request.method === "POST" && url.pathname === "/api/v1/poe/levels";
      const isPublicRuns = request.method === "POST" && url.pathname === "/api/v1/public-runs";
      const isPersonalStatus = request.method === "GET" && url.pathname === "/api/v1/companion/personal-status";
      // Track L: who is signed in, their Guilded servers, and the join invite for their in-game guild.
      const isCompanionMe = request.method === "GET" && url.pathname === "/api/v1/companion/me";
      const isAlbum = request.method === "GET" && url.pathname === "/api/v1/companion/achievements";
      // Guilded Collection (TCG stage 1): the phone's card collection, daily pack and crafting. Signed-in member only.
      const isCards = (request.method === "GET" && url.pathname === "/api/v1/companion/cards") || (request.method === "POST" && (url.pathname === "/api/v1/companion/cards/open" || url.pathname === "/api/v1/companion/cards/craft"));
      // Guilded Clash (TCG stage C): matches against the AI or a PvE boss. Signed-in member only; ids travel in the query or body.
      const clashMethods: Record<string, string> = { start: "POST", match: "GET", intent: "POST", concede: "POST", matches: "GET", pve: "GET",
        "trade/partners": "GET", "trade/cards": "GET", trades: "GET", trade: "GET", "trade/offer": "POST", "trade/edit": "POST", "trade/confirm": "POST", "trade/cancel": "POST", "trade/settings": "POST", ...DUEL_ROUTES };
      const clashRoute = url.pathname.startsWith("/api/v1/companion/clash/") ? url.pathname.slice("/api/v1/companion/clash/".length) : null;
      const isClash = clashRoute !== null && Object.hasOwn(clashMethods, clashRoute) && request.method === clashMethods[clashRoute];
      // Track M: the phone's guildmate map (guild members only) and the member's own sharing switch.
      const isMapView = request.method === "GET" && url.pathname === "/api/v1/companion/guild-map";
      const isMapEdit = request.method === "POST" && url.pathname === "/api/v1/companion/guild-map";
      const isPoeStatus = request.method === "GET" && url.pathname === "/api/v1/poe/status";
      const isPoeRecent = request.method === "GET" && url.pathname === "/api/v1/poe/visits";
      // /leave (9.1.4, "Remove this server"): the same revoke of the calling credential only; /logout stays for older companions.
      const isLogout = request.method === "POST" && (url.pathname === "/api/v1/companion/logout" || url.pathname === "/api/v1/companion/leave");
      const isDeleteData = request.method === "POST" && url.pathname === "/api/v1/companion/delete-my-data";
      const isSignInStart = request.method === "POST" && url.pathname === "/api/v1/companion/sign-in";
      const isSignInPoll = request.method === "POST" && url.pathname === "/api/v1/companion/sign-in/poll";
      // The companion's own pages: wishlists for members; prices, core rules and rosters for Raid Leaders.
      const isManageView = request.method === "GET" && url.pathname === "/api/v1/manage";
      const isManageEdit = request.method === "POST" && url.pathname === "/api/v1/manage";
      // The companion's hub: my characters, reserves and (officers) the server page.
      const isHubView = request.method === "GET" && url.pathname === "/api/v1/hub";
      const isHubEdit = request.method === "POST" && url.pathname === "/api/v1/hub";
      // Zero-setup companion: register a device key, upload as that device, claim it after a sign-in.
      const isDeviceRegister = request.method === "POST" && url.pathname === "/api/v1/device/register";
      const isDeviceUpload = request.method === "POST" && url.pathname === "/api/v1/device/uploads";
      const isDeviceClaim = request.method === "POST" && url.pathname === "/api/v1/device/claim";
      if (!isDeviceRegister && !isDeviceUpload && !isDeviceClaim && !isImport && !isPairing && !isSignInStart && !isSignInPoll && !isPublicRuns && !isPersonalStatus && !isCompanionMe && !isAlbum && !isCards && !isClash && !isStandings && !isPoeUpload && !isPoeLevels && !isPoeStatus && !isPoeRecent && !isLogout && !isDeleteData && !isManageView && !isManageEdit && !isHubView && !isHubEdit && !isMapView && !isMapEdit) {
        json(response, 404, { error: "Not found" });
        return;
      }
      const address = clientAddress(request);
      if (isLockedOut(address)) {
        json(response, 429, { error: "Too many failed attempts. Try again in a few minutes." });
        return;
      }
      if (isDeviceRegister || isDeviceUpload || isDeviceClaim) {
        const devices = prismaInstallStore(prisma, (discordId) => client?.guilds.cache.get(discordId)?.name ?? null);
        if (isDeviceRegister) {
          if (!deviceRegistrations(networkKey(address))) { json(response, 429, { error: "Too many new companions from this network. Try again later." }); return; }
          json(response, 200, await registerDevice(devices));
          return;
        }
        const device = await deviceFor(devices, deviceHeader(request));
        if (!device) { recordFailure(address); json(response, 401, { error: "This companion's device key is not known. Restart the companion to get a new one." }); return; }
        if (isDeviceClaim) {
          // Both the device key and the member's own credential from a Discord sign-in in the same app.
          if (!allowCompanionRevocation(`device-claim:${address}`)) { json(response, 429, { error: "Too many requests. Try again in a minute." }); return; }
          const memberId = await memberForCredential(prisma, headerOf(request, "x-companion-credential"));
          if (!memberId) { recordFailure(address); json(response, 401, { error: "Sign in with Discord first." }); return; }
          const ok = await claimDevice(devices, device, memberId);
          json(response, ok ? 200 : 409, ok ? { ok: true } : { error: "This companion was already confirmed by another Discord account." });
          return;
        }
        // The rate limits come before the body is read. A runs-only upload (a parked guild) says so in a header and has its own budget.
        const runsOnlyHeader = headerOf(request, "x-guilded-runs-only") === "1";
        if (!(runsOnlyHeader ? deviceRunsOnlyPerDevice(device.id) : deviceUploadsPerDevice(device.id)) || !deviceUploadsPerIp(address)) { json(response, 429, { error: "Too many uploads in the last hour. Try again later." }); return; }
        const deviceBody = await readBody(request);
        const runsOnly = (deviceBody as { runsOnly?: unknown } | null)?.runsOnly === true;
        // A runs-only body without the header spends the runs-only budget as well.
        if (runsOnly && !runsOnlyHeader && !deviceRunsOnlyPerDevice(device.id)) { json(response, 429, { error: "Too many uploads in the last hour. Try again later." }); return; }
        try {
          const answered = await handleDeviceUpload(devices, device, deviceBody, { allows: (id) => hostedPilot.allows(id), sealKey: deviceHeader(request) ? deriveSealKey(deviceHeader(request)!) : null });
          // A fresh challenge for the duel records the addon makes next (the companion writes it where the addon reads it).
          // A runs-only upload (a parked guild) is not the device's own sync: no challenge for it.
          const duelChallenge = runsOnly ? null : await issueDuelChallenge(prisma, device.id).catch(() => null);
          json(response, 200, { ...answered, botVersion: BOT_VERSION, deviceFeatures: DEVICE_FEATURES, ...(duelChallenge ? { duelChallenge } : {}) });
        } catch (error) {
          if (error instanceof DeviceError) { json(response, error.status, { error: error.message }); return; }
          throw error;
        }
        return;
      }
      if (isLogout) {
        // Unknown/already-revoked secrets get the same idempotent response, so
        // bound attempts independently of the failed-authentication counter.
        if (!allowCompanionRevocation(address)) { json(response, 429, { error: "Too many disconnect requests. Try again in a minute." }); return; }
        const secret = request.headers["x-companion-credential"] ?? request.headers.authorization?.replace(/^Bearer\s+/i, "");
        const ok = await revokeCompanionCredential(prisma, secret);
        if (!ok) recordFailure(address);
        json(response, ok ? 200 : 400, ok ? { ok: true } : { error: "A valid companion credential is required." });
        return;
      }
      if (isDeleteData) {
        // "Delete my data" from the companion: same erasure as the website, confirmed with the word DELETE.
        if (!allowCompanionRevocation(address)) { json(response, 429, { error: "Too many requests. Try again in a minute." }); return; }
        const secret = request.headers["x-companion-credential"] ?? request.headers.authorization?.replace(/^Bearer\s+/i, "");
        if (typeof secret !== "string" || secret.length < 32 || secret.length > 256) { recordFailure(address); json(response, 401, { error: "Sign in with Discord in the companion first." }); return; }
        const payload = await readBody(request).catch(() => null) as { confirm?: unknown } | null;
        const done = await deleteMyDataByCredential(prisma, hashCompanionSecret(secret), payload?.confirm);
        if (done === null) { recordFailure(address); json(response, 401, { error: "This companion link is no longer valid. Sign in with Discord again." }); return; }
        if (done === "confirm") { json(response, 400, { error: "Type DELETE to confirm." }); return; }
        json(response, 200, { ok: true, ...done });
        return;
      }
      if (isSignInStart) {
        // Needs the website's Discord sign-in; a bot without it keeps pairing codes only.
        const auth = webAuthConfig(config);
        if (!auth) { json(response, 503, { error: "Sign-in with Discord is not set up on this bot. Use a pairing code instead." }); return; }
        if (!allowSignInStart(address)) { json(response, 429, { error: "Too many sign-in attempts. Try again later." }); return; }
        // The Windows app's 127.0.0.1 port (8.1): approval then needs no typed code (companion-signin.ts).
        const startPayload = await readBody(request).catch(() => null) as { loopback?: unknown; guild?: unknown } | null;
        // A zero-setup companion sends its device key: the page then puts the server it syncs to first.
        const signInDevice = await deviceFor(prismaInstallStore(prisma), deviceHeader(request)).catch(() => null);
        const started = companionSignIn.start({ loopback: startPayload?.loopback, prefer: signInDevice?.guildId ?? null, guildKey: (startPayload as { guild?: unknown } | null)?.guild });
        if (!started) { json(response, 503, { error: "Too many sign-ins in progress. Try again in a few minutes." }); return; }
        const page = new URL("/me/companion", auth.siteUrl);
        page.searchParams.set("request", started.requestId);
        json(response, 200, { requestId: started.requestId, confirm: started.confirm, expiresAt: started.expiresAt.toISOString(), expiresInSeconds: Math.max(0, Math.round((started.expiresAt.getTime() - Date.now()) / 1000)), url: page.href, loopbackAccepted: companionSignIn.loopbackFor(started.requestId) !== null });
        return;
      }
      if (isSignInPoll) {
        const payload = await readBody(request) as { requestId?: unknown; proof?: unknown } | null;
        const answer = await companionSignIn.poll(payload?.requestId, payload?.proof);
        if (answer === "pending") { json(response, 202, { status: "pending" }); return; }
        if (answer === "expired") { json(response, 410, { error: "This sign-in expired. Choose Sign in with Discord again." }); return; }
        json(response, 200, answer);
        return;
      }
      if (isPairing) {
        const payload = await readBody(request);
        if (!payload || typeof payload !== "object" || !("code" in payload)) {
          json(response, 400, { error: "code is required" });
          return;
        }
        // The server ID is optional since 6.5.1: the code identifies the server on its own.
        const pairingPayload = payload as { guildDiscordId?: unknown; code: unknown };
        if ((pairingPayload.guildDiscordId !== undefined && typeof pairingPayload.guildDiscordId !== "string") || typeof pairingPayload.code !== "string") {
          json(response, 400, { error: "guildDiscordId and code must be strings" });
          return;
        }
        // A personal code from the website (7.0): no guild, public dungeon runs only.
        if (isPersonalCode(pairingPayload.code)) {
          const personal = await exchangePersonalCode(personalStore, pairingPayload.code);
          if (!personal) { recordFailure(address); json(response, 401, { error: "This companion code is invalid, expired or already used. Get a new one on your Guilded page (guilded.kcaron.top/me/)." }); return; }
          json(response, 200, { ...personal, personal: true });
          return;
        }
        let serverId: string = typeof pairingPayload.guildDiscordId === "string" ? pairingPayload.guildDiscordId.trim() : "";
        if (!serverId) {
          const found = await findPairingServer(prisma, pairingPayload.code);
          if (found === "ambiguous") { json(response, 409, { error: "This code matches more than one server. Enter your Discord server ID too." }); return; }
          if (!found) { recordFailure(address); json(response, 401, { error: "Pairing code is invalid, expired, or already used. Run /character pair again." }); return; }
          serverId = found;
        }
        if (!hostedPilot.allows(serverId)) { json(response, 403, { error: "This server is on Guilded Lite: companion sync unlocks when the Guilded owner approves it." }); return; }
        const guild = await prisma.guild.findUnique({ where: guildWhere(serverId), select: { id: true } });
        if (!guild) {
          json(response, 404, { error: "Guild is not initialized" });
          return;
        }
        let result;
        try { result = await exchangeCharacterPairingCode(prisma, serverId, pairingPayload.code); }
        catch (error) {
          if (!(error instanceof Error) || !error.message.startsWith("Pairing code is invalid")) throw error;
          recordFailure(address); json(response, 401, { error: "Pairing code is invalid, expired, or already used. Run /character pair again." }); return;
        }
        json(response, 200, { ...result, guildDiscordId: serverId });
        return;
      }
      if (isCompanionMe) {
        const secret = request.headers["x-companion-credential"] ?? request.headers.authorization?.replace(/^Bearer\s+/i, "");
        if (typeof secret !== "string" || secret.length < 32 || secret.length > 256) { recordFailure(address); json(response, 401, { error: "Sign in with Discord in the companion first." }); return; }
        const answer = await companionMe({
          async accountFor(tokenHash) {
            const member = await prisma.companionCredential.findFirst({ where: { tokenHash, revokedAt: null, member: { status: "ACTIVE" } }, select: { member: { select: { discordUserId: true, displayName: true } } } });
            if (member) {
              const web = await prisma.webAccount.findUnique({ where: { discordUserId: member.member.discordUserId }, select: { username: true, displayName: true } });
              return { discordUserId: member.member.discordUserId, username: web?.username ?? member.member.displayName, displayName: web?.displayName ?? member.member.displayName, personal: false };
            }
            const personal = await prisma.webCompanionCredential.findFirst({ where: { tokenHash, revokedAt: null }, select: { account: { select: { discordUserId: true, username: true, displayName: true } } } });
            return personal ? { ...personal.account, personal: true } : null;
          },
          servers: async (discordUserId) => (await signInServers(client, discordUserId)).map((server) => ({ discordId: server.discordId, name: server.name })),
          avatar: async (discordUserId) => client ? (await client.users.fetch(discordUserId)).displayAvatarURL({ size: 64, extension: "png" }) : null,
          async joinTarget(nameKey, realmKey) {
            const found = pickServer(await prismaInstallStore(prisma, (discordId) => client?.guilds.cache.get(discordId)?.name ?? null).candidates(nameKey, realmKey));
            if (!("pick" in found) || !hostedPilot.allows(found.pick.discordId)) return null;
            const row = { guild: await prisma.guild.findFirst({ where: { discordId: found.pick.discordId, scopeKey: "default" }, select: { discordId: true, page: { select: { inviteUrl: true } } } }) };
            if (!row.guild) return null;
            const name = client?.guilds.cache.get(row.guild.discordId)?.name ?? null;
            return name ? { discordId: row.guild.discordId, name, inviteUrl: row.guild.page?.inviteUrl ?? null } : null;
          }
        }, { tokenHash: hashCompanionSecret(secret), guild: url.searchParams.get("guild"), realm: url.searchParams.get("realm") });
        if (!answer) { recordFailure(address); json(response, 401, { error: "This companion link is no longer valid. Sign in with Discord again." }); return; }
        json(response, 200, answer);
        return;
      }
      if (isCards) {
        const secret = request.headers["x-companion-credential"] ?? request.headers.authorization?.replace(/^Bearer\s+/i, "");
        if (typeof secret !== "string" || secret.length < 32 || secret.length > 256) { recordFailure(address); json(response, 401, { error: "Sign in with Discord in the companion first." }); return; }
        const tokenHash = hashCompanionSecret(secret);
        const owner = await prisma.companionCredential.findFirst({ where: { tokenHash, revokedAt: null, member: { status: "ACTIVE" } }, select: { member: { select: { discordUserId: true } } } })
          ?? await prisma.webCompanionCredential.findFirst({ where: { tokenHash, revokedAt: null }, select: { account: { select: { discordUserId: true } } } });
        const discordUserId = owner ? ("member" in owner ? owner.member.discordUserId : owner.account.discordUserId) : null;
        if (!discordUserId) { recordFailure(address); json(response, 401, { error: "This companion link is no longer valid. Sign in with Discord again." }); return; }
        const lang = url.searchParams.get("lang") === "fr" ? "fr" : "en";
        const allows = (id: string) => hostedPilot.allows(id);
        if (!await tcgAllowed(prisma, discordUserId, allows)) { json(response, 403, { error: "The card collection is off for your server, or you are not in a server that has Guilded." }); return; }
        try {
          if (request.method === "GET") { json(response, 200, await collectionFor(prisma as never, discordUserId, lang, allows)); return; }
          if (url.pathname.endsWith("/open")) {
            if (!allowCompanionRevocation(`cards:${discordUserId}`)) { json(response, 429, { error: "Too many requests. Try again in a minute." }); return; }
            json(response, 200, await openPack(prisma as never, discordUserId, lang, allows)); return;
          }
          const body = await readBody(request).catch(() => null) as { card?: unknown } | null;
          if (typeof body?.card !== "string" || body.card.length > 80) { json(response, 400, { error: "card is required." }); return; }
          json(response, 200, await craftCard(prisma as never, discordUserId, body.card, lang, allows)); return;
        } catch (error) {
          if (error instanceof TcgError) { json(response, error.status, { error: error.message }); return; }
          throw error;
        }
      }
      if (isClash) {
        const secret = request.headers["x-companion-credential"] ?? request.headers.authorization?.replace(/^Bearer\s+/i, "");
        if (typeof secret !== "string" || secret.length < 32 || secret.length > 256) { recordFailure(address); json(response, 401, { error: "Sign in with Discord in the companion first." }); return; }
        const tokenHash = hashCompanionSecret(secret);
        const owner = await prisma.companionCredential.findFirst({ where: { tokenHash, revokedAt: null, member: { status: "ACTIVE" } }, select: { member: { select: { discordUserId: true } } } })
          ?? await prisma.webCompanionCredential.findFirst({ where: { tokenHash, revokedAt: null }, select: { account: { select: { discordUserId: true } } } });
        const discordUserId = owner ? ("member" in owner ? owner.member.discordUserId : owner.account.discordUserId) : null;
        if (!discordUserId) { recordFailure(address); json(response, 401, { error: "This companion link is no longer valid. Sign in with Discord again." }); return; }
        const lang = url.searchParams.get("lang") === "fr" ? "fr" : "en";
        if (!await tcgAllowed(prisma, discordUserId, (id) => hostedPilot.allows(id))) { json(response, 403, { error: "The card game is off for your server, or you are not in a server that has Guilded." }); return; }
        try {
          markSeenInApp(discordUserId);
          if (Object.hasOwn(DUEL_ROUTES, clashRoute)) {
            if (DUEL_ROUTES[clashRoute] === "POST" && !allowCompanionRevocation(`clash-pvp:${discordUserId}`)) { json(response, 429, { error: "Too many requests. Try again in a minute." }); return; }
            const reply = await handleDuelRoute(prisma as never, clashRoute, discordUserId, url.searchParams, () => readBody(request), (id) => hostedPilot.allows(id));
            json(response, reply.status, reply.body); return;
          }
          if (clashRoute.startsWith("trade") || clashRoute === "trades") {
            const allows = (id: string) => hostedPilot.allows(id);
            if (clashRoute === "trade/partners") { json(response, 200, await tradePartners(prisma as never, discordUserId, allows)); return; }
            if (clashRoute === "trade/cards") { json(response, 200, await tradableCards(prisma as never, discordUserId, lang)); return; }
            if (clashRoute === "trades") { json(response, 200, await listTrades(prisma as never, discordUserId, lang)); return; }
            if (clashRoute === "trade") {
              const id = url.searchParams.get("id") ?? "";
              if (!id || id.length > 40) { json(response, 400, { error: "id is required." }); return; }
              json(response, 200, await getTrade(prisma as never, discordUserId, id, lang)); return;
            }
            if (!allowCompanionRevocation(`clash-trade:${discordUserId}`)) { json(response, 429, { error: "Too many requests. Try again in a minute." }); return; }
            const body = await readBody(request).catch(() => null) as { to?: unknown; give?: unknown; want?: unknown; id?: unknown; off?: unknown } | null;
            if (!body || typeof body !== "object") { json(response, 400, { error: "A JSON body is required." }); return; }
            if (clashRoute === "trade/settings") {
              if (typeof body.off !== "boolean") { json(response, 400, { error: "off (true or false) is required." }); return; }
              json(response, 200, await setTradingOff(prisma as never, discordUserId, body.off)); return;
            }
            if (clashRoute === "trade/offer") {
              if (typeof body.to !== "string" || !body.to || body.to.length > 32) { json(response, 400, { error: "to (a guildmate) is required." }); return; }
              json(response, 200, await offerTrade(prisma as never, discordUserId, { to: body.to, give: body.give, want: body.want ?? [] }, lang, allows)); return;
            }
            if (typeof body.id !== "string" || !body.id || body.id.length > 40) { json(response, 400, { error: "id is required." }); return; }
            if (clashRoute === "trade/edit") { json(response, 200, await editTrade(prisma as never, discordUserId, body.id, { give: body.give, want: body.want ?? [] }, lang)); return; }
            if (clashRoute === "trade/confirm") { json(response, 200, await confirmTrade(prisma as never, discordUserId, body.id, lang, allows)); return; }
            json(response, 200, await cancelTrade(prisma as never, discordUserId, body.id, lang)); return;
          }
          if (clashRoute === "matches") { json(response, 200, await listMatches(prisma as never, discordUserId)); return; }
          if (clashRoute === "pve") { json(response, 200, await pveProgress(prisma as never, discordUserId, lang)); return; }
          if (clashRoute === "match") {
            const id = url.searchParams.get("id") ?? "";
            if (!id || id.length > 40) { json(response, 400, { error: "id is required." }); return; }
            json(response, 200, await getMatch(prisma as never, discordUserId, id)); return;
          }
          if (!allowCompanionRevocation(`clash:${discordUserId}`)) { json(response, 429, { error: "Too many requests. Try again in a minute." }); return; }
          const body = await readBody(request).catch(() => null) as { mode?: unknown; cls?: unknown; level?: unknown; opponent?: unknown; boss?: unknown; id?: unknown; action?: unknown } | null;
          if (!body || typeof body !== "object") { json(response, 400, { error: "A JSON body is required." }); return; }
          if (clashRoute === "start") {
            if ((body.mode !== "ai" && body.mode !== "pve") || !isClassKey(body.cls)) { json(response, 400, { error: "mode (ai or pve) and cls (your class) are required." }); return; }
            if (body.level !== undefined && !isAiLevel(body.level)) { json(response, 400, { error: "level must be easy, normal or hard." }); return; }
            if (body.opponent !== undefined && !isClassKey(body.opponent)) { json(response, 400, { error: "opponent must be a class." }); return; }
            if (body.mode === "pve" && (typeof body.boss !== "string" || body.boss.length > 40)) { json(response, 400, { error: "boss is required for the gauntlet." }); return; }
            json(response, 200, await startMatch(prisma as never, discordUserId, { mode: body.mode, cls: body.cls, ...(body.level !== undefined ? { level: body.level as never } : {}), ...(body.opponent !== undefined ? { opponentCls: body.opponent as never } : {}), ...(typeof body.boss === "string" ? { boss: body.boss } : {}) })); return;
          }
          if (typeof body.id !== "string" || !body.id || body.id.length > 40) { json(response, 400, { error: "id is required." }); return; }
          if (clashRoute === "concede") { json(response, 200, await concedeMatch(prisma as never, discordUserId, body.id)); return; }
          const action = parseIntent(body.action);
          if (!action) { json(response, 400, { error: "action is not a valid move." }); return; }
          json(response, 200, await submitIntent(prisma as never, discordUserId, body.id, action)); return;
        } catch (error) {
          if (error instanceof TcgError) { json(response, error.status, { error: error.message }); return; }
          throw error;
        }
      }
      if (isAlbum) {
        // Phone badge album: the signed-in member's own stored achievements (companion-album.ts). Read-only.
        const secret = request.headers["x-companion-credential"] ?? request.headers.authorization?.replace(/^Bearer\s+/i, "");
        if (typeof secret !== "string" || secret.length < 32 || secret.length > 256) { recordFailure(address); json(response, 401, { error: "Sign in with Discord in the companion first." }); return; }
        const tokenHash = hashCompanionSecret(secret);
        const owner = await prisma.companionCredential.findFirst({ where: { tokenHash, revokedAt: null, member: { status: "ACTIVE" } }, select: { member: { select: { discordUserId: true } } } })
          ?? await prisma.webCompanionCredential.findFirst({ where: { tokenHash, revokedAt: null }, select: { account: { select: { discordUserId: true } } } });
        const discordUserId = owner ? ("member" in owner ? owner.member.discordUserId : owner.account.discordUserId) : null;
        if (!discordUserId) { recordFailure(address); json(response, 401, { error: "This companion link is no longer valid. Sign in with Discord again." }); return; }
        json(response, 200, await albumFor(prisma, discordUserId, url.searchParams.get("lang") === "fr" ? "fr" : "en", (id) => hostedPilot.allows(id)));
        return;
      }
      if (isPersonalStatus) {
        const secret = request.headers["x-companion-credential"];
        const account = await personalAccess(personalStore, typeof secret === "string" ? secret : undefined);
        if (!account) { recordFailure(address); json(response, 401, { error: "This personal companion link is no longer valid. Sign in again." }); return; }
        json(response, 200, { ok: true, scope: "personal" });
        return;
      }
      if (isPublicRuns) {
        // Personal companions (website accounts) send their own finished dungeon runs.
        const secret = request.headers["x-companion-credential"];
        const account = await personalAccess(personalStore, typeof secret === "string" ? secret : undefined);
        if (!account) { recordFailure(address); json(response, 401, { error: "Connect this companion with a code from your Guilded page (guilded.kcaron.top/me/)." }); return; }
        if (!allowPublicUpload(account.accountId)) { json(response, 429, { error: "Too many uploads in the last hour. Try again later." }); return; }
        const body = await readBody(request) as { character?: { name?: unknown; displayName?: unknown; realm?: unknown; gameEdition?: unknown; interface?: unknown }; runs?: unknown; includeScore?: unknown; characters?: unknown } | null;
        let gameEdition;
        try {
          gameEdition = gameEditionOf(body?.character ?? {});
          assertForeverEdition(gameEdition);
        } catch (error) {
          json(response, 409, { error: error instanceof Error ? error.message : "Invalid WoW edition" }); return;
        }
        const character = typeof body?.character?.name === "string" ? body.character.name.slice(0, 40) : null;
        const parsedDisplay = addonCharacterSchema.shape.displayName.safeParse(body?.character?.displayName);
        const displayName = parsedDisplay.success ? parsedDisplay.data : undefined;
        if (!character) { json(response, 400, { error: "character.name is required" }); return; }
        return await withEdition(gameEdition, async () => {
        const rawRealm = typeof body?.character?.realm === "string" ? body.character.realm.trim().slice(0, 100) : "";
        const realm = gameEdition === "forever" ? rawRealm : realmKey(rawRealm);
        if (gameEdition !== "forever" && !realm) { json(response, 400, { error: "character.realm is required" }); return; }
        try {
          // (9.3.0) The account's other saved characters: a run of any of them counts and links, not only the one that logged in last.
          const own = [{ name: character, realm }, ...(Array.isArray(body?.characters) ? body.characters : []).slice(0, 12).flatMap((entry: { name?: unknown; realm?: unknown } | null) => {
            const name = typeof entry?.name === "string" ? entry.name.trim().slice(0, 40) : "";
            if (!name) return [];
            const otherRealm = typeof entry?.realm === "string" ? entry.realm.trim().slice(0, 100) : "";
            return [{ name, realm: gameEdition === "forever" ? otherRealm : realmKey(otherRealm) }];
          })];
          const others = own.slice(1).map((entry) => characterKey(entry.name, entry.realm, gameEdition));
          const result = await ingestPublicRuns(publicRuns, { uploaderKey: `account:${account.accountId}`, gameEdition, character: characterKey(character, realm, gameEdition), characters: others, source: "personal", runs: body?.runs });
          const refs = [...result.accepted, ...result.confirmed, ...result.duplicates];
          let scoreCharacter = { name: character, realm };
          if (refs.length) {
            // Link only this uploader's own characters (the one that logged in and the account's saved ones) in a run accepted
            // from this request. Party members are never claimed as the account's alts.
            const players = await prisma.publicRunPlayer.findMany({
              where: { OR: ownPlayersFilter(own, gameEdition === "forever"), run: { gameEdition, runRef: { in: refs }, status: "ACCEPTED", uploads: { some: { uploaderKey: `account:${account.accountId}` } } } },
              select: { character: true, realm: true }, distinct: ["character", "realm"]
            });
            for (const player of players) if (player.realm) await prisma.webCharacter.upsert({
              where: { accountId_gameEdition_name_realm: { accountId: account.accountId, gameEdition, name: player.character, realm: player.realm } },
              create: { accountId: account.accountId, gameEdition, name: player.character, realm: player.realm, ...(displayName ? { displayName } : {}) }, update: displayName ? { displayName } : {}
            });
            // The score shown is the logged-in character's when it ran, else the first own character that did.
            scoreCharacter = pickScoreCharacter(players, { name: character, realm });
          }
          // Explicit opt-in keeps old companions' response and cost unchanged. Public
          // data may be read without claiming ownership; names are always realm-scoped.
          const publicScore = body?.includeScore === true && scoreCharacter.realm && scoreCharacter.realm !== "-"
            ? publicAddonBoard(await prismaLeaderboardStore(prisma).characterRuns(scoreCharacter.name, scoreCharacter.realm), { character: scoreCharacter.name, realm: scoreCharacter.realm },
              publicSeasons(new Date(), await loadOfficialWindows(prisma))) : undefined;
          json(response, 200, { ...result, gameEdition, ...(body?.includeScore === true ? { publicScore: publicScore ?? null } : {}), botVersion: BOT_VERSION });
        } catch (error) {
          if (error instanceof PublicUploadError) { json(response, error.status, { error: error.message }); return; }
          throw error;
        }
        });
      }
      const payload = isImport || isPoeUpload || isPoeLevels || isManageEdit || isHubEdit || isMapEdit ? await readBody(request) : null;
      const bodyReadAt = Date.now();
      const requestPayload = payload as { guildDiscordId?: unknown; export?: unknown } | null;
      const guildDiscordId = isStandings || isPoeStatus || isPoeRecent || isManageView || isHubView || isMapView ? url.searchParams.get("guild") : requestPayload?.guildDiscordId;
      if (typeof guildDiscordId !== "string") { json(response, 400, { error: "guildDiscordId is required" }); return; }
      if (!hostedPilot.allows(guildDiscordId)) { json(response, 403, { error: "This server is on Guilded Lite: companion sync unlocks when the Guilded owner approves it." }); return; }
      const header = request.headers["x-companion-credential"] ?? request.headers.authorization?.replace(/^Bearer\s+/i, "");
      // The credential binds the in-game guild. A caller cannot change scope by
      // substituting another guild ID in a request or selecting another file.
      const credential = typeof header === "string" ? await prisma.companionCredential.findFirst({
        where: { tokenHash: hashCompanionSecret(header), revokedAt: null, member: { guild: { discordId: guildDiscordId }, status: "ACTIVE" } },
        select: { member: { select: { guild: true } } }
      }) : null;
      const guild = credential?.member.guild;
      if (!guild) { json(response, 401, { error: "Pair this companion with /character pair in the selected in-game guild." }); return; }
      return await runInGuildScope(await loadGuildScope(prisma, guild.id, guildDiscordId), async () => {
      const scopeLoadedAt = Date.now();
      const access = typeof header === "string" ? await companionAccess(prisma, client, guild.id, guild.discordId, header) : null;
      const accessAt = Date.now();
      if (!access) {
        recordFailure(address);
        json(response, 401, { error: "Pair this companion with /character pair. The shared upload token no longer grants access." }); return;
      }
      if (isMapView || isMapEdit) {
        // Signed-in members of this guild only (the credential is bound to it); never public, never cached.
        if (!access.memberId) { json(response, 403, { error: "Sign in as a member of this guild to see the guild map." }); return; }
        if (isMapEdit) {
          const share = (payload as { share?: unknown } | null)?.share;
          if (typeof share !== "boolean") { json(response, 400, { error: "share must be true or false" }); return; }
          const done = await setMapSharing(prisma, access.memberId, share);
          privateJson(response, { ok: true, ...done, map: await guildMapFor(prisma, guild.id, access.memberId) });
          return;
        }
        privateJson(response, await guildMapFor(prisma, guild.id, access.memberId));
        return;
      }
      if (isHubView) {
        // The /setup checklist is read from Discord for officers only; if Discord cannot be reached the page says so.
        let checks = null;
        if (access.officer && client) {
          const language = url.searchParams.get("lang") === "fr" ? "fr" : "en";
          try {
            const { gatherFacts } = await import("./commands/setup.js");
            const discordGuild = await client.guilds.fetch(guild.discordId);
            const settings = await prisma.guildSettings.findUnique({ where: { guildId: guild.id } });
            if (settings) checks = setupChecks(await gatherFacts(discordGuild, guild.id, settings), language);
          } catch (error) { console.warn("Companion hub could not read the setup checklist", error); }
        }
        // What the companion's Link everything list shows next to the characters (link-status.ts): never fails the hub.
        const link = await memberLinkStatus(prisma, access.actorId, guild.id).catch(() => null);
        const battleTag = link?.battleNet ? (await prisma.battleNetIdentity.findFirst({ where: { account: { discordUserId: access.actorId } }, select: { battleTag: true } }).catch(() => null))?.battleTag ?? null : null;
        const view = await hub.view(guild.id, access, checks);
        // The Discord server's own name, from the bot's cache, so the companion can show it beside each character.
        const withServers = { ...view, characters: view.characters.map((c) => ({ ...c, guild: { ...c.guild, serverName: client?.guilds.cache.get(c.guild.discordId)?.name ?? null } })) };
        json(response, 200, { ...withServers, ...(link ? { link: { battleNet: link.battleNet, characters: link.characters, battleTag } } : {}), botVersion: BOT_VERSION });
        return;
      }
      if (isHubEdit) {
        if (!allowManageWrite(access.memberId)) { json(response, 429, { error: "Too many changes in a short time. Try again in a few minutes." }); return; }
        let result;
        try { result = await hub.applyServer(guild.id, access, (payload as { change?: unknown }).change); }
        catch (error) {
          if (error instanceof ManageError) { json(response, error.status, { error: error.message }); return; }
          if (error instanceof ZodError) { json(response, 400, { error: "That change is not valid." }); return; }
          throw error;
        }
        markGuildChanged(guild.id);
        if (result.audit) await auditService.record({ guildId: guild.id, actorId: access.actorId, action: "CONFIG_UPDATED", metadata: { via: "companion", ...result.audit } });
        json(response, 200, { ok: true, message: result.message, botVersion: BOT_VERSION });
        return;
      }
      if (isManageView) {
        json(response, 200, { ...await manage.view(guild.id, access), botVersion: BOT_VERSION });
        return;
      }
      if (isManageEdit) {
        if (!allowManageWrite(access.memberId)) { json(response, 429, { error: "Too many changes in a short time. Try again in a few minutes." }); return; }
        let result;
        try { result = await manage.apply(guild.id, access, (payload as { change?: unknown }).change); }
        catch (error) {
          if (error instanceof ManageError) { json(response, error.status, { error: error.message }); return; }
          // The services' own short messages ("not in this core", a realm mismatch) are shown; a database error is not.
          if (error instanceof Error && !(error instanceof ZodError) && !error.constructor.name.startsWith("Prisma") && error.message.length < 300) { json(response, 400, { error: error.message }); return; }
          throw error;
        }
        markGuildChanged(guild.id);
        if (result.audit) await auditService.record({ guildId: guild.id, actorId: access.actorId, action: "CONFIG_UPDATED", ...(result.rosterCoreId ? { entityId: result.rosterCoreId } : {}), metadata: { via: "companion", ...result.audit } });
        if (result.rosterCoreId) {
          // The roster message and the core's role follow the change, as after /core add (never throws).
          const discordGuild = client ? await client.guilds.fetch(guild.discordId).catch(() => null) : null;
          await syncCoreRoster(discordGuild, prisma, guild.id, result.rosterCoreId);
        }
        json(response, 200, { ok: true, message: result.message, ...(result.rosterCoreId ? { rosterCoreId: result.rosterCoreId } : {}), botVersion: BOT_VERSION });
        return;
      }
      // Forever-only focus (companion/active-games.mjs): PoE2 is paused. Old companions are told tracking is off
      // (status) or that it is paused (everything else); nothing is stored and saved data stays untouched.
      if ((isPoeRecent || isPoeStatus || isPoeLevels || isPoeUpload) && !POE_TRACKING_ENABLED) {
        if (isPoeStatus) json(response, 200, { enabled: false, paused: true, botVersion: BOT_VERSION });
        else json(response, 409, { error: GAME_ON_HOLD_NOTE[0], paused: true });
        return;
      }
      if (isPoeRecent) {
        const visits = await createPoeMappingService(prisma).recent(guild.id, access.memberId);
        json(response, 200, { visits: visits.map(row => ({ character: row.character, league: row.league, mode: row.mode, areaId: row.areaId, areaName: poeAreaName(row.areaId), areaLevel: row.areaLevel, startedAt: row.startedAt, endedAt: row.endedAt, durationSeconds: row.durationSeconds, endReason: row.endReason })), botVersion: BOT_VERSION }); return;
      }
      if (isPoeStatus) {
        const settings = await prisma.guildSettings.findUnique({ where: { guildId: guild.id } });
        json(response, 200, { enabled: settings?.poeTrackingEnabled ?? false, botVersion: BOT_VERSION });
        return;
      }
      if (isPoeLevels) {
        const result = await createPoeMappingService(prisma).ingestLevels(guild.id, access.memberId, payload);
        json(response, 200, { ...result, botVersion: BOT_VERSION });
        return;
      }
      if (isPoeUpload) {
        const result = await createPoeMappingService(prisma).ingest(guild.id, access.memberId, payload);
        json(response, 200, { ...result, botVersion: BOT_VERSION });
        return;
      }
      if (isStandings) {
        // A companion that has this answer already says so (header, or `since` because the
        // website proxy forwards only a few headers); it may also wait for the next change.
        const ifNoneMatch = (typeof request.headers["if-none-match"] === "string" ? request.headers["if-none-match"] : null) ?? url.searchParams.get("since");
        const waitMs = Math.max(0, Math.min(15, Number(url.searchParams.get("wait")) || 0)) * 1000;
        const answer = await standingsFeed.get({
          guildId: guild.id, memberKey: `${access.memberId}:${access.actorId}:${access.officer ? 1 : 0}`, ifNoneMatch, waitMs,
          header: { protocolVersion: 2, botVersion: BOT_VERSION, features: COMPANION_FEATURES, gameEdition: guild.gameEdition, wowGuildId: guild.id, wowGuildName: guild.name },
          compose: () => standingsParts(guild, access, client)
        });
        response.setHeader("etag", answer.etag);
        if (answer.status === 304) { response.writeHead(304); response.end(); return; }
        response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        response.end(answer.body);
        return;
      }
      if (!requestPayload?.export) { json(response, 400, { error: "export is required" }); return; }
      const pairedMemberId = access.memberId;
      const createdBy = access.actorId;
      // From the first line of the handler: `body` (read, gunzip, parse), `auth` (credential and guild scope) and `access` come first.
      const uploadTimer = createUploadTimer(requestStartedAt);
      uploadTimer.mark("body", bodyReadAt); uploadTimer.mark("auth", scopeLoadedAt); uploadTimer.mark("access", accessAt);
      const timed = uploadTimer.time;
      const mark = uploadTimer.mark;
      response.once("close", () => console.info(uploadTimer.line(guild.id, Number(request.headers["content-length"]) || 0, !!access.officer)));
      let preview = await timed("preview", () => importService.preview(guild.id, requestPayload.export, createdBy));
      // T1 (10 Nov 2026): a signed upload only links and imports in a server that knows the saved file's in-game guild.
      // Officers stay exempt (their server may not list every guild an alt is in). The companion shows the warning.
      const guildCheck = await timed("guild-check", () => serverKnowsWowGuild(prisma, guild, preview.snapshot.wowGuild)).catch(() => undefined);
      if (guildCheck?.known === false && !access.officer) {
        json(response, 200, { skipped: "wrong-server", serverWowGuild: guildCheck, status: "SKIPPED", pairedCharacterStatus: "wrong-server", checksum: preview.checksum, scope: "personal", botVersion: BOT_VERSION, protocolVersion: 2 });
        return;
      }
      const uploadStartedAt = new Date();
      // One read of the guild's settings for the whole upload (it was read up to four times), next to the character count.
      const [linkedBefore, settings] = await Promise.all([
        pairedMemberId ? linkedCharacterCount(prisma, pairedMemberId) : 0,
        prisma.guildSettings.findUnique({ where: { guildId: guild.id } })
      ]);
      mark("settings");
      const pairedCharacterStatus = pairedMemberId
        ? await timed("link-uploader", () => linkUploaderCharacters(prisma, guild.id, pairedMemberId, preview.snapshot))
        : "unpaired";
      // First link, and later new characters: one batched DM listing the linked characters (owner decision, 8.5 track F).
      if (pairedMemberId && client) {
        scheduleLinkedCharacters(client, prisma, { guildDiscordId: guild.discordId, memberId: pairedMemberId, lang: asLang(settings?.language), before: linkedBefore });
      }
      // Guildmates who pasted their /guilded verify code in game, as this uploader's addon heard them:
      // an officer's upload links and confirms; a member's links provisionally (character-verify.ts).
      if (access.officer) { await prisma.guild.update({ where: { id: guild.id }, data: { officerSyncAt: new Date() } }).catch(() => undefined); mark("officer-sync"); }
      // Characters in an officer's roster upload are in the guild: their waiting invite posts get a check mark.
      if (access.officer && client) {
        const rosterNames = [preview.snapshot.character, ...preview.snapshot.characters].flatMap((entry) => entry ? [entry.name, ...(entry.displayName ? [entry.displayName] : [])] : []);
        void completeInvitesFromRoster(client, prisma, { id: guild.id, discordId: guild.discordId }, rosterNames)
          .then((done) => { if (done) markGuildChanged(guild.id); }).catch((error: unknown) => console.warn("Invite check marks failed", error));
        mark("invite-check-start");
      }
      if (access.officer || pairedMemberId) {
        const verified = await timed("verified-links", () => linkVerifiedCharacters(prisma, guild.id, { officer: access.officer, memberId: pairedMemberId }, preview.snapshot.characters))
          .catch((error: unknown) => { console.error("Linking verified characters failed", error); return []; });
        if (verified.length && client) void tellVerified(client, guild.discordId, asLang(settings?.language), verified).catch(() => undefined);
      }
      // Two members and one character (the uploader's own characters above, or a verify code): stronger
      // proof moved it, or it waits for an officer. Both members and the officer log hear it once.
      if ((access.officer || pairedMemberId) && client) {
        void tellLinkConflicts(client, prisma, { id: guild.id, discordId: guild.discordId }, asLang(settings?.language));
        mark("link-conflicts-start");
      }
      // 8.5: the game's guild roster, event log and MOTD from any member's upload (guild-data.ts):
      // members without the addon reach the race board, last seen and roster gaps. Rank only from
      // officers. No markGuildChanged: none of it is in the standings feed. Never fails the upload.
      if (preview.snapshot.guildRoster || preview.snapshot.guildEvents.length || preview.snapshot.guildInfo) {
        // 9 Nov 2026: two connections uploading one file at once collided on the same Character rows (P2034). Uploads for one
        // guild now apply one at a time, and a lost write conflict is retried with a short jittered backoff inside an 8 s budget.
        await timed("guild-data", () => serializeByKey(`guild-data:${guild.id}`, () => retryWriteConflict(() => prisma.$transaction((tx) => applyGuildData(tx, guild.id, { memberId: pairedMemberId ?? null, officer: access.officer }, preview.snapshot),
          { timeout: 60_000, maxWait: 15_000 })))).catch((error: unknown) => { console.error("Guild data upload failed", error); });
        // The whole guild roster (any member's upload) is now stored: waiting invite requests for those names are done.
        if (client && preview.snapshot.guildRoster) {
          void backCheckInvites(client, prisma, { id: guild.id, discordId: guild.discordId })
            .then((done) => { if (done) markGuildChanged(guild.id); }).catch((error: unknown) => console.warn("Invite back-check failed", error));
        }
      }
      // 9.1: a member who asked for a guild invite naming a character gets it linked (provisionally) once it is seen in the guild.
      if (client) {
        const seen = [preview.snapshot.character, ...preview.snapshot.characters].filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
        void prelinkAfterUpload(client, prisma, guild, seen);
        mark("prelink-start");
      }
      // 9.0 guild bank ledger (guild-bank.ts): contents, gold history and the game's logs, deduped across uploaders.
      if (preview.snapshot.guildBank !== undefined) {
        const bankResult = await timed("guild-bank", () => serializeByKey(`guild-bank:${guild.id}`, () => retryWriteConflict(() => prisma.$transaction((tx) => applyGuildBank(tx, guild.id, pairedMemberId ?? null, preview.snapshot.guildBank),
          { timeout: 60_000, maxWait: 15_000 })))).catch((error: unknown) => { console.error("Guild bank upload failed", error); return null; });
        // 9.1: one alert in the log channel for items that just went below their minimum (/bank stock).
        if (bankResult?.contents && client) void alertLowStock(client, prisma, guild.id).catch((error: unknown) => console.warn("Bank stock alert failed", error));
      }
      // 9.1: guild bank requests made in game, only the uploader's own (their pairing), each once.
      const bankRequests = pairedMemberId ? parseAddonBankRequests(preview.snapshot.bankRequests) : [];
      if (bankRequests.length && pairedMemberId) {
        const created = await timed("bank-requests", () => createBankService(prisma).fromAddon(guild.id, pairedMemberId, bankRequests)).catch((error: unknown) => { console.warn("Bank requests from the addon failed", error); return []; });
        if (client && created.length) inBackground("Bank request cards", async () => { for (const request of created) await postRequestCard(client, prisma, request).catch((error: unknown) => console.warn("Bank request card failed", error)); });
      }
      // Crafting orders in game (craft-orders.ts): claims, finishes and give-backs made on the addon's Orders page, the
      // uploader's own and guildmates' heard in game. Already-reflected actions change nothing, so a resent upload is harmless.
      if (pairedMemberId) {
        const own = parseAddonOrderActions(preview.snapshot.craftOrderActions);
        const relayed = parseAddonOrderActions(preview.snapshot.craftOrderRelayActions, true);
        const orderChanges = own.length || relayed.length
          ? await timed("craft-actions", () => applyOrderActions(prisma, guild.id, pairedMemberId, own, relayed)).catch((error: unknown) => { console.warn("Craft order actions from the addon failed", error); return []; })
          : [];
        if (orderChanges.length) {
          markGuildChanged(guild.id);
          if (client) {
            void announceOrderChanges(client, guild.discordId, orderChanges).catch((error: unknown) => console.warn("Craft order Discord update failed", error));
          }
        }
      }
      // Craft requests made in game (craft-orders.ts): the uploader's own and ones a guildmate's addon heard. Each is
      // created once (its gameRef), only for a confirmed character of an active member, and posted like a Discord request.
      if (pairedMemberId) {
        const ownRequests = parseAddonOrderRequests(preview.snapshot.craftOrderRequests);
        const relayedRequests = parseAddonOrderRequests(preview.snapshot.craftOrderRelayRequests, true);
        const created = ownRequests.length || relayedRequests.length
          ? await timed("craft-requests", () => applyOrderRequests(prisma, guild.id, pairedMemberId, ownRequests, relayedRequests))
            .catch((error: unknown) => { console.warn("Craft requests from the addon failed", error); return []; })
          : [];
        // A request whose Discord post failed earlier (no thread, no orders line) is posted again, a few per upload.
        mark("before:unposted");
        const retry = await unpostedGameRequests(prisma, guild.id).catch(() => [] as string[]);
        mark("unposted");
        const toPost = [...new Set([...created.map((request) => request.id), ...retry])];
        if (created.length) markGuildChanged(guild.id);
        const postNow = toPost.filter((id) => !postingCraftRequests.has(id));
        if (postNow.length && client) {
          for (const id of postNow) postingCraftRequests.add(id);
          inGuildBackground(guild.id, "Craft request posts", async () => {
            try {
              const discordGuild = await client.guilds.fetch(guild.discordId).catch(() => null);
              for (const id of postNow) {
                if (!discordGuild) break;
                // Another upload's task may have posted it while this one waited its turn: only a request with no forum post
                // and no orders line yet (the same rule that picks the retries) is posted.
                if (!await craftRequestNeedsPost(id)) continue;
                const result = await withGuildScope(prisma, guild.id, () => postCraftRequest(discordGuild, id)).catch((error: unknown) => { console.warn("Craft request post failed", error); return null; });
                if (!result?.posted && !retry.includes(id)) console.warn(`Craft request ${id} made in game was not posted to Discord yet; the next upload retries`);
              }
            } finally { for (const id of postNow) postingCraftRequests.delete(id); }
          });
        }
      }
      // 9.1 guild board (guild-board.ts): votes made in game, the uploader's own and guildmates' heard in
      // game; officers' news written in game. Each is idempotent, so a resent upload changes nothing.
      if (pairedMemberId) {
        const boardChanged = await timed("board", () => applyGuildBoardUpload(guild.id, pairedMemberId, !!access.officer, preview.snapshot, client))
          .catch((error: unknown) => { console.warn("Guild board upload failed", error); return false; });
        if (boardChanged) markGuildChanged(guild.id);
      }
      // Track M: the uploader's own last-seen positions and calls for help, for the phone map (guild-map.ts).
      if (pairedMemberId && (preview.snapshot.mapSightings.length || preview.snapshot.helpCalls.length)) {
        await timed("map", () => applyGuildMapUpload(prisma, guild.id, pairedMemberId, parseGuildMapUpload(preview.snapshot.mapSightings, preview.snapshot.helpCalls)))
          .catch((error: unknown) => { console.warn("Guild map upload failed", error); });
      }
      // World PvP: this week's counters, capped and checked against the guild's real calls (world-pvp.ts).
      if (pairedMemberId && preview.snapshot.worldPvp.length) {
        const worldChanged = await timed("world-pvp", () => applyWorldPvpUpload(prisma, guild.id, pairedMemberId, parseWorldPvpUploads(preview.snapshot.worldPvp)))
          .catch((error: unknown) => { console.warn("World PvP upload failed", error); return false; });
        if (worldChanged) { markGuildChanged(guild.id); void scheduleBgLadderRefresh(prisma, guild.id); }
      }
      if (!access.officer) {
        // Guildmates heard in game (level, class, race, professions): applied to already-linked
        // characters only, never over newer first-hand data (guildmate-relay.ts). Never fails the upload.
        if (pairedMemberId) {
          // No markGuildChanged: levels and professions are not in the standings feed, and a
          // generation bump per member upload kept the feed from ever finishing (8.5 hotfix).
          await timed("guildmate-relay", () => applyGuildmateRelay(prisma, guild.id, pairedMemberId, preview.snapshot))
            .catch((error: unknown) => { console.error("Guildmate relay failed", error); return null; });
        }
        // 9.1: guildmates' recipes, cooldowns and attunements, for characters already linked in this guild.
        const [owned, linkedInGuild] = await Promise.all([
          prisma.character.findMany({ where: { memberId: pairedMemberId }, select: { name: true, realm: true } }),
          pairedMemberId ? prisma.character.findMany({ where: { member: { guildId: guild.id } }, select: { name: true, realm: true, memberId: true, gameEdition: true } }) : []
        ]);
        mark("personal-reads");
        preview = await importService.previewSnapshot(guild.id, personalSnapshot(preview.snapshot, owned, pairedMemberId ? { uploaderMemberId: pairedMemberId, linked: linkedInGuild } : undefined), createdBy);
        mark("personal-preview");
      }
      const professionRelay = access.officer && !settings?.autoApplyImports
        ? await timed("profession-relay", () => relayProfessions(prisma, guild.id, preview.snapshot)) : null;
      if (professionRelay) {
        // Discord work (linking by name, the directory post): in order, after the response is decided.
        inGuildBackground(guild.id, "Profession directory", async (overCap) => {
          const discordGuild = client ? await client.guilds.fetch(guild.discordId).catch(() => null) : null;
          if (discordGuild && professionRelay.discovered) await autoLinkUnclaimed(discordGuild, prisma, guild.id, { since: uploadStartedAt }).catch((error: unknown) => console.warn("Profession character linking failed", error));
          if (!overCap) await updateProfessionDirectory(discordGuild);
        });
      }
      // The apply of an upload runs in a lane per guild and uploader, and the response waits for it only until the deadline.
      const laneKey = `${guild.id}:${pairedMemberId ?? createdBy}`;
      const guildHash = createHash("sha256").update(guild.id).digest("hex").slice(0, 8);
      type ApplyOutcome = { ok: true; result: AutoApplied; ms: number } | { ok: false; error: unknown; applied: boolean; ms: number };
      type ApplyJob = { importId: string; retried: boolean };
      const runApply = async (job: ApplyJob): Promise<ApplyOutcome> => {
        const began = Date.now();
        let applied = false;
        try {
          const result = await autoApplyImport({ guildId: guild.id, discordId: guild.discordId, importId: job.importId, createdBy, since: uploadStartedAt, retried: job.retried, onApplied: () => { applied = true; } });
          return { ok: true, result, ms: Date.now() - began };
        } catch (error) { return { ok: false, error, applied, ms: Date.now() - began }; }
      };
      // Not applied: the reason goes to the server log, to the uploader (when still waiting) and, for a guild upload, to the officers.
      // A transient database failure is retried in the background first and only told to the officers if the retries fail too.
      const failApply = (outcome: Extract<ApplyOutcome, { ok: false }>, job: ApplyJob, late = false): string | null => {
        const failure = classifyApplyFailure(outcome.error);
        // The companion already showed "applying" and moved on: a member whose apply then failed for good is told by private message
        // (officers get the notice in the officer channel below). Closed DMs are skipped quietly.
        if (late && !access.officer && !failure.transient && !outcome.applied && client && shouldTellApplyFailure(`member:${guild.id}:${createdBy}:${failure.reason}`) && !/already been applied/i.test(outcome.error instanceof Error ? outcome.error.message : "")) {
          const text = settings?.language === "fr"
            ? `⚠️ **Guilded** : votre dernier envoi du companion a été reçu mais n'a pas pu être appliqué : ${failure.message} [${failure.reason}]\nRien n'en a été importé. Un officier peut regarder le journal du bot ; le prochain envoi réessaie.`
            : `⚠️ **Guilded**: your last companion upload was received but could not be applied: ${failure.message} [${failure.reason}]\nNothing from it was imported. An officer can check the bot's log; the next upload tries again.`;
          inBackground("Member notice for a failed late apply", async () => { await client.users.send(createdBy, { content: text, allowedMentions: { parse: [] } }).catch(() => undefined); });
        }
        if (job.retried) {
          if (/already been applied/i.test(outcome.error instanceof Error ? outcome.error.message : "")) return null;
          console.info(applyFailureLogLine({ guildId: guild.id, importId: job.importId, failure, attempts: 1, ms: outcome.ms, officer: !!access.officer, retriedDuplicate: true }));
          return failure.message;
        }
        // Application and notification are distinct: a committed import stays APPLIED even if follow-up fails.
        console.error("Auto-apply of an addon import failed", outcome.error);
        if (outcome.applied) return null;
        console.info(applyFailureLogLine({ guildId: guild.id, importId: job.importId, failure, attempts: 1, ms: outcome.ms, officer: !!access.officer, retriedDuplicate: false }));
        const tellOfficers = async (told: ApplyFailure, attempts: number) => {
          if (!access.officer || !shouldTellApplyFailure(`${guild.id}:${told.reason}:${told.message}`)) return;
          const discordGuild = client ? await client.guilds.fetch(guild.discordId).catch(() => null) : null;
          // The reason stays as the classifier wrote it (it matches the server log); the frame is in the guild's language.
          await notify(discordGuild, settings?.language === "fr"
            ? `⚠️ **Import de l'addon non appliqué** (envoi de <@${createdBy}>) : ${told.message}${attempts > 1 ? ` (${attempts} essais)` : ""} [${told.reason}]\nRien n'a été importé. Corrigez la cause, ou appliquez-le à la main : \`/import apply id:${job.importId}\`.`
            : `⚠️ **Addon import not applied** (upload by <@${createdBy}>): ${told.message}${attempts > 1 ? ` (${attempts} tries)` : ""} [${told.reason}]\nNothing from it was imported. Fix the cause, or apply it by hand: \`/import apply id:${job.importId}\`.`, "officer");
        };
        if (failure.transient) retryApplyLater({ guildId: guild.id, discordId: guild.discordId, importId: job.importId, createdBy, since: uploadStartedAt, officer: !!access.officer, tellOfficers });
        else inBackground("Officer notice for a failed import", () => tellOfficers(failure, 1));
        return failure.transient ? `${failure.message} The bot tries again in a minute.` : failure.message;
      };
      // What happens to an apply that ends after the response went out (or that waited in the lane).
      const settleLate = (outcome: ApplyOutcome, job: ApplyJob) => {
        console.info(`import-apply-finished guild=${guildHash} ms=${outcome.ms} late=1 ok=${outcome.ok ? 1 : 0}`);
        if (!outcome.ok) failApply(outcome, job, true);
      };
      // Runs the apply (or queues it behind the one running) and waits for it only until the deadline.
      const applyWithDeadline = async (job: ApplyJob): Promise<{ state: "done"; outcome: ApplyOutcome } | { state: "applying" }> => {
        // A waiting import that a newer one replaces will never be applied: it stops listing as waiting (/import, handover, status).
        const first = startApplyLane(laneKey, job, runApply, settleLate, (replaced) => inBackground("Superseded import", async () => {
          await prisma.addonImport.updateMany({ where: { id: replaced.importId, guildId: guild.id, status: "PREVIEWED" }, data: { status: "SUPERSEDED" } });
        }));
        if (!first) return { state: "applying" };
        const wait = Math.min(APPLY_DEADLINE_MS, APPLY_DEADLINE_MAX_MS) - (Date.now() - requestStartedAt);
        const outcome = await raceDeadline(first, Math.max(1_000, wait));
        if (!outcome) { void first.then((late) => settleLate(late, job)); return { state: "applying" }; }
        return { state: "done", outcome };
      };
      // "Received, being applied": the upload is stored; the companion shows it as sent and does not send the same file again.
      const applyingAnswer = (status: number, importId: string) => json(response, status, {
        applying: true, importId, checksum: preview.checksum, source: preview.snapshot.source, transactionCount: preview.transactionCount, pairedCharacterStatus,
        ...(guildCheck ? { serverWowGuild: guildCheck } : {}), status: "PREVIEWED", scope: access.officer ? "officer" : "personal", botVersion: BOT_VERSION, protocolVersion: 2
      });
      if (preview.duplicate) {
        const existing = preview.existingImport;
        // Unchanged data still repairs a member who has no linked character yet.
        if (pairedMemberId) inBackground("Repair of missing links", async () => { await repairMissingLinks(client ? await client.guilds.fetch(guild.discordId).catch(() => null) : null, prisma, guild.id, pairedMemberId); });
        // A member upload (and an officer guild with auto-apply) that was stored
        // but not applied must be tried again. Leaving it PREVIEWED made the
        // companion say "waiting for officer review", which a member cannot do.
        if ((existing?.status === "PREVIEWED" || existing?.status === "SUPERSEDED") && (!access.officer || settings?.autoApplyImports)) {
          // A file resent after a newer upload replaced it is the one to apply again: back to waiting, then applied.
          if (existing.status === "SUPERSEDED") await prisma.addonImport.updateMany({ where: { id: existing.id, guildId: guild.id, status: "SUPERSEDED" }, data: { status: "PREVIEWED" } });
          mark("before:auto-apply");
          const job = { importId: existing.id, retried: true };
          const answer = await applyWithDeadline(job);
          mark("auto-apply");
          if (answer.state === "applying") { applyingAnswer(200, existing.id); return; }
          if (!answer.outcome.ok) {
            const applyError = failApply(answer.outcome, job);
            if (applyError) {
              json(response, 409, { error: "This export was already received", checksum: preview.checksum, pairedCharacterStatus, importId: existing.id, status: "PREVIEWED", applyError, botVersion: BOT_VERSION, protocolVersion: 2 });
              return;
            }
          } else {
            json(response, 200, {
              autoApplied: answer.outcome.result, importId: existing.id, checksum: preview.checksum, pairedCharacterStatus,
              status: "APPLIED", scope: access.officer ? "officer" : "personal", botVersion: BOT_VERSION, protocolVersion: 2
            });
            return;
          }
          json(response, 409, { error: "This export was already received", checksum: preview.checksum, pairedCharacterStatus, importId: existing.id, status: "APPLIED", botVersion: BOT_VERSION, protocolVersion: 2 });
          return;
        }
        json(response, 409, { error: "This export was already received", checksum: preview.checksum, pairedCharacterStatus, importId: existing?.id, status: existing?.status, botVersion: BOT_VERSION, protocolVersion: 2 });
        return;
      }
      mark("duplicate-check");
      const record = await timed("record", () => importService.record(guild.id, preview.snapshot, preview.checksum, createdBy, pairedMemberId));
      // Auto-apply (a guild opt-in: /config auto-import): apply now and follow up, no /import apply.
      let autoApplied: AutoApplied | null = null;
      let applyError: string | null = null;
      if (!access.officer || settings?.autoApplyImports) {
        mark("before:auto-apply");
        const job = { importId: record.id, retried: false };
        const answer = await applyWithDeadline(job);
        mark("auto-apply");
        if (answer.state === "applying") { applyingAnswer(201, record.id); return; }
        if (answer.outcome.ok) autoApplied = answer.outcome.result;
        else applyError = failApply(answer.outcome, job);
      }
      mark("apply-tail");
      // 9.0.9: does this server know the uploading character's WoW guild? The companion warns about a wrong connection.
      json(response, 201, {
        ...(guildCheck ? { serverWowGuild: guildCheck } : {}),
        autoApplied,
        applyError,
        professionRelay,
        importId: record.id,
        checksum: preview.checksum,
        source: preview.snapshot.source,
        transactionCount: preview.transactionCount,
        pairedCharacterStatus,
        status: autoApplied ? "APPLIED" : record.status,
        scope: access.officer ? "officer" : "personal",
        botVersion: BOT_VERSION,
        protocolVersion: 2
      });
      });
    } catch (error) {
      if (error instanceof PoeMappingError) { json(response, error.status, { error: error.message }); return; }
      if (error instanceof GameEditionError) { json(response, 409, { error: error.message }); return; }
      if (error instanceof BodyTooLargeError) {
        json(response, 413, { error: "This upload is larger than the bot accepts. Update the companion: newer versions compress uploads and send only entries the bot does not have yet." });
        return;
      }
      console.error("Companion API request failed", error);
      json(response, error instanceof ZodError || error instanceof SyntaxError ? 400 : 503, { error: "Request could not be processed. Check the export or ask an officer to inspect the server log." });
    }
  });
  server.listen(config.COMPANION_API_PORT, config.COMPANION_API_HOST, () => {
    console.info(`Companion API listening on http://${config.COMPANION_API_HOST}:${config.COMPANION_API_PORT}`);
  });
  return server;
}
