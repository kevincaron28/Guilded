import { characterId, characterScores, periodRules, rateRun, type PublicPeriod, type ScorePlayer, type ScoreRun } from "./public-score.js";
import { routeTargetAt } from "./dungeon-november-rules.js";
import { snapshotGuidance } from "./dungeon-snapshot-guidance.js";
import type { DungeonRatingDetail } from "./dungeon-rating.js";
import { currentEdition } from "./edition-context.js";
import { dungeonRole } from "../../companion/dungeon-role.mjs";
import { integrityRole, UPLOAD_GRACE_MS } from "./dungeon-integrity.js";

/** Personal public scores only. Never include guild standings or claim a global rank. */
export function publicAddonBoard(runs: ScoreRun[], me: Pick<ScorePlayer, "character" | "realm">, periods: PublicPeriod[], now = new Date()) {
  const mine = (p: ScorePlayer) => characterId(p) === characterId(me);
  const levels = runs.flatMap(r => r.players.filter(mine).flatMap(p => p.level === null ? [] : [p.level]));
  const level = levels.length ? Math.max(...levels) : undefined;
  const seasons = periods.slice(0, 11).map(period => {
    const rules = periodRules(period);
    const active = (!period.from || period.from <= now) && (!period.to || now < period.to);
    const history = runs.filter(r => (!period.from || r.endedAt >= period.from) && (!period.to || r.endedAt < period.to));
    const profile = (bracket: string, role?: string) => {
      const row = characterScores(history, rules, p => mine(p) && (!role || (rules.evidencePolicy === "current-v2" ? integrityRole(p.integrity) : dungeonRole(p.role)) === dungeonRole(role))).find(r => r.bracket === bracket);
      const details: DungeonRatingDetail[] = (row?.routes ?? []).map(r => ({ dungeonKey: r.key, instanceId: r.run.instanceId,
        name: rules.routes.find(route => route.dungeonKey === r.key)!.name, points: r.points, durationSec: r.run.durationSec,
        targetSec: routeTargetAt(rules, r.key, r.run.endedAt) ?? null, speedBonus: 0, counted: r.counted,
        penaltyPercent: rateRun(r.run, rules).score!.penaltyPercent, runRef: r.run.runId, ratingVersion: 6 }));
      const result = { name: me.character, bracket, points: row?.points ?? 0, details, ...(level === undefined ? {} : { level }) };
      return { ...result, guidance: active ? snapshotGuidance(result, rules, now) : null };
    };
    const profiles = rules.brackets.map(b => ({ ...profile(b.key), roles: ["TANK", "HEALER", "DAMAGER"].map(role => ({ ...profile(b.key, role), role })) }));
    return { id: `public:${period.id}`, season: `Public · ${period.label}`, status: active ? "ACTIVE" : rules.evidencePolicy === "current-v2" && period.to && now.getTime() < period.to.getTime() + UPLOAD_GRACE_MS ? "CLOSING" : "ENDED",
      startsAt: period.from?.toISOString() ?? null, endsAt: period.to?.toISOString() ?? null,
      ratingVersion: 6, detailsAvailable: true, provisionalTargets: rules.provisionalTargets, brackets: rules.brackets,
      catalog: rules.catalog.map(d => ({ ...d, targetSec: routeTargetAt(rules, d.dungeonKey, active ? now : period.to) ?? d.targetSec })),
      profiles, rows: profiles.map(p => ({ name: p.name, points: p.points, bracket: p.bracket })) };
  });
  return seasons.length ? { ...seasons[0]!, gameEdition: currentEdition(), updatedAt: now.toISOString(), character: me.character, realm: me.realm, history: seasons.slice(1) } : null;
}
