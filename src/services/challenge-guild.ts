import { EmbedBuilder, escapeMarkdown } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { Lang } from "../i18n.js";
import { characterReference } from "../../companion/character-identity.mjs";
import { rankChallenges, challengeClock, type ChallengeRun } from "./challenge-leaderboard.js";
import { currentEdition } from "./edition-context.js";
import { challengeScores } from "./challenge-rating.js";
import { validBracketedRules } from "./dungeon-november-rules.js";

export async function guildChallengeBoard(database: PrismaClient, guildId: string, lang: Lang): Promise<EmbedBuilder> {
  const fr = lang === "fr";
  if (currentEdition() !== "retail") throw new Error(fr ? "Choisissez une guilde Retail avec /wow use." : "Select a Retail guild with /wow use.");
  const season = await database.dungeonSeason.findFirst({ where: { guildId, status: "ACTIVE" }, orderBy: { startsAt: "desc" } });
  const runs: ChallengeRun[] = [];
  let cursor: string | undefined;
  if (season) for (;;) {
    const rows = await database.dungeonRun.findMany({ where: { guildId, seasonId: season.id, state: "COMPLETED", valid: true,
      difficultyId: 8, completedBy: "challenge objectives", NOT: { runRef: { startsWith: "SIM-" } },
      startedAt: { gte: season.startsAt }, ...(season.endsAt ? { endedAt: { lt: season.endsAt } } : {}) },
      orderBy: { id: "asc" }, take: 500, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, runRef: true, instanceId: true, difficultyId: true, dungeonName: true, durationSec: true,
        endedAt: true, completedBy: true, competitionData: true,
        players: { where: { member: { guildId } }, select: { character: true, presentSec: true } } } });
    for (const row of rows) if (row.endedAt && row.durationSec) runs.push({ ...row, gameEdition: "retail", runId: row.runRef,
      durationSec: row.durationSec, endedAt: row.endedAt, challenge: (row.competitionData as { challenge?: unknown } | null)?.challenge,
      evidence: { completedBy: row.completedBy }, players: row.players.map(p => ({ ...p, ...characterReference(p.character, "", "retail") })) });
    if (rows.length < 500) break;
    cursor = rows[rows.length - 1]!.id;
  }
  const ranks = rankChallenges(runs);
  const rating = season && validBracketedRules(season.ratingRules) ? season.ratingRules.keystoneRating : undefined;
  const scores = challengeScores(runs, rating);
  const groups = [...new Set(ranks.map(r => r.group))];
  const embed = new EmbedBuilder().setColor(0x8b5cf6).setTitle(`Mythic+ · ${season?.name ?? (fr ? "Aucune saison" : "No season")}`.slice(0, 256))
    .setDescription(fr
      ? "Plus haute clé terminée à temps, puis chrono officiel. Classements séparés par donjon et affixes; présence ≥ 80 %. Les essais d'entraînement, hors délai ou sans résultat natif sont exclus."
      : "Highest key finished in time, then the official timer. Separate rankings per dungeon and affix set; ≥80% presence. Practice, overtime and missing native results are excluded.");
  if (scores.length) embed.addFields({name: fr ? "Cote Guilded provisoire" : "Provisional Guilded rating", value:
    scores.slice(0,5).map((r,i) => `${i+1}. **${escapeMarkdown(r.character)}-${escapeMarkdown(r.realm)}** · ${r.points.toFixed(1)} · ${r.completed}/${rating!.dungeons.length}`).join("\n").slice(0,800) });
  for (const group of groups.slice(0, scores.length ? 8 : 10)) {
    const rows = ranks.filter(r => r.group === group);
    const first = rows[0]!;
    embed.addFields({ name: `${first.run.dungeonName} · affixes ${first.challenge.affixIds.join(", ") || "—"}`.slice(0, 100),
      value: rows.slice(0, 5).map((r, i) => `${i + 1}. **${escapeMarkdown(r.player.character)}-${escapeMarkdown(r.player.realm)}** · +${r.challenge.level} · ${challengeClock(r.challenge.durationMs)}`).join("\n").slice(0, 420) });
  }
  if (!ranks.length) embed.addFields({ name: fr ? "Résultats" : "Results", value: fr ? "Aucune clé admissible importée dans cette saison." : "No eligible key imported in this season." });
  embed.setFooter({ text: fr ? `${groups.length} groupes · 5 personnages par groupe, 10 groupes affichés · Rapports communautaires`
    : `${groups.length} groups · 5 characters per group, ${scores.length ? 8 : 10} groups shown · Community reports` });
  return embed;
}
