import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type GuildTextBasedChannel, type Message } from "discord.js";
import { tx, type Lang } from "../i18n.js";
import { pinnedMessages } from "./pins.js";

// "Install Guilded in 1 minute": a short pinned post with tappable link buttons, kept in the bot
// guide channel next to the longer getting-started guide. "Update bot messages" posts it once,
// pins it and edits the same message afterwards (never a duplicate). The three steps are the ones
// on https://guilded.kcaron.top/start/. All links are the published ones (site/releases.json).
export const START_URL = "https://guilded.kcaron.top/start/";
const ADDON_URL = "https://www.curseforge.com/wow/addons/guilded";
const STORE_URL = "https://apps.microsoft.com/detail/9N680XX3QFL9";
const GITHUB_URL = "https://github.com/kevincaron28/Guilded/releases/latest";

const TITLES = { en: "⚡ Install Guilded in 1 minute", fr: "⚡ Installer Guilded en 1 minute" } as const;
const OWNED_TITLES = new Set<string>(Object.values(TITLES));

const BODY = {
  en: "**1. Addon (required).** Pick the file for your WoW version. Close WoW before you install.\n**2. Companion (optional, Windows).** Sends your saved game data to Discord and the website. Latest from the Microsoft Store.\n**3. Sign in with Discord.** One click; pairing and sync are then automatic. The 1-minute guide has every step.",
  fr: "**1. Addon (obligatoire).** Choisis le fichier de ta version de WoW. Ferme WoW avant d'installer.\n**2. Compagnon (facultatif, Windows).** Envoie tes données de jeu enregistrées vers Discord et le site. Dernière version du Microsoft Store.\n**3. Connecte-toi avec Discord.** Un clic; le lien et la synchronisation sont ensuite automatiques. Le guide d'une minute détaille chaque étape."
} as const;

const label = (lang: Lang, en: string, fr: string) => (lang === "fr" ? fr : en);

export function installPost(lang: Lang) {
  const embed = new EmbedBuilder().setTitle(TITLES[lang]).setColor(0xd4af37).setDescription(BODY[lang]).setFooter({ text: "Guilded" });
  const link = (text: string, url: string) => new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(text).setURL(url);
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    link(label(lang, "1 · Addon (CurseForge)", "1 · Addon (CurseForge)"), ADDON_URL),
    link(label(lang, "2 · Companion (Store)", "2 · Compagnon (Store)"), STORE_URL),
    link(label(lang, "Direct download (GitHub)", "Téléchargement direct (GitHub)"), GITHUB_URL),
    link(label(lang, "3 · Start here", "3 · Commencer ici"), lang === "fr" ? `${START_URL}?lang=fr` : START_URL)
  );
  return { embeds: [embed], components: [row], allowedMentions: { parse: [] as never[] } };
}

const urls = (components: readonly unknown[]): string => JSON.stringify(components.flatMap((row) => ((row as { components?: { url?: string | null }[] }).components ?? []).map((c) => c.url ?? "")));
const isOwned = (message: Message, channel: GuildTextBasedChannel) =>
  message.author.id === channel.client.user?.id && message.embeds.some((embed) => OWNED_TITLES.has(embed.title ?? ""));
const matches = (message: Message, lang: Lang) => {
  const post = installPost(lang);
  return message.embeds[0]?.title === post.embeds[0]!.data.title && message.embeds[0]?.description === post.embeds[0]!.data.description
    && urls(message.components) === urls(post.components.map((row) => row.toJSON()));
};

// The post, pinned or not: pins first, then the channel's recent messages, so an unpinned post
// (no Manage Messages) is still found and edited instead of posted again.
async function find(channel: GuildTextBasedChannel): Promise<{ message: Message; pinned: boolean } | null> {
  const pins = await pinnedMessages(channel).catch(() => [] as Message[]);
  const pinned = pins.find((message) => isOwned(message, channel));
  if (pinned) return { message: pinned, pinned: true };
  const recent = await channel.messages.fetch?.({ limit: 50 }).catch(() => null);
  const message = recent ? [...recent.values()].find((m) => isOwned(m, channel)) : undefined;
  return message ? { message, pinned: false } : null;
}

export type InstallPostState = "current" | "outdated" | "missing";

// Not pinned counts as out of date: "Update bot messages" tries to pin it again.
export async function installPostState(channel: GuildTextBasedChannel, lang: Lang): Promise<InstallPostState> {
  const found = await find(channel).catch(() => null);
  if (!found) return "missing";
  return found.pinned && matches(found.message, lang) ? "current" : "outdated";
}

/** Posts and pins the install post, or edits and pins the existing one. Returns false when it
 * could not be pinned (the bot lacks Manage Messages); the post itself is still in the channel. */
export async function ensureInstallPost(channel: GuildTextBasedChannel, lang: Lang): Promise<{ pinned: boolean }> {
  const found = await find(channel);
  let message = found?.message;
  if (message) {
    if (message.editable && !matches(message, lang)) await message.edit(installPost(lang));
    if (found!.pinned) return { pinned: true };
  } else {
    message = await channel.send(installPost(lang));
  }
  return { pinned: await message.pin().then(() => true, () => false) };
}

export const installPinHint = (lang: Lang) => tx(lang, "The install post is in the channel but not pinned: give Guilded the Manage Messages permission there, then press \"Update bot messages\" again.");
