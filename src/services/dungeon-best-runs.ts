import { EmbedBuilder, escapeMarkdown } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { Lang } from "../i18n.js";
import { difficultyName, type RecordRow } from "./dungeon-stats.js";
import { formatDuration } from "./dungeon-rules.js";
import { canonicalClass, displayCharacterName, loadFullNameBook } from "./character-display.js";
import { bossRecordLines, type BossRecordRow } from "./dungeon-records.js";

export async function seasonBestRuns(database: Pick<PrismaClient, "dungeonRun"> & Partial<Pick<PrismaClient, "character" | "unclaimedCharacter" | "guildRosterEntry" | "publicRunPlayer">>, guildId: string, seasonId: string): Promise<RecordRow[]> {
  const where = { guildId, seasonId, valid: true, state: "COMPLETED", durationSec: { not: null },
    NOT: { runRef: { startsWith: "SIM-" } }, players: { some: { OR: [{ memberId: { not: null } }, { inGuild: true }] } } };
  // Aggregate first so many short clears cannot crowd a longer dungeon out.
  const bests = await database.dungeonRun.groupBy({ by: ["instanceId", "difficultyId"], where, _min: { durationSec: true } });
  const rows = await Promise.all(bests.map(best => database.dungeonRun.findFirst({
    where: { ...where, instanceId: best.instanceId, difficultyId: best.difficultyId, durationSec: best._min.durationSec },
    orderBy: [{ endedAt: "asc" }, { id: "asc" }],
    select: { instanceId: true, dungeonName: true, difficultyId: true, durationSec: true, endedAt: true,
      players: { where: { OR: [{ memberId: { not: null } }, { inGuild: true }] }, select: { character: true, memberId: true, class: true } } }
  })));
  // The whole guild party (linked or not), by full character name: the guild's tables, then the public runs for these
  // very names, then (for a linked player) the member's own character that starts with the stored first name.
  const party = rows.flatMap(row => row?.players ?? []);
  const book = await loadFullNameBook(database, guildId, party.map(player => player.character));
  const memberIds = [...new Set(party.flatMap(player => player.memberId ? [player.memberId] : []))];
  const owned = memberIds.length && database.character
    ? await database.character.findMany({ where: { memberId: { in: memberIds } }, select: { memberId: true, name: true, displayName: true, className: true }, take: 2_000 }).catch(() => [])
    : [];
  // First names still open after the book: the public runs' full names for them, with the class each was seen as.
  const open = [...new Set(party.map(player => player.character.trim()).filter(name => name && !displayCharacterName(name, book).includes(" ")))].slice(0, 500);
  const seen = open.length && database.publicRunPlayer
    ? await database.publicRunPlayer.findMany({ where: { character: { in: open }, displayName: { contains: " " } }, select: { character: true, displayName: true, className: true }, distinct: ["character", "displayName", "className"], take: 2_000 }).catch(() => [])
    : [];
  // One member often has alts sharing a first name ("Crashing Pally", "Crashing Arcane"): the class the run recorded
  // picks the right one. Still more than one, or none: the stored first name stays (never a guess).
  const sameClass = (a: string | null | undefined, b: string | null | undefined) => !a || !b || canonicalClass(a) === canonicalClass(b);
  const unique = (names: string[]) => new Set(names).size === 1 ? names[0]! : undefined;
  const fullName = (player: { character: string; memberId?: string | null; class?: string | null }) => {
    const shown = displayCharacterName(player.character, book);
    if (shown.includes(" ")) return shown;
    const first = `${player.character.trim().toLowerCase()} `;
    const mine = player.memberId ? owned.filter(row => row.memberId === player.memberId).filter(row => displayCharacterName(row, book).toLowerCase().startsWith(first)) : [];
    const fromMember = unique(mine.map(row => displayCharacterName(row, book))) ?? unique(mine.filter(row => sameClass(row.className, player.class)).map(row => displayCharacterName(row, book)));
    if (fromMember) return fromMember;
    const publicNames = seen.filter(row => row.character.toLowerCase() === player.character.trim().toLowerCase() && row.displayName);
    return unique(publicNames.filter(row => sameClass(row.className, player.class)).map(row => row.displayName!)) ?? shown;
  };
  return rows.flatMap(row => row?.durationSec !== null && row ? [{ ...row, durationSec: row.durationSec!, players: row.players.map(fullName) }] : [])
    .sort((a, b) => a.dungeonName.localeCompare(b.dungeonName) || a.difficultyId - b.difficultyId);
}

export function bestRunsEmbed(rows: RecordRow[], lang: Lang, bosses: readonly BossRecordRow[] = []): EmbedBuilder {
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
  const embed = new EmbedBuilder().setColor(0x38bdf8).setTitle(fr ? "⏱️ Les meilleurs parcours" : "⏱️ Fastest dungeon clears")
    .setDescription(lines.join("\n"));
  // 9.1: the guild's fastest kill of each boss, all time, newest records first (the run's pull → kill time).
  const bossLines = bossRecordLines(bosses, 900);
  if (bossLines.length) embed.addFields({ name: fr ? "⚔️ Boss tués le plus vite · depuis toujours" : "⚔️ Fastest boss kills · all time", value: bossLines.join("\n") });
  return embed.setFooter({ text: fr ? "Les points de saison restent un classement distinct. Chronos depuis le premier combat." : "Season points remain a separate ranking. Times start at the first pull." });
}
