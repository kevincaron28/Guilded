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
import { exchangeCharacterPairingCode, linkPairedCharacter } from "./services/character-pairing.js";
import type { Client } from "discord.js";
import { companionAccess, personalSnapshot } from "./services/companion-access.js";
import { readFileSync } from "node:fs";
import { ZodError } from "zod";
import type { PrismaClient } from "@prisma/client";
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

// `client` lets an upload be applied and announced by the bot itself (auto-apply).
export function startCompanionApi(client?: Client): ReturnType<typeof createServer> {
  const server = createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/health") {
        json(response, client?.isReady() ? 200 : 503, { ok: client?.isReady() ?? false, botVersion: BOT_VERSION, protocolVersion: 2 });
        return;
      }
      const url = new URL(request.url ?? "/", "http://localhost");
      const isImport = request.method === "POST" && url.pathname === "/api/v1/addon-imports";
      const isPairing = request.method === "POST" && url.pathname === "/api/v1/addon-pairings";
      const isStandings = request.method === "GET" && url.pathname === "/api/v1/standings";
      if (!isImport && !isPairing && !isStandings) {
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
      const payload = isImport ? await readBody(request) : null;
      const requestPayload = payload as { guildDiscordId?: unknown; export?: unknown } | null;
      const guildDiscordId = isStandings ? url.searchParams.get("guild") : requestPayload?.guildDiscordId;
      if (typeof guildDiscordId !== "string") { json(response, 400, { error: "guildDiscordId is required" }); return; }
      const guild = await prisma.guild.findUnique({ where: { discordId: guildDiscordId } });
      if (!guild) { json(response, 404, { error: "Guild is not initialized" }); return; }
      const header = request.headers["x-companion-credential"] ?? request.headers.authorization?.replace(/^Bearer\s+/i, "");
      const access = typeof header === "string" ? await companionAccess(prisma, client, guild.id, guild.discordId, header) : null;
      if (!access) {
        recordFailure(address);
        json(response, 401, { error: "Pair this companion with /character pair. The shared upload token no longer grants access." }); return;
      }
      if (isStandings) {
        const scheduledEvents = await discordCalendarEvents(client, guild.discordId).catch(() => {
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
        const acceptedLedgerRefs = (await database.epgpTransaction.findMany({ where: { guildId: guild.id, sourceRef: { startsWith: "addon:" } }, select: { sourceRef: true } })).map((row) => row.sourceRef);
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
      if (preview.duplicate) {
        json(response, 409, { error: "This export was already received", checksum: preview.checksum, pairedCharacterStatus, importId: preview.existingImport?.id, status: preview.existingImport?.status, botVersion: BOT_VERSION, protocolVersion: 2 });
        return;
      }
      const record = await importService.record(guild.id, preview.snapshot, preview.checksum, createdBy, pairedMemberId);
      // Auto-apply (a guild opt-in: /setup config auto-import): apply now and follow up, no /import apply.
      const settings = await prisma.guildSettings.findUnique({ where: { guildId: guild.id } });
      let autoApplied: { epgp: number; discovered: number } | null = null;
      if (!access.officer || settings?.autoApplyImports) {
        try {
          const result = await importService.apply(guild.id, record.id, createdBy);
          autoApplied = { epgp: result.epgpTransactions.length, discovered: result.discovery.discovered };
          await auditService.record({
            guildId: guild.id, actorId: createdBy, action: "IMPORT_APPLIED", entityId: record.id,
            metadata: { auto: true, epgpTransactionCount: result.epgpTransactions.length, readinessSnapshotCount: result.readinessSnapshots.length, discovered: result.discovery.discovered }
          });
          const discordGuild = client ? await client.guilds.fetch(guild.discordId).catch(() => null) : null;
          await followUpImport(discordGuild, guild.id, result);
          autoApplied = { epgp: result.epgpTransactions.length, discovered: result.discovery.discovered };
        } catch (error) {
          // Application and notification are distinct: a committed import stays APPLIED even if follow-up fails.
          console.error("Auto-apply of an addon import failed", error);
        }
      }
      json(response, 201, {
        autoApplied,
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
      console.error("Companion API request failed", error);
      json(response, error instanceof ZodError || error instanceof SyntaxError ? 400 : 503, { error: "Request could not be processed. Check the export or ask an officer to inspect the server log." });
    }
  });
  server.listen(config.COMPANION_API_PORT, config.COMPANION_API_HOST, () => {
    console.info(`Companion API listening on http://${config.COMPANION_API_HOST}:${config.COMPANION_API_PORT}`);
  });
  return server;
}
