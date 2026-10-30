import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { findCharacter } from "./character-match.js";
import { battlegroundReportSchema, battlegroundReportFingerprint, validBattlegroundReportTime } from "./battleground-record-schema.js";

type Tx = Prisma.TransactionClient;
async function lock(tx: Tx, guildId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${guildId}, 0))`;
}
async function requireMember(tx: Pick<Tx, "member">, guildId: string, memberId: string) {
  const member = await tx.member.findFirst({ where: { id: memberId, guildId, status: "ACTIVE" }, select: { id: true } });
  if (!member) throw new Error("Current guild membership required / Appartenance actuelle requise.");
}

export async function setBattlegroundConsent(db: PrismaClient, guildId: string, memberId: string,
  input: { capture: boolean; guildStats: boolean }, now = new Date()) {
  if (input.guildStats && !input.capture) throw new Error("Enable capture before statistics / Activez la capture avant les statistiques.");
  return db.$transaction(async tx => {
    await lock(tx, guildId); await requireMember(tx, guildId, memberId);
    const prior = await tx.battlegroundConsent.findUnique({ where: { memberId } });
    if (!input.capture && prior?.capture) {
      const reports = await tx.battlegroundReport.findMany({ where: { guildId, memberId, premadeNonce: { not: null } }, select: { premadeNonce: true } });
      const nonces = reports.flatMap(r => r.premadeNonce ? [r.premadeNonce] : []);
      if (nonces.length) await tx.battlegroundReport.updateMany({ where: { guildId, premadeNonce: { in: nonces } }, data: { corroborated: false } });
    }
    const consentedAt = input.capture && !prior?.capture ? now : prior?.consentedAt ?? now;
    return tx.battlegroundConsent.upsert({ where: { memberId },
      create: { guildId, memberId, ...input, consentedAt }, update: { ...input, consentedAt } });
  });
}

/** Caller supplies the credential's paired member, never a payload identity. Runs inside the import transaction. */
export async function importBattlegroundReports(tx: Tx, guildId: string, pairedMemberId: string | null | undefined,
  rows: unknown[], now = new Date()) {
  const result = { recorded: 0, duplicates: 0, conflicts: 0, rejected: 0 };
  if (!rows.length) return result;
  if (!pairedMemberId) return { ...result, rejected: rows.length };
  await lock(tx, guildId);
  await requireMember(tx, guildId, pairedMemberId);
  const consent = await tx.battlegroundConsent.findUnique({ where: { memberId: pairedMemberId } });
  if (!consent?.capture || consent.guildId !== guildId) return { ...result, rejected: rows.length };
  const guild = await tx.guild.findUniqueOrThrow({ where: { id: guildId }, select: { gameEdition: true } });
  const characters = await tx.character.findMany({ where: { memberId: pairedMemberId, guildId, gameEdition: guild.gameEdition } });
  let recent = await tx.battlegroundReport.count({ where: { guildId, memberId: pairedMemberId, createdAt: { gte: new Date(now.getTime() - 86400000) } } });
  for (const raw of rows.slice(0, 100)) {
    const parsed = battlegroundReportSchema.safeParse(raw);
    if (!parsed.success) { result.rejected++; continue; }
    const report = parsed.data;
    const character = findCharacter(characters, report.character, report.realm, report.edition);
    if (!character || report.edition !== guild.gameEdition || !validBattlegroundReportTime(report, now)
      || report.endedAt * 1000 < consent.consentedAt.getTime()) { result.rejected++; continue; }
    const fingerprint = battlegroundReportFingerprint(report);
    const key = { guildId, memberId: pairedMemberId, reportId: report.reportId };
    const prior = await tx.battlegroundReport.findUnique({ where: { guildId_memberId_reportId: key } });
    if (prior) {
      if (prior.fingerprint === fingerprint) result.duplicates++;
      else {
        const differences = (["mode", "mapId", "bracket", "durationSeconds", "outcome", "presence", "reloaded", "premadeNonce"] as const)
          .filter(key => (prior[key] ?? null) !== (report[key] ?? null))
          .map(key => `${key}: ${String(prior[key] ?? "none")} → ${String(report[key] ?? "none")}`);
        if (prior.endedAt.getTime() !== report.endedAt * 1000) differences.push(`endedAt: ${prior.endedAt.toISOString()} → ${new Date(report.endedAt * 1000).toISOString()}`);
        if (prior.characterId !== character.id) differences.push("reporter character changed");
        const conflictSummary = (differences.join("; ") || "Reporter identity or payload changed").slice(0, 600);
        // Retain original evidence; never let replay replace or resurrect a withdrawn report.
        await tx.battlegroundReport.update({ where: { id: prior.id }, data: {
          status: prior.status === "WITHDRAWN" ? "WITHDRAWN" : "CONFLICT", conflictFingerprint: fingerprint, conflictSummary, corroborated: false } });
        if (prior.premadeNonce) await tx.battlegroundReport.updateMany({ where: { guildId, id: { not: prior.id }, premadeNonce: prior.premadeNonce, status: { not: "WITHDRAWN" } },
          data: { status: "CONFLICT", corroborated: false, conflictSummary: "Another consenting reporter changed evidence for this premade nonce; no verified association." } });
        result.conflicts++;
      }
      continue;
    }
    if (recent >= 100) { result.rejected++; continue; }
    await tx.battlegroundReport.create({ data: { ...key, characterId: character.id,
      adapter: report.adapter, gameEdition: report.edition, mode: report.mode, mapId: report.mapId,
      bracket: report.bracket, endedAt: new Date(report.endedAt * 1000), durationSeconds: report.durationSeconds,
      outcome: report.outcome, presence: report.presence, reloaded: report.reloaded,
      premadeNonce: report.premadeNonce ?? null, fingerprint, status: "PROVISIONAL" } });
    recent++; result.recorded++;
    if (report.premadeNonce) {
      // An explicit per-match premade nonce is a correlation hint, never a verified
      // game ID. Require independent characters plus compatible observations.
      const candidates = await tx.battlegroundReport.findMany({ where: { guildId, premadeNonce: report.premadeNonce,
        status: { not: "WITHDRAWN" }, member: { guildId, status: "ACTIVE", battlegroundConsent: { is: { guildId, capture: true } } } },
        include: { member: { select: { battlegroundConsent: { select: { consentedAt: true } } } } }, take: 101 });
      const peers = candidates.filter(p => p.member.battlegroundConsent && p.endedAt >= p.member.battlegroundConsent.consentedAt);
      const compatible = candidates.length <= 100 && peers.every(p => p.status !== "CONFLICT"
        && p.gameEdition === report.edition && p.mapId === report.mapId && p.mode === report.mode
        && p.bracket === report.bracket && p.outcome === report.outcome
        && Math.abs(p.endedAt.getTime() / 1000 - report.endedAt) <= 5
        && Math.abs(p.durationSeconds - report.durationSeconds) <= 5)
        && new Set(peers.map(p => p.characterId)).size === peers.length
        && new Set(peers.map(p => p.memberId)).size === peers.length;
      if (!compatible) {
        await tx.battlegroundReport.updateMany({ where: { guildId, premadeNonce: report.premadeNonce, status: { not: "WITHDRAWN" } },
          data: { status: "CONFLICT", corroborated: false, conflictSummary: "Premade reports disagree or repeat a reporter; no verified match association." } });
        result.conflicts++;
      } else if (peers.length > 1 && peers.every(p => p.presence === "complete" && !p.reloaded && p.outcome !== "unknown" && p.durationSeconds > 0)) {
        await tx.battlegroundReport.updateMany({ where: { id: { in: peers.map(p => p.id) } }, data: { corroborated: true } });
      }
    }
  }
  result.rejected += Math.max(0, rows.length - 100);
  return result;
}

export async function battlegroundHistory(db: PrismaClient, guildId: string, memberId: string, reportId?: string) {
  await requireMember(db, guildId, memberId);
  return db.battlegroundReport.findMany({ where: { guildId, memberId,
    ...(reportId ? { OR: [{ id: reportId }, { reportId }] } : {}) },
    orderBy: [{ endedAt: "desc" }, { id: "desc" }], take: reportId ? 1 : 25,
    select: { id: true, reportId: true, gameEdition: true, mode: true, mapId: true, bracket: true,
      endedAt: true, outcome: true, presence: true, reloaded: true, status: true, corroborated: true, conflictSummary: true, correctionReason: true } });
}

export async function correctBattlegroundReport(db: PrismaClient, guildId: string, memberId: string, reportId: string, reason: string) {
  const note = reason.trim();
  if (note.length < 3 || note.length > 200) throw new Error("Correction reason: 3–200 characters / Motif : 3–200 caractères.");
  return db.$transaction(async tx => {
    await lock(tx, guildId); await requireMember(tx, guildId, memberId);
    const report = await tx.battlegroundReport.findFirst({ where: { guildId, memberId, OR: [{ id: reportId }, { reportId }] } });
    if (!report) throw new Error("Your report was not found / Votre rapport est introuvable.");
    if (report.premadeNonce) await tx.battlegroundReport.updateMany({ where: { guildId, premadeNonce: report.premadeNonce }, data: { corroborated: false } });
    return tx.battlegroundReport.update({ where: { id: report.id }, data: { status: "WITHDRAWN", correctedAt: new Date(), correctionReason: note, corroborated: false } });
  });
}

export async function battlegroundStats(db: PrismaClient, guildId: string,
  scope: { edition: string; mode?: string; bracket?: string; startsAt: Date; endsAt: Date }) {
  const guild = await db.guild.findUniqueOrThrow({ where: { id: guildId }, select: { gameEdition: true } });
  if (!scope.mode || !scope.bracket || guild.gameEdition !== scope.edition || !Number.isFinite(scope.startsAt.getTime()) || !Number.isFinite(scope.endsAt.getTime())
    || scope.endsAt <= scope.startsAt) throw new Error("Invalid guild season scope / Période de guilde invalide.");
  const where = { guildId, gameEdition: scope.edition, ...(scope.mode ? { mode: scope.mode } : {}),
    ...(scope.bracket ? { bracket: scope.bracket } : {}), endedAt: { gte: scope.startsAt, lt: scope.endsAt },
    member: { guildId, status: "ACTIVE" as const, battlegroundConsent: { is: { guildId, capture: true, guildStats: true } } } };
  const groups = await db.battlegroundReport.groupBy({ by: ["outcome"], where: { ...where, status: "PROVISIONAL" }, _count: { _all: true } });
  const count = (outcome: string) => groups.find(row => row.outcome === outcome)?._count._all ?? 0;
  const wins = count("win"), losses = count("loss"), draws = count("draw"), unknownOutcomes = count("unknown");
  const knownOutcomes = wins + losses + draws, participations = knownOutcomes + unknownOutcomes;
  // These count consenting player reports, not unique games or competitive rating.
  // Corroboration does not turn an unaccepted adapter into verified game evidence.
  return { matches: 0, verifiedMatches: null, participations, wins, losses, draws, unknownOutcomes, knownOutcomes,
    winRate: knownOutcomes ? wins / knownOutcomes : null, provisionalReports: participations };
}
