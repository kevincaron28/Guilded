import { createPugWeb } from "./services/pug-web.js";
import { cachedOfficerCheck, meSection, type MeSectionInput } from "./services/me-layout.js";
import { revokeCompanionCredential } from "./services/companion-revoke.js";
import { createWebCommunityBadges } from "./services/web-community-badges.js";
import { guildWhere, loadGuildScope, runInGuildScope, withGuildScope } from "./services/guild-scope.js";
import { hostedPilot } from "./hosted-pilot.js";
import { GameEditionError, gameEditionOf } from "./services/game-edition.js";
import { withEdition } from "./services/edition-context.js";
import { addonName } from "./services/addon-name.js";
import { characterKey, realmKey } from "../companion/character-identity.mjs";
import { relayProfessions } from "./services/profession-relay.js";
import { autoLinkUnclaimed } from "./services/character-autolink.js";
import { linkUploaderCharacters, repairMissingLinks } from "./services/upload-linking.js";
import { linkedCharacterCount, scheduleLinkedCharacters } from "./services/companion-link-dm.js";
import { companionMe } from "./services/companion-me.js";
import { updateProfessionDirectory } from "./services/profession-directory.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { config } from "./config.js";
import { createDevicePages, prismaDeviceStore } from "./services/companion-devices.js";
import { memberLinkStatus } from "./services/link-status.js";
import { battleNetMeSection, createBattleNetPage, type BattleNetLinking } from "./services/battlenet-page.js";
import { autoLinkBattleNet, recentBattleNetLinks, undoBattleNetLinks } from "./services/battlenet-autolink.js";
import { battleNetConfig, discoverAllBattleNet, discoverBattleNet } from "./services/battlenet.js";
import { prismaBattleNetStore } from "./services/battlenet-store.js";
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
import { createGuildDirectory, prismaGuildDirectoryStore } from "./services/guild-directory.js";
import { calendarEventsWithin, discordCalendarEvents, mergeCalendarEvents } from "./services/discord-calendar.js";
import { createAuditService } from "./services/audit.js";
import { followUpImport } from "./services/import-followup.js";
import { exchangeCharacterPairingCode, findPairingServer, hashCompanionSecret, issueMemberCredential } from "./services/character-pairing.js";
import { linkVerifiedCharacters, tellVerified } from "./services/character-verify.js";
import { applyGuildmateRelay } from "./services/guildmate-relay.js";
import { applyGuildData } from "./services/guild-data.js";
import { applyGuildBank } from "./services/guild-bank.js";
import { asLang } from "./i18n.js";
import { serveCompanionWeb } from "./services/companion-redirect.js";
import { createGuildPageServer, loadGuildPageView } from "./services/guild-page.js";
import type { Client } from "discord.js";
import { companionAccess, personalSnapshot } from "./services/companion-access.js";
import { createMemberData, memberDataStore } from "./services/member-data.js";
import { deleteMyData } from "./services/data-deletion.js";
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
import { prismaAvailabilityStore } from "./services/web-availability-store.js";
import { createWebAvailability } from "./services/web-availability.js";
import { prismaGuildToolsStore } from "./services/guild-tools-store.js";
import { createGuildToolsPages } from "./services/guild-tools-pages.js";
import { createStatsPage } from "./services/stats-page.js";
import { createGuildBankPage } from "./services/guild-bank-page.js";
import { feedAccess, recentSnapshots, statsCsv, MAX_FEED_DAYS } from "./services/stat-snapshots.js";
import { createArtisansGallery } from "./services/artisans-gallery.js";
import { postCraftRequest } from "./commands/craft-board.js";
import { webAuthConfig } from "./services/web-auth.js";
import { prismaWebStore } from "./services/web-store.js";
import { postWebApplication } from "./services/recruitment-discord.js";
import { createLeaderboardPages, prismaLeaderboardStore } from "./services/public-leaderboard.js";
import { exchangePersonalCode, isPersonalCode, issuePersonalCredential, personalAccess, prismaPersonalStore } from "./services/personal-pairing.js";
import { loadOfficialWindows } from "./services/official-seasons.js";
import { companionSignInRoute, createCompanionSignIn } from "./services/companion-signin.js";
import { ingestPublicRuns, PUBLIC_LIMITS, prismaPublicRunStore, PublicUploadError } from "./services/public-runs.js";
import { publicAddonBoard } from "./services/public-addon-board.js";
import { publicSeasons } from "./services/public-score.js";
import { inviteListForAddon, pendingInvites } from "./services/invite-queue.js";
import { backCheckInvites, completeInvitesFromRoster } from "./services/invite-channel.js";
import { COMPANION_FEATURES, markGuildChanged, standingsFeed, type FeedParts } from "./services/standings-feed.js";
import { commandRegistration } from "./services/command-registration.js";
const BOT_VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version as string;

const importService = createAddonImportService(prisma);

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
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
const guildPages = createGuildPageServer((slug) => loadGuildPageView(prisma, slug, (id) => hostedPilot.allows(id)));

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
  const availability = createWebAvailability(prismaAvailabilityStore(prisma, guildDashboardAccess(prisma, client, id => hostedPilot.allows(id), "member")));
  const guildTools = createGuildToolsPages(prismaGuildToolsStore(prisma, guildDashboardAccess(prisma, client, id => hostedPilot.allows(id))));
  const gallery = createArtisansGallery({ db: prisma, access: guildDashboardAccess(prisma, client, id => hostedPilot.allows(id), "member"),
    post: async (guildId, requestId, askCrafter) => {
      const record = await prisma.guild.findUnique({ where: { id: guildId }, select: { discordId: true } });
      const discordGuild = record && client ? await client.guilds.fetch(record.discordId).catch(() => null) : null;
      return discordGuild ? (await withGuildScope(prisma, guildId, () => postCraftRequest(discordGuild, requestId, askCrafter))).posted : false;
    } });
  const achievementsWeb = createAchievementsWeb(prisma, hostedPilot.allows);
  const profiles = createPlayerProfiles(prismaProfileStore(prisma, hostedPilot.allows), achievementsWeb);
  const directory = createGuildDirectory(prismaGuildDirectoryStore(prisma, (id) => hostedPilot.allows(id)));
  const leaderboards = createLeaderboardPages({ store: prismaLeaderboardStore(prisma, (id) => hostedPilot.allows(id)), personal: personalStore, calendar: () => loadOfficialWindows(prisma) });
  const signInPage = companionSignInRoute({
    signIn: companionSignIn,
    servers: (discordUserId) => signInServers(client, discordUserId),
    issueGuild: (account, guildDiscordId, wowGuildId, deviceName) => signInGuildCredential(client, account, guildDiscordId, wowGuildId, deviceName),
    issuePersonal: async (accountId, deviceName) => (await issuePersonalCredential(personalStore, accountId, deviceName)).companionCredential
  });
  const badges = createWebCommunityBadges(prisma, client, id => hostedPilot.allows(id));
  const devices = createDevicePages(prismaDeviceStore(prisma));
  const memberData = createMemberData(memberDataStore(prisma, guildDashboardAccess(prisma, client, id => hostedPilot.allows(id), "member")), discordUserId => deleteMyData(prisma, discordUserId));
  const raidPlanning = createRaidPlanning(raidPlanningStore(prisma, guildDashboardAccess(prisma, client, id => hostedPilot.allows(id), "member"), guildDashboardAccess(prisma, client, id => hostedPilot.allows(id)), client));
  const handover = createOfficerHandover(officerHandoverStore(prisma, guildDashboardAccess(prisma, client, id => hostedPilot.allows(id))));
  const personalCalendar = createPersonalCalendar(personalCalendarStore(prisma, guildDashboardAccess(prisma, client, id => hostedPilot.allows(id), "member"), client));
  const battleNetLinking: BattleNetLinking = {
    discoverAll: discoverAllBattleNet,
    autoLink: (discordUserId, characters) => autoLinkBattleNet(prisma, discordUserId, characters),
    recent: discordUserId => recentBattleNetLinks(prisma, discordUserId),
    undo: discordUserId => undoBattleNetLinks(prisma, discordUserId),
    status: discordUserId => memberLinkStatus(prisma, discordUserId)
  };
  const battleNet = createBattleNetPage(prismaBattleNetStore(prisma), battleNetConfig(config), discoverBattleNet, battleNetLinking);
  const routes: WebRoute[] = [badges.route, signInPage, availability.route, roster.route, createRosterReview(rosterStore, prismaRosterPlanWriter(prisma, guildDashboardAccess(prisma, client, id => hostedPilot.allows(id)))), guildTools.route, createStatsPage(prisma, guildDashboardAccess(prisma, client, id => hostedPilot.allows(id))).route, createGuildBankPage(prisma, guildDashboardAccess(prisma, client, id => hostedPilot.allows(id))).route, gallery.route, leaderboards.route, directory.route, achievementsWeb.route, achievementsWeb.ownerRoute, profiles.route, createPugWeb(prisma, id => hostedPilot.allows(id)).route];
  const isOfficer = cachedOfficerCheck(rosterStore.guilds);
  const meSections: MeSectionInput[] = [
    meSection({ id: "profile", group: "overview", render: profiles.meSection, fold: { en: "Privacy and details", fr: "Confidentialité et détails" } }),
    meSection({ id: "characters", group: "overview", render: battleNetMeSection(battleNetLinking, battleNetConfig(config)) }),
    meSection({ id: "achievements", group: "play", render: achievementsWeb.meSection }),
    meSection({ id: "badges", group: "play", render: badges.meSection }),
    meSection({ id: "availability", group: "play", render: availability.meSection }),
    meSection({ id: "calendar", group: "play", render: personalCalendar.meSection }),
    meSection({ id: "raid-planning", group: "play", render: raidPlanning.meSection }),
    meSection({ id: "leaderboards", group: "play", render: leaderboards.meSection, fold: { en: "How to connect the companion", fr: "Comment connecter le compagnon" } }),
    meSection({ id: "guild-tools", group: "guild", render: guildTools.meSection }),
    meSection({ id: "artisans", group: "guild", render: gallery.meSection }),
    meSection({ id: "roster", group: "guild", render: roster.meSection, officer: true, visible: isOfficer }),
    meSection({ id: "handover", group: "guild", render: handover.meSection, officer: true, visible: isOfficer }),
    meSection({ id: "connections", group: "account", render: devices.meSection }),
    meSection({ id: "your-data", group: "account", render: memberData.meSection })
  ];
  routes.unshift(devices.route, battleNet, memberData.route, personalCalendar.route, handover.route, raidPlanning.route);
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
  // At most 4 s (hotfix 2): otherwise the member's last known events (discord-calendar.ts).
  const scheduledEvents = await calendarEventsWithin(() => discordCalendarEvents(client, guild.discordId, access.actorId),
    `${guild.discordId}:${access.actorId}`).catch(() => {
    console.warn("Discord calendar events could not be fetched; exporting bot raids only.");
    return [];
  });
  return prisma.$transaction(async (transaction) => {
    const database = transaction as unknown as PrismaClient;
    const epgp = createEpgpService(database);
    const baseGp = (await database.guildSettings.findUnique({ where: { guildId: guild.id } }))?.baseGp ?? 0;
    // Dungeon runs the bot has stored lately, so the addon can mark them
    // as synced (roadmap D3).
    const acceptedRunRefs = (await database.dungeonRun.findMany({
      where: { guildId: guild.id, createdAt: { gte: new Date(Date.now() - 45 * 86_400_000) } },
      select: { runRef: true },
      orderBy: { createdAt: "desc" },
      take: 500
    })).map((row) => row.runRef);
    const dungeonBoard = await addonDungeonBoard(database, guild.id);
    const nextRaid = await nextRaidRoster(database, guild.id);
    const items = await itemInsights(database, guild.id).catch(() => []);
    // How each raid core decides loot, with its item prices and own-pool standings.
    const loot = await lootRulesForAddon(database, guild.id, async (coreId, coreBaseGp) =>
      (await epgp.getGuildStandings(guild.id, coreBaseGp, coreId)).map((row) => ({ character: addonName(row.character, row.realm), ...(row.displayName ? { displayName: row.displayName } : {}), main: row.main, ep: row.ep, gp: row.gp })));
    const botRaids = await upcomingRaidsForAddon(database, guild.id);
    const raids = mergeCalendarEvents(botRaids, scheduledEvents);
    const accounts = Object.fromEntries((await database.character.findMany({ where: { member: { guildId: guild.id } }, select: { name: true, realm: true, memberId: true } })).map((c) => [addonName(c.name, c.realm), c.memberId]));
    const acceptedLedgerRefs = await ledgerRefsFor(database, guild.id, access.memberId);
    const acceptedLootRefs = await lootRefsFor(database, guild.id);
    const standings = (await epgp.getGuildStandings(guild.id, baseGp)).map(row => ({ ...row, character: addonName(row.character, row.realm) }));
    // Shared: the same for every member, so it sets the stamp. Discord events are filtered
    // per member and dungeon/ledger acknowledgements do not change what the addon shows.
    return {
      shared: { accounts, baseGp, dungeonBoard, nextRaid, items, loot: loot ? { ...loot, cores: loot.cores.map((core) => ({ ...core, accounts })) } : null, standings },
      personal: { acceptedLedgerRefs, acceptedLootRefs, acceptedRunRefs, raids, ...(promotion ? { promotion } : {}),
        // Officers only (8.5 batch 3): the names waiting for a guild invite, for the addon's "To invite" panel.
        ...(access.officer ? { officerInvites: inviteListForAddon(await pendingInvites(database, guild.id)) } : {}),
        publicRaids: { fetchedAt: new Date().toISOString(), raids: await publicRaids(database, hostedPilot.allows) } },
      stampOnly: { botRaids }
    };
  }, { isolationLevel: "RepeatableRead", timeout: STANDINGS_READ_BUDGET_MS.query, maxWait: STANDINGS_READ_BUDGET_MS.poolWait });
}

// `client` lets an upload be applied and announced by the bot itself (auto-apply).
export function startCompanionApi(client?: Client): ReturnType<typeof createServer> {
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
      const isPoeStatus = request.method === "GET" && url.pathname === "/api/v1/poe/status";
      const isPoeRecent = request.method === "GET" && url.pathname === "/api/v1/poe/visits";
      const isLogout = request.method === "POST" && url.pathname === "/api/v1/companion/logout";
      const isSignInStart = request.method === "POST" && url.pathname === "/api/v1/companion/sign-in";
      const isSignInPoll = request.method === "POST" && url.pathname === "/api/v1/companion/sign-in/poll";
      // The companion's own pages: wishlists for members; prices, core rules and rosters for Raid Leaders.
      const isManageView = request.method === "GET" && url.pathname === "/api/v1/manage";
      const isManageEdit = request.method === "POST" && url.pathname === "/api/v1/manage";
      // The companion's hub: my characters, reserves and (officers) the server page.
      const isHubView = request.method === "GET" && url.pathname === "/api/v1/hub";
      const isHubEdit = request.method === "POST" && url.pathname === "/api/v1/hub";
      if (!isImport && !isPairing && !isSignInStart && !isSignInPoll && !isPublicRuns && !isPersonalStatus && !isCompanionMe && !isStandings && !isPoeUpload && !isPoeLevels && !isPoeStatus && !isPoeRecent && !isLogout && !isManageView && !isManageEdit && !isHubView && !isHubEdit) {
        json(response, 404, { error: "Not found" });
        return;
      }
      const address = clientAddress(request);
      if (isLockedOut(address)) {
        json(response, 429, { error: "Too many failed attempts. Try again in a few minutes." });
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
      if (isSignInStart) {
        // Needs the website's Discord sign-in; a bot without it keeps pairing codes only.
        const auth = webAuthConfig(config);
        if (!auth) { json(response, 503, { error: "Sign-in with Discord is not set up on this bot. Use a pairing code instead." }); return; }
        if (!allowSignInStart(address)) { json(response, 429, { error: "Too many sign-in attempts. Try again later." }); return; }
        // The Windows app's 127.0.0.1 port (8.1): approval then needs no typed code (companion-signin.ts).
        const startPayload = await readBody(request).catch(() => null) as { loopback?: unknown } | null;
        const started = companionSignIn.start({ loopback: startPayload?.loopback });
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
            const row = await prisma.wowGuild.findFirst({ where: { gameEdition: "forever", nameKey, realmKey }, select: { guild: { select: { discordId: true, page: { select: { inviteUrl: true } } } } } });
            if (!row || !hostedPilot.allows(row.guild.discordId)) return null;
            const name = client?.guilds.cache.get(row.guild.discordId)?.name ?? null;
            return name ? { discordId: row.guild.discordId, name, inviteUrl: row.guild.page?.inviteUrl ?? null } : null;
          }
        }, { tokenHash: hashCompanionSecret(secret), guild: url.searchParams.get("guild"), realm: url.searchParams.get("realm") });
        if (!answer) { recordFailure(address); json(response, 401, { error: "This companion link is no longer valid. Sign in with Discord again." }); return; }
        json(response, 200, answer);
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
        const body = await readBody(request) as { character?: { name?: unknown; displayName?: unknown; realm?: unknown; gameEdition?: unknown; interface?: unknown }; runs?: unknown; includeScore?: unknown } | null;
        let gameEdition;
        try {
          gameEdition = gameEditionOf(body?.character ?? {});
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
          const result = await ingestPublicRuns(publicRuns, { uploaderKey: `account:${account.accountId}`, gameEdition, character: characterKey(character, realm, gameEdition), source: "personal", runs: body?.runs });
          const refs = [...result.accepted, ...result.confirmed, ...result.duplicates];
          if (refs.length) {
            // Link only this uploader's named character in a run accepted from this request.
            // Party members are never claimed as the account's alts.
            const players = await prisma.publicRunPlayer.findMany({
              where: { character: { equals: character, mode: "insensitive" }, ...(gameEdition !== "forever" ? { realm: { equals: realm, mode: "insensitive" } } : {}), run: { gameEdition, runRef: { in: refs }, status: "ACCEPTED", uploads: { some: { uploaderKey: `account:${account.accountId}` } } } },
              select: { character: true, realm: true }, distinct: ["character", "realm"]
            });
            for (const player of players) if (player.realm) await prisma.webCharacter.upsert({
              where: { accountId_gameEdition_name_realm: { accountId: account.accountId, gameEdition, name: player.character, realm: player.realm } },
              create: { accountId: account.accountId, gameEdition, name: player.character, realm: player.realm, ...(displayName ? { displayName } : {}) }, update: displayName ? { displayName } : {}
            });
          }
          // Explicit opt-in keeps old companions' response and cost unchanged. Public
          // data may be read without claiming ownership; names are always realm-scoped.
          const publicScore = body?.includeScore === true && realm && realm !== "-"
            ? publicAddonBoard(await prismaLeaderboardStore(prisma).characterRuns(character, realm), { character, realm },
              publicSeasons(new Date(), await loadOfficialWindows(prisma))) : undefined;
          json(response, 200, { ...result, gameEdition, ...(body?.includeScore === true ? { publicScore: publicScore ?? null } : {}), botVersion: BOT_VERSION });
        } catch (error) {
          if (error instanceof PublicUploadError) { json(response, error.status, { error: error.message }); return; }
          throw error;
        }
        });
      }
      const payload = isImport || isPoeUpload || isPoeLevels || isManageEdit || isHubEdit ? await readBody(request) : null;
      const requestPayload = payload as { guildDiscordId?: unknown; export?: unknown } | null;
      const guildDiscordId = isStandings || isPoeStatus || isPoeRecent || isManageView || isHubView ? url.searchParams.get("guild") : requestPayload?.guildDiscordId;
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
      const access = typeof header === "string" ? await companionAccess(prisma, client, guild.id, guild.discordId, header) : null;
      if (!access) {
        recordFailure(address);
        json(response, 401, { error: "Pair this companion with /character pair. The shared upload token no longer grants access." }); return;
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
      let preview = await importService.preview(guild.id, requestPayload.export, createdBy);
      const uploadStartedAt = new Date();
      const linkedBefore = pairedMemberId ? await linkedCharacterCount(prisma, pairedMemberId) : 0;
      const pairedCharacterStatus = pairedMemberId
        ? await linkUploaderCharacters(prisma, guild.id, pairedMemberId, preview.snapshot)
        : "unpaired";
      // First link, and later new characters: one batched DM listing the linked characters (owner decision, 8.5 track F).
      if (pairedMemberId && client) {
        const language = await prisma.guildSettings.findUnique({ where: { guildId: guild.id }, select: { language: true } });
        scheduleLinkedCharacters(client, prisma, { guildDiscordId: guild.discordId, memberId: pairedMemberId, lang: asLang(language?.language), before: linkedBefore });
      }
      // Guildmates who pasted their /guilded verify code in game, as this uploader's addon heard them:
      // an officer's upload links and confirms; a member's links provisionally (character-verify.ts).
      if (access.officer) await prisma.guild.update({ where: { id: guild.id }, data: { officerSyncAt: new Date() } }).catch(() => undefined);
      // Characters in an officer's roster upload are in the guild: their waiting invite posts get a check mark.
      if (access.officer && client) {
        const rosterNames = [preview.snapshot.character, ...preview.snapshot.characters].flatMap((entry) => entry ? [entry.name, ...(entry.displayName ? [entry.displayName] : [])] : []);
        void completeInvitesFromRoster(client, prisma, { id: guild.id, discordId: guild.discordId }, rosterNames)
          .then((done) => { if (done) markGuildChanged(guild.id); }).catch((error: unknown) => console.warn("Invite check marks failed", error));
      }
      if (access.officer || pairedMemberId) {
        const verified = await linkVerifiedCharacters(prisma, guild.id, { officer: access.officer, memberId: pairedMemberId }, preview.snapshot.characters)
          .catch((error: unknown) => { console.error("Linking verified characters failed", error); return []; });
        if (verified.length && client) {
          const language = await prisma.guildSettings.findUnique({ where: { guildId: guild.id }, select: { language: true } });
          void tellVerified(client, guild.discordId, asLang(language?.language), verified).catch(() => undefined);
        }
      }
      // 8.5: the game's guild roster, event log and MOTD from any member's upload (guild-data.ts):
      // members without the addon reach the race board, last seen and roster gaps. Rank only from
      // officers. No markGuildChanged: none of it is in the standings feed. Never fails the upload.
      if (preview.snapshot.guildRoster || preview.snapshot.guildEvents.length || preview.snapshot.guildInfo) {
        await prisma.$transaction((tx) => applyGuildData(tx, guild.id, { memberId: pairedMemberId ?? null, officer: access.officer }, preview.snapshot),
          { timeout: 60_000, maxWait: 15_000 }).catch((error: unknown) => { console.error("Guild data upload failed", error); });
        // The whole guild roster (any member's upload) is now stored: waiting invite requests for those names are done.
        if (client && preview.snapshot.guildRoster) {
          void backCheckInvites(client, prisma, { id: guild.id, discordId: guild.discordId })
            .then((done) => { if (done) markGuildChanged(guild.id); }).catch((error: unknown) => console.warn("Invite back-check failed", error));
        }
      }
      // 9.0 guild bank ledger (guild-bank.ts): contents, gold history and the game's logs, deduped across uploaders.
      if (preview.snapshot.guildBank !== undefined) {
        await prisma.$transaction((tx) => applyGuildBank(tx, guild.id, pairedMemberId ?? null, preview.snapshot.guildBank),
          { timeout: 60_000, maxWait: 15_000 }).catch((error: unknown) => { console.error("Guild bank upload failed", error); });
      }
      if (!access.officer) {
        // Guildmates heard in game (level, class, race, professions): applied to already-linked
        // characters only, never over newer first-hand data (guildmate-relay.ts). Never fails the upload.
        if (pairedMemberId) {
          // No markGuildChanged: levels and professions are not in the standings feed, and a
          // generation bump per member upload kept the feed from ever finishing (8.5 hotfix).
          await applyGuildmateRelay(prisma, guild.id, pairedMemberId, preview.snapshot)
            .catch((error: unknown) => { console.error("Guildmate relay failed", error); return null; });
        }
        const owned = await prisma.character.findMany({ where: { memberId: pairedMemberId }, select: { name: true, realm: true } });
        preview = await importService.previewSnapshot(guild.id, personalSnapshot(preview.snapshot, owned), createdBy);
      }
      const settings = await prisma.guildSettings.findUnique({ where: { guildId: guild.id } });
      const professionRelay = access.officer && !settings?.autoApplyImports
        ? await relayProfessions(prisma, guild.id, preview.snapshot) : null;
      if (professionRelay) {
        const discordGuild = client ? await client.guilds.fetch(guild.discordId).catch(() => null) : null;
        if (discordGuild && professionRelay.discovered) await autoLinkUnclaimed(discordGuild, prisma, guild.id, { since: uploadStartedAt }).catch((error: unknown) => console.warn("Profession character linking failed", error));
        await updateProfessionDirectory(discordGuild);
      }
      if (preview.duplicate) {
        const existing = preview.existingImport;
        // Unchanged data still repairs a member who has no linked character yet.
        if (pairedMemberId) await repairMissingLinks(client ? await client.guilds.fetch(guild.discordId).catch(() => null) : null, prisma, guild.id, pairedMemberId);
        // A member upload (and an officer guild with auto-apply) that was stored
        // but not applied must be tried again. Leaving it PREVIEWED made the
        // companion say "waiting for officer review", which a member cannot do.
        if (existing?.status === "PREVIEWED" && (!access.officer || settings?.autoApplyImports)) {
          let autoApplied: { epgp: number; discovered: number; held: number; voided: number; rejected: number } | null = null;
          try {
            const result = await importService.apply(guild.id, existing.id, createdBy);
            autoApplied = { epgp: result.epgpTransactions.length, discovered: result.discovery.discovered, held: result.held.rows.length, voided: result.voided, rejected: result.rejected.length };
            markGuildChanged(guild.id);
            await auditService.record({
              guildId: guild.id, actorId: createdBy, action: "IMPORT_APPLIED", entityId: existing.id,
              metadata: { auto: true, retried: true, epgpTransactionCount: result.epgpTransactions.length, readinessSnapshotCount: result.readinessSnapshots.length, discovered: result.discovery.discovered }
            });
            const discordGuild = client ? await client.guilds.fetch(guild.discordId).catch(() => null) : null;
            await followUpImport(discordGuild, guild.id, result, { since: uploadStartedAt });
          } catch (error) {
            const already = error instanceof Error && /already been applied/i.test(error.message);
            if (!autoApplied && !already) {
              const applyError = error instanceof Error && error.message.length < 200 ? error.message : "The bot could not apply this upload (see the server log).";
              json(response, 409, { error: "This export was already received", checksum: preview.checksum, pairedCharacterStatus, importId: existing.id, status: "PREVIEWED", applyError, botVersion: BOT_VERSION, protocolVersion: 2 });
              return;
            }
          }
          if (autoApplied) {
            json(response, 200, {
              autoApplied, importId: existing.id, checksum: preview.checksum, pairedCharacterStatus,
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
      const record = await importService.record(guild.id, preview.snapshot, preview.checksum, createdBy, pairedMemberId);
      // Auto-apply (a guild opt-in: /config auto-import): apply now and follow up, no /import apply.
      let autoApplied: { epgp: number; discovered: number; held: number; voided: number; rejected: number } | null = null;
      let applyError: string | null = null;
      if (!access.officer || settings?.autoApplyImports) {
        let applied = false;
        try {
          const result = await importService.apply(guild.id, record.id, createdBy);
          applied = true;
          markGuildChanged(guild.id);
          autoApplied = { epgp: result.epgpTransactions.length, discovered: result.discovery.discovered, held: result.held.rows.length, voided: result.voided, rejected: result.rejected.length };
          await auditService.record({
            guildId: guild.id, actorId: createdBy, action: "IMPORT_APPLIED", entityId: record.id,
            metadata: { auto: true, epgpTransactionCount: result.epgpTransactions.length, readinessSnapshotCount: result.readinessSnapshots.length, discovered: result.discovery.discovered }
          });
          const discordGuild = client ? await client.guilds.fetch(guild.discordId).catch(() => null) : null;
          await followUpImport(discordGuild, guild.id, result, { since: uploadStartedAt });
        } catch (error) {
          // Application and notification are distinct: a committed import stays APPLIED even if follow-up fails.
          console.error("Auto-apply of an addon import failed", error);
          if (!applied) {
            // Nothing was imported: say so to the uploader and, for a guild upload, to the officers,
            // instead of leaving it in the server log only. Short messages are ours; anything else
            // (a database error) is not shown.
            applyError = error instanceof Error && error.message.length < 200 ? error.message : "The bot could not apply this upload (see the server log).";
            if (access.officer && shouldTellApplyFailure(`${guild.id}:${applyError}`)) {
              const discordGuild = client ? await client.guilds.fetch(guild.discordId).catch(() => null) : null;
              await notify(discordGuild, `⚠️ **Addon import not applied** (upload by <@${createdBy}>): ${applyError}\nNothing from it was imported. Fix the cause, or apply it by hand: \`/import apply id:${record.id}\`.`, "officer");
            }
          }
        }
      }
      json(response, 201, {
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
