import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, escapeMarkdown, MessageFlags,
  type ButtonInteraction, type Client
} from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { asLang, t, type Lang } from "../i18n.js";
import { postToLogChannel } from "./housekeeping.js";
import { isHoldingMember, LINK_EVIDENCE, undoMove, type LinkEvidence } from "./character-move.js";

// Linking audit T3: what members and officers hear when two members claim one character
// (character-move.ts writes CharacterLinkConflict rows; this file announces each one once).
//   MOVED   both members get a DM with an undo button, the officer log one line
//   OPEN    equal proof: the claimant gets a DM, the officer log one line (the officer queue)
//   WEAKER  the claimant gets a DM, once
// Closed DMs are skipped silently. The undo button carries only the conflict id, so it works in a DM.

export const LINK_MOVE_PREFIX = "linkmove:";
const UNDO = `${LINK_MOVE_PREFIX}undo:`;

type Messenger = Pick<Client, "users" | "guilds">;

const proofText = (lang: Lang, evidence: string) => t(lang, `linkmove.proof.${LINK_EVIDENCE.includes(evidence as LinkEvidence) ? evidence as LinkEvidence : "named"}`);

function undoRow(lang: Lang, conflictId: string, mine: boolean): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${UNDO}${conflictId}`).setLabel(t(lang, mine ? "linkmove.mine" : "linkmove.notMine")).setStyle(ButtonStyle.Secondary));
}

/** Announces every conflict of this server nobody was told about yet. Never throws; returns how many it announced. */
export async function tellLinkConflicts(client: Messenger | null | undefined, database: PrismaClient, guild: { id: string; discordId: string }, lang: Lang): Promise<number> {
  if (!client) return 0;
  try {
    const rows = await database.characterLinkConflict.findMany({
      where: { guildId: guild.id, notifiedAt: null, status: { in: ["MOVED", "OPEN", "WEAKER"] } },
      include: { character: { select: { name: true, displayName: true } } }, orderBy: { createdAt: "asc" }, take: 25
    });
    if (!rows.length) return 0;
    // Marked before sending, so a closed DM or a crash never makes it repeat.
    await database.characterLinkConflict.updateMany({ where: { id: { in: rows.map((row) => row.id) } }, data: { notifiedAt: new Date() } });
    const members = await database.member.findMany({ where: { id: { in: [...new Set(rows.flatMap((row) => [row.ownerMemberId, row.claimantMemberId]))] } }, select: { id: true, discordUserId: true } });
    const userOf = (memberId: string) => { const member = members.find((row) => row.id === memberId); return member && !isHoldingMember(member) ? member.discordUserId : null; };
    const discordGuild = await client.guilds.fetch(guild.discordId).catch(() => null);
    const server = escapeMarkdown(discordGuild?.name ?? "Discord");
    const send = (discordUserId: string | null, content: string, components: ActionRowBuilder<ButtonBuilder>[] = []) => discordUserId
      ? client.users.send(discordUserId, { content, components, allowedMentions: { parse: [] } }).catch(() => undefined) : undefined;
    const log: string[] = [];
    for (const row of rows) {
      const name = escapeMarkdown(row.character.displayName ?? row.character.name);
      const owner = userOf(row.ownerMemberId), claimant = userOf(row.claimantMemberId);
      const vars = { name, server, proof: proofText(lang, row.claimantEvidence), other: proofText(lang, row.ownerEvidence) };
      if (row.status === "MOVED") {
        await send(claimant, t(lang, "linkmove.gained", vars), [undoRow(lang, row.id, false)]);
        await send(owner, t(lang, "linkmove.lost", vars), [undoRow(lang, row.id, true)]);
        if (owner && claimant) log.push(t(lang, "linkmove.logMoved", { ...vars, from: owner, to: claimant }));
      } else if (row.status === "OPEN") {
        await send(claimant, t(lang, "linkmove.queued", vars));
        if (owner && claimant) log.push(t(lang, "linkmove.logQueued", { ...vars, from: owner, to: claimant }));
      } else await send(claimant, t(lang, "linkmove.weaker", vars));
    }
    if (discordGuild && log.length) await postToLogChannel(discordGuild, log.join("\n").slice(0, 1900)).catch(() => undefined);
    return rows.length;
  } catch (error) {
    console.warn("Telling link conflicts failed", error);
    return 0;
  }
}

/** The undo button under a move DM. */
export async function handleLinkMoveButton(interaction: ButtonInteraction, database: PrismaClient): Promise<void> {
  if (!interaction.customId.startsWith(UNDO)) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const outcome = await undoMove(database, interaction.customId.slice(UNDO.length), interaction.user.id);
  if (!("guildId" in outcome)) {
    const lang = asLang(interaction.locale?.startsWith("fr") ? "fr" : "en");
    await interaction.editReply({ content: t(lang, "linkmove.tooLate") });
    return;
  }
  const guild = await database.guild.findUnique({ where: { id: outcome.guildId }, select: { discordId: true, settings: { select: { language: true } } } });
  const lang = asLang(guild?.settings?.language);
  const name = escapeMarkdown(outcome.characterName);
  await interaction.editReply({ content: t(lang, outcome.status === "undone" ? "linkmove.undone" : "linkmove.contested", { name }) });
  // The button did its work: take it off the message so it is not pressed twice.
  await interaction.message.edit({ components: [] }).catch(() => undefined);
  const members = await database.member.findMany({ where: { id: { in: [outcome.ownerMemberId, outcome.claimantMemberId] } }, select: { id: true, discordUserId: true } });
  const from = members.find((member) => member.id === outcome.ownerMemberId)?.discordUserId;
  const to = members.find((member) => member.id === outcome.claimantMemberId)?.discordUserId;
  const discordGuild = guild ? await interaction.client.guilds.fetch(guild.discordId).catch(() => null) : null;
  if (discordGuild && from && to) {
    await postToLogChannel(discordGuild, t(lang, outcome.status === "undone" ? "linkmove.logUndone" : "linkmove.logContested", { name, from, to })).catch(() => undefined);
  }
}
