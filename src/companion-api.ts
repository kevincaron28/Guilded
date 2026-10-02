import { relayProfessions } from "./services/profession-relay.js";
import { autoLinkUnclaimed } from "./services/character-autolink.js";
import { updateProfessionDirectory } from "./services/profession-directory.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { config } from "./config.js";
import { prisma } from "./database.js";
import { createAddonImportService } from "./services/addon-import.js";
import { createEpgpService } from "./services/epgp.js";
import { addonDungeonBoard } from "./services/dungeon-stats.js";
import { nextRaidRoster } from "./services/raid-roster.js";
import { itemInsights } from "./services/item-insights.js";
import { lootRulesForAddon } from "./services/loot-rules-export.js";
import { upcomingRaidsForAddon } from "./services/calendar-sync.js";
import { discordCalendarEvents, mergeCalendarEvents } from "./services/discord-calendar.js";
import { createAuditService } from "./services/audit.js";
import { followUpImport } from "./services/import-followup.js";
import { exchangeCharacterPairingCode, hashCompanionSecret, linkPairedCharacter } from "./services/character-pairing.js";
import { serveCompanionWeb } from "./services/companion-web.js";
import type { Client } from "discord.js";
import { companionAccess, personalSnapshot } from "./services/companion-access.js";
import { readFileSync } from "node:fs";
import { ZodError } from "zod";
import type { PrismaClient } from "@prisma/client";
import { createPoeMappingService, poeAreaName, PoeMappingError } from "./services/poe-mapping.js";
import { notify } from "./services/notify.js";
import { allowManageWrite, createCompanionManage, ManageError } from "./services/companion-manage.js";
import { syncCoreRoster } from "./services/raid-core.js";
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

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += Buffer.byteLength(chunk);
    chunks.push(Buffer.from(chunk));
    if (size > 1_000_000) throw new Error("Request body is too large.");
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const auditService = createAuditService(prisma);
const manage = createCompanionManage(prisma);

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

// `client` lets an upload be applied and announced by the bot itself (auto-apply).
export function startCompanionApi(client?: Client): ReturnType<typeof createServer> {
  const server = createServer(async (request, response) => {
    try {
      response.setHeader("cache-control", "no-store");
      response.setHeader("x-content-type-options", "nosniff");
      if (request.method === "GET" && request.url === "/health") {
        json(response, client?.isReady() ? 200 : 503, { ok: client?.isReady() ?? false, botVersion: BOT_VERSION, protocolVersion: 2 });
        return;
      }
      const url = new URL(request.url ?? "/", "http://localhost");
      if (await serveCompanionWeb(request, response, url.pathname)) return;
      const isImport = request.method === "POST" && url.pathname === "/api/v1/addon-imports";
      const isPairing = request.method === "POST" && url.pathname === "/api/v1/addon-pairings";
      const isStandings = request.method === "GET" && url.pathname === "/api/v1/standings";
      const isPoeUpload = request.method === "POST" && url.pathname === "/api/v1/poe/visits";
      const isPoeStatus = request.method === "GET" && url.pathname === "/api/v1/poe/status";
      const isPoeRecent = request.method === "GET" && url.pathname === "/api/v1/poe/visits";
      const isLogout = request.method === "POST" && url.pathname === "/api/v1/companion/logout";
      // The companion's own pages: wishlists for members; prices, core rules and rosters for Raid Leaders.
      const isManageView = request.method === "GET" && url.pathname === "/api/v1/manage";
      const isManageEdit = request.method === "POST" && url.pathname === "/api/v1/manage";
      if (!isImport && !isPairing && !isStandings && !isPoeUpload && !isPoeStatus && !isPoeRecent && !isLogout && !isManageView && !isManageEdit) {
        json(response, 404, { error: "Not found" });
        return;
      }
      const address = clientAddress(request);
      if (isLockedOut(address)) {
        json(response, 429, { error: "Too many failed attempts. Try again in a few minutes." });
        return;
      }
      if (isPairing) {
        const payload = await readBody(request);
        if (!payload || typeof payload !== "object" || !("guildDiscordId" in payload) || !("code" in payload)) {
          json(response, 400, { error: "guildDiscordId and code are required" });
          return;
        }
        const pairingPayload = payload as { guildDiscordId: unknown; code: unknown };
        if (typeof pairingPayload.guildDiscordId !== "string" || typeof pairingPayload.code !== "string") {
          json(response, 400, { error: "guildDiscordId and code must be strings" });
          return;
        }
        const guild = await prisma.guild.findUnique({ where: { discordId: pairingPayload.guildDiscordId }, select: { id: true } });
        if (!guild) {
          json(response, 404, { error: "Guild is not initialized" });
          return;
        }
        let result;
        try { result = await exchangeCharacterPairingCode(prisma, pairingPayload.guildDiscordId, pairingPayload.code); }
        catch (error) {
          if (!(error instanceof Error) || !error.message.startsWith("Pairing code is invalid")) throw error;
          recordFailure(address); json(response, 401, { error: "Pairing code is invalid, expired, or already used. Run /character pair again." }); return;
        }
        json(response, 200, result);
        return;
      }
      const payload = isImport || isPoeUpload || isLogout || isManageEdit ? await readBody(request) : null;
      const requestPayload = payload as { guildDiscordId?: unknown; export?: unknown } | null;
      const guildDiscordId = isStandings || isPoeStatus || isPoeRecent || isManageView ? url.searchParams.get("guild") : requestPayload?.guildDiscordId;
      if (typeof guildDiscordId !== "string") { json(response, 400, { error: "guildDiscordId is required" }); return; }
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
        const scheduledEvents = await discordCalendarEvents(client, guild.discordId, access.actorId).catch(() => {
          console.warn("Discord calendar events could not be fetched; exporting bot raids only.");
          return [];
        });
        // Read-only EP/GP/PR per linked character. The companion writes it
        // into the addon folder so /guilded standings shows the bot's numbers.
        const data = await prisma.$transaction(async (transaction) => {
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
        const raids = mergeCalendarEvents(await upcomingRaidsForAddon(database, guild.id), scheduledEvents);
        const accounts = Object.fromEntries((await database.character.findMany({ where: { member: { guildId: guild.id } }, select: { name: true, memberId: true } })).map((c) => [c.name, c.memberId]));
        const acceptedLedgerRefs = await ledgerRefsFor(database, guild.id, access.memberId);
        return { protocolVersion: 2, botVersion: BOT_VERSION, updatedAt: new Date().toISOString(), accounts, acceptedLedgerRefs, baseGp, acceptedRunRefs, dungeonBoard, nextRaid, raids, items, loot: loot ? { ...loot, cores: loot.cores.map((core) => ({ ...core, accounts })) } : null, standings: await epgp.getGuildStandings(guild.id, baseGp) };
        }, { isolationLevel: "RepeatableRead", timeout: 60_000, maxWait: 15_000 });
        json(response, 200, data);
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
      if (!access.officer) {
        const owned = await prisma.character.findMany({ where: { memberId: pairedMemberId }, select: { name: true, realm: true } });
        preview = await importService.preview(guild.id, personalSnapshot(preview.snapshot, owned), createdBy);
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
      // Auto-apply (a guild opt-in: /setup config auto-import): apply now and follow up, no /import apply.
      let autoApplied: { epgp: number; discovered: number; held: number; voided: number; rejected: number } | null = null;
      let applyError: string | null = null;
      if (!access.officer || settings?.autoApplyImports) {
        let applied = false;
        try {
          const result = await importService.apply(guild.id, record.id, createdBy);
          applied = true;
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
      console.error("Companion API request failed", error);
      json(response, error instanceof ZodError || error instanceof SyntaxError ? 400 : 503, { error: "Request could not be processed. Check the export or ask an officer to inspect the server log." });
    }
  });
  server.listen(config.COMPANION_API_PORT, config.COMPANION_API_HOST, () => {
    console.info(`Companion API listening on http://${config.COMPANION_API_HOST}:${config.COMPANION_API_PORT}`);
  });
  return server;
}
