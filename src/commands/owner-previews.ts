import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, type ButtonInteraction, type ChatInputCommandInteraction, type TextBasedChannel } from "discord.js";
import { config } from "../config.js";
import { prisma } from "../database.js";
import { parseWebhookUrl } from "../services/item-preview-webhook.js";
import { sealSecret } from "../services/secret-box.js";
import { enableAfterStepZero, parseStepZeroButton, runStepZero, stepZeroButtons, type BotWebhook } from "../services/item-preview-step0.js";
import { botOwnerId } from "./owner-season.js";

// /guilded-previews: the bot owner switches Discord-only item previews on or off for a server
// (docs/ITEM_PREVIEWS.md). Home server only, like /guilded-season. Off by default everywhere.
export const OWNER_PREVIEWS_COMMAND = "guilded-previews";

export const ownerPreviewsCommand = new SlashCommandBuilder()
  .setName(OWNER_PREVIEWS_COMMAND)
  .setDescription("Bot owner: Discord-only item previews for a linked WoW chat channel")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand(sub => sub.setName("test").setDescription("Step 0: test embed through a temporary webhook, then turn previews on if it passes")
    .addChannelOption(o => o.setName("channel").setDescription("The Blizzard-linked guild chat channel").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true)))
  .addSubcommand(sub => sub.setName("enable").setDescription("Turn previews on with a webhook you created for the channel")
    .addChannelOption(o => o.setName("channel").setDescription("The linked chat channel to watch").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
    .addStringOption(o => o.setName("webhook_url").setDescription("Webhook URL of that channel (stored encrypted)").setRequired(true))
    .addStringOption(o => o.setName("server_id").setDescription("Server id (default: this server)")))
  .addSubcommand(sub => sub.setName("disable").setDescription("Turn previews off (keeps the stored webhook)")
    .addStringOption(o => o.setName("server_id").setDescription("Server id (default: this server)")))
  .addSubcommand(sub => sub.setName("delete").setDescription("Turn previews off and erase the stored webhook")
    .addStringOption(o => o.setName("server_id").setDescription("Server id (default: this server)")))
  .addSubcommand(sub => sub.setName("status").setDescription("Show whether previews are on")
    .addStringOption(o => o.setName("server_id").setDescription("Server id (default: this server)")));

export async function executeOwnerPreviews(interaction: ChatInputCommandInteraction): Promise<void> {
  const reply = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
  if (interaction.user.id !== await botOwnerId(interaction.client)) { await reply("Only the Guilded bot's owner can change item previews."); return; }
  const sub = interaction.options.getSubcommand();
  if (sub === "test") { await runTest(interaction); return; }
  const guildId = interaction.options.getString("server_id")?.trim() || interaction.guildId;
  if (!guildId || !/^\d{15,25}$/.test(guildId)) { await reply("Give a valid server id."); return; }

  if (sub === "enable") {
    if (!config.ITEM_PREVIEW_SECRET) { await reply("Set ITEM_PREVIEW_SECRET (32+ random characters) in the bot's environment first; the webhook is stored encrypted with it."); return; }
    if (!config.MESSAGE_CONTENT_INTENT) { await reply("Previews need MESSAGE_CONTENT_INTENT=true and the Message Content switch in the Developer Portal."); return; }
    const parts = parseWebhookUrl(interaction.options.getString("webhook_url", true));
    if (!parts) { await reply("That does not look like a Discord webhook URL."); return; }
    const channel = interaction.options.getChannel("channel", true);
    const data = { channelId: channel.id, webhookId: parts.id, webhookSealed: sealSecret(config.ITEM_PREVIEW_SECRET, interaction.options.getString("webhook_url", true).trim()), enabled: true, disabledReason: null, createdBy: interaction.user.id };
    await prisma.itemPreviewConfig.upsert({ where: { discordGuildId: guildId }, create: { discordGuildId: guildId, ...data }, update: data });
    await reply(`Item previews are on for <#${channel.id}>. Run the two live tests in docs/ITEM_PREVIEWS.md before relying on it. Delete the message containing the webhook URL from your Discord client history if you can.`);
    return;
  }
  if (sub === "disable") {
    const done = await prisma.itemPreviewConfig.updateMany({ where: { discordGuildId: guildId }, data: { enabled: false, disabledReason: "turned off by the owner" } });
    await reply(done.count ? "Item previews are off." : "Item previews were not set up.");
    return;
  }
  if (sub === "delete") {
    const done = await prisma.itemPreviewConfig.deleteMany({ where: { discordGuildId: guildId } });
    await reply(done.count ? "Item previews are off and the stored webhook is erased. Also delete the webhook in Discord (Channel settings > Integrations)." : "Nothing was stored.");
    return;
  }
  const row = await prisma.itemPreviewConfig.findUnique({ where: { discordGuildId: guildId } });
  await reply(!row ? "Item previews: not set up (off)." : row.enabled ? `Item previews: ON for <#${row.channelId}>.` : `Item previews: OFF${row.disabledReason ? ` (${row.disabledReason})` : ""}.`);
}

type HookChannel = TextBasedChannel & { createWebhook(options: { name: string; reason?: string }): Promise<{ id: string; url: string; delete(reason?: string): Promise<unknown> }> };
async function hookFactory(channel: TextBasedChannel | null | undefined) {
  if (!channel || !("createWebhook" in channel)) throw new Error("no webhooks here");
  return async (_channelId: string, name: string): Promise<BotWebhook> => {
    const hook = await (channel as HookChannel).createWebhook({ name, reason: "Guilded item previews (owner command)" });
    return { id: hook.id, url: hook.url, remove: async () => { await hook.delete("Guilded item previews (owner command)"); } };
  };
}

/** /guilded-previews test: step 0 of docs/ITEM_PREVIEWS.md in one command. */
async function runTest(interaction: ChatInputCommandInteraction): Promise<void> {
  const reply = (content: string) => interaction.editReply({ content });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (!interaction.guildId) { await reply("Run this in a server."); return; }
  if (!config.ITEM_PREVIEW_SECRET) { await reply("Set ITEM_PREVIEW_SECRET (32+ random characters) in the bot's environment first; the webhook is stored encrypted with it."); return; }
  if (!config.MESSAGE_CONTENT_INTENT) { await reply("Previews need MESSAGE_CONTENT_INTENT=true and the Message Content switch in the Developer Portal."); return; }
  const picked = interaction.options.getChannel("channel", true);
  const channel = await interaction.guild?.channels.fetch(picked.id).catch(() => null);
  if (!channel?.isTextBased()) { await reply("Pick a text channel."); return; }
  const make = await hookFactory(channel).catch(() => null);
  if (!make) { await reply("That channel cannot have webhooks."); return; }
  const result = await runStepZero({ createWebhook: make, fetch: (url, init) => fetch(url, init) }, channel.id);
  if (!result.ok || !result.messageId) {
    await reply(`Step 0 failed at "${result.stage}": ${result.detail}${result.ok ? " The post id was not returned, so the test post must be removed by hand." : ""}`);
    return;
  }
  const ids = stepZeroButtons(channel.id, result.messageId);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(ids.pass).setLabel("Seen in Discord only: turn previews on").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(ids.fail).setLabel("It showed in WoW chat: keep off").setStyle(ButtonStyle.Danger));
  await interaction.editReply({ content: `${result.detail}\nLook at <#${channel.id}> for the test embed, then check WoW guild chat (it must NOT appear there). Then choose below. Either button removes the test post.`, components: [row] });
}

/** The two buttons under the step-0 result. Owner only; either one deletes the test post. */
export async function handleItemPreviewButton(interaction: ButtonInteraction): Promise<void> {
  const parsed = parseStepZeroButton(interaction.customId);
  if (!parsed || !interaction.guildId) return;
  if (interaction.user.id !== await botOwnerId(interaction.client)) { await interaction.reply({ content: "Only the Guilded bot's owner can do this.", flags: MessageFlags.Ephemeral }); return; }
  await interaction.deferUpdate();
  const channel = await interaction.guild?.channels.fetch(parsed.channelId).catch(() => null);
  if (channel?.isTextBased()) await channel.messages.delete(parsed.messageId).catch(() => undefined);
  const finish = (content: string) => interaction.editReply({ content, components: [] });
  if (parsed.verdict === "bad") { await finish("Previews stay off, and the test post was removed. Nothing was stored."); return; }
  if (!config.ITEM_PREVIEW_SECRET || !channel?.isTextBased()) { await finish("Previews stay off: the secret or the channel is missing."); return; }
  const make = await hookFactory(channel).catch(() => null);
  if (!make) { await finish("Previews stay off: that channel cannot have webhooks."); return; }
  const guildId = interaction.guildId;
  const done = await enableAfterStepZero({ createWebhook: make, secret: config.ITEM_PREVIEW_SECRET,
    save: async row => {
      const data = { ...row, enabled: true, disabledReason: null, createdBy: interaction.user.id };
      await prisma.itemPreviewConfig.upsert({ where: { discordGuildId: guildId }, create: { discordGuildId: guildId, ...data }, update: data });
    } }, parsed.channelId);
  await finish(done.detail);
}
