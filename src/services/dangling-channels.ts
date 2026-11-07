import type { Guild as DiscordGuild } from "discord.js";

// A saved channel id whose channel was deleted in Discord is the same as no channel at all.
// /setup clears those ids (and the message ids that lived in them) on every run, so the checklist,
// the "missing channels" count and the create buttons never trust a channel that is gone.

/** Channel columns in the guild settings, each with the message-id columns that belong to it. */
export const SETTINGS_CHANNEL_COLUMNS: Record<string, string[]> = {
  notifyChannelId: [], raidSignupChannelId: [], logChannelId: [], guideChannelId: [],
  readinessChannelId: [], craftChannelId: [], craftOrdersChannelId: [], craftArchiveChannelId: [], applicationChannelId: [], attendanceChannelId: [], weeklyReportChannelId: [], inviteChannelId: [],
  dungeonLeaderboardChannelId: ["dungeonLeaderboardMessageId"], dungeonSignupChannelId: [], dungeonChannelId: [],
  // Retired in 9.0 (#bot-faq) and optional channels.
  raidLogChannelId: [], lootChannelId: [], coreChannelId: [], answerChannelId: [], pugChannelId: ["pugMessageId"],
  // PvP module and the race to 60 board.
  bgGroupsChannelId: ["bgGroupsMessageId"], bgResultsChannelId: ["bgResultsMessageId"], bgStatsChannelId: ["bgStatsMessageId", "bgLadderMessageId"],
  duelBoardChannelId: ["duelBoardMessageId"], raceBoardChannelId: ["raceBoardMessageId"]
};

/** True only when Discord confirmed the channel is gone (10003); a permission or network error never counts. */
export async function channelIsGone(guild: Pick<DiscordGuild, "channels">, id: string): Promise<boolean> {
  try {
    return !(await guild.channels.fetch(id));
  } catch (error) {
    return Number((error as { code?: unknown } | null)?.code) === 10003;
  }
}

/**
 * Clears every saved channel id (and its message ids) whose channel no longer exists. Returns the cleared columns.
 * `update` writes the cleared columns (guildService.updateSettings in production).
 */
export async function clearDanglingChannels(guild: Pick<DiscordGuild, "channels">, settings: Record<string, unknown>,
  update: (data: Record<string, null>) => Promise<unknown>): Promise<string[]> {
  const data: Record<string, null> = {};
  for (const [column, messageColumns] of Object.entries(SETTINGS_CHANNEL_COLUMNS)) {
    const id = settings[column];
    if (typeof id !== "string" || !id) continue;
    if (!(await channelIsGone(guild, id))) continue;
    data[column] = null;
    for (const message of messageColumns) data[message] = null;
  }
  const cleared = Object.keys(data).filter((key) => key.endsWith("ChannelId"));
  if (cleared.length) await update(data);
  return cleared;
}
