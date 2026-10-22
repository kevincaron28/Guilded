import { EmbedBuilder, escapeMarkdown } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { Lang } from "../i18n.js";
import { difficultyName, type RecordRow } from "./dungeon-stats.js";
import { formatDuration } from "./dungeon-rules.js";

export async function seasonBestRuns(database: Pick<PrismaClient, "dungeonRun">, guildId: string, seasonId: string): Promise<RecordRow[]> {
  const where = { guildId, seasonId, valid: true, state: "COMPLETED", durationSec: { not: null },
    NOT: { runRef: { startsWith: "SIM-" } }, players: { some: { memberId: { not: null } } } };
  // Aggregate first so many short clears cannot crowd a longer dungeon out.
  const bests = await database.dungeonRun.groupBy({ by: ["instanceId", "difficultyId"], where, _min: { durationSec: true } });
  const rows = await Promise.all(bests.map(best => database.dungeonRun.findFirst({
    where: { ...where, instanceId: best.instanceId, difficultyId: best.difficultyId, durationSec: best._min.durationSec },
    orderBy: [{ endedAt: "asc" }, { id: "asc" }],
    select: { instanceId: true, dungeonName: true, difficultyId: true, durationSec: true, endedAt: true,
      players: { where: { memberId: { not: null } }, select: { character: true } } }
  })));
  return rows.flatMap(row => row?.durationSec !== null && row ? [{ ...row, durationSec: row.durationSec!, players: row.players.map(player => player.character) }] : [])
    .sort((a, b) => a.dungeonName.localeCompare(b.dungeonName) || a.difficultyId - b.difficultyId);
}

export function bestRunsEmbed(rows: RecordRow[], lang: Lang): EmbedBuilder {
  const fr = lang === "fr";
  const intro = fr ? "**Un meilleur temps par donjon et difficulté · saison actuelle**\nRejouer n’ajoute pas d’entrées : il faut battre le chrono. Les noms affichés sont ceux de la guilde."
    : "**One fastest clear per dungeon and difficulty · current season**\nRepeats add no entries: beat the clock to improve. Only guild members are listed.";
  const lines = [intro];
  let shown = 0;
  for (const row of rows) {
    const difficulty = difficultyName(row.difficultyId);
    const line = `\n🏅 **${escapeMarkdown(row.dungeonName)}**${difficulty ? ` · ${escapeMarkdown(difficulty)}` : ""}\n⏱️ **${formatDuration(row.durationSec)}** · ${row.players.map(name => escapeMarkdown(name)).join(", ")}`;
    if (lines.join("\n").length + line.length > 2600) break;
    lines.push(line); shown++;
  }
  if (!rows.length) lines.push(fr ? "Le premier donjon terminé ouvrira le tableau." : "The first completed dungeon will open the board.");
  if (shown < rows.length) lines.push(fr ? `… ${rows.length - shown} autres records : /dungeon records` : `… ${rows.length - shown} more records: /dungeon records`);
  return new EmbedBuilder().setColor(0x38bdf8).setTitle(fr ? "⏱️ Les meilleurs parcours" : "⏱️ Fastest dungeon clears")
    .setDescription(lines.join("\n")).setFooter({ text: fr ? "Les points de saison restent un classement distinct. Chronos depuis le premier combat." : "Season points remain a separate ranking. Times start at the first pull." });
}
