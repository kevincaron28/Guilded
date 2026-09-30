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
    "**Groupes de donjon**", "• Publiez un donjon avec le bouton ci-dessous : précisez le donjon, l'heure et les rôles recherchés.",
    "• 1 tank, 1 soigneur et 3 DPS. Les joueurs supplémentaires vont en liste d'attente.",
    "• Un salon vocal privé est créé au départ et supprimé quand il reste vide.",
    "• Utilisez les salons PvP et leveling pour vos annonces libres. Les alertes du bot concernent uniquement les donjons."
  ] : [
    "**Dungeon groups**", "• Post a dungeon below: say which dungeon, when, and which roles you need.",
    "• 1 tank, 1 healer and 3 DPS. Extra players join the waitlist.",
    "• A private voice channel opens when the group starts and is removed after it stays empty.",
    "• Use the PvP and leveling channels for member posts. Bot alerts are for dungeons only."
  ]).join("\n");

}

export function dungeonSignupGuideComponents(lang: Lang) {
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder()
    .setCustomId(DUNGEON_GUIDE_CREATE_ID).setLabel(lang === "fr" ? "Créer un groupe de donjon" : "Post a dungeon group").setEmoji("⚔️").setStyle(ButtonStyle.Primary)),
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
  return ids.includes(DUNGEON_GUIDE_CREATE_ID) && ids.includes(DUNGEON_GUIDE_ALERTS_ID) && !ids.includes(DUNGEON_GUIDE_KIND_ID);
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
