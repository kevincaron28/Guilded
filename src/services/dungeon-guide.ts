import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, type GuildTextBasedChannel, type Message } from "discord.js";
import { tx, type Lang } from "../i18n.js";
import { GROUP_KINDS, type GroupKind } from "./dungeon-group.js";

// The pinned group finder message in the group finder channel (it was the dungeon signup guide):
// a menu to post a group of any kind. The old "Post a dungeon group" button still works on posts
// made before 4.6, and the checklist offers to update those (GUIDE_VERSION).
export const DUNGEON_GUIDE_PREFIX = "dguide:";
export const DUNGEON_GUIDE_CREATE_ID = `${DUNGEON_GUIDE_PREFIX}create`;
export const DUNGEON_GUIDE_KIND_ID = `${DUNGEON_GUIDE_PREFIX}kind`;
export const DUNGEON_GUIDE_ALERTS_ID = `${DUNGEON_GUIDE_PREFIX}alerts`;
// 3 (5.0): the "My group alerts" button under the menu.
export const GUIDE_VERSION = 3;

// The role pinged when a group of that kind is posted: a role with exactly this name (members
// opt in, e.g. with the welcome role buttons). /setup can create them.
export const LFG_ROLE_NAMES: Record<GroupKind, string> = {
  DUNGEON: "LFG Dungeon", LEVELING: "LFG Leveling", PVP: "LFG PvP", WORLDPVP: "LFG World PvP", WORLD: "LFG World", OTHER: "LFG Other"
};

export function dungeonSignupGuideText(lang: Lang): string {
  return [
    tx(lang, "**Group finder**"),
    tx(lang, "• Pick what you want to do in the menu below (dungeon, leveling, PvP, world PvP, a world activity or anything else), then say what, when and who you need."),
    tx(lang, "• Join a group with the buttons on its post. A dungeon takes 1 tank, 1 healer and 3 DPS; the other kinds take anyone up to their size. Extra players wait on the waitlist."),
    tx(lang, "• When the group is full (or the leader presses Start) it gets a private voice channel, deleted once it is empty."),
    tx(lang, "• Want a ping when a group you could join is posted? Press **My group alerts**: pick the kinds and the roles you play. You are pinged only when your characters' level fits the group and it still needs one of your roles.")
  ].join("\n");
}

export function dungeonSignupGuideComponents(lang: Lang) {
  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder()
    .setCustomId(DUNGEON_GUIDE_KIND_ID)
    .setPlaceholder(tx(lang, "Post a group..."))
    .addOptions((Object.keys(GROUP_KINDS) as GroupKind[]).map((kind) => ({
      label: tx(lang, GROUP_KINDS[kind].label).slice(0, 100), value: kind, emoji: GROUP_KINDS[kind].emoji
    })))),
  new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder()
    .setCustomId(DUNGEON_GUIDE_ALERTS_ID).setLabel(tx(lang, "My group alerts")).setEmoji("🔔").setStyle(ButtonStyle.Secondary))];
}

function componentIds(message: Message): string[] {
  const ids: string[] = [];
  for (const row of message.components) {
    if (!("components" in row)) continue;
    for (const component of row.components) {
      if ("customId" in component && typeof component.customId === "string") ids.push(component.customId);
    }
  }
  return ids;
}

function isDungeonGuide(message: Message): boolean {
  const ids = componentIds(message);
  return ids.includes(DUNGEON_GUIDE_CREATE_ID) || ids.includes(DUNGEON_GUIDE_KIND_ID);
}

// True when the pinned message is the current version (the menu and the alerts button).
export function isCurrentGuide(message: Message): boolean {
  const ids = componentIds(message);
  return ids.includes(DUNGEON_GUIDE_KIND_ID) && ids.includes(DUNGEON_GUIDE_ALERTS_ID);
}

export async function hasDungeonSignupGuide(channel: GuildTextBasedChannel): Promise<boolean> {
  const pins = await channel.messages.fetchPinned();
  return pins.some(isDungeonGuide);
}

// "missing", "outdated" (the pre-4.6 button) or "current".
export async function dungeonGuideState(channel: GuildTextBasedChannel): Promise<"missing" | "outdated" | "current"> {
  const pins = await channel.messages.fetchPinned();
  const guide = pins.find(isDungeonGuide);
  if (!guide) return "missing";
  return isCurrentGuide(guide) ? "current" : "outdated";
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
