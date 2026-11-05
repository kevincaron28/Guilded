import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { config } from "../config.js";
import { prisma } from "../database.js";
import { parseWebhookUrl } from "../services/item-preview-webhook.js";
import { sealSecret } from "../services/secret-box.js";
import { botOwnerId } from "./owner-season.js";

// /guilded-previews: the bot owner switches Discord-only item previews on or off for a server
// (docs/ITEM_PREVIEWS.md). Home server only, like /guilded-season. Off by default everywhere.
export const OWNER_PREVIEWS_COMMAND = "guilded-previews";

export const ownerPreviewsCommand = new SlashCommandBuilder()
  .setName(OWNER_PREVIEWS_COMMAND)
  .setDescription("Bot owner: Discord-only item previews for a linked WoW chat channel")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
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
