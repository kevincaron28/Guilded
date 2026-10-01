import { randomUUID } from "node:crypto";
import type { DiscordJob, Prisma, PrismaClient } from "@prisma/client";
import { EmbedBuilder, type Client, type Guild, type MessageCreateOptions } from "discord.js";
import { prisma } from "../database.js";

type Db = Pick<PrismaClient, "discordJob">;
export type JobKind = "DUNGEON_BOARD" | "PROFESSIONS" | "RAID_POST" | "CALENDAR" | "MESSAGE";
export async function enqueueDiscordJob(database: Db, guildId: string, key: string, kind: JobKind, payload: Prisma.InputJsonValue = {}) {
  return database.discordJob.upsert({ where: { guildId_key: { guildId, key } },
    create: { guildId, key, kind, payload },
    // Never clear an active lease. Its owner notices a newer revision when settling.
    update: { kind, payload, revision: { increment: 1 }, status: "PENDING", attempts: 0, nextAttemptAt: new Date(), lastError: null } });
}

export function retryDelay(attempt: number): number { return Math.min(3_600_000, 30_000 * 2 ** Math.min(Math.max(attempt - 1, 0), 7)); }
const available = (now: Date): Prisma.DiscordJobWhereInput => ({ status: "PENDING", nextAttemptAt: { lte: now }, OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] });

// Atomic lease + revision check protects a refresh enqueued during a slow Discord call.
export async function deliverDiscordJob(database: Db, id: string, send: (job: DiscordJob) => Promise<void>, now = new Date()): Promise<boolean> {
  const token = randomUUID();
  const claim = await database.discordJob.updateMany({ where: { id, ...available(now) }, data: { leaseToken: token, lockedUntil: new Date(now.getTime() + 5 * 60_000), attempts: { increment: 1 } } });
  if (!claim.count) return false;
  const job = await database.discordJob.findUnique({ where: { id } });
  if (!job || job.leaseToken !== token) return false;
  try {
    await send(job);
    await database.discordJob.updateMany({ where: { id, leaseToken: token, revision: job.revision }, data: { status: "DONE", deliveredAt: new Date(), lastError: null } });
  } catch (error) {
    // Do not store request bodies, credentials or arbitrary exception text in the dashboard.
    const code = error && typeof error === "object" && "code" in error ? String(error.code).slice(0, 30) : "delivery-unavailable";
    await database.discordJob.updateMany({ where: { id, leaseToken: token, revision: job.revision }, data: { lastError: code, nextAttemptAt: new Date(Date.now() + retryDelay(job.attempts)) } });
  } finally {
    await database.discordJob.updateMany({ where: { id, leaseToken: token }, data: { leaseToken: null, lockedUntil: null } });
  }
  return true;
}

export async function dispatchDiscordJob(guild: Guild, job: DiscordJob): Promise<void> {
  const payload = job.payload as Record<string, unknown>;
  if (job.kind === "DUNGEON_BOARD") {
    const { updateDungeonLeaderboard } = await import("./dungeon-leaderboard.js");
    if (!await updateDungeonLeaderboard(guild, true)) throw new Error("Board unavailable");
  } else if (job.kind === "PROFESSIONS") {
    const { updateProfessionDirectory } = await import("./profession-directory.js");
    if (!await updateProfessionDirectory(guild, true)) throw new Error("Directory unavailable");
  } else if (job.kind === "RAID_POST") {
    const raidId = String(payload["raidId"] ?? "");
    const raid = await prisma.raid.findFirst({ where: { id: raidId, guildId: job.guildId }, select: { id: true } });
    if (!raid) return; // Deleted raid jobs have nothing left to publish.
    const { syncSignupEmbed } = await import("../commands/raid.js");
    await syncSignupEmbed(guild, job.guildId, raid.id, true);
  } else if (job.kind === "CALENDAR") {
    const { runCalendarPlan } = await import("./calendar-sync.js");
    const plan = payload["plan"] as unknown as import("./calendar-sync.js").CalendarPlan;
    const planned = await prisma.raid.findMany({ where: { guildId: job.guildId, status: "PLANNED", isTest: false, id: { in: plan.matches.map(match => match.raidId) } }, select: { id: true } });
    const eligible = new Set(planned.map(raid => raid.id));
    const summary = await runCalendarPlan(prisma, job.guildId, { ...plan, matches: plan.matches.filter(match => eligible.has(match.raidId)), unmatched: plan.unmatched.map(event => ({ ...event, startsAt: new Date(event.startsAt) })) });
    for (const raidId of summary.changedRaidIds) await enqueueDiscordJob(prisma, job.guildId, `raid:${raidId}`, "RAID_POST", { raidId });
    if (summary.failed) throw new Error("Calendar signup retry required");
  } else if (job.kind === "MESSAGE") {
    let channelId = String(payload["channelId"]);
    const route = payload["route"];
    if (route === "dungeon") {
      const settings = await prisma.guildSettings.findUnique({ where: { guildId: job.guildId }, select: { dungeonChannelId: true, notifyChannelId: true } });
      const current = settings?.dungeonChannelId ?? settings?.notifyChannelId;
      if (!current) throw new Error("Configure dungeon announcements first");
      channelId = current;
    } else if (route === "wowWeekly") {
      const settings = await prisma.guildSettings.findUnique({ where: { guildId: job.guildId }, select: { weeklyReportChannelId: true, notifyChannelId: true } });
      const current = settings?.weeklyReportChannelId ?? settings?.notifyChannelId;
      if (!current) throw new Error("Configure WoW weekly reports first");
      channelId = current;
    } else if (route !== undefined) {
      if (!["notify", "raidLog", "loot", "officer", "application"].includes(String(route))) throw new Error("Unknown notification route");
      const { resolveNotifyAddress } = await import("./notify.js");
      const address = await resolveNotifyAddress(guild, route as "notify" | "raidLog" | "loot" | "officer" | "application", typeof payload["coreId"] === "string" ? payload["coreId"] : null);
      if (!address) throw new Error("Configure the notification channel first");
      if (address.guildId !== job.guildId) return; // A reset retired this guild identity.
      channelId = address.channelId;
    }
    const channel = await guild.channels.fetch(channelId);
    if (!channel?.isTextBased()) throw new Error("Channel unavailable");
    // Discord only retains nonce deduplication briefly. A visible footer is also checked
    // after a crash so a delayed retry can reuse the already posted announcement.
    const marker = `Guilded delivery ${job.id}`;
    const recent = await channel.messages.fetch({ limit: 100 });
    if (recent.some(message => message.author.id === guild.client.user?.id && message.embeds.some(embed => embed.footer?.text.includes(marker)))) return;
    const message = payload["message"] as MessageCreateOptions;
    const embeds = (message.embeds ?? []).map(embed => new EmbedBuilder("toJSON" in embed ? embed.toJSON() : embed));
    if (!embeds.length) embeds.push(new EmbedBuilder().setDescription(message.content || "Guilded update"));
    const last = embeds[embeds.length - 1]!;
    const footer = last.data.footer?.text;
    last.setFooter({ text: footer ? `${footer.slice(0, 1900)} · ${marker}` : marker });
    await channel.send({ ...message, embeds, allowedMentions: { parse: [] }, nonce: job.id.slice(-25), enforceNonce: true });
  } else throw new Error("Unknown job type");
}

let running = false;
export async function runDiscordJobs(client: Client): Promise<void> {
  if (running) return;
  running = true;
  try {
    const now = new Date();
    const jobs = await prisma.discordJob.findMany({ where: available(now), orderBy: { nextAttemptAt: "asc" }, take: 25, include: { guild: { select: { discordId: true } } } });
    for (const job of jobs) await deliverDiscordJob(prisma, job.id, async current => {
      const guild = await client.guilds.fetch(job.guild.discordId);
      await dispatchDiscordJob(guild, current);
    });
    await prisma.discordJob.deleteMany({ where: { status: "DONE", deliveredAt: { lt: new Date(Date.now() - 30 * 86_400_000) } } });
  } finally { running = false; }
}
