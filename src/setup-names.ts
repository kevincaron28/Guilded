import { BRAND } from "./brand.js";
import type { Lang } from "./i18n.js";

// Names and topics of the channels and categories /setup creates, in English and French, so
// a French guild gets a French server. The bot recognizes both spellings (for example when
// tidying channels it made earlier), so switching language later never strands a channel.

export type ChannelField = "notifyChannelId" | "raidSignupChannelId" | "raidLogChannelId" | "logChannelId"
  | "dungeonLeaderboardChannelId" | "dungeonSignupChannelId" | "dungeonChannelId"
  | "lootChannelId" | "craftChannelId" | "readinessChannelId" | "coreChannelId" | "applicationChannelId" | "guideChannelId" | "answerChannelId";

// Access: "open" everyone talks; "readonly" everyone reads, only the bot and
// leadership post (signup channels are read-only too: people use the buttons);
// "officers" hidden from everyone but Guild Master/Officer; "leaders" hidden
// from everyone but the leadership roles; "board" the craft board forum.
export type Access = "open" | "readonly" | "pinned" | "officers" | "leaders" | "board";
export type CategoryKey = "guild" | "raid" | "dungeon" | "craft" | "officers";

export const CATEGORY_NAMES: Record<Lang, Record<CategoryKey, string>> = {
  en: { guild: "⚜️ Guild", raid: "⚔️ Raiding", dungeon: "🏰 Dungeons", craft: "🔨 Crafting", officers: "🔒 Officers" },
  fr: { guild: "⚜️ Guilde", raid: "⚔️ Raids", dungeon: "🏰 Donjons", craft: "🔨 Artisanat", officers: "🔒 Officiers" }
};

export interface ChannelSpec { name: string; topic: string; access: Access; category: CategoryKey; forum?: boolean }

const ACCESS: Record<ChannelField, { access: Access; category: CategoryKey; forum?: boolean }> = {
  notifyChannelId: { access: "readonly", category: "guild" },
  raidSignupChannelId: { access: "readonly", category: "raid" },
  coreChannelId: { access: "readonly", category: "raid" },
  raidLogChannelId: { access: "readonly", category: "raid" },
  lootChannelId: { access: "readonly", category: "raid" },
  dungeonSignupChannelId: { access: "pinned", category: "dungeon" },
  dungeonLeaderboardChannelId: { access: "readonly", category: "dungeon" },
  dungeonChannelId: { access: "readonly", category: "dungeon" },
  craftChannelId: { access: "board", category: "craft", forum: true },
  logChannelId: { access: "officers", category: "officers" },
  readinessChannelId: { access: "leaders", category: "officers" },
  applicationChannelId: { access: "officers", category: "officers" },
  answerChannelId: { access: "open", category: "guild" },
  guideChannelId: { access: "pinned", category: "guild" }
};

const TEXT: Record<Lang, Record<ChannelField, { name: string; topic: string }>> = {
  en: {
    answerChannelId: { name: "bot-faq", topic: "Ask Guilded questions about the addon, setup and guild features" },
    notifyChannelId: { name: `${BRAND.channelPrefix}-announcements`, topic: `Raid, boss and guild announcements from ${BRAND.name}` },
    raidSignupChannelId: { name: "raid-signups", topic: "Raid signups: use the buttons under each raid post" },
    coreChannelId: { name: "raid-roster", topic: "Raid core rosters: core members get signup priority" },
    raidLogChannelId: { name: "raid-logs", topic: "Raid summaries and Warcraft Logs, posted after each raid" },
    lootChannelId: { name: "loot-log", topic: "Loot awards and EP/GP changes" },
    dungeonSignupChannelId: { name: "group-finder", topic: "Dungeon groups: post with the pinned button; join as tank, healer or DPS. PvP and leveling use their dedicated channels" },
    dungeonLeaderboardChannelId: { name: "dungeon-leaderboard", topic: "Dungeon challenge standings, updated automatically" },
    dungeonChannelId: { name: "dungeon-runs", topic: "Completed dungeon runs and new records" },
    craftChannelId: { name: "craft-board", topic: "Craft requests: press Request a craft in the pinned post. Crafters filter by profession tag and press I'll craft it." },
    logChannelId: { name: "officer-log", topic: "Officer log: joins, moderation, bank and craft requests" },
    readinessChannelId: { name: "raid-readiness", topic: "Who is ready for raid night: gear and consumable checks (officers and raid leaders only)" },
    applicationChannelId: { name: "raid-applications", topic: "New recruitment applications (officers only): use /application list|view|approve|reject|trial" },
    guideChannelId: { name: `${BRAND.channelPrefix}-guide`, topic: "How Guilded works, and what's new when it updates" }
  },
  fr: {
    answerChannelId: { name: "bot-faq", topic: "Posez vos questions à Guilded sur l’addon, la configuration et la guilde" },
    notifyChannelId: { name: `${BRAND.channelPrefix}-annonces`, topic: `Annonces de raid, de boss et de guilde de ${BRAND.name}` },
    raidSignupChannelId: { name: "inscriptions-raid", topic: "Inscriptions aux raids : utilisez les boutons sous chaque annonce de raid" },
    coreChannelId: { name: "cores-de-raid", topic: "Compositions des cores de raid : les membres du core ont la priorité aux inscriptions" },
    raidLogChannelId: { name: "rapports-raid", topic: "Résumés de raid et Warcraft Logs, publiés après chaque raid" },
    lootChannelId: { name: "butin", topic: "Butin attribué et changements d'EP/GP" },
    dungeonSignupChannelId: { name: "recherche-de-groupe", topic: "Groupes de donjon : publiez avec le bouton épinglé; rejoignez comme tank, soigneur ou DPS. JcJ et leveling : salons dédiés" },
    dungeonLeaderboardChannelId: { name: "classement-donjons", topic: "Classement du défi des donjons, mis à jour automatiquement" },
    dungeonChannelId: { name: "donjons-termines", topic: "Donjons terminés et nouveaux records" },
    craftChannelId: { name: "tableau-artisanat", topic: "Demandes d'artisanat : appuyez sur Demander un craft dans le message épinglé. Les artisans filtrent par métier et appuient sur Je le fabrique." },
    logChannelId: { name: "journal-officiers", topic: "Journal des officiers : arrivées, modération, banque et demandes d'artisanat" },
    readinessChannelId: { name: "preparation-raid", topic: "Qui est prêt pour la soirée de raid : gear et consommables (officiers et chefs de raid seulement)" },
    applicationChannelId: { name: "candidatures-raid", topic: "Nouvelles candidatures de recrutement (officiers seulement) : utilisez /application list|view|approve|reject|trial" },
    guideChannelId: { name: `${BRAND.channelPrefix}-guide`, topic: "Comment fonctionne Guilded, et les nouveautés lors des mises à jour" }
  }
};

export function channelSpec(field: ChannelField, lang: Lang): ChannelSpec {
  return { ...ACCESS[field], ...TEXT[lang][field] };
}

// Every name the bot has ever given this channel (either language).
// Names used by earlier versions still count (the group finder was "dungeon-signups").
const LEGACY_NAMES: Partial<Record<ChannelField, string[]>> = { guideChannelId: [`${BRAND.channelPrefix}-addon`], raidSignupChannelId: ["raid-inscription", "raid-inscriptions"], dungeonSignupChannelId: ["dungeon-signups", "inscriptions-donjon"] };
export const channelNames = (field: ChannelField): string[] => [TEXT.en[field].name, TEXT.fr[field].name, ...(LEGACY_NAMES[field] ?? [])];
export const categoryNames = (key: CategoryKey): string[] => [CATEGORY_NAMES.en[key], CATEGORY_NAMES.fr[key]];

// These channels are part of setup/reset even when an administrator renames them.
export const RESET_REQUIRED_CHANNELS: ChannelField[] = ["raidSignupChannelId", "guideChannelId", "answerChannelId"];

// Recover known leftovers after an older reset erased their saved IDs. Restrict
// recovery to text channels in Guilded's categories, never similarly named user channels.
export function isSetupLeftover(field: ChannelField, name: string, parentName: string | undefined): boolean {
  return RESET_REQUIRED_CHANNELS.includes(field) && channelNames(field).includes(name)
    && parentName !== undefined && [...categoryNames(channelSpec(field, "en").category), "⚜️ Guilded"].includes(parentName);
}
