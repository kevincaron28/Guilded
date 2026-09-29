import type { AutocompleteInteraction, GuildMember } from "discord.js";
import { prisma } from "../database.js";
import { hasPermission } from "../permissions.js";
import {
  applicationChoices, auctionChoices, bankChoices, coreChoices, craftChoices, epgpEntryChoices, importChoices,
  raidChoices, raidStatusesFor, type Choice
} from "../services/autocomplete.js";
import {
  attunementSuggestions, availabilitySuggestions, durationSuggestions, itemSuggestions, ownCharacterChoices, raceSuggestions,
  raidTitleSuggestions, reasonSuggestions, specSuggestions, tagSuggestions, timeSuggestions
} from "../services/option-suggestions.js";
import { dungeonChoices } from "../services/dungeon-stats.js";
import { recipeNameSuggestions } from "../services/recipes.js";
import { runChoices } from "../services/dungeon-admin.js";
import { guildService } from "./context.js";
import { faqChoices } from "./faq.js";
import { commands } from "./index.js";
import { resolveCommand } from "./router.js";

// Routes every autocomplete request (see setAutocomplete(true) on ID
// options) to the right list. Must answer within 3 seconds, so any error
// just returns an empty list rather than failing the interaction.
export async function handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  let choices: Choice[] = [];
  let numeric: { name: string; value: number }[] | null = null;
  try {
    if (!interaction.guildId || !interaction.guild) return;
    const guild = await guildService.ensureGuild(interaction.guildId, interaction.guild.name);
    const settings = await guildService.getSettings(guild.id);
    const focused = interaction.options.getFocused(true);
    const query = String(focused.value ?? "");
    const { legacy: command, sub: legacySub } = resolveCommand(commands, interaction);
    const subcommand = legacySub;
    const member = await guildService.ensureMember(guild.id, interaction.user.id, interaction.user.username);
    const timeZone = settings?.timezone ?? "America/Toronto";
    const language = settings?.language ?? "en";

    if (command === "faq" && focused.name === "entry") {
      choices = await faqChoices(guild.id, query);
    } else if (focused.name === "race") {
      choices = raceSuggestions(query);
    } else if (focused.name === "spec") {
      choices = specSuggestions(interaction.options.getString("class"), query);
    } else if (focused.name === "availability") {
      choices = availabilitySuggestions(query);
    } else if (focused.name === "character" && ["profession", "attunement", "wishlist"].includes(command)) {
      choices = await ownCharacterChoices(prisma, member.id, query);
    } else if (command === "core" && focused.name === "character") {
      // The characters of the player picked in the same command (or your own).
      const userId = interaction.options.get("player")?.value;
      const player = typeof userId === "string" && userId !== interaction.user.id
        ? await prisma.member.findFirst({ where: { guildId: guild.id, discordUserId: userId }, select: { id: true } })
        : member;
      choices = player ? await ownCharacterChoices(prisma, player.id, query) : [];
    } else if (command === "attunement" && focused.name === "name") {
      choices = await attunementSuggestions(prisma, guild.id, query);
    } else if ((command === "wishlist" || command === "loot") && focused.name === "item") {
      choices = await itemSuggestions(prisma, guild.id, query);
    } else if (command === "tag" && focused.name === "name") {
      choices = await tagSuggestions(prisma, guild.id, query);
    } else if (command === "raid" && focused.name === "title") {
      choices = await raidTitleSuggestions(prisma, guild.id, query);
    } else if (command === "raid" && focused.name === "time") {
      choices = timeSuggestions(query, timeZone, language);
    } else if (command === "epgp" && focused.name === "reason") {
      choices = reasonSuggestions(subcommand, query);
    } else if (command === "loot" && focused.name === "duration") {
      numeric = durationSuggestions(query);
    } else if (focused.name === "core") {
      // Only cores with their own point pool make sense for /epgp.
      choices = await coreChoices(prisma, guild.id, query, command === "epgp");
    } else if (focused.name === "raid") {
      choices = await raidChoices(prisma, {
        guildId: guild.id,
        query,
        statuses: command === "testraid" ? ["PLANNED", "ACTIVE"] : raidStatusesFor(command === "raid" ? subcommand : null),
        testOnly: command === "testraid",
        timeZone,
        language
      });
    } else if (focused.name === "auction") {
      choices = await auctionChoices(prisma, guild.id, query);
    } else if (command === "bank" && focused.name === "id") {
      // Officers handling requests see everyone's; members see their own.
      const officer = subcommand === "handle" && !!interaction.member && hasPermission(interaction.member as GuildMember, "officer");
      choices = await bankChoices(prisma, guild.id, query, officer ? null : member.id);
    } else if (command === "craft" && focused.name === "item" && subcommand === "who") {
      choices = await recipeNameSuggestions(prisma, guild.id, query);
    } else if (command === "craft" && focused.name === "id" && subcommand) {
      choices = await craftChoices(prisma, guild.id, query, subcommand, member.id);
    } else if (command === "epgp" && focused.name === "entry") {
      choices = await epgpEntryChoices(prisma, guild.id, query);
    } else if (command === "application" && focused.name === "id") {
      choices = await applicationChoices(prisma, guild.id, query);
    } else if (command === "dungeon-admin" && focused.name === "run") {
      choices = await runChoices(prisma, guild.id, query);
    } else if ((command === "dungeon" || command === "dungeon-admin") && focused.name === "dungeon") {
      choices = await dungeonChoices(prisma, guild.id, query);
    } else if (command === "character" && focused.name === "name" && (subcommand === "claim" || subcommand === "link")) {
      const rows = await prisma.unclaimedCharacter.findMany({ where: { guildId: guild.id, name: { contains: query, mode: "insensitive" } }, orderBy: { name: "asc" }, take: 25 });
      choices = rows.map((row) => ({ name: `${row.name} - ${row.className}${row.level ? ` ${row.level}` : ""}`.slice(0, 100), value: row.name }));
    } else if (command === "character" && focused.name === "name" && subcommand === "unlink") {
      const rows = await prisma.character.findMany({
        where: { member: { guildId: guild.id }, name: { contains: query, mode: "insensitive" } },
        include: { member: true }, orderBy: { name: "asc" }, take: 25
      });
      choices = rows.map((row) => ({ name: `${row.name} - ${row.className}${row.isMain ? " (main)" : ""} · ${row.member.displayName}`.slice(0, 100), value: row.name }));
    } else if (command === "import-apply" && focused.name === "id") {
      choices = await importChoices(prisma, guild.id, query);
    }
  } catch (error) {
    console.warn(`Autocomplete failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  await interaction.respond(numeric ?? choices).catch(() => undefined);
}
