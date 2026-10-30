import type { PrismaClient } from "../generated/prisma/client.js";
import { groupSubscriptionSchema, subscriptionPreview, type SubscriptionEvent } from "./group-subscription.js";
import { ALL_ROLES, type AlertCandidate } from "./group-alerts.js";

export function watchWindow(text: string) {
  const match = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(text);
  if (!match || Number(match[1]) > 23 || Number(match[3]) > 23 || Number(match[2]) > 59 || Number(match[4]) > 59) throw new Error("Use HH:mm-HH:mm (24-hour time).");
  return { start: Number(match[1]) * 60 + Number(match[2]), end: Number(match[3]) * 60 + Number(match[4]) };
}
export async function saveGroupWatch(database: PrismaClient, guildId: string, memberId: string, settings: unknown, roles: string[]) {
  const parsed = groupSubscriptionSchema.parse(settings);
  if (!roles.length || roles.some(role => !(ALL_ROLES as string[]).includes(role))) throw new Error("Choose tank, healer or dps.");
  if (!await database.member.findFirst({ where: { id: memberId, guildId }, select: { id: true } })) throw new Error("Member unavailable in this guild.");
  // The same lock as reservations prevents an in-flight stale read from restoring
  // opt-in after off/save. Never delete delivery history when changing preferences.
  return database.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`targeted-alert:${guildId}:${memberId}`}))`;
    return tx.groupAlert.upsert({ where: { memberId }, create: { guildId, memberId, kinds: ["DUNGEON"], roles, subscription: parsed },
      update: { roles, kinds: ["DUNGEON"], subscription: parsed } });
  });
}

export interface WatchEvent extends SubscriptionEvent { channelId: string; messageId: string; title: string; excludedMemberIds: string[] }

/** Use structured seats and times, never parse a raid time from its title. Open
 * dungeon groups are an immediate opportunity; raids retain their scheduled time. */
export async function groupWatchEvents(database: PrismaClient, guildId: string, now = new Date()): Promise<WatchEvent[]> {
  const [groups, raids] = await Promise.all([
    database.dungeonGroup.findMany({ where: { guildId, status: "OPEN", kind: "DUNGEON", createdAt: { gt: new Date(now.getTime() - 2 * 3_600_000) }, signupChannelId: { not: null }, signupMessageId: { not: null } },
      include: { signups: { where: { status: "SIGNED_UP" }, select: { role: true, memberId: true } } }, take: 50, orderBy: { createdAt: "desc" } }),
    database.raid.findMany({ where: { guildId, isTest: false, status: "PLANNED", scheduledAt: { gte: now, lt: new Date(now.getTime() + 7 * 86_400_000) }, signupChannelId: { not: null }, signupMessageId: { not: null } },
      include: { signups: { where: { status: "SIGNED_UP" }, select: { role: true, memberId: true } } }, take: 50, orderBy: { scheduledAt: "asc" } })
  ]);
  const vacancies = (rows: { role: string }[], limits: Record<string, number | null>) => ALL_ROLES.filter(role => limits[role] !== null && limits[role] !== undefined && rows.filter(row => row.role === role).length < limits[role]!);
  return [
    ...groups.map(group => ({ key: `group:${group.id}`, type: "group" as const, immediate: true, startsAt: now, expiresAt: new Date(group.createdAt.getTime() + 2 * 3_600_000),
      open: true, hasVacancy: group.signups.length < group.maxSize, channelId: group.signupChannelId!, messageId: group.signupMessageId!, title: group.title, excludedMemberIds: [group.leaderId, ...group.signups.map(signup => signup.memberId)],
      group: { kind: "DUNGEON" as const, minLevel: group.minLevel, maxLevel: group.maxLevel, rolesNeeded: vacancies(group.signups, { TANK: 1, HEALER: 1, DPS: 3 }), leaderDiscordId: group.leaderId } })),
    ...raids.map(raid => {
      const rolesNeeded = vacancies(raid.signups, { TANK: raid.tankLimit, HEALER: raid.healerLimit, DPS: raid.dpsLimit });
      return { key: `vacancy:${raid.id}`, type: "vacancy" as const, startsAt: raid.scheduledAt, expiresAt: raid.signupsCloseAt && raid.signupsCloseAt < raid.scheduledAt ? raid.signupsCloseAt : raid.scheduledAt,
        open: true, hasVacancy: rolesNeeded.length > 0, channelId: raid.signupChannelId!, messageId: raid.signupMessageId!, title: raid.title, excludedMemberIds: raid.signups.map(signup => signup.memberId),
        group: { kind: "DUNGEON" as const, minLevel: null, maxLevel: null, rolesNeeded, leaderDiscordId: raid.createdBy } };
    })
  ];
}

/** Durable at-most-once attempt, reserved under a per-member DB lock. No sender
 * may call Discord until this returns a row. A crash/timeout is never replayed.
 * loadEvent and access must read current scoped state, not caller-submitted JSON. */
export async function deliverGroupWatch(database: PrismaClient, input: {
  guildId: string; memberId: string; eventKey: string;
  loadEvent: () => Promise<WatchEvent | null>;
  access: (discordUserId: string, channelId: string) => Promise<boolean>;
  send: (discordUserId: string, event: WatchEvent) => Promise<string>;
}, now = new Date()) {
  const began = Date.now();
  const event = await input.loadEvent();
  if (!event || event.key !== input.eventKey || event.excludedMemberIds.includes(input.memberId)) return "unavailable";
  const member = await database.member.findFirst({ where: { id: input.memberId, guildId: input.guildId }, select: { discordUserId: true, characters: { select: { level: true } } } });
  if (!member || !await input.access(member.discordUserId, event.channelId)) return "not-visible";
  const attempt = await database.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`targeted-alert:${input.guildId}:${input.memberId}`}))`;
    const settings = await tx.guildSettings.findUnique({ where: { guildId: input.guildId } });
    if (!settings?.targetedAlertsEnabled || settings.targetedAlertsChannelId !== event.channelId) return null;
    const alert = await tx.groupAlert.findFirst({ where: { guildId: input.guildId, memberId: input.memberId } });
    if (!alert?.subscription) return null;
    const history = await tx.targetedAlertAttempt.findMany({ where: { guildId: input.guildId, memberId: input.memberId,
      OR: [{ attemptedAt: { gt: new Date(now.getTime() - 86_400_000) } }, { eventKey: event.key }] }, select: { eventKey: true, attemptedAt: true } });
    const candidate: AlertCandidate = { discordUserId: member.discordUserId, kinds: alert.kinds, roles: alert.roles, levels: member.characters.map(character => character.level) };
    if (!subscriptionPreview({ subscription: alert.subscription, candidate, event, now, history, isMember: true, canViewChannel: true }).eligible) return null;
    return tx.targetedAlertAttempt.create({ data: { guildId: input.guildId, memberId: input.memberId, eventKey: event.key, channelId: event.channelId, attemptedAt: now } });
  });
  if (!attempt) return "suppressed";
  // A permission, opt-out, destination, role-vacancy or expiry change cancels this
  // attempt but still consumes budget. Never send to a newly substituted channel.
  const [latest, alert, settings] = await Promise.all([input.loadEvent(), database.groupAlert.findFirst({ where: { guildId: input.guildId, memberId: input.memberId } }), database.guildSettings.findUnique({ where: { guildId: input.guildId } })]);
  const stillVisible = latest?.channelId === event.channelId && await input.access(member.discordUserId, event.channelId);
  const checkedAt = new Date(now.getTime() + Math.max(0, Date.now() - began));
  const allowed = latest?.key === event.key && !latest.excludedMemberIds.includes(input.memberId) && latest.channelId === event.channelId && settings?.targetedAlertsEnabled && settings.targetedAlertsChannelId === event.channelId
    && alert && subscriptionPreview({ subscription: alert.subscription, candidate: { discordUserId: member.discordUserId, kinds: alert.kinds, roles: alert.roles, levels: member.characters.map(character => character.level) },
      event: latest, now: checkedAt, history: [], isMember: true, canViewChannel: true }).eligible && stillVisible;
  if (!allowed || !latest) {
    await database.targetedAlertAttempt.update({ where: { id: attempt.id }, data: { status: "CANCELLED" } });
    return "cancelled";
  }
  try {
    const messageId = await input.send(member.discordUserId, latest);
    await database.targetedAlertAttempt.update({ where: { id: attempt.id }, data: { status: "SENT", messageId } });
    return "sent";
  } catch {
    await database.targetedAlertAttempt.update({ where: { id: attempt.id }, data: { status: "UNCERTAIN" } });
    return "uncertain";
  }
}
