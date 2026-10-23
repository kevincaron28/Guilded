import { SlashCommandBuilder, type ChatInputCommandInteraction, type GuildMember, MessageFlags } from "discord.js";
import type { BankRequestStatus } from "@prisma/client";
import { prisma } from "../database.js";
import { hasPermission } from "../permissions.js";
import { createBankService } from "../services/bank.js";
import { postToLogChannel } from "../services/housekeeping.js";
import { requireGuildContext } from "./context.js";

const bankService = createBankService(prisma);

export const bankCommand = new SlashCommandBuilder()
  .setName("bank")
  .setDescription("Request items from the guild bank.")
  .addSubcommand((sub) => sub.setName("request").setDescription("Ask the guild bank for an item.")
    .addStringOption((o) => o.setName("item").setDescription("Item name").setMaxLength(100).setRequired(true))
    .addIntegerOption((o) => o.setName("quantity").setDescription("How many (default 1)").setMinValue(1).setMaxValue(1000))
    .addStringOption((o) => o.setName("note").setDescription("What it's for").setMaxLength(300)))
  .addSubcommand((sub) => sub.setName("mine").setDescription("Your recent bank requests."))
  .addSubcommand((sub) => sub.setName("cancel").setDescription("Cancel one of your open requests.")
    .addStringOption((o) => o.setName("id").setDescription("Request (start typing the item)").setAutocomplete(true).setRequired(true)))
  .addSubcommand((sub) => sub.setName("list").setDescription("Open requests (officers).")
    .addStringOption((o) => o.setName("status").setDescription("Which requests (default open)")
      .addChoices(
        { name: "Open (pending + approved)", value: "OPEN" },
        { name: "Pending", value: "PENDING" },
        { name: "Approved", value: "APPROVED" },
        { name: "Fulfilled", value: "FULFILLED" },
        { name: "Denied", value: "DENIED" }
      )))
  .addSubcommand((sub) => sub.setName("handle").setDescription("Approve, fulfil, or deny a request (officers).")
    .addStringOption((o) => o.setName("id").setDescription("Request (start typing the item)").setAutocomplete(true).setRequired(true))
    .addStringOption((o) => o.setName("action").setDescription("What to do").setRequired(true)
      .addChoices(
        { name: "Approve", value: "APPROVED" },
        { name: "Fulfilled (sent by mail/trade)", value: "FULFILLED" },
        { name: "Deny", value: "DENIED" }
      ))
    .addStringOption((o) => o.setName("reply").setDescription("Message to the requester").setMaxLength(300)));

const statusIcon: Record<BankRequestStatus, string> = {
  PENDING: "⏳", APPROVED: "👍", FULFILLED: "✅", DENIED: "❌", CANCELLED: "🚫"
};

export async function executeBank(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = await requireGuildContext(interaction);
  if (!context) return;
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "request") {
    const item = interaction.options.getString("item", true);
    const quantity = interaction.options.getInteger("quantity") ?? 1;
    const note = interaction.options.getString("note") ?? undefined;
    const request = await bankService.request(context.guildId, context.memberId, item, quantity, note);
    await interaction.reply({ content: `Request sent: ${quantity} × **${request.item}**. ID \`${request.id}\`. You'll get a DM when an officer handles it.`, flags: MessageFlags.Ephemeral });
    if (interaction.guild) {
      await postToLogChannel(interaction.guild, `📦 Bank request from ${interaction.user.username}: ${quantity} × ${request.item}${request.note ? ` (${request.note})` : ""} — /bank handle id:${request.id}`);
    }
    return;
  }
  if (subcommand === "mine") {
    const requests = await bankService.mine(context.guildId, context.memberId);
    await interaction.reply({
      content: requests.length
        ? requests.map((r) => `${statusIcon[r.status]} ${r.quantity} × **${r.item}** — ${r.status.toLowerCase()}${r.reply ? ` ("${r.reply}")` : ""} \`${r.id}\``).join("\n")
        : "You have no bank requests.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }
  if (subcommand === "cancel") {
    await bankService.cancel(context.guildId, context.memberId, interaction.options.getString("id", true).replace(/`/g, "").trim());
    await interaction.reply({ content: "Request cancelled.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (!interaction.member || !hasPermission(interaction.member as GuildMember, "officer")) {
    await interaction.reply({ content: "Only officers can view and handle bank requests.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (subcommand === "list") {
    const choice = interaction.options.getString("status") ?? "OPEN";
    const statuses: BankRequestStatus[] = choice === "OPEN" ? ["PENDING", "APPROVED"] : [choice as BankRequestStatus];
    const requests = await bankService.list(context.guildId, statuses);
    const text = requests.map((r) =>
      `${statusIcon[r.status]} ${r.quantity} × **${r.item}** for ${r.member.displayName}${r.note ? ` (${r.note})` : ""} <t:${Math.floor(r.createdAt.getTime() / 1000)}:R> \`${r.id}\``).join("\n");
    await interaction.reply({ content: text.slice(0, 1900) || "No requests.", flags: MessageFlags.Ephemeral });
    return;
  }

  const status = interaction.options.getString("action", true) as BankRequestStatus;
  const reply = interaction.options.getString("reply") ?? undefined;
  const updated = await bankService.setStatus(context.guildId, interaction.options.getString("id", true).replace(/`/g, "").trim(), status, interaction.user.id, reply);
  await interaction.reply({ content: `Marked ${updated.quantity} × **${updated.item}** for ${updated.member.displayName} as ${status.toLowerCase()}.`, flags: MessageFlags.Ephemeral });
  // Tell the requester; closed DMs are fine, /bank mine shows it too.
  await interaction.client.users.send(updated.member.discordUserId,
    `${statusIcon[status]} Your guild bank request for ${updated.quantity} × **${updated.item}** was ${status.toLowerCase()}${reply ? `: "${reply}"` : "."}`)
    .catch(() => undefined);
}
