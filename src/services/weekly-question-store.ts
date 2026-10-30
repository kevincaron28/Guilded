import { Prisma, type PrismaClient } from "../generated/prisma/client.js";
import { weeklyQuestionDraftSchema } from "./weekly-question.js";

export function questionWeek(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find(value => value.type === type)!.value;
  const date = new Date(`${part("year")}-${part("month")}-${part("day")}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}

export async function saveWeeklyQuestion(database: PrismaClient, guildId: string, actorId: string, value: unknown) {
  const settings = weeklyQuestionDraftSchema.parse(value);
  return database.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`weekly-question:${guildId}`}))`;
    return tx.weeklyQuestionPlan.upsert({ where: { guildId }, create: { guildId, settings, createdBy: actorId },
      update: { settings, paused: false, automation: Prisma.DbNull, createdBy: actorId, revision: { increment: 1 } } });
  });
}

export async function reviewWeeklyQuestion(database: PrismaClient, guildId: string, actorId: string, now = new Date()) {
  return database.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`weekly-question:${guildId}`}))`;
    const plan = await tx.weeklyQuestionPlan.findUnique({ where: { guildId } });
    if (!plan) throw new Error("Save a weekly-preview first.");
    const settings = weeklyQuestionDraftSchema.parse(plan.settings);
    const weekKey = questionWeek(now, settings.timezone);
    await tx.weeklyQuestionReview.deleteMany({ where: { guildId, expiresAt: { lte: now } } });
    const review = await tx.weeklyQuestionReview.create({ data: { guildId, actorId, revision: plan.revision, weekKey, expiresAt: new Date(now.getTime() + 5 * 60_000) } });
    const occurrence = await tx.weeklyQuestionOccurrence.findUnique({ where: { guildId_weekKey: { guildId, weekKey } } });
    return { plan, settings, review, occurrence };
  });
}

export async function pauseWeeklyQuestion(database: PrismaClient, guildId: string, paused: boolean) {
  return database.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`weekly-question:${guildId}`}))`;
    return tx.weeklyQuestionPlan.updateMany({ where: { guildId }, data: { paused, automation: Prisma.DbNull, revision: { increment: 1 } } });
  });
}

/** Permission validation belongs to the Discord adapter and is repeated for the
 * stored guild/channel. Claim commits before send; uncertain outcomes are held.
 * Recurrence is manual only. Two officers/retries cannot post the same week. */
export async function actOnWeeklyQuestion(database: PrismaClient, input: {
  reviewId: string; guildId: string; actorId: string; action: "post" | "skip" | "pause";
  authorize: (channelId: string) => Promise<boolean>;
  send: (settings: ReturnType<typeof weeklyQuestionDraftSchema.parse>, pollId: string | null) => Promise<string>;
}, now = new Date()) {
  const began = Date.now();
  const review = await database.weeklyQuestionReview.findFirst({ where: { id: input.reviewId, guildId: input.guildId, actorId: input.actorId, expiresAt: { gt: now } } });
  const plan = review ? await database.weeklyQuestionPlan.findUnique({ where: { guildId: input.guildId } }) : null;
  if (!review || !plan || plan.revision !== review.revision) return "expired";
  const settings = weeklyQuestionDraftSchema.parse(plan.settings);
  if (!await input.authorize(settings.channelId)) return "not-authorized";
  const claim = await database.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`weekly-question:${input.guildId}`}))`;
    const current = await tx.weeklyQuestionPlan.findUnique({ where: { guildId: input.guildId } });
    const claimAt = new Date(now.getTime() + Math.max(0, Date.now() - began));
    const token = await tx.weeklyQuestionReview.findFirst({ where: { id: input.reviewId, guildId: input.guildId, actorId: input.actorId, expiresAt: { gt: claimAt } } });
    if (!current || !token || current.revision !== token.revision || questionWeek(claimAt, settings.timezone) !== token.weekKey) return null;
    if (input.action === "pause") {
      await tx.weeklyQuestionPlan.update({ where: { guildId: input.guildId }, data: { paused: true, revision: { increment: 1 } } });
      return { status: "paused" as const };
    }
    if (current.paused || await tx.weeklyQuestionOccurrence.findUnique({ where: { guildId_weekKey: { guildId: input.guildId, weekKey: token.weekKey } } })) return null;
    // A timezone edit near a week boundary must not create a second immediate
    // post. This guard also survives different review tokens and plan revisions.
    if (input.action === "post" && await tx.weeklyQuestionOccurrence.findFirst({ where: { guildId: input.guildId,
      status: { in: ["ATTEMPTED", "SENT", "UNCERTAIN"] }, createdAt: { gt: new Date(now.getTime() - 6 * 86_400_000) } } })) return null;
    const poll = input.action === "post" && settings.mode === "button-poll" ? await tx.poll.create({ data: {
      guildId: input.guildId, question: settings.question, options: settings.options, createdBy: input.actorId,
      closesAt: new Date(now.getTime() + 7 * 86_400_000)
    } }) : null;
    const occurrence = await tx.weeklyQuestionOccurrence.create({ data: { guildId: input.guildId, weekKey: token.weekKey,
      status: input.action === "skip" ? "SKIPPED" : "ATTEMPTED", pollId: poll?.id ?? null, channelId: settings.channelId } });
    return { status: input.action === "skip" ? "skipped" as const : "claimed" as const, occurrence, revision: current.revision };
  });
  if (!claim) return "already-handled";
  if (claim.status !== "claimed") return claim.status;
  // No fallback channel or automatic retry after a permission/configuration race.
  const stillAuthorized = await input.authorize(settings.channelId);
  const latest = await database.weeklyQuestionPlan.findUnique({ where: { guildId: input.guildId } });
  const checkedAt = new Date(now.getTime() + Math.max(0, Date.now() - began));
  if (!latest || latest.paused || latest.revision !== claim.revision || !stillAuthorized || review.expiresAt <= checkedAt || questionWeek(checkedAt, settings.timezone) !== review.weekKey) {
    await database.weeklyQuestionOccurrence.update({ where: { id: claim.occurrence.id }, data: { status: "SKIPPED" } });
    if (claim.occurrence.pollId) await database.poll.update({ where: { id: claim.occurrence.pollId }, data: { closed: true } });
    return "cancelled";
  }
  try {
    const messageId = await input.send(settings, claim.occurrence.pollId);
    await database.$transaction(async tx => {
      await tx.weeklyQuestionOccurrence.update({ where: { id: claim.occurrence.id }, data: { status: "SENT", messageId } });
      if (claim.occurrence.pollId) await tx.poll.update({ where: { id: claim.occurrence.pollId }, data: { channelId: settings.channelId, messageId } });
    });
    return "sent";
  } catch {
    await database.weeklyQuestionOccurrence.update({ where: { id: claim.occurrence.id }, data: { status: "UNCERTAIN" } });
    return "uncertain";
  }
}
