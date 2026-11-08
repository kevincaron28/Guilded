import { pinnedMessages } from "./pins.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type GuildTextBasedChannel, type Message } from "discord.js";
import { tx, type Lang } from "../i18n.js";
import { type GroupKind } from "./dungeon-group.js";

// Pinned dungeon signup guide. Old multi-kind menus are detected and replaced.
export const DUNGEON_GUIDE_PREFIX = "dguide:";
export const DUNGEON_GUIDE_CREATE_ID = `${DUNGEON_GUIDE_PREFIX}create`;
export const DUNGEON_GUIDE_KIND_ID = `${DUNGEON_GUIDE_PREFIX}kind`;
export const DUNGEON_GUIDE_ALERTS_ID = `${DUNGEON_GUIDE_PREFIX}alerts`;
// 3 (5.0): the "My group alerts" button under the menu.
export const GUIDE_VERSION = 4;

// The role pinged when a group of that kind is posted: a role with exactly this name (members
// opt in, e.g. with the welcome role buttons). /setup can create them.
export const LFG_ROLE_NAMES: Record<GroupKind, string> = {
  DUNGEON: "LFG Dungeon", LEVELING: "LFG Leveling", PVP: "LFG PvP", WORLDPVP: "LFG World PvP", WORLD: "LFG World", OTHER: "LFG Other"
};

export function dungeonSignupGuideText(lang: Lang): string {
  return (lang === "fr" ? [
    "**Recherche de groupe : donjons et JcJ (PvP)**", "• Appuyez sur le bouton ci-dessous, choisissez l'activité (donjon, champ de bataille, arène ou JcJ en monde ouvert), puis précisez l'heure et ce que vous cherchez.",
    "• Donjon : 1 tank, 1 soigneur et 3 DPS. JcJ : tout rôle, de 2 à 40 joueurs. Les joueurs en trop vont en file d'attente.",
    "• Un salon vocal privé est créé au départ et supprimé quand il reste vide. Un groupe ouvert expire après 24 h.",
    "• Utilisez le salon leveling pour les annonces de leveling. 🔔 Mes alertes de groupe vous prévient des groupes qui vous conviennent.",
    "• `/dungeon rules` explique la cote par personnage et les points de participation par compte, avec les bonus et limites configurés."
  ] : [
    "**Group finder: dungeons and PvP**", "• Press the button below, pick the activity (dungeon, battleground, arena or world PvP), then say when and what you need.",
    "• Dungeon: 1 tank, 1 healer and 3 DPS. PvP: any role, 2 to 40 players. Extra players join the queue.",
    "• A private voice channel opens when the group starts and is removed after it stays empty. An open group expires after 24 hours.",
    "• Use the leveling channel for leveling posts. 🔔 My group alerts pings you for groups that fit you.",
    "• `/dungeon rules` explains character rating and account participation points, including configured bonuses and limits."
  ]).join("\n");

}

export function dungeonSignupGuideComponents(lang: Lang) {
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder()
    .setCustomId(DUNGEON_GUIDE_CREATE_ID).setLabel(lang === "fr" ? "Créer un groupe" : "Post a group").setEmoji("⚔️").setStyle(ButtonStyle.Primary)),
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
  // 9.1: the text names PvP once the guide is the merged one, so a guide pinned before it is refreshed.
  return ids.includes(DUNGEON_GUIDE_CREATE_ID) && ids.includes(DUNGEON_GUIDE_ALERTS_ID) && !ids.includes(DUNGEON_GUIDE_KIND_ID) && /PvP|JcJ/.test(message.content ?? "");
}

export async function hasDungeonSignupGuide(channel: GuildTextBasedChannel): Promise<boolean> {
  const pins = await pinnedMessages(channel);
  return pins.some(isDungeonGuide);
}

// "missing", "outdated" (the pre-4.6 button) or "current".
export async function dungeonGuideState(channel: GuildTextBasedChannel): Promise<"missing" | "outdated" | "current"> {
  const pins = await pinnedMessages(channel);
  const guide = pins.find(isDungeonGuide);
  if (!guide) return "missing";
  return isCurrentGuide(guide) ? "current" : "outdated";
}

export async function ensureDungeonSignupGuide(channel: GuildTextBasedChannel, lang: Lang): Promise<void> {
  const pins = await pinnedMessages(channel);
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
