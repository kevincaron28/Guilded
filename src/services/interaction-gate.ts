import { alwaysAllowed, tierDenial } from "../commands/lite.js";
import { resolveCommand, type AnyCommand } from "../commands/router.js";

/** Custom-id prefix of the confirm and cancel buttons of /delete-my-data (src/commands/delete-my-data.ts). */
export const DELETE_MY_DATA_PREFIX = "deletemydata:";

type Gated = { commandName?: unknown; customId?: unknown; isButton?: () => boolean; options?: unknown };
type Options = { getSubcommandGroup(required: boolean): string | null; getSubcommand(required: boolean): string | null };

export const isDeleteMyDataButton = (interaction: Gated): boolean => typeof interaction.isButton === "function" && interaction.isButton() && typeof interaction.customId === "string" && interaction.customId.startsWith(DELETE_MY_DATA_PREFIX);

const groupAndSub = (interaction: Gated): [string | null, string | null] => {
  const options = interaction.options as Options | undefined;
  if (!options || typeof options.getSubcommand !== "function") return [null, null];
  return [options.getSubcommandGroup(false) ?? null, options.getSubcommand(false) ?? null];
};

/** Deleting one's own data (/character privacy) needs no in-game guild role and no server scope: the command and its buttons skip that check. */
export const skipsGuildScope = (interaction: Gated): boolean =>
  isDeleteMyDataButton(interaction) || (typeof interaction.commandName === "string" && alwaysAllowed(interaction.commandName, ...groupAndSub(interaction)));

// Old commands (as their handlers see them) that work per Discord server rather than per in-game
// guild: choosing the in-game guild itself (/wow, now /character guild and /setup guild), community
// seasons and activities, PoE and Discord participation. /organize poll and /organize dungeon-seasons
// stay per in-game guild, as /poll and the dungeon seasons were.
const SERVER_WIDE = ["wow", "community", "lottery", "gaming", "challenge", "poe", "participation"];

/** Whether a slash command (or its autocomplete) runs for the whole Discord server, without an in-game guild scope. */
export function serverWideCommand(commands: AnyCommand[], interaction: { commandName: string; options: Options & { getString?(name: string): string | null } }): boolean {
  const found = resolveCommand(commands, interaction);
  if (SERVER_WIDE.includes(found.legacy)) return true;
  if (interaction.commandName === "character" && found.sub === "guild" && found.legacy === "character") return true;
  if (interaction.commandName === "leaderboard") {
    try { return interaction.options.getString?.("board") === "community"; } catch { return false; }
  }
  return false;
}

/**
 * What the global handler does with an interaction before any command runs: "collector" leaves a delete-my-data click to
 * the command's own collector (answering it here would make the collector's acknowledgement fail), "blocked"/"lite" refuse,
 * null lets it through. `command` is true for slash commands and their autocomplete.
 */
export function gateOutcome(tier: string, interaction: Gated, command: boolean): "collector" | "blocked" | "lite" | null {
  if (isDeleteMyDataButton(interaction)) return "collector";
  if (command) return tierDenial(tier, String(interaction.commandName), ...groupAndSub(interaction));
  return tier === "blocked" ? "blocked" : null;
}
