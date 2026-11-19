import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { legacyView } from "./router.js";
import { executeDungeon } from "./dungeon.js";
import { executeCommunity } from "./community.js";
import { executeEpgp } from "./epgp.js";
import { executeBattleground } from "./battleground.js";

// /leaderboard (commands restructure, November 2026): one obvious place for every board. A thin
// dispatcher: each board is the existing command's own handler, which sees its old name.
export const LEADERBOARD_BOARDS = {
  dungeon: { legacy: "dungeon", sub: "leaderboard", handler: executeDungeon },
  guild: { legacy: "dungeon", sub: "records", handler: executeDungeon },
  pvp: { legacy: "bg", sub: "duels", handler: executeBattleground },
  community: { legacy: "community", sub: "leaderboard", handler: executeCommunity },
  epgp: { legacy: "epgp", sub: "leaderboard", handler: executeEpgp }
} as const;
export type LeaderboardBoard = keyof typeof LEADERBOARD_BOARDS;

export const leaderboardCommand = new SlashCommandBuilder()
  .setName("leaderboard")
  .setDescription("Leaderboards: dungeon rating (default), guild records, PvP, community points or EPGP.")
  .setNameLocalizations({ fr: "classement" })
  .setDescriptionLocalizations({ fr: "Classements : donjons (par défaut), records de la guilde, JcJ, communauté ou EPGP." })
  .addStringOption((option) => option.setName("board").setDescription("Which board (default: dungeon rating)")
    .setNameLocalizations({ fr: "tableau" }).setDescriptionLocalizations({ fr: "Quel classement (par défaut : donjons)" })
    .addChoices(
      { name: "Dungeon rating", name_localizations: { fr: "Cote des donjons" }, value: "dungeon" },
      { name: "Guild records (fastest clears)", name_localizations: { fr: "Records de la guilde" }, value: "guild" },
      { name: "PvP: duels", name_localizations: { fr: "JcJ : duels" }, value: "pvp" },
      { name: "Community points", name_localizations: { fr: "Points de communauté" }, value: "community" },
      { name: "EPGP", value: "epgp" }
    ));

/** Which board a /leaderboard call means (dungeon when none or an unknown one is given). */
export function leaderboardBoard(value: string | null): LeaderboardBoard {
  return value && value in LEADERBOARD_BOARDS ? value as LeaderboardBoard : "dungeon";
}

export async function executeLeaderboard(interaction: ChatInputCommandInteraction): Promise<void> {
  const board = LEADERBOARD_BOARDS[leaderboardBoard(interaction.options.getString("board"))];
  await board.handler(legacyView(interaction, board.legacy, board.sub));
}
