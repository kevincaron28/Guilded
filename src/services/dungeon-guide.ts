import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type GuildTextBasedChannel, type Message } from "discord.js";
import { tx, type Lang } from "../i18n.js";

export const DUNGEON_GUIDE_PREFIX = "dguide:";
export const DUNGEON_GUIDE_CREATE_ID = `${DUNGEON_GUIDE_PREFIX}create`;

export function dungeonSignupGuideText(lang: Lang): string {
  return [
    tx(lang, "**How dungeon signups work**"),
    tx(lang, "• Press **Post a dungeon group** below and enter the dungeon, time, and what roles you need."),
    tx(lang, "• Choose Tank, Healer, or DPS on the new post to sign up. Extra players go on that role's waitlist."),
    tx(lang, "• The group leader can start the private voice channel when ready; it starts automatically when 5 players have joined.")
  ].join("\n");
}

export function dungeonSignupGuideComponents(lang: Lang) {
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(DUNGEON_GUIDE_CREATE_ID)
      .setLabel(tx(lang, "Post a dungeon group"))
      .setStyle(ButtonStyle.Primary)
  )];
}

function isDungeonGuide(message: Message): boolean {
  return message.components.some((row) => "components" in row
    && row.components.some((component) => "customId" in component && component.customId === DUNGEON_GUIDE_CREATE_ID));
}

export async function hasDungeonSignupGuide(channel: GuildTextBasedChannel): Promise<boolean> {
  const pins = await channel.messages.fetchPinned();
  return pins.some(isDungeonGuide);
}

export async function ensureDungeonSignupGuide(channel: GuildTextBasedChannel, lang: Lang): Promise<void> {
  const pins = await channel.messages.fetchPinned();
  let message = pins.find(isDungeonGuide);
  if (!message) {
    const recent = await channel.messages.fetch({ limit: 100 });
    message = recent.find((candidate) => candidate.author.id === channel.client.user?.id && isDungeonGuide(candidate));
  }
  if (message) {
    await message.edit({ content: dungeonSignupGuideText(lang), components: dungeonSignupGuideComponents(lang) });
    if (!message.pinned) await message.pin();
    return;
  }

  const posted = await channel.send({
    content: dungeonSignupGuideText(lang),
    components: dungeonSignupGuideComponents(lang),
    allowedMentions: { parse: [] }
  });
  await posted.pin();
}
