import { MessageFlags, type ButtonInteraction } from "discord.js";
import { prisma } from "../database.js";
import { teamLanguage } from "../services/activity-core-discord.js";
import { DUNGEON_TIMELINE_PREFIX } from "../services/dungeon-announce.js";
import type { DungeonImportResult } from "../services/dungeon-import.js";
import { dungeonTimeline } from "../services/dungeon-timeline.js";
import { requireGuildContext } from "./context.js";

/** The Chronologie button under a dungeon post: the boss chronology, shown only to the person who asked. */
export async function handleDungeonTimeline(i: ButtonInteraction): Promise<void> {
  const ctx = await requireGuildContext(i);
  if (!ctx) return;
  const lang = (await teamLanguage(prisma, ctx.guildId)) ? "fr" : "en";
  const reply = (content: string) => i.reply({ content, flags: MessageFlags.Ephemeral });
  const run = await prisma.dungeonRun.findFirst({ where: { id: i.customId.slice(DUNGEON_TIMELINE_PREFIX.length), guildId: ctx.guildId, valid: true },
    select: { dungeonName: true, startedAt: true, endedAt: true, competitionData: true } });
  const data = run?.competitionData as { encounters?: DungeonImportResult["encounters"] } | null | undefined;
  const timeline = run && run.startedAt && run.endedAt ? dungeonTimeline({
    startedAt: Math.floor(run.startedAt.getTime() / 1000), endedAt: Math.floor(run.endedAt.getTime() / 1000), encounters: data?.encounters
  } as DungeonImportResult, lang) : null;
  if (!run || !timeline) {
    await reply(lang === "fr" ? "Aucune chronologie n'est disponible pour ce donjon." : "No timeline is available for this dungeon run.");
    return;
  }
  await reply(`**⏱️ ${lang === "fr" ? "Chronologie" : "Timeline"} · ${run.dungeonName}**\n${timeline}`.slice(0, 1990));
}
