import { timingSafeEqual } from "node:crypto";
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
import { createAuditService } from "./services/audit.js";
import { followUpImport } from "./services/import-followup.js";
import { exchangeCharacterPairingCode, hashCompanionSecret, linkPairedCharacter } from "./services/character-pairing.js";
import type { Client } from "discord.js";

const importService = createAddonImportService(prisma);
const epgpService = createEpgpService(prisma);

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

function authorized(request: IncomingMessage): boolean {
  if (!config.COMPANION_UPLOAD_TOKEN) return false;
  const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
  const expected = Buffer.from(config.COMPANION_UPLOAD_TOKEN);
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  let body = "";
  for await (const chunk of request) {
    body += chunk.toString();
    if (body.length > 1_000_000) throw new Error("Request body is too large.");
  }
  return JSON.parse(body);
}

const auditService = createAuditService(prisma);

// `client` lets an upload be applied and announced by the bot itself (auto-apply).
export function startCompanionApi(client?: Client): ReturnType<typeof createServer> {
  const server = createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/health") {
        json(response, 200, { ok: true });
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
      if (!authorized(request)) {
        recordFailure(address);
        json(response, 401, { error: "Unauthorized" });
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
        const result = await exchangeCharacterPairingCode(prisma, pairingPayload.guildDiscordId, pairingPayload.code);
        json(response, 200, result);
        return;
      }
      if (isStandings) {
        // Read-only EP/GP/PR per linked character. The companion writes it
        // into the addon folder so /guilded standings shows the bot's numbers.
        const guild = await prisma.guild.findUnique({ where: { discordId: url.searchParams.get("guild") ?? "" } });
        if (!guild) {
          json(response, 404, { error: "Guild is not initialized" });
          return;
        }
        const baseGp = (await prisma.guildSettings.findUnique({ where: { guildId: guild.id } }))?.baseGp ?? 0;
        // Dungeon runs the bot has stored lately, so the addon can mark them
        // as synced (roadmap D3).
        const acceptedRunRefs = (await prisma.dungeonRun.findMany({
          where: { guildId: guild.id, createdAt: { gte: new Date(Date.now() - 45 * 86_400_000) } },
          select: { runRef: true },
          orderBy: { createdAt: "desc" },
          take: 500
        })).map((row) => row.runRef);
        const dungeonBoard = await addonDungeonBoard(prisma, guild.id);
        const nextRaid = await nextRaidRoster(prisma, guild.id);
        const items = await itemInsights(prisma, guild.id).catch(() => []);
        // How each raid core decides loot, with its item prices and own-pool standings.
        const loot = await lootRulesForAddon(prisma, guild.id, async (coreId, coreBaseGp) =>
          (await epgpService.getGuildStandings(guild.id, coreBaseGp, coreId)).map((row) => ({ character: row.character, main: row.main, ep: row.ep, gp: row.gp }))).catch(() => null);
        const raids = await upcomingRaidsForAddon(prisma, guild.id).catch(() => []);
        json(response, 200, { updatedAt: new Date().toISOString(), baseGp, acceptedRunRefs, dungeonBoard, nextRaid, raids, items, loot, standings: await epgpService.getGuildStandings(guild.id, baseGp) });
        return;
      }
      const payload = await readBody(request);
      if (!payload || typeof payload !== "object" || !("guildDiscordId" in payload) || !("export" in payload)) {
        json(response, 400, { error: "guildDiscordId and export are required" });
        return;
      }
      const requestPayload = payload as { guildDiscordId: unknown; export: unknown; createdBy?: unknown };
      if (typeof requestPayload.guildDiscordId !== "string") {
        json(response, 400, { error: "guildDiscordId must be a string" });
        return;
      }
      const guild = await prisma.guild.findUnique({ where: { discordId: requestPayload.guildDiscordId } });
      if (!guild) {
        json(response, 404, { error: "Guild is not initialized" });
        return;
      }
      const suppliedCredential = request.headers["x-companion-credential"];
      let pairedMemberId: string | undefined;
      if (suppliedCredential !== undefined) {
        if (typeof suppliedCredential !== "string" || suppliedCredential.length > 256) {
          json(response, 401, { error: "Invalid companion credential" });
          return;
        }
        const credential = await prisma.companionCredential.findFirst({
          where: { tokenHash: hashCompanionSecret(suppliedCredential), revokedAt: null, member: { guildId: guild.id } },
          select: { memberId: true }
        });
        if (!credential) {
          json(response, 401, { error: "Invalid companion credential" });
          return;
        }
        pairedMemberId = credential.memberId;
      }
      const createdBy = typeof requestPayload.createdBy === "string" ? requestPayload.createdBy : "companion-app";
      const preview = await importService.preview(guild.id, requestPayload.export, createdBy);
      const pairedCharacterStatus = pairedMemberId && preview.snapshot.character
        ? await linkPairedCharacter(prisma, guild.id, pairedMemberId, preview.snapshot.character)
        : pairedMemberId ? "missing-character" : "unpaired";
      if (preview.duplicate) {
        json(response, 409, { error: "This export was already received", checksum: preview.checksum, pairedCharacterStatus });
        return;
      }
      const record = await importService.record(guild.id, preview.snapshot, preview.checksum, createdBy, pairedMemberId);
      // Auto-apply (a guild opt-in: /setup config auto-import): apply now and follow up, no /import apply.
      const settings = await prisma.guildSettings.findUnique({ where: { guildId: guild.id } });
      let autoApplied: { epgp: number; discovered: number } | null = null;
      if (settings?.autoApplyImports) {
        try {
          const result = await importService.apply(guild.id, record.id, "companion-auto");
          await auditService.record({
            guildId: guild.id, actorId: "companion-auto", action: "IMPORT_APPLIED", entityId: record.id,
            metadata: { auto: true, epgpTransactionCount: result.epgpTransactions.length, readinessSnapshotCount: result.readinessSnapshots.length, discovered: result.discovery.discovered }
          });
          const discordGuild = client ? await client.guilds.fetch(guild.discordId).catch(() => null) : null;
          await followUpImport(discordGuild, guild.id, result);
          autoApplied = { epgp: result.epgpTransactions.length, discovered: result.discovery.discovered };
        } catch (error) {
          // Left as a normal pending import: an officer can still /import apply it.
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
        status: record.status
      });
    } catch (error) {
      console.error("Companion API request failed", error);
      json(response, 400, { error: error instanceof Error ? error.message : "Invalid request" });
    }
  });
  server.listen(config.COMPANION_API_PORT, config.COMPANION_API_HOST, () => {
    console.info(`Companion API listening on http://${config.COMPANION_API_HOST}:${config.COMPANION_API_PORT}`);
  });
  return server;
}
