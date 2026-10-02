import type { CommunityParticipationDay, Prisma, PrismaClient } from "@prisma/client";
import { dateAfter, dayStart, MESSAGE_COOLDOWN_MS, participationDay, participationRules, participationWeek, VOICE_BLOCK_MS, voiceSegments, type ParticipationRules } from "./participation-rules.js";

type Tx = Prisma.TransactionClient;
const fail = (text: string): never => { throw new Error(text); };
const json = (value: unknown) => value as Prisma.InputJsonValue;
export function createParticipationService(database: PrismaClient) {
  // Share the community lock with wallets, season archives and event rewards.
  const locked = <T>(guildId: string, work: (tx: Tx) => Promise<T>) => database.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`community:${guildId}`}, 0))`;
    return work(tx);
  }, { timeout: 20_000 });
  const current = async (tx: Tx, guildId: string, seasonId: string, revision?: number, requireEnabled = true) => {
    const row = await tx.communityParticipationConfig.findFirst({ where: { seasonId, ...(requireEnabled ? { enabled: true } : {}), season: { guildId, game: "DISCORD", status: "ACTIVE" } }, include: { season: { include: { guild: { include: { settings: true } } } } } });
    if (!row || revision !== undefined && row.revision !== revision) return null;
    return { ...row, rules: participationRules.parse(row.rules), timezone: row.season.guild.settings?.timezone ?? "America/Toronto" };
  };
  const daily = async (tx: Tx, seasonId: string, userId: string, day: string) => tx.communityParticipationDay.upsert({ where: { seasonId_userId_day: { seasonId, userId, day } }, create: { seasonId, userId, day }, update: {} });
  const award = (tx: Tx, seasonId: string, userId: string, amount: number, reference: string, reason: string, actorId: string, createdAt: Date) => tx.communityPoint.create({ data: { seasonId, userId, amount, reference, reason, actorId, createdAt, kind: "AWARD" } });
  const exists = (tx: Tx, seasonId: string, reference: string) => tx.communityPoint.findUnique({ where: { seasonId_reference: { seasonId, reference } } });

  return {
    async configure(guildId: string, seasonId: string, enabled: boolean, input: ParticipationRules) {
      const rules = participationRules.parse(input);
      if (enabled && !rules.textChannels.length && !rules.voiceChannels.length && !rules.allVoice) fail("Choisis au moins un salon / Select at least one channel.");
      return locked(guildId, async tx => {
        const season = await tx.communitySeason.findFirst({ where: { id: seasonId, guildId, game: "DISCORD", status: "ACTIVE" } });
        if (!season) return fail("Saison Discord active requise / Active Discord season required.");
        return tx.communityParticipationConfig.upsert({ where: { seasonId }, create: { seasonId, enabled, rules: json(rules) }, update: { enabled, rules: json(rules), revision: { increment: 1 } } });
      });
    },
    async message(guildId: string, seasonId: string, input: { userId: string; channelId: string; messageId: string; hash: string | null; contentAvailable: boolean; at: Date; revision: number }) {
      return locked(guildId, async tx => {
        const cfg = await current(tx, guildId, seasonId, input.revision);
        if (!cfg || !cfg.rules.textChannels.includes(input.channelId) || input.contentAvailable && !input.hash) return false;
        if (await tx.communityParticipationDeletion.findUnique({ where: { seasonId_messageId: { seasonId, messageId: input.messageId } } })) return false;
        const reference = `participation:message:${input.messageId}`;
        if (await exists(tx, seasonId, reference)) return false;
        const today = await daily(tx, seasonId, input.userId, participationDay(input.at, cfg.timezone));
        const previous = await tx.communityParticipationDay.findFirst({ where: { seasonId, userId: input.userId, lastMessageAt: { not: null } }, orderBy: { lastMessageAt: "desc" } });
        const hashes = Array.isArray(today.messageHashes) ? today.messageHashes as string[] : [];
        if (today.messages >= cfg.rules.messageDailyCap || previous?.lastMessageAt && input.at.getTime() - previous.lastMessageAt.getTime() < MESSAGE_COOLDOWN_MS || input.hash && hashes.includes(input.hash)) return false;
        await award(tx, seasonId, input.userId, 1, reference, "Discussion / Discussion", "Guilded", input.at);
        await tx.communityParticipationDay.update({ where: { id: today.id }, data: { messages: { increment: 1 }, lastMessageAt: input.at, messageHashes: json(input.hash ? [...hashes, input.hash].slice(-50) : hashes) } });
        return true;
      });
    },
    async reaction(guildId: string, seasonId: string, input: { userId: string; reactorId: string; messageId: string; channelId: string; at: Date; revision: number }) {
      if (input.userId === input.reactorId) return false;
      return locked(guildId, async tx => {
        const cfg = await current(tx, guildId, seasonId, input.revision);
        if (!cfg || !cfg.rules.textChannels.includes(input.channelId)) return false;
        if (await tx.communityParticipationDeletion.findUnique({ where: { seasonId_messageId: { seasonId, messageId: input.messageId } } })) return false;
        // Emoji is deliberately absent: several emojis or toggling cannot earn again.
        const reference = `participation:reaction:${input.messageId}:${input.reactorId}`;
        if (await exists(tx, seasonId, reference)) return false;
        const day = participationDay(input.at, cfg.timezone);
        const today = await daily(tx, seasonId, input.userId, day);
        if (today.reactions >= cfg.rules.reactionDailyCap) return false;
        if (await tx.communityPoint.count({ where: { seasonId, kind: "AWARD", reference: { startsWith: `participation:reaction:${input.messageId}:` } } }) >= 3) return false;
        if (await tx.communityPoint.count({ where: { seasonId, userId: input.userId, actorId: input.reactorId, kind: "AWARD", reference: { startsWith: "participation:reaction:" }, createdAt: { gte: dayStart(day, cfg.timezone), lt: dayStart(dateAfter(day, 1), cfg.timezone) } } }) >= 2) return false;
        await award(tx, seasonId, input.userId, 1, reference, "Réaction positive / Positive reaction", input.reactorId, input.at);
        await tx.communityParticipationDay.update({ where: { id: today.id }, data: { reactions: { increment: 1 } } });
        return true;
      });
    },
    async voice(guildId: string, seasonId: string, userId: string, start: Date, end: Date, revision: number) {
      return locked(guildId, async tx => {
        const cfg = await current(tx, guildId, seasonId, revision);
        if (!cfg) return 0;
        let earned = 0;
        for (const segment of voiceSegments(start, end, cfg.timezone)) {
          const today = await daily(tx, seasonId, userId, segment.day);
          const from = Math.max(segment.start.getTime(), today.lastVoiceAt?.getTime() ?? 0);
          const elapsed = Math.max(0, segment.end.getTime() - from);
          if (!elapsed) continue;
          const voiceMs = Math.max(today.voiceMs, Math.min(cfg.rules.voiceDailyMinutes * 60_000, today.voiceMs + elapsed));
          const points = Math.max(today.voicePoints, Math.floor(voiceMs / VOICE_BLOCK_MS) * 2);
          if (points > today.voicePoints) {
            await award(tx, seasonId, userId, points - today.voicePoints, `participation:voice:${userId}:${segment.day}:${points}`, "Vocal partagé / Shared voice time", "Guilded", new Date(segment.end.getTime() - 1));
            earned += points - today.voicePoints;
          }
          await tx.communityParticipationDay.update({ where: { id: today.id }, data: { voiceMs, voicePoints: points, lastVoiceAt: segment.end } });
        }
        return earned;
      });
    },
    async nominate(guildId: string, seasonId: string, userId: string, nominatorId: string, reason: string, now = new Date()) {
      if (userId === nominatorId || !reason.trim() || reason.length > 300) fail("Un autre membre et un motif sont requis / Another member and a reason are required.");
      return locked(guildId, async tx => {
        const cfg = await current(tx, guildId, seasonId);
        if (!cfg) return fail("Participation désactivée / Participation disabled.");
        const week = participationWeek(now, cfg.timezone);
        const existing = await tx.communityKudos.findUnique({ where: { seasonId_nominatorId_userId_week: { seasonId, nominatorId, userId, week } } });
        if (existing) return existing;
        if (await tx.communityKudos.count({ where: { seasonId, nominatorId, week } }) >= 3) fail("Maximum trois nominations par semaine / Maximum three nominations per week.");
        return tx.communityKudos.create({ data: { seasonId, userId, nominatorId, week, reason: reason.trim(), createdAt: now } });
      });
    },
    async deleteMessage(guildId: string, seasonId: string, messageId: string, now = new Date()) {
      return locked(guildId, async tx => {
        if (!await tx.communitySeason.findFirst({ where: { id: seasonId, guildId, status: "ACTIVE", game: "DISCORD" } })) return;
        // Tombstones prevent a delayed create/reaction handler awarding after deletion.
        await tx.communityParticipationDeletion.upsert({ where: { seasonId_messageId: { seasonId, messageId } }, create: { seasonId, messageId, createdAt: now }, update: {} });
        const points = await tx.communityPoint.findMany({ where: { seasonId, kind: "AWARD", OR: [{ reference: `participation:message:${messageId}` }, { reference: { startsWith: `participation:reaction:${messageId}:` } }] } });
        for (const point of points) {
          const reference = `participation:reverse:${point.id}`;
          if (!await exists(tx, seasonId, reference)) await tx.communityPoint.create({ data: { seasonId, userId: point.userId, amount: -point.amount, kind: "REVERSAL", reference, reason: "Message supprimé / Message deleted", actorId: "Guilded", createdAt: now } });
        }
      });
    },
    async review(guildId: string, seasonId: string, id: string, actorId: string, approve: boolean, note: string, now = new Date()) {
      if (!note.trim() || note.length > 300) fail("Motif requis / Reason required.");
      return locked(guildId, async tx => {
        const cfg = await current(tx, guildId, seasonId, undefined, false);
        if (!cfg) return fail("Participation désactivée / Participation disabled.");
        if (approve && !cfg.enabled) fail("Gains en pause; les refus restent possibles / Earning paused; nominations can still be rejected.");
        const row = await tx.communityKudos.findFirst({ where: { id, seasonId } });
        if (!row) return fail("Nomination introuvable / Nomination not found.");
        if ([row.userId, row.nominatorId].includes(actorId)) fail("Un autre officier doit valider / An independent officer must review.");
        if (row.status !== "PENDING") return row;
        if (approve) {
          // Count original approvals, including reversals, so corrections never refill caps.
          const week = participationWeek(now, cfg.timezone);
          const count = await tx.communityPoint.count({ where: { seasonId, userId: row.userId, kind: "AWARD", reference: { startsWith: "participation:helper:" }, createdAt: { gte: dayStart(week, cfg.timezone), lt: dayStart(dateAfter(week, 7), cfg.timezone) } } });
          if (count >= 3) fail("Maximum 15 points d'entraide par semaine / Maximum 15 helper points per week.");
          await award(tx, seasonId, row.userId, 5, `participation:helper:${id}`, row.reason, actorId, now);
        }
        return tx.communityKudos.update({ where: { id }, data: { status: approve ? "APPROVED" : "REJECTED", reviewedBy: actorId, reviewNote: note.trim() } });
      });
    },
    async reverse(guildId: string, seasonId: string, id: string, actorId: string, reason: string, now = new Date()) {
      if (!reason.trim() || reason.length > 300) fail("Motif requis / Reason required.");
      return locked(guildId, async tx => {
        // Corrections work when earning is paused, but never change a frozen season.
        const row = await tx.communityPoint.findFirst({ where: { id, seasonId, kind: "AWARD", amount: { gt: 0 }, reference: { startsWith: "participation:" }, season: { guildId, status: "ACTIVE" } } });
        if (!row) return fail("Gain actif introuvable / Active award not found.");
        const reference = `participation:reverse:${id}`;
        const existing = await exists(tx, seasonId, reference);
        if (existing) return existing;
        if (row.reference.startsWith("participation:helper:")) await tx.communityKudos.update({ where: { id: row.reference.slice("participation:helper:".length) }, data: { status: "REVERSED", reviewedBy: actorId, reviewNote: reason.trim() } });
        return tx.communityPoint.create({ data: { seasonId, userId: row.userId, amount: -row.amount, kind: "REVERSAL", reference, reason: reason.trim(), actorId, createdAt: now } });
      });
    },
    async summary(guildId: string, seasonId: string, userId: string, now = new Date()) {
      const season = await database.communitySeason.findFirst({ where: { id: seasonId, guildId }, include: { guild: { include: { settings: true } }, participation: true } });
      if (!season) return fail("Saison introuvable / Season not found.");
      const timezone = season.guild.settings?.timezone ?? "America/Toronto";
      const day = participationDay(now, timezone), week = participationWeek(now, timezone);
      const today: CommunityParticipationDay | null = await database.communityParticipationDay.findUnique({ where: { seasonId_userId_day: { seasonId, userId, day } } });
      const entries = await database.communityPoint.findMany({ where: { seasonId, kind: { in: ["AWARD", "REVERSAL"] } } });
      const weekly = entries.filter(entry => entry.createdAt >= dayStart(week, timezone) && entry.createdAt <= now);
      const totals = new Map<string, number>();
      for (const entry of weekly) totals.set(entry.userId, (totals.get(entry.userId) ?? 0) + entry.amount);
      const participants = [...totals].filter(([, amount]) => amount > 0).length;
      const helperTotals = new Map<string, number>();
      const awards = new Map(entries.filter(entry => entry.kind === "AWARD").map(entry => [entry.id, entry]));
      for (const entry of weekly) {
        const original = entry.kind === "REVERSAL" ? awards.get(entry.reference.slice("participation:reverse:".length)) : entry;
        if (original?.reference.startsWith("participation:helper:")) helperTotals.set(entry.userId, (helperTotals.get(entry.userId) ?? 0) + entry.amount);
      }
      return { season, today, participants, points: entries.filter(entry => entry.userId === userId).reduce((sum, entry) => sum + entry.amount, 0), helpers: [...helperTotals].filter(([, amount]) => amount > 0).sort((a, b) => b[1] - a[1]).slice(0, 5), rules: participationRules.parse(season.participation?.rules ?? {}) };
    }
  };
}
