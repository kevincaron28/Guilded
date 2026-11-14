import { createHash } from "node:crypto";
import { z } from "zod";
import { Routes, type APIGuildScheduledEvent, type Client, type GuildMember } from "discord.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { hostedPilot } from "../hosted-pilot.js";
import { hashCompanionSecret } from "./character-pairing.js";
import { loadGuildScope } from "./guild-scope.js";
import { config } from "../config.js";
import { mergeCalendarEvents } from "./discord-calendar.js";

const enrollment = z.object({ enabled: z.boolean(), expoPushToken: z.string().regex(/^(?:ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,200}\]$/).optional(), locale: z.enum(["en", "fr"]).default("en") })
  .refine(input => !input.enabled || !!input.expoPushToken, { message: "A push token is required to enable mobile alerts." });
type RaidState = { title: string; at: string; revision: string };
type Snapshot = Record<string, RaidState>;
type Alert = { raidId: string; kind: "reminder" | "changed" | "cancelled"; state: RaidState };
type RaidRow = { id: string; title: string; scheduledAt: Date; updatedAt: Date };
export const raidSnapshot = (raids: RaidRow[]): Snapshot => Object.fromEntries(raids.map(r => [r.id, { title: r.title, at: r.scheduledAt.toISOString(), revision: r.updatedAt.toISOString() }]));
export function mobileRaidChanges(previous: Snapshot, current: Snapshot, now: Date): Alert[] {
  const result: Alert[] = [];
  for (const [id, old] of Object.entries(previous)) {
    const next = current[id];
    if (!next && Date.parse(old.at) > now.getTime()) result.push({ raidId: id, kind: "cancelled", state: old });
    else if (next && (next.at !== old.at || next.title !== old.title)) result.push({ raidId: id, kind: "changed", state: next });
  }
  for (const [id, state] of Object.entries(current)) {
    const left = Date.parse(state.at) - now.getTime();
    if (left > 0 && left <= 3_600_000) result.push({ raidId: id, kind: "reminder", state });
  }
  return result;
}
export async function configureMobileDevice(database: PrismaClient, secret: string, payload: unknown) {
  const input = enrollment.parse(payload);
  const credential = await database.companionCredential.findUniqueOrThrow({ where: { tokenHash: hashCompanionSecret(secret) }, include: { member: true } });
  return database.$transaction(async tx => {
    // An OS token can belong to only one active account on a phone. Switching
    // accounts retires its prior enrollment rather than sending both guilds.
    if (input.expoPushToken) await tx.mobileDevice.updateMany({ where: { expoPushToken: input.expoPushToken, credentialId: { not: credential.id } }, data: { enabled: false, expoPushToken: null, snapshot: {}, generation: { increment: 1 } } });
    const previous = await tx.mobileDevice.findUnique({ where: { credentialId: credential.id } });
    const initial = input.enabled && (!previous?.enabled || previous.expoPushToken !== input.expoPushToken);
    const snapshot = initial ? raidSnapshot(await tx.raid.findMany({ where: { guildId: credential.member.guildId, status: "PLANNED", isTest: false, scheduledAt: { gt: new Date() } } })) : undefined;
    const data = { enabled: input.enabled, expoPushToken: input.enabled ? input.expoPushToken! : null, locale: input.locale, ...(!input.enabled ? { snapshot: {} } : snapshot ? { snapshot } : {}) };
    const device = await tx.mobileDevice.upsert({ where: { credentialId: credential.id }, create: { credentialId: credential.id, ...data }, update: data });
    if (!input.enabled || initial) {
      await tx.mobileDelivery.updateMany({ where: { deviceId: device.id, status: { in: ["PENDING", "ACCEPTED"] } }, data: { status: "DROPPED", payload: {}, tokenHash: null, receiptId: null, receiptCheckAt: null } });
      return tx.mobileDevice.update({ where: { id: device.id }, data: { generation: { increment: 1 } } });
    }
    return device;
  });
}

async function liveMember(database: PrismaClient, client: Client, guildId: string, discordId: string, userId: string): Promise<GuildMember | null> {
  if (!hostedPilot.allows(discordId)) return null;
  const scope = await loadGuildScope(database, guildId, discordId);
  const guild = await client.guilds.fetch(discordId);
  let member;
  try { member = await guild.members.fetch({ user: userId, force: true }); }
  catch (error) { if (error && typeof error === "object" && "code" in error && error.code === 10007) return null; throw error; }
  if (scope.memberRoleId && !member.permissions.has("Administrator") && !member.roles.cache.has(scope.memberRoleId)) return null;
  return member;
}
async function canSeeRaid(member: GuildMember, channelId: string | null): Promise<boolean> {
  if (!channelId) return true;
  const channel = await member.guild.channels.fetch(channelId);
  return !!channel?.permissionsFor(member)?.has("ViewChannel");
}

// Durable per-device outbox. Run from the bot scheduler, independently of Discord
// reminder settings. Enrollment is the only switch that enables phone delivery.
export async function runMobileAlerts(database: PrismaClient, client: Client, now = new Date(), send: typeof fetch = fetch) {
  await database.mobileDelivery.updateMany({ where: { status: { in: ["PENDING", "ACCEPTED"] }, expiresAt: { lte: now } }, data: { status: "EXPIRED", payload: {}, tokenHash: null, receiptId: null, receiptCheckAt: null } });
  await database.mobileDelivery.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 30 * 86_400_000) } } });
  await pollMobileReceipts(database, now, send);
  const started = Date.now();
  const devices = await database.mobileDevice.findMany({ where: { enabled: true, expoPushToken: { not: null }, credential: { revokedAt: null, member: { status: "ACTIVE" } } }, take: 100, orderBy: { checkedAt: "asc" }, include: { credential: { include: { member: { include: { guild: true } } } } } });
  const eventCache = new Map<string, Promise<APIGuildScheduledEvent[]>>();
  const raidCache = new Map<string, Promise<Awaited<ReturnType<typeof database.raid.findMany>>>>();
  for (const device of devices) {
    if (Date.now() - started > 20_000) break;
    try {
      const { member: owner } = device.credential;
      const member = await liveMember(database, client, owner.guildId, owner.guild.discordId, owner.discordUserId);
      if (!member) continue;
      if (!raidCache.has(owner.guildId)) raidCache.set(owner.guildId, database.raid.findMany({ where: { guildId: owner.guildId, status: "PLANNED", isTest: false, scheduledAt: { gte: now, lte: new Date(now.getTime() + 21 * 86_400_000) } }, orderBy: { scheduledAt: "asc" }, take: 50 }));
      const raids = await raidCache.get(owner.guildId)!;
      const visible = [];
      for (const raid of raids) if (await canSeeRaid(member, raid.signupChannelId)) visible.push(raid);
      if (!eventCache.has(owner.guild.discordId)) eventCache.set(owner.guild.discordId, client.rest.get(Routes.guildScheduledEvents(owner.guild.discordId)) as Promise<APIGuildScheduledEvent[]>);
      const events = [];
      for (const event of await eventCache.get(owner.guild.discordId)!) if (event.guild_id === owner.guild.discordId && await canSeeRaid(member, event.channel_id)) events.push(event);
      const merged = mergeCalendarEvents(visible.map(r => ({ id: r.id, title: r.title.slice(0, 30), at: r.scheduledAt.toISOString(), core: null, note: "" })), events, now);
      const snapshot = Object.fromEntries(merged.map(r => [r.id, { title: r.title, at: r.at, revision: createHash("sha256").update(`${r.title}:${r.at}`).digest("hex") }]));
      // Losing channel access is not a cancellation and must not expose its title.
      const previous = device.snapshot as Snapshot;
      const changes = mobileRaidChanges(previous, snapshot, now);
      await database.$transaction(async tx => {
        for (const alert of changes) {
          const identity = alert.kind === "reminder" ? { raidId: alert.raidId, kind: alert.kind, at: alert.state.at } : alert;
          const key = createHash("sha256").update(JSON.stringify([device.generation, identity])).digest("hex");
          await tx.mobileDelivery.upsert({ where: { deviceId_eventKey: { deviceId: device.id, eventKey: key } }, create: { deviceId: device.id, eventKey: key, generation: device.generation, expiresAt: alert.kind === "reminder" ? new Date(alert.state.at) : new Date(now.getTime() + 86_400_000), payload: alert as unknown as Prisma.InputJsonValue }, update: {} });
        }
        await tx.mobileDevice.updateMany({ where: { id: device.id, generation: device.generation, enabled: true }, data: { snapshot } });
      });
    } catch { /* Keep the previous snapshot and retry membership/API failures next tick. */ }
    finally { await database.mobileDevice.updateMany({ where: { id: device.id }, data: { checkedAt: now } }); }
  }
  const pending = await database.mobileDelivery.findMany({ where: { status: "PENDING", nextAttemptAt: { lte: now }, OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] }, take: 100, orderBy: { nextAttemptAt: "asc" } });
  for (const delivery of pending) {
    if (Date.now() - started > 40_000) break;
    const claim = await database.mobileDelivery.updateMany({ where: { id: delivery.id, status: "PENDING", OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] }, data: { lockedUntil: new Date(now.getTime() + 120_000), attempts: { increment: 1 } } });
    if (!claim.count) continue;
    try {
      const device = await database.mobileDevice.findUnique({ where: { id: delivery.deviceId }, include: { credential: { include: { member: { include: { guild: true } } } } } });
      const alert = delivery.payload as unknown as Alert;
      if (!device?.enabled || !device.expoPushToken || device.generation !== delivery.generation || device.credential.revokedAt || device.credential.member.status !== "ACTIVE") { await drop(database, delivery.id); continue; }
      const owner = device.credential.member;
      const member = await liveMember(database, client, owner.guildId, owner.guild.discordId, owner.discordUserId);
      if (!member) { await drop(database, delivery.id); continue; }
      const discordEventId = alert.raidId.startsWith("discord:") ? alert.raidId.slice(8) : null;
      const event = discordEventId ? (await client.rest.get(Routes.guildScheduledEvents(owner.guild.discordId)) as APIGuildScheduledEvent[]).find(e => e.id === discordEventId && e.guild_id === owner.guild.discordId) : null;
      const raid = discordEventId ? null : await database.raid.findFirst({ where: { id: alert.raidId, guildId: owner.guildId, isTest: false } });
      if (event && !await canSeeRaid(member, event.channel_id)) { await drop(database, delivery.id); continue; }
      if (raid && !await canSeeRaid(member, raid.signupChannelId)) { await drop(database, delivery.id); continue; }
      const valid = discordEventId
        ? alert.kind === "cancelled" ? !event || event.status === 4 : event?.status === 1 && new Date(event.scheduled_start_time).toISOString() === alert.state.at && event.name.slice(0, 30) === alert.state.title && Date.parse(alert.state.at) > now.getTime()
        : alert.kind === "cancelled" ? !raid || raid.status === "CANCELLED" : raid?.status === "PLANNED" && raid.scheduledAt.toISOString() === alert.state.at && raid.title.slice(0, 30) === alert.state.title && raid.scheduledAt > now;
      if (!valid) { await drop(database, delivery.id); continue; }
      const stillEnabled = await database.mobileDevice.count({ where: { id: device.id, generation: delivery.generation, enabled: true, expoPushToken: device.expoPushToken, credential: { revokedAt: null, member: { status: "ACTIVE" } } } });
      if (!stillEnabled) { await drop(database, delivery.id); continue; }
      const fr = device.locale === "fr";
      const response = await send("https://exp.host/--/api/v2/push/send", { method: "POST", headers: expoHeaders(), signal: AbortSignal.timeout(10_000), body: JSON.stringify({ to: device.expoPushToken, title: alert.state.title, body: alert.kind === "reminder" ? (fr ? "Le raid commence dans moins d’une heure." : "Your raid starts within an hour.") : alert.kind === "cancelled" ? (fr ? "Ce raid est annulé." : "This raid was cancelled.") : (fr ? "Les détails du raid ont changé." : "Raid details changed."), data: { type: "raid", guildDiscordId: owner.guild.discordId, raidId: alert.raidId, kind: alert.kind }, sound: "default", channelId: "raids", ttl: alert.kind === "reminder" ? Math.max(1, Math.floor((Date.parse(alert.state.at) - now.getTime()) / 1000)) : 86_400 }) });
      if (!response.ok) throw new Error("push unavailable");
      const result = await response.json() as { data?: { status?: string; id?: string; details?: { error?: string } } };
      if (result.data?.details?.error === "DeviceNotRegistered") { await retireToken(database, device.id, device.generation, hashCompanionSecret(device.expoPushToken)); await drop(database, delivery.id); continue; }
      if (result.data?.status !== "ok") throw new Error("push rejected");
      if (!result.data.id) throw new Error("push ticket missing");
      await database.mobileDelivery.updateMany({ where: { id: delivery.id, status: "PENDING", generation: delivery.generation }, data: { status: "ACCEPTED", expiresAt: new Date(now.getTime() + 86_400_000), receiptId: result.data.id, receiptCheckAt: new Date(now.getTime() + 15 * 60_000), tokenHash: hashCompanionSecret(device.expoPushToken) } });
    } catch {
      await database.mobileDelivery.update({ where: { id: delivery.id }, data: { nextAttemptAt: new Date(now.getTime() + Math.min(3_600_000, 30_000 * 2 ** Math.min(delivery.attempts, 7))) } });
    } finally { await database.mobileDelivery.update({ where: { id: delivery.id }, data: { lockedUntil: null } }); }
  }
}
async function drop(database: PrismaClient, id: string) { await database.mobileDelivery.update({ where: { id }, data: { status: "DROPPED", payload: {}, tokenHash: null, receiptId: null, receiptCheckAt: null } }); }

export function expoHeaders(accessToken = config.EXPO_ACCESS_TOKEN): Record<string, string> {
  return { "content-type": "application/json", ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) };
}
async function retireToken(database: PrismaClient, deviceId: string, generation: number, tokenHash: string) {
  const current = await database.mobileDevice.findUnique({ where: { id: deviceId }, select: { expoPushToken: true } });
  if (!current?.expoPushToken || hashCompanionSecret(current.expoPushToken) !== tokenHash) return;
  // Both predicates matter: a delayed receipt for the same OS token from a prior
  // enrollment must not turn off a newly approved enrollment.
  await database.mobileDevice.updateMany({ where: { id: deviceId, generation, expoPushToken: current.expoPushToken }, data: { enabled: false, expoPushToken: null, generation: { increment: 1 }, snapshot: {} } });
}

export async function pollMobileReceipts(database: PrismaClient, now = new Date(), send: typeof fetch = fetch) {
  const deliveries = await database.mobileDelivery.findMany({ where: { status: "ACCEPTED", receiptCheckAt: { lte: now }, expiresAt: { gt: now } }, take: 100 });
  if (!deliveries.length) return;
  try {
    const response = await send("https://exp.host/--/api/v2/push/getReceipts", { method: "POST", headers: expoHeaders(), signal: AbortSignal.timeout(10_000), body: JSON.stringify({ ids: deliveries.map(d => d.receiptId).filter(Boolean) }) });
    if (!response.ok) throw new Error("receipts unavailable");
    const answer = await response.json() as { data?: Record<string, { status: string; details?: { error?: string } }> };
    for (const delivery of deliveries) {
      const receipt = delivery.receiptId ? answer.data?.[delivery.receiptId] : null;
      if (!receipt) {
        await database.mobileDelivery.update({ where: { id: delivery.id }, data: { receiptCheckAt: new Date(now.getTime() + 5 * 60_000) } });
        continue;
      }
      if (receipt.status === "error" && receipt.details?.error === "DeviceNotRegistered" && delivery.tokenHash) await retireToken(database, delivery.deviceId, delivery.generation, delivery.tokenHash);
      await database.mobileDelivery.update({ where: { id: delivery.id }, data: { status: receipt.status === "ok" ? "SENT" : "REJECTED", deliveredAt: receipt.status === "ok" ? now : null, payload: {}, tokenHash: null, receiptId: null, receiptCheckAt: null } });
    }
  } catch {
    // No arbitrary provider messages or response bodies enter logs/diagnostics.
    await database.mobileDelivery.updateMany({ where: { id: { in: deliveries.map(d => d.id) }, status: "ACCEPTED" }, data: { receiptCheckAt: new Date(now.getTime() + 5 * 60_000) } });
  }
}
