import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction, type GuildMember } from "discord.js";
import { prisma } from "../database.js";
import { hasPermission } from "../permissions.js";
import { formatInviteList, markInvitedByName, pendingInvites } from "../services/invite-queue.js";
import { formatOpenInvitePosts, inviteChannelCandidates, openInvitePosts, scanInviteChannel } from "../services/invite-extras.js";
import { markPostsDone } from "../services/invite-channel.js";
import {
  cooldownState, DEFAULT_TEMPLATE, ensureInviteGuide, markRecruitPosted, MAX_COOLDOWN_HOURS, MIN_COOLDOWN_HOURS, parseQuestions,
  STAGE_LABEL, STAGES, storedQuestions, updateRecruit, type Stage
} from "../services/recruiting-kit.js";
import { markGuildChanged } from "../services/standings-feed.js";
import { guildService, requireGuildContext } from "./context.js";

// Mounted as /mod invites (/officer is at Discord's size limit). Private replies. The invite itself is the officer's click in
// game (the addon's To invite panel). Light recruiting kit: stages and notes, interview questions, a post template and cooldown.

export const invitesCommand = new SlashCommandBuilder()
  .setName("invites")
  .setDescription("Invite queue.")
  .addSubcommand((sub) => sub.setName("list").setDescription("Waiting."))
  .addSubcommand((sub) => sub.setName("extra").setDescription("Extra."))
  .addSubcommand((sub) => sub.setName("record").setDescription("Stage, note.")
    .addStringOption((o) => o.setName("name").setDescription("First Last").setRequired(true).setMaxLength(60))
    .addStringOption((o) => o.setName("stage").setDescription("Stage").addChoices(...STAGES.map((value) => ({ name: STAGE_LABEL[value], value }))))
    .addStringOption((o) => o.setName("note").setDescription("Note").setMaxLength(500)))
  .addSubcommand((sub) => sub.setName("settings").setDescription("Switches.")
    .addBooleanOption((o) => o.setName("queue").setDescription("Queue"))
    .addBooleanOption((o) => o.setName("dm").setDescription("Role DM"))
    .addBooleanOption((o) => o.setName("notify").setDescription("Tag"))
    .addBooleanOption((o) => o.setName("cleanup").setDescription("Tidy"))
    .addRoleOption((o) => o.setName("role").setDescription("WoW role")))
  .addSubcommand((sub) => sub.setName("questions").setDescription("Questions.")
    .addStringOption((o) => o.setName("text").setDescription("Split by |").setMaxLength(800)))
  .addSubcommand((sub) => sub.setName("post").setDescription("Recruit post.")
    .addStringOption((o) => o.setName("text").setDescription("Template").setMaxLength(1500))
    .addIntegerOption((o) => o.setName("hours").setDescription("Hours").setMinValue(MIN_COOLDOWN_HOURS).setMaxValue(MAX_COOLDOWN_HOURS))
    .addBooleanOption((o) => o.setName("posted").setDescription("Posted now")));

const stageOf = (value: string): Stage => (STAGES as readonly string[]).includes(value) ? value as Stage : "PENDING";

export async function executeInvites(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = await requireGuildContext(interaction);
  if (!context) return;
  const reply = (content: string) => interaction.reply({ content: content.slice(0, 1990), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  if (!interaction.member || !hasPermission(interaction.member as GuildMember, "officer") || !interaction.guild) { await reply("Only officers can use the invite queue."); return; }
  const guildId = context.guildId;
  const settings = await guildService.getSettings(guildId);
  const sub = interaction.options.getSubcommand();
  const o = interaction.options;

  if (sub === "list") {
    const rows = await pendingInvites(prisma, guildId);
    const where = settings?.inviteChannelId ? `\nPosts go in <#${settings.inviteChannelId}>. In game: \`/guilded invites\`.` : "\nNo invite channel yet: press Create missing channels in `/setup`.";
    await reply(formatInviteList(rows, interaction.guild.id) + where);
    return;
  }
  if (sub === "extra") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const extras = inviteChannelCandidates(interaction.guild).filter((candidate) => candidate.id !== settings?.inviteChannelId);
    if (!extras.length) { await interaction.editReply("There is no extra invite channel: only one exists."); return; }
    const parts: string[] = [];
    for (const extra of extras) parts.push(formatOpenInvitePosts(openInvitePosts(await scanInviteChannel(interaction.guild, extra.id)), extra.id, settings?.inviteChannelId ?? null));
    await interaction.editReply({ content: parts.join("\n\n").slice(0, 1990), allowedMentions: { parse: [] } });
    return;
  }
  if (sub === "record") {
    const name = o.getString("name", true);
    const stage = o.getString("stage");
    const noteInput = o.getString("note");
    if (!stage && noteInput === null) { await reply("Pick a stage or write a note."); return; }
    let changed = 0;
    if (stage === "INVITED") {
      const rows = await markInvitedByName(prisma, guildId, [name], interaction.user.id);
      changed = rows.length;
      await markPostsDone(interaction.client, rows, "en", prisma);
    }
    if ((stage && stage !== "INVITED") || noteInput !== null) {
      changed = Math.max(changed, await updateRecruit(prisma, guildId, name, { ...(stage && stage !== "INVITED" ? { stage: stageOf(stage) } : {}), ...(noteInput !== null ? { note: noteInput === "-" ? null : noteInput } : {}) }));
    }
    if (changed) markGuildChanged(guildId);
    await reply(changed ? `Updated **${name}**${stage ? ` → ${STAGE_LABEL[stageOf(stage)]}` : ""}${noteInput !== null ? " (note saved)" : ""}.` : "Nobody under that name.");
    return;
  }
  if (sub === "questions") {
    const text = o.getString("text");
    if (text !== null) {
      const questions = text.trim() === "-" ? [] : parseQuestions(text);
      await prisma.guildSettings.upsert({ where: { guildId }, create: { guildId, inviteQuestions: questions }, update: { inviteQuestions: questions } });
      const posted = await ensureInviteGuide(interaction.client, prisma, guildId).catch(() => null);
      await reply(`${questions.length ? `${questions.length} question${questions.length > 1 ? "s" : ""} saved.` : "Questions cleared."} They go in the role DM${posted ? " and the pinned message in the invite channel" : ""}. Answers are the lines under a name and are saved on the record.`);
      return;
    }
    const questions = storedQuestions(settings?.inviteQuestions);
    await reply(questions.length ? questions.map((q, i) => `${i + 1}. ${q}`).join("\n") : "No questions yet. Set them with `text:` (split by |).");
    return;
  }
  if (sub === "post") {
    const text = o.getString("text");
    const hours = o.getInteger("hours");
    const data = { ...(text !== null ? { recruitPostTemplate: text } : {}), ...(hours !== null ? { recruitCooldownHours: hours } : {}) };
    if (Object.keys(data).length) await prisma.guildSettings.upsert({ where: { guildId }, create: { guildId, ...data }, update: data });
    const fresh = { ...settings, ...data };
    let note = "";
    if (o.getBoolean("posted")) {
      const result = await markRecruitPosted(prisma, guildId, interaction.user.id);
      note = result.ok ? "\n✅ Cooldown started. I will remind the officer log when it is over."
        : `\n⏳ Already posted by <@${result.state.by}>. Next post <t:${Math.floor(result.state.until!.getTime() / 1000)}:R>. Not recorded.`;
    }
    const latest = await guildService.getSettings(guildId);
    const state = latest ? cooldownState({ recruitLastPostAt: latest.recruitLastPostAt, recruitLastPostBy: latest.recruitLastPostBy, recruitCooldownHours: latest.recruitCooldownHours }) : { cooling: false, until: null, by: null };
    await reply(`**Recruiting post** (${fresh.recruitCooldownHours ?? 72} h shared cooldown):\n${fresh.recruitPostTemplate ?? DEFAULT_TEMPLATE}\n\n${state.cooling ? `⏳ Posted by <@${state.by}>; free again <t:${Math.floor(state.until!.getTime() / 1000)}:R>.` : "✅ No cooldown: you can post now, then run this with `posted:true`."}${note}`);
    return;
  }
  const data = {
    ...(o.getBoolean("queue") !== null ? { inviteQueueEnabled: o.getBoolean("queue")! } : {}),
    ...(o.getBoolean("dm") !== null ? { inviteDmEnabled: o.getBoolean("dm")! } : {}),
    ...(o.getBoolean("notify") !== null ? { inviteNotifyEnabled: o.getBoolean("notify")! } : {}),
    ...(o.getBoolean("cleanup") !== null ? { inviteCleanupEnabled: o.getBoolean("cleanup")! } : {}),
    ...(o.getRole("role") ? { inviteWowRoleId: o.getRole("role")!.id } : {})
  };
  if (Object.keys(data).length) await prisma.guildSettings.upsert({ where: { guildId }, create: { guildId, ...data }, update: data });
  const merged = { ...settings, ...data };
  const on = (value: boolean | undefined) => value === false ? "**off**" : "**on**";
  await reply(`Invite queue: ${on(merged.inviteQueueEnabled)}${merged.inviteChannelId ? ` in <#${merged.inviteChannelId}>` : " (no channel yet)"}. WoW-role DM: ${on(merged.inviteDmEnabled)}, tag online officers: ${on(merged.inviteNotifyEnabled)}, tidy the channel an hour after an invite (needs Manage Messages): ${on(merged.inviteCleanupEnabled)}, role: ${merged.inviteWowRoleId ? `<@&${merged.inviteWowRoleId}>` : "the one named like \"World of Warcraft\""}.`);
}
