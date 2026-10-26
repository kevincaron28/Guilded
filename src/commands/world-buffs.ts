import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { prisma } from "../database.js";
import { asLang, t } from "../i18n.js";
import { hasPermission } from "../permissions.js";
import { currentEdition } from "../services/edition-context.js";
import { parseRaidTime } from "../services/raid-time.js";
import { createWorldBuffService, WORLD_BUFFS, worldBuffLine, worldBuffsSupported } from "../services/world-buffs.js";
import { guildService, requireGuildContext } from "./context.js";

const service = createWorldBuffService(prisma);
const buffChoices = Object.entries(WORLD_BUFFS).map(([value, label]) => ({ name: label.en, name_localizations: { fr: label.fr }, value }));

// Mounted flat under /raid: /raid worldbuff, /raid worldbuffs, /raid worldbuff-remove.
export const worldBuffCommand = new SlashCommandBuilder()
  .setName("worldbuff")
  .setDescription("World-buff drops announced by the guild (Classic Era, Forever).")
  .addSubcommand((sub) => sub.setName("add").setDescription("Announce a world-buff drop: which buff, when and where.")
    .addStringOption((o) => o.setName("buff").setDescription("The buff").setRequired(true).addChoices(...buffChoices))
    .addStringOption((o) => o.setName("time").setDescription("When it drops, e.g. 20:15 or friday 8pm").setAutocomplete(true).setRequired(true))
    .addStringOption((o) => o.setName("where").setDescription("Where, e.g. Stormwind").setMaxLength(60))
    .addStringOption((o) => o.setName("note").setDescription("Optional note").setMaxLength(120)))
  .addSubcommand((sub) => sub.setName("list").setDescription("Upcoming world-buff drops.")
    .addBooleanOption((o) => o.setName("post").setDescription("Post the list in this channel for everyone")))
  .addSubcommand((sub) => sub.setName("remove").setDescription("Withdraw a drop you announced (raid leaders: any).")
    .addStringOption((o) => o.setName("drop").setDescription("The drop (pick from the list)").setAutocomplete(true).setRequired(true)));

export async function executeWorldBuff(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = await requireGuildContext(interaction);
  if (!context) return;
  const settings = await guildService.getSettings(context.guildId);
  const lang = asLang(settings?.language);
  if (!worldBuffsSupported(currentEdition())) {
    await interaction.reply({ content: t(lang, "worldbuff.unsupported"), flags: MessageFlags.Ephemeral });
    return;
  }
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "add") {
    const drop = await service.add({
      guildId: context.guildId, buff: interaction.options.getString("buff", true), createdBy: interaction.user.id,
      dropsAt: parseRaidTime(interaction.options.getString("time", true), settings?.timezone ?? "America/Toronto"),
      location: interaction.options.getString("where"), note: interaction.options.getString("note")
    });
    // The public announcement is the point; no pings.
    await interaction.reply({ content: `${t(lang, "worldbuff.announced")}\n${worldBuffLine(drop, lang)}`, allowedMentions: { parse: [] } });
    return;
  }
  if (subcommand === "list") {
    const drops = await service.upcoming(context.guildId);
    const body = drops.length ? drops.map((drop) => worldBuffLine(drop, lang)).join("\n") : t(lang, "worldbuff.none");
    const post = interaction.options.getBoolean("post") ?? false;
    await interaction.reply({ content: `**${t(lang, "worldbuff.title")}**\n${body}`, allowedMentions: { parse: [] }, ...(post ? {} : { flags: MessageFlags.Ephemeral }) });
    return;
  }
  const leader = !!interaction.member && hasPermission(interaction.member as Parameters<typeof hasPermission>[0], "raidLeader");
  const drop = await service.remove(context.guildId, interaction.options.getString("drop", true), interaction.user.id, leader);
  await interaction.reply({ content: `${t(lang, "worldbuff.removed")}\n${worldBuffLine(drop, lang)}`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}

// Autocomplete for remove: this guild's upcoming drops.
export async function worldBuffDropChoices(guildId: string, query: string, lang: "en" | "fr") {
  const drops = await service.upcoming(guildId, new Date(), 25);
  const q = query.trim().toLowerCase();
  return drops.map((drop) => {
    const label = WORLD_BUFFS[drop.buff as keyof typeof WORLD_BUFFS]?.[lang] ?? drop.buff;
    const when = drop.dropsAt.toISOString().slice(5, 16).replace("T", " ");
    return { name: `${label} · ${when} UTC${drop.location ? ` · ${drop.location}` : ""}`.slice(0, 100), value: drop.id };
  }).filter((choice) => !q || choice.name.toLowerCase().includes(q));
}
