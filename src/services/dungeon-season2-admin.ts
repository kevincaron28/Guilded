import { EmbedBuilder } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { formatDuration } from "./dungeon-rules.js";
import { observeSeason, type SeasonObservations } from "./dungeon-season-observations.js";
import { season2Proposal, SEASON2_NAME, TARGET_POLICY, type Season2Policy, type Season2Proposal } from "./dungeon-season2.js";
import { withIntegrityWindow } from "./dungeon-integrity.js";
import type { BracketedRules } from "./dungeon-november-rules.js";
import { configureNextSeasonRules, loadOfficialWindows, officialWindowAt, scheduleNextSeason, SeasonCalendarError, type OfficialWindow } from "./official-seasons.js";
import { prismaLeaderboardStore } from "./public-leaderboard.js";
import { publicRules } from "./public-score.js";

// Owner tools around the Season 2 proposal. Read-only except activateSeason2, which only the
// bot owner's /guilded-season season2-activate reaches.

export interface LoadedObservations { window: OfficialWindow; rules: BracketedRules; observations: SeasonObservations }

/** The running season's real runs (all guilds, every accepted public run once) summarised per route. Null before Season 1. */
export async function loadSeasonObservations(database: PrismaClient, now: Date): Promise<LoadedObservations | null> {
  const window = officialWindowAt(await loadOfficialWindows(database), now);
  if (!window) return null;
  const base = window.rules?.rules ?? { ...publicRules(), evidencePolicy: "current-v1" as const };
  const rules = withIntegrityWindow(base, window.start, window.end);
  const runs = await prismaLeaderboardStore(database).runs({ from: window.start, to: window.end });
  return { window, rules, observations: observeSeason(runs, rules, window.start, window.end) };
}

const minutes = (seconds: number | null) => seconds === null ? "—" : formatDuration(seconds);
const bracketLabel = (key: string) => key === "60" ? "Level 60" : `Levels ${key}`;

export function observationsEmbed(loaded: LoadedObservations): EmbedBuilder {
  const { window, observations: o } = loaded;
  const embed = new EmbedBuilder().setColor(0x0ea5e9).setTitle(`Observed completion times · ${window.name}`)
    .setDescription([
      `${o.totalRuns} public runs in this season · ${o.ratedRuns} ranked (${o.penalisedRuns} over-level, not timed) · ${o.v2Runs} would also pass current-v2.`,
      "Observation only: **nothing here changes a score or a target.** The season keeps its frozen rules. `count` is every ranked run; `samples` is one per crew per day, the number Season 2's formula trusts (it needs 20 samples, 5 crews, 3 days to move a target by itself).",
      "Median and the middle 50% of times, against the current target."
    ].join("\n\n"));
  const brackets = [...new Set(o.routes.map(r => r.bracket))];
  for (const bracket of brackets) {
    const rows = o.routes.filter(r => r.bracket === bracket);
    const value = rows.map(r => r.count
      ? `${r.name} · ${r.count} runs / ${r.samples} samples · **${minutes(r.median)}** (${minutes(r.p25)}–${minutes(r.p75)}) · target ${minutes(r.targetSec)}`
      : `${r.name} · no runs yet · target ${minutes(r.targetSec)}`).join("\n");
    embed.addFields({ name: `${bracketLabel(bracket)} · ${rows.length} routes`, value: value.slice(0, 1024) });
  }
  if (o.unrated.length) {
    embed.addFields({ name: "Cleared but not rated in this season", value: o.unrated.slice(0, 10).map(u =>
      `${u.name} (map ${u.instanceId}) · ${u.count} runs · median ${minutes(u.median)}${u.levels ? ` · levels ${u.levels[0]}–${u.levels[1]}` : ""}`).join("\n").slice(0, 1024) });
  }
  return embed.setFooter({ text: `Window ${window.start.toISOString().slice(0, 10)} → ${window.end ? window.end.toISOString().slice(0, 10) : "open"} · docs/DUNGEON_SEASON_2_PLAN.md` });
}

export interface Season2Review { loaded: LoadedObservations; startsAt: Date; proposal: Season2Proposal }
export async function reviewSeason2(database: PrismaClient, startsAt: Date, now: Date, policy: Season2Policy = "current-v2", scoring?: BracketedRules["scoring"], bossScoring?: BracketedRules["bossScoring"] | null): Promise<Season2Review | null> {
  const loaded = await loadSeasonObservations(database, now);
  if (!loaded) return null;
  return { loaded, startsAt, proposal: season2Proposal(loaded.rules, loaded.observations.routes, startsAt, policy, scoring, bossScoring) };
}

export function season2Embed(review: Season2Review): EmbedBuilder {
  const { proposal, loaded, startsAt } = review;
  const c = proposal.counts;
  const embed = new EmbedBuilder().setColor(0x22c55e).setTitle(`${SEASON2_NAME} · proposed targets (not active)`)
    .setDescription([
      `Computed from ${loaded.window.name}'s observed times. Starts **<t:${Math.floor(startsAt.getTime() / 1000)}:f>**; evidence policy **${review.proposal.rules.evidencePolicy}**; levels, brackets, best-N and over-level penalty unchanged.`,
      `${c.measured} measured · ${c.blended} blended · ${c.carried} carried (kept at their ${loaded.window.name} estimate). Each target is within ${TARGET_POLICY.floor}x–${TARGET_POLICY.ceiling}x of the old one and rounded to a minute.`,
      `Readiness for current-v2: **${loaded.observations.v2Runs} of ${loaded.observations.ratedRuns}** ranked runs so far also carry the stricter evidence (observed first-combat start, native boss checkpoint, known presence). If that share is low, hold Season 2 on current-v1 or wait for more addon updates.`,
      "Nothing is scheduled yet. `/guilded-season season2-activate` schedules the season and stores these targets; run it only after reviewing the attached rules."
    ].join("\n\n"));
  for (const bracket of [...new Set(proposal.rows.map(r => r.bracket))]) {
    const rows = proposal.rows.filter(r => r.bracket === bracket);
    embed.addFields({ name: `${bracketLabel(bracket)}`, value: rows.map(r =>
      `${r.name} · ${minutes(r.previousSec)} → **${minutes(r.targetSec)}** · ${r.basis}${r.basis === "carried" ? "" : ` (${r.samples})`}`).join("\n").slice(0, 1024) });
  }
  const o = loaded.observations;
  if (o.unrated.length) embed.addFields({ name: "Not in Season 2 yet (no route)", value: `${o.unrated.slice(0, 8).map(u => `${u.name} (map ${u.instanceId}) ×${u.count}`).join("\n")}\nAdd them with a reviewed rules file before activating: current-v2 seasons cannot gain routes later.`.slice(0, 1024) });
  return embed;
}

/**
 * Schedules Season 2 and stores the computed rules on it. Recomputes from the runs known now. With
 * `keepRules`, rules the owner already uploaded for the pending season are left alone.
 */
export async function activateSeason2(database: PrismaClient, input: { startsAt: Date; name: string; actorId: string; keepRules: boolean; policy?: Season2Policy; scoring?: BracketedRules["scoring"]; bossScoring?: BracketedRules["bossScoring"] | null }, now: Date): Promise<{ name: string; routes: number | null; replaced: boolean }> {
  const review = await reviewSeason2(database, input.startsAt, now, input.policy, input.scoring, input.bossScoring);
  if (!review) throw new SeasonCalendarError("Season 1 has not started: nothing to compute from.");
  const windows = await loadOfficialWindows(database);
  const pending = windows.find(w => w.start > now);
  const season = await scheduleNextSeason(database, { name: input.name, startsAt: input.startsAt, actorId: input.actorId }, now);
  if (input.keepRules && pending?.rules) return { name: season.name, routes: null, replaced: false };
  const routes = await configureNextSeasonRules(database, review.proposal.rules, now);
  return { name: season.name, routes, replaced: !!pending?.rules };
}
