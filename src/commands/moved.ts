import { MessageFlags, type ChatInputCommandInteraction } from "discord.js";
import { asLang, t, type Lang } from "../i18n.js";
import { guildService } from "./context.js";

// Commands restructure (November 2026): retired top-level commands (/wow, /import, /poll, /delete-my-data)
// are no longer registered; main.ts keeps a handler for their names so a call Discord still routes
// gets a private answer saying where it went.

/** Old top-level command -> where it went. */
export const RETIRED_COMMANDS: Record<string, string> = {
  wow: "/character guild · /setup guild",
  import: "/setup import",
  poll: "/organize poll",
  "delete-my-data": "/character privacy action:delete"
};

async function serverLang(interaction: ChatInputCommandInteraction): Promise<Lang> {
  const fallback: Lang = interaction.locale?.startsWith("fr") ? "fr" : "en";
  if (!interaction.guildId || !interaction.guild) return fallback;
  try {
    const guild = await guildService.ensureGuild(interaction.guildId, interaction.guild.name);
    const settings = await guildService.getSettings(guild.id);
    return settings?.language ? asLang(settings.language) : fallback;
  } catch {
    return fallback;
  }
}

/** The private "this moved" answer, in the server's language. */
export async function replyMoved(interaction: ChatInputCommandInteraction, target: string): Promise<void> {
  const lang = await serverLang(interaction);
  const content = t(lang, "command.moved", { target: target.split(" · ").map((path) => `\`${path}\``).join(lang === "fr" ? " ou " : " or ") });
  if (interaction.deferred || interaction.replied) await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
  else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

/** Handler for a retired top-level command name. */
export const retiredHandler = (name: string) => (interaction: ChatInputCommandInteraction) => replyMoved(interaction, RETIRED_COMMANDS[name] ?? "/help");
