import { ALWAYS_ALLOWED_COMMANDS, tierDenial } from "../commands/lite.js";

/** Custom-id prefix of the confirm and cancel buttons of /delete-my-data (src/commands/delete-my-data.ts). */
export const DELETE_MY_DATA_PREFIX = "deletemydata:";

type Gated = { commandName?: unknown; customId?: unknown; isButton?: () => boolean; options?: unknown };
type Options = { getSubcommandGroup(required: boolean): string | null; getSubcommand(required: boolean): string | null };

export const isDeleteMyDataButton = (interaction: Gated): boolean => typeof interaction.isButton === "function" && interaction.isButton() && typeof interaction.customId === "string" && interaction.customId.startsWith(DELETE_MY_DATA_PREFIX);

/** Deleting one's own data needs no in-game guild role and no server scope: the command and its buttons skip that check. */
export const skipsGuildScope = (interaction: Gated): boolean =>
  isDeleteMyDataButton(interaction) || (typeof interaction.commandName === "string" && ALWAYS_ALLOWED_COMMANDS.includes(interaction.commandName));

/**
 * What the global handler does with an interaction before any command runs: "collector" leaves a delete-my-data click to
 * the command's own collector (answering it here would make the collector's acknowledgement fail), "blocked"/"lite" refuse,
 * null lets it through. `command` is true for slash commands and their autocomplete.
 */
export function gateOutcome(tier: string, interaction: Gated, command: boolean): "collector" | "blocked" | "lite" | null {
  if (isDeleteMyDataButton(interaction)) return "collector";
  if (command) return tierDenial(tier, String(interaction.commandName), (interaction.options as Options | undefined)?.getSubcommandGroup(false) ?? null, (interaction.options as Options | undefined)?.getSubcommand(false) ?? null);
  return tier === "blocked" ? "blocked" : null;
}
