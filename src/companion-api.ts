import { hostedPilot } from "./hosted-pilot.js";
import { relayProfessions } from "./services/profession-relay.js";
import { autoLinkUnclaimed } from "./services/character-autolink.js";
import { updateProfessionDirectory } from "./services/profession-directory.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { gunzipSync } from "node:zlib";
import { config } from "./config.js";
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
import { discordCalendarEvents, mergeCalendarEvents } from "./services/discord-calendar.js";
import { createAuditService } from "./services/audit.js";
import { followUpImport } from "./services/import-followup.js";
import { exchangeCharacterPairingCode, findPairingServer, hashCompanionSecret, issueMemberCredential, linkPairedCharacter } from "./services/character-pairing.js";
import { linkVerifiedCharacters, tellVerified } from "./services/character-verify.js";
import { asLang } from "./i18n.js";
import { serveCompanionWeb } from "./services/companion-web.js";
import { createGuildPageServer, loadGuildPageView } from "./services/guild-page.js";
import type { Client } from "discord.js";
import { companionAccess, personalSnapshot } from "./services/companion-access.js";
import { readFileSync } from "node:fs";
import { ZodError } from "zod";
import type { PrismaClient } from "./generated/prisma/client.js";
import { createPoeMappingService, poeAreaName, PoeMappingError } from "./services/poe-mapping.js";
import { notify } from "./services/notify.js";
import { allowManageWrite, createCompanionManage, ManageError } from "./services/companion-manage.js";
import { syncCoreRoster } from "./services/raid-core.js";
import { createWebApp, isWebPath, type WebRoute } from "./services/web-app.js";
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
// Public guild pages (/g/<slug>/): read-only HTML, no pairing needed.
const guildPages = createGuildPageServer((slug) => loadGuildPageView(prisma, slug, (id) => hostedPilot.allows(id)));

// The website's signed-in pages (/auth/, /recruitment/, /me/, /leaderboards/), served through the Worker.
const WEB_FORM_BYTES = 16_000;
async function readForm(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += Buffer.byteLength(chunk);
    if (size > WEB_FORM_BYTES) throw new BodyTooLargeError("Form is too large.");
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
  const guilds = await prisma.guild.findMany({ select: { discordId: true, name: true } });
  const found: { discordId: string; name: string }[] = [];
  for (const guild of guilds) {
    if (!hostedPilot.allows(guild.discordId)) continue;
    const discordGuild = client.guilds.cache.get(guild.discordId);
    const member = discordGuild ? await discordGuild.members.fetch({ user: discordUserId, force: true }).catch(() => null) : null;
    if (member) found.push({ discordId: guild.discordId, name: discordGuild!.name || guild.name });
  }
  return found;
}

async function signInGuildCredential(client: Client | undefined, account: { discordUserId: string; username: string; displayName: string | null }, guildDiscordId: string) {
  if (!(await signInServers(client, account.discordUserId)).some((server) => server.discordId === guildDiscordId)) return null;
  const guild = await prisma.guild.findUnique({ where: { discordId: guildDiscordId }, select: { id: true } });
  if (!guild) return null;
  const member = await prisma.member.upsert({
    where: { guildId_discordUserId: { guildId: guild.id, discordUserId: account.discordUserId } },
    create: { guildId: guild.id, discordUserId: account.discordUserId, displayName: account.displayName ?? account.username },
    update: {}
  });
  // Same rule as companionAccess: only active members get (and keep) companion access.
  if (member.status !== "ACTIVE") return null;
  return issueMemberCredential(prisma, member.id);
}

export function createSiteApp(client?: Client) {
  const profiles = createPlayerProfiles(prismaProfileStore(prisma, hostedPilot.allows));
  const leaderboards = createLeaderboardPages({ store: prismaLeaderboardStore(prisma, (id) => hostedPilot.allows(id)), personal: personalStore, calendar: () => loadOfficialWindows(prisma) });
  const signInPage = companionSignInRoute({
    signIn: companionSignIn,
    servers: (discordUserId) => signInServers(client, discordUserId),
    issueGuild: (account, guildDiscordId) => signInGuildCredential(client, account, guildDiscordId),
    issuePersonal: async (accountId) => (await issuePersonalCredential(personalStore, accountId)).companionCredential
  });
  const routes: WebRoute[] = [signInPage, leaderboards.route, profiles.route];
  const meSections = [profiles.meSection, leaderboards.meSection];
  return createWebApp({
    publicRaids: now => publicRaids(prisma, hostedPilot.allows, now),
    store: prismaWebStore(prisma), auth: webAuthConfig(config), allows: (id) => hostedPilot.allows(id), routes, meSections,
    postApplication: (view) => postWebApplication(client, view),
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
  const mine = await database.character.findMany({ where: { memberId }, select: { name: true } });
  const rows = await database.epgpTransaction.findMany({
    where: { guildId, OR: [
      { sourceRef: { startsWith: "addon:" }, createdAt: { gte: new Date(now.getTime() - RECENT_REF_DAYS * 86_400_000) } },
      ...mine.map((character) => ({ sourceRef: { startsWith: `addon:qg:${character.name}-` } }))
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

// Read-only EP/GP/PR per linked character and what goes with it. The companion writes it
// into the addon folder so /guilded standings shows the bot's numbers.
async function standingsParts(guild: { id: string; discordId: string }, access: { memberId: string; actorId: string }, client?: Client): Promise<FeedParts> {
  const scheduledEvents = await discordCalendarEvents(client, guild.discordId, access.actorId).catch(() => {
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
      (await epgp.getGuildStandings(guild.id, coreBaseGp, coreId)).map((row) => ({ character: row.character, main: row.main, ep: row.ep, gp: row.gp })));
    const botRaids = await upcomingRaidsForAddon(database, guild.id);
    const raids = mergeCalendarEvents(botRaids, scheduledEvents);
    const accounts = Object.fromEntries((await database.character.findMany({ where: { member: { guildId: guild.id } }, select: { name: true, memberId: true } })).map((c) => [c.name, c.memberId]));
    const acceptedLedgerRefs = await ledgerRefsFor(database, guild.id, access.memberId);
    const acceptedLootRefs = await lootRefsFor(database, guild.id);
    const standings = await epgp.getGuildStandings(guild.id, baseGp);
    // Shared: the same for every member, so it sets the stamp. Discord events are filtered
    // per member and dungeon/ledger acknowledgements do not change what the addon shows.
    return {
      shared: { accounts, baseGp, dungeonBoard, nextRaid, items, loot: loot ? { ...loot, cores: loot.cores.map((core) => ({ ...core, accounts })) } : null, standings },
      personal: { acceptedLedgerRefs, acceptedLootRefs, acceptedRunRefs, raids,
        publicRaids: { fetchedAt: new Date().toISOString(), raids: await publicRaids(database, hostedPilot.allows) } },
      stampOnly: { botRaids }
    };
  }, { isolationLevel: "RepeatableRead", timeout: 60_000, maxWait: 15_000 });
}

// `client` lets an upload be applied and announced by the bot itself (auto-apply).
export function startCompanionApi(client?: Client): ReturnType<typeof createServer> {
  const site = createSiteApp(client);
  const server = createServer(async (request, response) => {
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
          headers: Object.fromEntries(["cookie", "origin", "referer", "accept-language", "content-type"].map((name) => [name, headerOf(request, name)])),
          ...(request.method === "POST" ? { body: await readForm(request) } : {})
        });
        if (answer) {
          response.writeHead(answer.status, answer.headers);
          response.end(request.method === "HEAD" ? undefined : answer.body);
          return;
        }
      }
      const page = await guildPages.respond(request.method ?? "GET", url.pathname);
      if (page) {
        response.writeHead(page.status, page.headers);
        response.end(request.method === "HEAD" ? undefined : page.body);
        return;
      }
      const isImport = request.method === "POST" && url.pathname === "/api/v1/addon-imports";
      const isPairing = request.method === "POST" && url.pathname === "/api/v1/addon-pairings";
      const isStandings = request.method === "GET" && url.pathname === "/api/v1/standings";
      const isPoeUpload = request.method === "POST" && url.pathname === "/api/v1/poe/visits";
      const isPublicRuns = request.method === "POST" && url.pathname === "/api/v1/public-runs";
      const isPoeStatus = request.method === "GET" && url.pathname === "/api/v1/poe/status";
      const isPoeRecent = request.method === "GET" && url.pathname === "/api/v1/poe/visits";
      const isLogout = request.method === "POST" && url.pathname === "/api/v1/companion/logout";
      const isSignInStart = request.method === "POST" && url.pathname === "/api/v1/companion/sign-in";
      const isSignInPoll = request.method === "POST" && url.pathname === "/api/v1/companion/sign-in/poll";
      // The companion's own pages: wishlists for members; prices, core rules and rosters for Raid Leaders.
      const isManageView = request.method === "GET" && url.pathname === "/api/v1/manage";
      const isManageEdit = request.method === "POST" && url.pathname === "/api/v1/manage";
      if (!isImport && !isPairing && !isSignInStart && !isSignInPoll && !isPublicRuns && !isStandings && !isPoeUpload && !isPoeStatus && !isPoeRecent && !isLogout && !isManageView && !isManageEdit) {
        json(response, 404, { error: "Not found" });
        return;
      }
      const address = clientAddress(request);
      if (isLockedOut(address)) {
        json(response, 429, { error: "Too many failed attempts. Try again in a few minutes." });
        return;
      }
      if (isSignInStart) {
        // Needs the website's Discord sign-in; a bot without it keeps pairing codes only.
        const auth = webAuthConfig(config);
        if (!auth) { json(response, 503, { error: "Sign-in with Discord is not set up on this bot. Use a pairing code instead." }); return; }
        if (!allowSignInStart(address)) { json(response, 429, { error: "Too many sign-in attempts. Try again later." }); return; }
        const started = companionSignIn.start();
        if (!started) { json(response, 503, { error: "Too many sign-ins in progress. Try again in a few minutes." }); return; }
        const page = new URL("/me/companion", auth.siteUrl);
        page.searchParams.set("request", started.requestId);
        json(response, 200, { requestId: started.requestId, confirm: started.confirm, expiresAt: started.expiresAt.toISOString(), url: page.href });
        return;
      }
      if (isSignInPoll) {
        const payload = await readBody(request) as { requestId?: unknown } | null;
        const answer = companionSignIn.poll(payload?.requestId);
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
        const guild = await prisma.guild.findUnique({ where: { discordId: serverId }, select: { id: true } });
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
      if (isPublicRuns) {
        // Personal companions (website accounts) send their own finished dungeon runs.
        const secret = request.headers["x-companion-credential"];
        const account = await personalAccess(personalStore, typeof secret === "string" ? secret : undefined);
        if (!account) { recordFailure(address); json(response, 401, { error: "Connect this companion with a code from your Guilded page (guilded.kcaron.top/me/)." }); return; }
        if (!allowPublicUpload(account.accountId)) { json(response, 429, { error: "Too many uploads in the last hour. Try again later." }); return; }
        const body = await readBody(request) as { character?: { name?: unknown; realm?: unknown }; runs?: unknown; includeScore?: unknown } | null;
        const character = typeof body?.character?.name === "string" ? body.character.name.slice(0, 40) : null;
        if (!character) { json(response, 400, { error: "character.name is required" }); return; }
        try {
          const result = await ingestPublicRuns(publicRuns, { uploaderKey: `account:${account.accountId}`, character, source: "personal", runs: body?.runs });
          const refs = [...result.accepted, ...result.confirmed, ...result.duplicates];
          if (refs.length) {
            // Link only this uploader's named character in a run accepted from this request.
            // Party members are never claimed as the account's alts.
            const players = await prisma.publicRunPlayer.findMany({
              where: { character: { equals: character, mode: "insensitive" }, run: { runRef: { in: refs }, status: "ACCEPTED", uploads: { some: { uploaderKey: `account:${account.accountId}` } } } },
              select: { character: true, realm: true }, distinct: ["character", "realm"]
            });
            for (const player of players) if (player.realm) await prisma.webCharacter.upsert({
              where: { accountId_name_realm: { accountId: account.accountId, name: player.character, realm: player.realm } },
              create: { accountId: account.accountId, name: player.character, realm: player.realm }, update: {}
            });
          }
          // Explicit opt-in keeps old companions' response and cost unchanged. Public
          // data may be read without claiming ownership; names are always realm-scoped.
          const realm = typeof body?.character?.realm === "string" ? body.character.realm.trim().slice(0, 100) : "";
          const publicScore = body?.includeScore === true && realm && realm !== "-"
            ? publicAddonBoard(await prismaLeaderboardStore(prisma).characterRuns(character, realm), { character, realm },
              publicSeasons(new Date(), await loadOfficialWindows(prisma))) : undefined;
          json(response, 200, { ...result, ...(body?.includeScore === true ? { publicScore: publicScore ?? null } : {}), botVersion: BOT_VERSION });
        } catch (error) {
          if (error instanceof PublicUploadError) { json(response, error.status, { error: error.message }); return; }
          throw error;
        }
        return;
      }
      const payload = isImport || isPoeUpload || isLogout || isManageEdit ? await readBody(request) : null;
      const requestPayload = payload as { guildDiscordId?: unknown; export?: unknown } | null;
      const guildDiscordId = isStandings || isPoeStatus || isPoeRecent || isManageView ? url.searchParams.get("guild") : requestPayload?.guildDiscordId;
      if (typeof guildDiscordId !== "string") { json(response, 400, { error: "guildDiscordId is required" }); return; }
      if (!hostedPilot.allows(guildDiscordId)) { json(response, 403, { error: "This server is on Guilded Lite: companion sync unlocks when the Guilded owner approves it." }); return; }
      const guild = await prisma.guild.findUnique({ where: { discordId: guildDiscordId } });
      if (!guild) { json(response, 404, { error: "Guild is not initialized" }); return; }
      const header = request.headers["x-companion-credential"] ?? request.headers.authorization?.replace(/^Bearer\s+/i, "");
      const access = typeof header === "string" ? await companionAccess(prisma, client, guild.id, guild.discordId, header) : null;
      if (!access) {
        recordFailure(address);
        json(response, 401, { error: "Pair this companion with /character pair. The shared upload token no longer grants access." }); return;
      }
      if (isLogout) {
        await prisma.companionCredential.updateMany({ where: { memberId: access.memberId, tokenHash: hashCompanionSecret(header as string), revokedAt: null }, data: { revokedAt: new Date() } });
        json(response, 200, { ok: true }); return;
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
        json(response, 200, { ok: true, message: result.message, botVersion: BOT_VERSION });
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
          header: { protocolVersion: 2, botVersion: BOT_VERSION, features: COMPANION_FEATURES },
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
      const pairedCharacterStatus = pairedMemberId && preview.snapshot.character
        ? await linkPairedCharacter(prisma, guild.id, pairedMemberId, preview.snapshot.character)
        : pairedMemberId ? "missing-character" : "unpaired";
      // The other characters that logged in on this PC belong to the same player: link them too.
      // A name already owned by someone else is left alone (linkPairedCharacter refuses it).
      if (pairedMemberId) {
        for (const alt of preview.snapshot.alts) {
          if (preview.snapshot.character && alt.name === preview.snapshot.character.name) continue;
          await linkPairedCharacter(prisma, guild.id, pairedMemberId, alt).catch((error: unknown) => console.error("Linking an alt failed", error));
        }
      }
      // Guildmates who pasted their /guilded verify code in game, as this officer's addon heard them.
      if (access.officer) {
        await prisma.guild.update({ where: { id: guild.id }, data: { officerSyncAt: new Date() } }).catch(() => undefined);
        const verified = await linkVerifiedCharacters(prisma, guild.id, access, preview.snapshot.characters)
          .catch((error: unknown) => { console.error("Linking verified characters failed", error); return []; });
        if (verified.length && client) {
          const language = await prisma.guildSettings.findUnique({ where: { guildId: guild.id }, select: { language: true } });
          void tellVerified(client, guild.discordId, asLang(language?.language), verified).catch(() => undefined);
        }
      }
      if (!access.officer) {
        const owned = await prisma.character.findMany({ where: { memberId: pairedMemberId }, select: { name: true, realm: true } });
        preview = await importService.previewSnapshot(guild.id, personalSnapshot(preview.snapshot, owned), createdBy);
      }
      const settings = await prisma.guildSettings.findUnique({ where: { guildId: guild.id } });
      const professionRelay = access.officer && !settings?.autoApplyImports
        ? await relayProfessions(prisma, guild.id, preview.snapshot) : null;
      if (professionRelay) {
        const discordGuild = client ? await client.guilds.fetch(guild.discordId).catch(() => null) : null;
        if (discordGuild && professionRelay.discovered) await autoLinkUnclaimed(discordGuild, prisma, guild.id).catch((error: unknown) => console.warn("Profession character linking failed", error));
        await updateProfessionDirectory(discordGuild);
      }
      if (preview.duplicate) {
        json(response, 409, { error: "This export was already received", checksum: preview.checksum, pairedCharacterStatus, importId: preview.existingImport?.id, status: preview.existingImport?.status, botVersion: BOT_VERSION, protocolVersion: 2 });
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
          await followUpImport(discordGuild, guild.id, result);
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
    } catch (error) {
      if (error instanceof PoeMappingError) { json(response, error.status, { error: error.message }); return; }
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
