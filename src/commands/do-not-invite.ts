import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction, type GuildMember } from "discord.js";
import { prisma } from "../database.js";
import { hasPermission } from "../permissions.js";
import { createDoNotInviteService, DNI_KINDS, type DniEntry, type DniExpiry, type DniKind } from "../services/do-not-invite.js";
import { requireGuildContext } from "./context.js";

const service = createDoNotInviteService(prisma);
const PAGE = 10;

// Mounted as /mod dni. Officer-only, and every reply is private.
export const dniCommand = new SlashCommandBuilder()
  .setName("dni")
  .setDescription("Do-not-invite list.")
  .addSubcommand((sub) => sub.setName("add").setDescription("Add a name.")
    .addStringOption((o) => o.setName("name").setDescription("Name[-Realm]").setMaxLength(60).setRequired(true))
    .addStringOption((o) => o.setName("kind").setDescription("Kind").addChoices(
      { name: "Kicked", value: "KICKED" }, { name: "Left", value: "LEFT_BADLY" }, { name: "Scammer", value: "SCAMMER" }, { name: "Other", value: "OTHER" }))
    .addStringOption((o) => o.setName("reason").setDescription("Reason").setMaxLength(200))
    .addStringOption((o) => o.setName("expiry").setDescription("Default 1y").addChoices(
      { name: "1 month", value: "1m" }, { name: "6 months", value: "6m" }, { name: "1 year", value: "1y" }, { name: "Forever", value: "forever" }))
    .addUserOption((o) => o.setName("user").setDescription("Discord user")))
  .addSubcommand((sub) => sub.setName("list").setDescription("Show the list.")
    .addIntegerOption((o) => o.setName("page").setDescription("Page").setMinValue(1)))
  .addSubcommand((sub) => sub.setName("clear").setDescription("Clear an entry.")
    .addStringOption((o) => o.setName("entry").setDescription("Entry").setAutocomplete(true).setRequired(true)))
  .addSubcommand((sub) => sub.setName("appeal-status").setDescription("Open appeals."))
  .addSubcommand((sub) => sub.setName("alias").setDescription("Link an alt")
    .addStringOption((o) => o.setName("entry").setDescription("Entry").setAutocomplete(true).setRequired(true))
    .addStringOption((o) => o.setName("name").setDescription("Alt").setMaxLength(60).setRequired(true)));

const label = (entry: Pick<DniEntry, "name" | "realm">) => `${entry.name}${entry.realm ? `-${entry.realm}` : ""}`;
const KIND_LABEL: Record<DniKind, string> = { KICKED: "kicked", LEFT_BADLY: "left badly", SCAMMER: "scammer", OTHER: "other" };

export function dniLine(entry: DniEntry): string {
  const until = entry.expiresAt ? `until <t:${Math.floor(entry.expiresAt.getTime() / 1000)}:d>` : "forever";
  return `• **${label(entry)}**${entry.discordUserId ? ` (<@${entry.discordUserId}>)` : ""} — ${KIND_LABEL[entry.kind ?? "KICKED"]}: ${entry.reason} · ${until}`
    + `${entry.status === "APPEALED" ? " · **appealed**" : ""} · <@${entry.addedBy}> <t:${Math.floor(entry.createdAt.getTime() / 1000)}:d>`;
}

export async function executeDni(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = await requireGuildContext(interaction);
  if (!context) return;
  if (!interaction.member || !hasPermission(interaction.member as GuildMember, "officer")) {
    await interaction.reply({ content: "Only officers can use the do-not-invite list.", flags: MessageFlags.Ephemeral });
    return;
  }
  const reply = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "add") {
    const user = interaction.options.getUser("user");
    const kind = (interaction.options.getString("kind") ?? "KICKED") as DniKind;
    const entry = await service.add(context.guildId, {
      name: interaction.options.getString("name", true), discordUserId: user?.id ?? null,
      kind: DNI_KINDS.includes(kind) ? kind : "KICKED", expiry: (interaction.options.getString("expiry") ?? "1y") as DniExpiry,
      reason: interaction.options.getString("reason") ?? `Added as ${KIND_LABEL[kind] ?? "kicked"}`, addedBy: interaction.user.id
    });
    await reply(`Added **${label(entry)}** to the do-not-invite list${entry.expiresAt ? ` until <t:${Math.floor(entry.expiresAt.getTime() / 1000)}:d>` : " forever"}`
      + `${entry.aliasGroup ? " (their other known characters too)" : ""}. Officers are warned if they apply, join or ask for an invite; nothing is blocked.`);
    return;
  }
  if (subcommand === "clear") {
    await service.clear(context.guildId, interaction.options.getString("entry", true), interaction.user.id);
    await reply("Cleared. The entry is kept for the audit trail for 30 days, then deleted.");
    return;
  }
  if (subcommand === "alias") {
    await service.alias(context.guildId, interaction.options.getString("entry", true), interaction.options.getString("name", true), interaction.user.id);
    await reply("Linked. A match on either name now warns for both.");
    return;
  }
  if (subcommand === "appeal-status") {
    const appealed = (await service.list(context.guildId, { take: 200 })).filter((entry) => entry.status === "APPEALED");
    await reply(appealed.length ? appealed.map(dniLine).join("\n").slice(0, 1900) : "No appeal is waiting. A person appeals with /character appeal; the decision buttons are posted in the officer log.");
    return;
  }
  const page = Math.max(1, interaction.options.getInteger("page") ?? 1);
  const [entries, total] = await Promise.all([service.list(context.guildId, { skip: (page - 1) * PAGE, take: PAGE }), service.count(context.guildId)]);
  const pages = Math.max(1, Math.ceil(total / PAGE));
  let text = "";
  for (const line of entries.map(dniLine)) { if (text.length + line.length > 1800) break; text += `${text ? "\n" : ""}${line}`; }
  await reply(text ? `${text}\n_Page ${page} of ${pages} · ${total} active_` : "The do-not-invite list is empty.");
}

export async function dniChoices(guildId: string, query: string) {
  const q = query.trim().toLowerCase();
  return (await service.list(guildId)).map((entry) => ({ name: `${label(entry)} — ${entry.reason}`.slice(0, 100), value: entry.id }))
    .filter((choice) => !q || choice.name.toLowerCase().includes(q)).slice(0, 25);
}
