import { z } from "zod";
import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import { timezone } from "./group-subscription.js";
import { questionWeek } from "./weekly-question-store.js";
import { weeklyQuestionDraftSchema } from "./weekly-question.js";

export const recurringScheduleSchema = z.object({
  timezone, weekday: z.number().int().min(0).max(6), minute: z.number().int().min(0).max(1439),
  quietStart: z.number().int().min(0).max(1439).default(1320),
  quietEnd: z.number().int().min(0).max(1439).default(480),
}).strict().refine(s => s.quietStart !== s.quietEnd, "Quiet hours need different start/end times.");
export type RecurringSchedule = z.infer<typeof recurringScheduleSchema>;
export const inQuietHours = (minute: number, start: number, end: number) => start < end ? minute >= start && minute < end : minute >= start || minute < end;

export function recurringDue(schedule: RecurringSchedule, now: Date) {
  if (!Number.isFinite(now.getTime())) return false;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: schedule.timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const value = (type: string) => parts.find(p => p.type === type)!.value;
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(value("weekday"));
  const minute = Number(value("hour")) * 60 + Number(value("minute"));
  const quiet = inQuietHours(minute, schedule.quietStart, schedule.quietEnd);
  // Catch up only on the configured local day; never dump old notices on restart.
  return day === schedule.weekday && minute >= schedule.minute && !quiet;
}

export async function configureRecap(db: PrismaClient, guildId: string, memberId: string, settings: unknown, enabled: boolean) {
  const parsed = recurringScheduleSchema.parse(settings);
  if (enabled && inQuietHours(parsed.minute, parsed.quietStart, parsed.quietEnd)) throw new Error("Scheduled time falls in quiet hours / Horaire dans les heures de silence.");
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`recap:${memberId}`}))`;
    if (!await tx.member.findFirst({ where: { id: memberId, guildId } })) throw new Error("Member unavailable / Membre indisponible.");
    // Preserve the delivery receipt across pause/resume and schedule edits.
    return tx.recurringRecap.upsert({ where: { memberId }, create: { memberId, guildId, settings: parsed, enabled, status: enabled ? "READY" : "OFF" },
      update: { settings: parsed, enabled, revision: { increment: 1 } } });
  });
}

export async function configureQuestionAutomation(db: PrismaClient, guildId: string, actorId: string, enabled: boolean, quiet: { start: number; end: number }) {
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`weekly-question:${guildId}`}))`;
    const plan = await tx.weeklyQuestionPlan.findUniqueOrThrow({ where: { guildId } });
    const settings = weeklyQuestionDraftSchema.parse(plan.settings);
    const schedule = recurringScheduleSchema.parse({ timezone: settings.timezone, weekday: settings.weekday, minute: settings.minute, quietStart: quiet.start, quietEnd: quiet.end });
    if (enabled && inQuietHours(schedule.minute, schedule.quietStart, schedule.quietEnd)) throw new Error("Scheduled time falls in quiet hours / Horaire dans les heures de silence.");
    return tx.weeklyQuestionPlan.update({ where: { guildId }, data: { automation: enabled ? schedule : Prisma.DbNull, paused: !enabled, ...(enabled ? { createdBy: actorId } : {}), revision: { increment: 1 } } });
  });
}

export async function deliverRecurringRecap(db: PrismaClient, memberId: string, input: {
  authorize: () => Promise<boolean>; send: () => Promise<string>;
}, now = new Date()) {
  const began = Date.now();
  const initial = await db.recurringRecap.findUnique({ where: { memberId } });
  if (!initial?.enabled || !await input.authorize()) return "not-authorized";
  const parsed = recurringScheduleSchema.safeParse(initial.settings);
  if (!parsed.success || !recurringDue(parsed.data, now)) return "not-due";
  const period = questionWeek(now, parsed.data.timezone);
  const claim = await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`recap:${memberId}`}))`;
    const current = await tx.recurringRecap.findUnique({ where: { memberId } });
    if (!current?.enabled || current.revision !== initial.revision || current.lastPeriod === period
      || current.lastAttemptAt && current.lastAttemptAt.getTime() > now.getTime() - 6 * 86400000) return null;
    return tx.recurringRecap.update({ where: { memberId }, data: { lastPeriod: period, lastAttemptAt: now, status: "ATTEMPTED", messageId: null } });
  });
  if (!claim) return "already-handled";
  const stillAuthorized = await input.authorize();
  const latest = await db.recurringRecap.findUnique({ where: { memberId } });
  const checkedAt = new Date(now.getTime() + Math.max(0, Date.now() - began));
  if (!latest?.enabled || latest.revision !== claim.revision || !recurringDue(parsed.data, checkedAt) || !stillAuthorized) {
    await db.recurringRecap.updateMany({ where: { memberId, lastPeriod: period }, data: { status: "CANCELLED" } });
    return "cancelled";
  }
  try {
    const messageId = await input.send();
    await db.recurringRecap.updateMany({ where: { memberId, lastPeriod: period }, data: { status: "SENT", messageId } });
    return "sent";
  } catch {
    // A network timeout may have delivered. Hold this occurrence instead of
    // duplicating a private DM. Failures before claiming retry safely next tick.
    await db.recurringRecap.updateMany({ where: { memberId, lastPeriod: period }, data: { status: "UNCERTAIN" } });
    return "uncertain";
  }
}
