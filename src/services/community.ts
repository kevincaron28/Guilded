import { randomInt } from "node:crypto";
import type { CommunityActivity, CommunitySeason, Prisma, PrismaClient } from "@prisma/client";
import { enqueueDiscordJob } from "./discord-jobs.js";
import { assertLotteryGame, challengeRules, COMMUNITY_GAMES, drawWinners, eventRules, evidenceReference, lotteryRules, quizRules, standings } from "./community-rules.js";
import { communityActivityChannel } from "./community-display.js";

type Tx = Prisma.TransactionClient;
const fail = (message: string): never => { throw new Error(message); };
const json = (value: unknown) => value as Prisma.InputJsonValue;

// A single guild lock serializes wallet spends, approvals, capacity and draws.
// PostgreSQL READ COMMITTED reads the preceding lock holder's committed changes.
export function createCommunityService(database: PrismaClient) {
  const locked = <T>(guildId: string, work: (tx: Tx) => Promise<T>) => database.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`community:${guildId}`}, 0))`;
    return work(tx);
  }, { timeout: 20_000 });
  const season = async (tx: Tx, guildId: string, id: string, active = true) => {
    const row = await tx.communitySeason.findFirst({ where: { id, guildId } });
    if (!row) return fail("Saison introuvable / Season not found.");
    if (active && row.status !== "ACTIVE") return fail("Saison terminée / Season ended.");
    return row;
  };
  const activity = async (tx: Tx, guildId: string, id: string, kind?: string) => {
    const row = await tx.communityActivity.findFirst({ where: { id, season: { guildId }, ...(kind ? { kind } : {}) }, include: { season: true } });
    return row ?? fail("Activité introuvable / Activity not found.");
  };
  const open = (row: CommunityActivity & { season: CommunitySeason }, now: Date) => {
    if (row.status !== "OPEN" || row.season.status !== "ACTIVE" || row.endsAt <= now) fail("Inscriptions fermées / Entries closed.");
  };
  const queue = (tx: Tx, row: CommunityActivity, guildId: string) => enqueueDiscordJob(tx, guildId, `community:${row.id}`, "COMMUNITY_POST", { activityId: row.id });
  const point = (tx: Tx, seasonId: string, userId: string, amount: number, kind: string, reference: string, reason: string, actorId: string) =>
    tx.communityPoint.create({ data: { seasonId, userId, amount, kind, reference, reason, actorId } });
  const balance = async (tx: Tx, seasonId: string, userId: string) => (await tx.communityPoint.aggregate({ where: { seasonId, userId }, _sum: { amount: true } }))._sum.amount ?? 0;

  return {
    async startSeason(guildId: string, data: { name: string; game: string; channelId: string; audienceRoleId: string | null; actorId: string }) {
      if (!(COMMUNITY_GAMES as readonly string[]).includes(data.game) || !data.name.trim() || data.name.length > 80) fail("Saison invalide / Invalid season.");
      if (data.game !== "DISCORD" && !data.audienceRoleId) fail("Choisis le rôle du jeu / Choose the game's role.");
      return locked(guildId, async tx => {
        if (await tx.communitySeason.findFirst({ where: { guildId, game: data.game, status: "ACTIVE" } })) fail("Une saison est déjà active pour ce jeu / A season is already active for this game.");
        const counter = await tx.communitySeasonCounter.upsert({ where: { guildId_game: { guildId, game: data.game } }, create: { guildId, game: data.game, nextNumber: 2 }, update: { nextNumber: { increment: 1 } } });
        return tx.communitySeason.create({ data: { guildId, name: data.name.trim(), number: counter.nextNumber - 1, game: data.game, channelId: data.channelId, audienceRoleId: data.audienceRoleId, createdBy: data.actorId } });
      });
    },
    async configureSeason(guildId: string, seasonId: string, actorId: string, input: { name?: string; announcementChannelId?: string }) {
      if (input.name !== undefined && (!input.name.trim() || input.name.length > 80)) fail("Nom invalide / Invalid name.");
      return locked(guildId, async tx => {
        const row = await season(tx, guildId, seasonId, false);
        const updated = await tx.communitySeason.update({ where: { id: row.id }, data: { ...(input.name === undefined ? {} : { name: input.name.trim() }), ...(input.announcementChannelId === undefined ? {} : { announcementChannelId: input.announcementChannelId }) } });
        await tx.auditLog.create({ data: { guildId, actorId, action: "CONFIG_UPDATED", entityId: row.id, metadata: { area: "community-season", before: { name: row.name, announcementChannelId: row.announcementChannelId }, after: { name: updated.name, announcementChannelId: updated.announcementChannelId } } } });
        if (updated.name !== row.name) {
          const posts = await tx.communityActivity.findMany({ where: { seasonId: row.id, messageId: { not: null }, kind: { not: "DICE" } } });
          for (const post of posts) await queue(tx, post, guildId);
        }
        return updated;
      });
    },
    async endSeason(guildId: string, seasonId: string) {
      return locked(guildId, async tx => {
        const row = await season(tx, guildId, seasonId, false);
        if (row.status === "ENDED") return row;
        if (await tx.communityActivity.count({ where: { seasonId, status: "OPEN" } })) fail("Ferme les activités avant la saison / Close activities before ending the season.");
        if (await tx.communityEntry.count({ where: { activity: { seasonId, kind: "CHALLENGE", status: { not: "CANCELLED" } }, status: "PENDING" } })) fail("Traite les preuves en attente avant d'archiver / Review pending evidence before archiving.");
        if (await tx.communityKudos.count({ where: { seasonId, status: "PENDING" } })) fail("Traite les nominations avant d'archiver / Review helper nominations before archiving.");
        const final = standings(await tx.communityPoint.findMany({ where: { seasonId } }));
        return tx.communitySeason.update({ where: { id: seasonId }, data: { status: "ENDED", endedAt: new Date(), finalStandings: json(final) } });
      });
    },
    async create(guildId: string, seasonId: string, data: { kind: string; title: string; rules: unknown; startsAt?: Date; endsAt: Date; actorId: string }, now = new Date()) {
      if (!data.title.trim() || data.title.length > 200 || !Number.isFinite(data.endsAt.getTime()) || data.endsAt <= now) fail("Titre ou date invalide / Invalid title or date.");
      if (data.endsAt.getTime() - now.getTime() > 366 * 86_400_000) fail("Maximum un an / Maximum one year.");
      let rules: unknown;
      if (data.kind === "LOTTERY") rules = lotteryRules.parse(data.rules);
      else if (data.kind === "CHALLENGE") rules = challengeRules.parse(data.rules);
      else if (data.kind === "QUIZ") rules = quizRules.parse(data.rules);
      else if (data.kind === "EVENT") {
        rules = eventRules.parse(data.rules);
        if (!data.startsAt || !Number.isFinite(data.startsAt.getTime()) || data.startsAt <= now || data.startsAt >= data.endsAt) fail("Heure de soirée invalide / Invalid event time.");
      } else return fail("Type d'activité invalide / Invalid activity kind.");
      return locked(guildId, async tx => {
        const current = await season(tx, guildId, seasonId);
        if (data.kind === "LOTTERY") assertLotteryGame(current.game, lotteryRules.parse(rules).mode);
        if (data.kind === "QUIZ" && current.game !== "DISCORD") fail("Les quiz utilisent une saison Discord / Quizzes use a Discord season.");
        const row = await tx.communityActivity.create({ data: { seasonId, postedChannelId: current.announcementChannelId ?? current.channelId, title: data.title.trim(), kind: data.kind, rules: json(rules), startsAt: data.startsAt ?? null, endsAt: data.endsAt, createdBy: data.actorId } });
        await queue(tx, row, guildId);
        return row;
      });
    },
    async editEvent(guildId: string, id: string, input: { title?: string; startsAt?: Date; endsAt?: Date; voiceChannelId?: string }, now = new Date()) {
      return locked(guildId, async tx => {
        const row = await activity(tx, guildId, id, "EVENT");
        if (row.status !== "OPEN" || row.season.status !== "ACTIVE" || !row.startsAt || row.startsAt <= now) fail("Seules les soirées à venir sont modifiables / Only upcoming gaming nights can be edited.");
        const title = input.title?.trim() ?? row.title;
        const startsAt = input.startsAt ?? row.startsAt!;
        const endsAt = input.endsAt ?? row.endsAt;
        if (!title || title.length > 200 || !Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || startsAt <= now || endsAt <= startsAt || endsAt.getTime() - now.getTime() > 366 * 86_400_000) fail("Titre ou date invalide / Invalid title or date.");
        const rules = eventRules.parse({ ...eventRules.parse(row.rules), ...(input.voiceChannelId ? { voiceChannelId: input.voiceChannelId } : {}) });
        const updated = await tx.communityActivity.update({ where: { id }, data: { title, startsAt, endsAt, rules: json(rules), ...(startsAt.getTime() !== row.startsAt!.getTime() ? { reminderAt: null } : {}) } });
        if (startsAt.getTime() !== row.startsAt!.getTime()) await tx.discordJob.updateMany({ where: { guildId, key: `community-reminder:${id}`, status: "PENDING" }, data: { status: "DONE", deliveredAt: now } });
        await queue(tx, updated, guildId);
        return updated;
      });
    },
    async enterLottery(guildId: string, id: string, userId: string, quantity = 1, now = new Date()) {
      return locked(guildId, async tx => {
        const row = await activity(tx, guildId, id, "LOTTERY");
        open(row, now);
        const rules = lotteryRules.parse(row.rules);
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > rules.maxTickets) fail("Nombre de billets invalide / Invalid ticket quantity.");
        const existing = await tx.communityEntry.findUnique({ where: { activityId_userId: { activityId: id, userId } } });
        if (existing) return existing;
        if (await tx.communityEntry.count({ where: { activityId: id } }) >= 10_000) fail("Loterie complète / Lottery full.");
        const total = rules.cost * quantity;
        if (rules.mode === "POINTS") {
          if (await balance(tx, row.seasonId, userId) < total) fail("Points insuffisants / Not enough points.");
          await point(tx, row.seasonId, userId, -total, "SPEND", `lottery:${id}:${userId}`, row.title, userId);
        }
        const entry = await tx.communityEntry.create({ data: { activityId: id, userId, quantity, status: ["FREE", "POINTS"].includes(rules.mode) ? "CONFIRMED" : "PENDING" } });
        await queue(tx, row, guildId);
        return entry;
      });
    },
    async confirmPayment(guildId: string, id: string, userId: string, actorId: string, receipt: string, now = new Date()) {
      if (actorId === userId) fail("Un autre organisateur doit confirmer / Another organizer must confirm.");
      if (!receipt.trim() || receipt.length > 300) fail("Note de paiement requise / Payment note required.");
      return locked(guildId, async tx => {
        const row = await activity(tx, guildId, id, "LOTTERY");
        open(row, now);
        const rules = lotteryRules.parse(row.rules);
        if (!["WOW_GOLD", "POE_CURRENCY"].includes(rules.mode)) fail("Cette loterie n'a pas de paiement en jeu / No in-game payment for this lottery.");
        const entry = await tx.communityEntry.findUnique({ where: { activityId_userId: { activityId: id, userId } } });
        if (!entry) return fail("Aucune demande de billets / No ticket request.");
        if (entry.status === "CONFIRMED") return entry;
        if (entry.status !== "PENDING") fail("Demande déjà traitée / Request already handled.");
        const updated = await tx.communityEntry.update({ where: { id: entry.id }, data: { status: "CONFIRMED", reviewedBy: actorId, reviewNote: receipt.trim() } });
        await queue(tx, row, guildId);
        return updated;
      });
    },
    async signup(guildId: string, id: string, userId: string, choice: string, now = new Date()) {
      if (!["JOINED", "MAYBE", "ABSENT"].includes(choice)) fail("Choix invalide / Invalid choice.");
      return locked(guildId, async tx => {
        const row = await activity(tx, guildId, id, "EVENT");
        open(row, now);
        if (row.startsAt! <= now) fail("La soirée a commencé / Event already started.");
        const existing = await tx.communityEntry.findUnique({ where: { activityId_userId: { activityId: id, userId } } });
        const rules = eventRules.parse(row.rules);
        let status = choice;
        if (choice === "JOINED" && existing?.status !== "JOINED" && await tx.communityEntry.count({ where: { activityId: id, status: "JOINED" } }) >= rules.capacity) status = "WAITLISTED";
        const entry = await tx.communityEntry.upsert({ where: { activityId_userId: { activityId: id, userId } }, create: { activityId: id, userId, status, createdAt: now }, update: { status, ...(status === "WAITLISTED" && existing?.status !== "WAITLISTED" ? { createdAt: now } : {}) } });
        if (existing?.status === "JOINED" && status !== "JOINED") {
          const next = await tx.communityEntry.findFirst({ where: { activityId: id, status: "WAITLISTED" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
          if (next) await tx.communityEntry.update({ where: { id: next.id }, data: { status: "JOINED" } });
        }
        await queue(tx, row, guildId);
        return entry;
      });
    },
    async attendance(guildId: string, id: string, userId: string, actorId: string, now = new Date()) {
      if (userId === actorId) fail("Un autre organisateur doit confirmer / Another organizer must confirm.");
      return locked(guildId, async tx => {
        const row = await activity(tx, guildId, id, "EVENT");
        if (row.status !== "OPEN" || row.season.status !== "ACTIVE" || row.startsAt! > now) fail("La soirée doit être en cours / Event must be in progress.");
        const entry = await tx.communityEntry.findUnique({ where: { activityId_userId: { activityId: id, userId } } });
        if (!entry) return fail("Inscription requise / Signup required.");
        if (entry.status === "PRESENT") return entry;
        if (entry.status !== "JOINED") fail("Le membre n'est pas inscrit présent / Member must have a confirmed spot.");
        const rules = eventRules.parse(row.rules);
        if (rules.points) await point(tx, row.seasonId, userId, rules.points, "AWARD", `attendance:${id}:${userId}`, row.title, actorId);
        const updated = await tx.communityEntry.update({ where: { id: entry.id }, data: { status: "PRESENT", reviewedBy: actorId } });
        await queue(tx, row, guildId);
        return updated;
      });
    },
    async submit(guildId: string, id: string, userId: string, proof: string, now = new Date()) {
      evidenceReference(proof);
      return locked(guildId, async tx => {
        const row = await activity(tx, guildId, id, "CHALLENGE");
        open(row, now);
        const existing = await tx.communityEntry.findUnique({ where: { activityId_userId: { activityId: id, userId } } });
        if (existing) fail("Déjà soumis; un résultat par membre / Already submitted; one result per member.");
        return tx.communityEntry.create({ data: { activityId: id, userId, status: "PENDING", evidence: proof } });
      });
    },
    async review(guildId: string, id: string, userId: string, actorId: string, decision: string, note: string) {
      if (userId === actorId) fail("Tu ne peux pas valider ton résultat / You cannot review your own result.");
      if (!["APPROVE", "REJECT", "REVERSE"].includes(decision) || !note.trim() || note.length > 300) fail("Décision et motif requis / Decision and reason required.");
      return locked(guildId, async tx => {
        const row = await activity(tx, guildId, id, "CHALLENGE");
        await season(tx, guildId, row.seasonId);
        if (row.status === "CANCELLED") fail("Défi annulé / Challenge cancelled.");
        const entry = await tx.communityEntry.findUnique({ where: { activityId_userId: { activityId: id, userId } } });
        if (!entry) return fail("Aucune soumission / No submission.");
        const status = decision === "APPROVE" ? "APPROVED" : decision === "REJECT" ? "REJECTED" : "REVERSED";
        if (entry.status === status) return entry;
        if (decision === "REVERSE" ? entry.status !== "APPROVED" : entry.status !== "PENDING") fail("Soumission déjà traitée / Submission already handled.");
        const points = challengeRules.parse(row.rules).points;
        if (decision !== "REJECT") {
          // Reversal can leave a negative wallet if earned points were already spent;
          // it never evades an accounting correction or permits further spending.
          await point(tx, row.seasonId, userId, decision === "REVERSE" ? -points : points, decision === "REVERSE" ? "REVERSAL" : "AWARD", `claim:${id}:${userId}:${decision}`, row.title, actorId);
        }
        const updated = await tx.communityEntry.update({ where: { id: entry.id }, data: { status, reviewedBy: actorId, reviewNote: note.trim() } });
        await queue(tx, row, guildId);
        return updated;
      });
    },
    async answerQuiz(guildId: string, id: string, userId: string, choice: number, now = new Date()) {
      if (!Number.isInteger(choice) || choice < 0 || choice > 3) fail("Réponse invalide / Invalid answer.");
      return locked(guildId, async tx => {
        const row = await activity(tx, guildId, id, "QUIZ");
        open(row, now);
        if (row.createdBy === userId) fail("L'auteur du quiz ne participe pas / The quiz author cannot participate.");
        const existing = await tx.communityEntry.findUnique({ where: { activityId_userId: { activityId: id, userId } } });
        if (existing) return existing;
        const rules = quizRules.parse(row.rules);
        const correct = rules.correct === choice;
        if (correct) await point(tx, row.seasonId, userId, rules.points, "AWARD", `quiz:${id}:${userId}`, row.title, userId);
        return tx.communityEntry.create({ data: { activityId: id, userId, status: correct ? "CORRECT" : "INCORRECT", evidence: String(choice) } });
      });
    },
    async dice(guildId: string, seasonId: string, userId: string, day: string, now = new Date()) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) fail("Date invalide / Invalid date.");
      return locked(guildId, async tx => {
        const current = await season(tx, guildId, seasonId);
        if (current.game !== "DISCORD") fail("Les dés utilisent une saison Discord / Dice use a Discord season.");
        let round = await tx.communityActivity.findFirst({ where: { seasonId, kind: "DICE", title: day } });
        if (!round) round = await tx.communityActivity.create({ data: { seasonId, kind: "DICE", title: day, rules: { participation: 5, bonus: 10, threshold: 90 }, status: "CLOSED", endsAt: now, createdBy: "Guilded" } });
        const existing = await tx.communityEntry.findUnique({ where: { activityId_userId: { activityId: round.id, userId } } });
        if (existing) return existing;
        const roll = randomInt(1, 101);
        await point(tx, seasonId, userId, 5 + (roll >= 90 ? 10 : 0), "AWARD", `dice:${day}:${userId}`, `Dice / Dés ${day}: ${roll}`, userId);
        return tx.communityEntry.create({ data: { activityId: round.id, userId, status: "PLAYED", evidence: String(roll) } });
      });
    },
    async close(guildId: string, id: string, cancel = false, now = new Date()) {
      return locked(guildId, async tx => {
        const row = await activity(tx, guildId, id);
        if (row.status !== "OPEN") return row;
        if (!cancel && row.kind === "LOTTERY" && row.endsAt > now) fail("Attends la fermeture annoncée / Wait until the announced closing time.");
        if (!cancel && row.kind === "EVENT" && row.startsAt! > now) fail("La soirée n'a pas commencé / Event has not started.");
        let result: Prisma.InputJsonValue = {};
        if (row.kind === "LOTTERY") {
          const rules = lotteryRules.parse(row.rules);
          const entries = await tx.communityEntry.findMany({ where: { activityId: id }, orderBy: { id: "asc" } });
          if (cancel && rules.mode === "POINTS") {
            for (const entry of entries.filter(entry => entry.status === "CONFIRMED")) await point(tx, row.seasonId, entry.userId, entry.quantity * rules.cost, "REFUND", `refund:${id}:${entry.userId}`, row.title, "Guilded");
          }
          result = cancel ? { externalRefundsRequired: entries.filter(entry => entry.status === "CONFIRMED" && ["WOW_GOLD", "POE_CURRENCY"].includes(rules.mode)).map(entry => ({ userId: entry.userId, amount: entry.quantity * rules.cost })) } :
            { winners: drawWinners(entries, rules.winners), tickets: entries.filter(entry => entry.status === "CONFIRMED").map(entry => ({ userId: entry.userId, quantity: entry.quantity })), drawnAt: now.toISOString() };
        }
        // Closing a challenge closes submissions, but pending claims may still be reviewed.
        // Cancellation requires resolving earned points so history stays explainable.
        if (cancel && row.kind === "CHALLENGE" && await tx.communityEntry.count({ where: { activityId: id, status: "APPROVED" } })) fail("Inverse les validations avant d'annuler / Reverse approved claims before cancelling.");
        const updated = await tx.communityActivity.update({ where: { id }, data: { status: cancel ? "CANCELLED" : "CLOSED", result } });
        await queue(tx, updated, guildId);
        return updated;
      });
    },
    async tick(guildId: string, now = new Date()) {
      const due = await database.communityActivity.findMany({ where: { season: { guildId }, status: "OPEN", endsAt: { lte: now } }, take: 50, orderBy: { endsAt: "asc" } });
      for (const row of due) await this.close(guildId, row.id, false, now);
      await locked(guildId, async tx => {
        const reminders = await tx.communityActivity.findMany({ where: { season: { guildId, status: "ACTIVE" }, kind: "EVENT", status: "OPEN", reminderAt: null, startsAt: { gt: now, lte: new Date(now.getTime() + 60 * 60_000) } }, include: { season: true }, take: 25 });
        for (const row of reminders) {
          const settings = await tx.guildSettings.findUnique({ where: { guildId }, select: { language: true } });
          const channelId = communityActivityChannel(row);
          await enqueueDiscordJob(tx, guildId, `community-reminder:${row.id}`, "MESSAGE", { channelId, message: { content: `${settings?.language === "fr" ? "🎮 La soirée commence bientôt" : "🎮 Gaming night starts soon"} : **${row.title}** <t:${Math.floor(row.startsAt!.getTime() / 1000)}:R>\n${row.messageId ? `https://discord.com/channels/${(await tx.guild.findUniqueOrThrow({ where: { id: guildId } })).discordId}/${channelId}/${row.messageId}` : row.id}`, allowedMentions: { parse: [] } } });
          await tx.communityActivity.update({ where: { id: row.id }, data: { reminderAt: now } });
        }
      });
    },
    async board(guildId: string, seasonId: string) {
      const current = await season(database, guildId, seasonId, false);
      return current.status === "ENDED" ? current.finalStandings as unknown as ReturnType<typeof standings> : standings(await database.communityPoint.findMany({ where: { seasonId } }));
    }
  };
}
