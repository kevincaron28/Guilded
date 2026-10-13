import { EmbedBuilder, escapeMarkdown } from "discord.js";
import type { PrismaClient } from "@prisma/client";
import type { Lang } from "../i18n.js";

// Immutable rules per season. Difficulty/alt changes never open another slot.
export const DUNGEON_RATING_RULES = { version: 1, model: "distinct-dungeons", pointsPerDungeon: 100,
  speedBonus: 0, minimumPresence: 0.8, automaticCompletionOnly: true } as const;
export function hasDungeonRating(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const rule = value as Record<string, unknown>;
  return rule["version"] === 1 && rule["model"] === "distinct-dungeons" && rule["pointsPerDungeon"] === 100
    && rule["speedBonus"] === 0 && rule["minimumPresence"] === 0.8 && rule["automaticCompletionOnly"] === true;
}
export interface RatingRow { memberId: string; name: string; points: number; dungeons: number }
export interface RatingRun {
  instanceId: number; durationSec: number | null;
  players: { memberId: string | null; presentSec: number; member: { displayName: string } | null }[];
}
export function calculateDungeonRating(runs: RatingRun[]): RatingRow[] {
  const members = new Map<string, { name: string; dungeons: Set<number> }>();
  for (const run of runs) {
    if (!run.durationSec || !Number.isFinite(run.durationSec) || run.durationSec <= 0) continue;
    for (const player of run.players) {
      if (!player.memberId || !player.member || !Number.isFinite(player.presentSec) || player.presentSec < run.durationSec * DUNGEON_RATING_RULES.minimumPresence) continue;
      const member = members.get(player.memberId) ?? { name: player.member.displayName, dungeons: new Set<number>() };
      member.dungeons.add(run.instanceId);
      members.set(player.memberId, member);
    }
  }
  return [...members].map(([memberId, member]) => ({ memberId, name: member.name,
    points: member.dungeons.size * 100, dungeons: member.dungeons.size }))
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name) || a.memberId.localeCompare(b.memberId));
}
export function frozenRating(value: unknown): RatingRow[] | null {
  if (!Array.isArray(value) || value.some(row => !row || typeof row.memberId !== "string" || typeof row.name !== "string"
    || !Number.isInteger(row.points) || row.points < 0 || !Number.isInteger(row.dungeons) || row.dungeons < 0 || row.points !== row.dungeons * 100)) return null;
  return value as RatingRow[];
}
export async function dungeonRating(database: Pick<PrismaClient, "dungeonRun">, guildId: string,
  season: { id: string; startsAt: Date; endsAt?: Date | null; status: string; ratingRules?: unknown; finalRating?: unknown }, instanceId: number | null = null): Promise<RatingRow[]> {
  if (!hasDungeonRating(season.ratingRules)) return [];
  if (season.status === "ENDED") {
    if (instanceId !== null) throw new Error("Archived ratings only support the frozen overall standings.");
    return frozenRating(season.finalRating) ?? [];
  }
  const runs = await database.dungeonRun.findMany({ where: {
    guildId, seasonId: season.id, valid: true, state: "COMPLETED", completedBy: "final boss",
    durationSec: { gt: 0 }, NOT: { runRef: { startsWith: "SIM-" } },
    startedAt: { gte: season.startsAt }, ...(season.endsAt ? { endedAt: { lt: season.endsAt } } : {}),
    ...(instanceId !== null ? { instanceId } : {})
  }, select: { instanceId: true, durationSec: true, players: {
    where: { member: { guildId } }, select: { memberId: true, presentSec: true, member: { select: { displayName: true } } }
  } } });
  return calculateDungeonRating(runs);
}
export function ratingEmbed(rows: RatingRow[], seasonName: string, lang: Lang): EmbedBuilder {
  const fr = lang === "fr";
  const lines = [fr ? "**100 par donjon distinct · aucun bonus de vitesse**" : "**100 per distinct dungeon · no speed bonus**",
    fr ? "Alts, difficultés et répétitions partagent le même résultat. Les égalités partagent le rang."
      : "Alts, difficulties and repeat clears share one result. Equal ratings share a rank."];
  for (const row of rows.slice(0, 10)) {
    const rank = rows.findIndex(other => other.points === row.points) + 1;
    lines.push(`${rank === 1 ? "🏅" : `${rank}.`} **${escapeMarkdown(row.name).slice(0, 100)}** · **${row.points}** · ${row.dungeons} ${fr ? "donjon(s)" : "dungeon(s)"}`);
  }
  if (!rows.length) lines.push(fr ? "Le premier nouveau donjon admissible rapporte 100." : "Your first eligible new dungeon earns 100.");
  return new EmbedBuilder().setColor(0x8b5cf6).setTitle(`${fr ? "🏅 Exploration" : "🏅 Exploration rating"} · ${seasonName}`.slice(0, 256))
    .setDescription(lines.join("\n\n"))
    .setFooter({ text: fr ? "Boss final détecté + présence ≥ 80 %. Points de participation et chronos séparés." : "Detected final boss + ≥80% presence. Participation points and speed records are separate." });
}
