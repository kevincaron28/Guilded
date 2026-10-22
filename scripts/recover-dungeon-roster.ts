// Repairs one run rejected by the obsolete five-name participant-history rule.
// Read-only unless --apply is explicitly supplied. Never starts a Discord client.
import { prisma } from "../src/database.js";
import { Prisma } from "../src/generated/prisma/client.js";
import { dungeonRunSchema, validateRun } from "../src/services/dungeon-rules.js";
import { importDungeonRuns } from "../src/services/dungeon-import.js";
import { dungeonAnnouncement } from "../src/services/dungeon-announce.js";
import { enqueueDiscordJob } from "../src/services/discord-jobs.js";
import { asLang } from "../src/i18n.js";

const [guildId, runRef, mode] = process.argv.slice(2);
if (!guildId || !runRef || (mode && mode !== "--apply")) throw new Error("Usage: tsx scripts/recover-dungeon-roster.ts <guildId> <runRef> [--apply]");
try {
  const result = await prisma.$transaction(async (tx) => {
    if (mode === "--apply") await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${guildId}, 0))`;
    const stored = await tx.dungeonRun.findUniqueOrThrow({ where: { guildId_runRef: { guildId, runRef } }, include: { players: true, _count: { select: { points: true, achievements: true } } } });
    if (stored.valid) return { status: "already valid; no changes", runRef };
    if (stored.state !== "COMPLETED" || stored.players.length <= 5 || stored.players.length > 40
      || stored.invalidReason !== `${stored.players.length} players (dungeons are 1-5)`
      || stored._count.points || stored._count.achievements || !stored.importId) throw new Error("Run is not eligible for this narrow repair");
    const original = await tx.addonImport.findFirstOrThrow({ where: { id: stored.importId, guildId } });
    const payload = original.payload as { dungeonRuns?: unknown[] };
    const raw = payload.dungeonRuns?.find((entry) => entry && typeof entry === "object" && "id" in entry && entry.id === runRef);
    const run = dungeonRunSchema.parse(raw);
    if (!validateRun(run).ok || run.instanceId !== stored.instanceId || run.startedAt !== Math.floor(stored.startedAt!.getTime() / 1000)
      || run.endedAt !== Math.floor(stored.endedAt!.getTime() / 1000)
      || run.players.length !== stored.players.length
      || run.players.some((player) => !stored.players.some((saved) => saved.character === player.character))) throw new Error("Original import does not match the stored run");
    const season = await tx.dungeonSeason.findFirst({ where: { guildId, status: "ACTIVE" }, orderBy: { startsAt: "desc" } });
    if (!season || season.id !== stored.seasonId) throw new Error("Repair requires the original active season");
    // Do not recalculate historical records against later clears. Handle those separately.
    if (await tx.dungeonRun.count({ where: { guildId, instanceId: stored.instanceId, valid: true, state: "COMPLETED", endedAt: { gt: stored.endedAt! } } })) throw new Error("Later completed runs need a historical reconciliation first");
    const settings = await tx.guildSettings.findUniqueOrThrow({ where: { guildId } });
    const channelId = settings.dungeonChannelId ?? settings.notifyChannelId;
    if (!channelId) throw new Error("No dungeon announcement channel configured");
    if (mode !== "--apply") return { status: "eligible; read-only preview", runRef, durationSec: stored.durationSec, participants: run.players.map(p => p.character), channelId };
    const characters = await tx.character.findMany({ where: { member: { guildId } }, select: { name: true, realm: true, memberId: true } });
    // Reuse the ordinary award rules while preserving this exact run and player rows.
    // Exclude only this rejected row from the importer's duplicate checks.
    const dungeonRun = new Proxy(tx.dungeonRun, { get(target, key) {
      if (key === "findUnique") return async (args: Prisma.DungeonRunFindUniqueArgs) => args.where.guildId_runRef?.runRef === runRef ? null : target.findUnique(args);
      if (key === "findMany") return (args: Prisma.DungeonRunFindManyArgs) => target.findMany({ ...args, where: { AND: [args.where ?? {}, { id: { not: stored.id } }] } });
      if (key === "create") return (args: Prisma.DungeonRunCreateArgs) => {
        if (args.data.runRef !== runRef) throw new Error("Unexpected run creation");
        return target.update({ where: { id: stored.id }, data: { valid: true, invalidReason: null } });
      };
      return Reflect.get(target, key);
    } });
    const summary = await importDungeonRuns({ dungeonRun, guildSettings: tx.guildSettings, dungeonSeason: tx.dungeonSeason,
      dungeonPointTransaction: tx.dungeonPointTransaction, dungeonAchievement: tx.dungeonAchievement }, guildId, [run], characters, "repair:dungeon-roster", stored.importId);
    if (summary.results.length !== 1 || !summary.results[0]?.valid) throw new Error("Repair did not produce one valid run");
    const embed = dungeonAnnouncement(summary, asLang(settings.language));
    if (!embed) throw new Error("Repair produced no announcement");
    await enqueueDiscordJob(tx, guildId, `dungeon-roster-repair:${stored.id}`, "MESSAGE", {
      channelId, route: "dungeon", coreId: null, message: { embeds: [JSON.parse(JSON.stringify(embed.toJSON()))], allowedMentions: { parse: [] } }
    });
    await enqueueDiscordJob(tx, guildId, "dungeon-board", "DUNGEON_BOARD");
    return { status: "repaired and announcement queued", runRef, summary };
  }, { timeout: 30_000 });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Prisma.PrismaClientKnownRequestError ? `Database error ${error.code}` : error instanceof Error ? error.message : "Repair failed");
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }
