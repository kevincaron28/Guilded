import type { ParsedItem } from "./item-links.js";
import type { ItemDetails, ItemFacts } from "./item-preview-data.js";

export interface WebhookEmbed {
  title: string; description?: string; url?: string; color: number;
  thumbnail?: { url: string }; footer?: { text: string };
  fields?: { name: string; value: string; inline?: boolean }[];
}
export interface WebhookPayload { embeds: WebhookEmbed[]; allowed_mentions: { parse: never[] }; username?: string; avatar_url?: string }

/** The sender's name on every item preview (a webhook name, set per post). */
export const PREVIEW_NAME = { en: "Guilded Items", fr: "Objets Guilded" } as const;
/** The Guilded logo as the website serves it (site/brand/logo-400.png). */
export const PREVIEW_AVATAR_PATH = "/brand/logo-400.png";

const QUALITY_COLOR = [0x9d9d9d, 0xffffff, 0x1eff00, 0x0070dd, 0xa335ee, 0xff8000];
const QUALITY_NAME = ["Poor", "Common", "Uncommon", "Rare", "Epic", "Legendary"];
const QUALITY_NAME_FR = ["Médiocre", "Commun", "Inhabituel", "Rare", "Épique", "Légendaire"];
const NEUTRAL = 0x5865f2;

/** Neutralises mentions, markdown, links and control characters in text taken from chat. */
export function sanitizeName(name: string, max = 60): string {
  let out = "";
  for (const ch of name) {
    if (ch < " " || ch === "\u007f") continue;
    if (ch === "@") { out += "＠"; continue; }
    if (ch === ":") { out += "∶"; continue; }
    if ("\\`*_~|>#[]()<".includes(ch)) { out += "\\" + ch; continue; }
    out += ch;
  }
  out = out.trim();
  return out.length > max ? out.slice(0, max - 1) + "…" : out;
}

const httpsOnly = (url?: string) => { try { return url && new URL(url).protocol === "https:" ? url : undefined; } catch { return undefined; } };

/** A Wowhead search for a name (Classic database): the link for a bracket-only name no source could match. */
export const wowheadSearchUrl = (name: string) => `https://www.wowhead.com/classic/search?q=${encodeURIComponent(name.trim().slice(0, 60))}`;

export function buildItemEmbed(item: ParsedItem, found: ItemDetails | null, lang: "en" | "fr" = "en"): WebhookEmbed {
  const fr = lang === "fr";
  // A name-only link counts as known only when the source found exactly one item with that exact name.
  const nameMatch = !item.verified && found?.matchedBy === "name" && found.itemId ? found.itemId : null;
  const details = item.verified || nameMatch ? found : null;
  const local = fr && details?.fr ? details.fr : details;
  const quality = details?.quality ?? item.quality;
  const color = quality !== undefined && QUALITY_COLOR[quality] !== undefined ? QUALITY_COLOR[quality]! : NEUTRAL;
  const lines: string[] = [];
  const fields: NonNullable<WebhookEmbed["fields"]> = [];
  const facts: ItemFacts | undefined = fr && details?.fr?.facts ? details.fr.facts : details?.facts;
  const qualityName = (fr ? QUALITY_NAME_FR : QUALITY_NAME)[quality ?? -1];
  const clean = (text: string, max = 200) => sanitizeName(text, max);
  if (facts) {
    // Fixed order: quality, slot and type; armour or damage; stats; effects; then level and price as small fields.
    const head = [qualityName ? `**${qualityName}**` : "", facts.slot ? clean(facts.slot, 40) : "", facts.type ? clean(facts.type, 40) : ""].filter(Boolean).join(" · ");
    if (head) lines.push(head);
    const power = [facts.armor, facts.damage].filter((text): text is string => !!text).map(text => clean(text, 60)).join(" · ");
    if (power) lines.push(power);
    if (facts.stats?.length) lines.push(`**${fr ? "Stats" : "Stats"}** ${facts.stats.map(text => clean(text, 40)).join(" · ")}`);
    for (const effect of facts.effects ?? []) lines.push(`*${clean(effect, 120)}*`);
    if (facts.binding) lines.push(clean(facts.binding, 40));
    if (facts.itemLevel) fields.push({ name: fr ? "Niveau d'objet" : "Item level", value: String(facts.itemLevel), inline: true });
    if (facts.requiredLevel) fields.push({ name: fr ? "Niveau requis" : "Requires", value: String(facts.requiredLevel), inline: true });
    if (facts.sellCopper) fields.push({ name: fr ? "Vente" : "Sells for", value: formatMoney(facts.sellCopper), inline: true });
  } else {
    if (qualityName) lines.push(`**${qualityName}**`);
    const summary = local?.summary ?? details?.summary;
    if (summary) lines.push(clean(summary, 200));
  }
  if (!item.verified && !nameMatch) {
    lines.push(fr ? "*Non vérifié : seul le nom a été partagé, aucune statistique n'est montrée. Le titre ouvre une recherche Wowhead.*" : "*Unverified: only the name was shared, so no stats are shown. The title opens a Wowhead search.*");
  } else if (nameMatch) {
    lines.push(fr ? "*Trouvé par son nom exact.*" : "*Matched by its exact name.*");
  }
  if (item.verified && item.suffixId) lines.push(fr ? `Suffixe aléatoire ${item.suffixId}` : `Random suffix ${item.suffixId}`);
  if (item.verified && item.enchantId) lines.push(fr ? `Enchantement ${item.enchantId}` : `Enchant ${item.enchantId}`);
  if (details?.source === "classic1x") lines.push(fr ? "*Données de Classic Era : WoW Forever ne connaît pas cet objet, il peut y être différent.*" : "*Classic Era data: WoW Forever does not list this item, so it may differ there.*");
  const id = item.verified ? item.itemId : nameMatch;
  const known = item.verified || nameMatch;
  const footerParts = [fr ? "Objets Guilded" : "Guilded Items"];
  if (id) footerParts.push(fr ? `Objet n° ${id}` : `Item ${id}`);
  if (details?.summary || facts) footerParts.push(fr ? "Données : Blizzard" : "Data: Blizzard");
  const embed: WebhookEmbed = {
    title: sanitizeName(local?.name ?? details?.name ?? item.name),
    description: lines.join("\n").slice(0, 600),
    color,
    footer: { text: footerParts.join(" · ") + (known ? "" : fr ? " · non vérifié" : " · unverified") }
  };
  if (fields.length) embed.fields = fields;
  // An item link only for a verified numeric id (or one a provider vouched for). A name nobody could match gets a
  // Wowhead search for that name instead: still a link, never an invented id.
  const url = httpsOnly(details?.url) ?? (item.verified && item.itemId ? `https://www.wowhead.com/classic/item=${item.itemId}` : wowheadSearchUrl(item.name));
  if (url) embed.url = url;
  const icon = httpsOnly(details?.iconUrl);
  if (icon) embed.thumbnail = { url: icon };
  return embed;
}

/** Copper to "1g 20s 5c" (zero parts left out). */
export function formatMoney(copper: number): string {
  const gold = Math.floor(copper / 10000), silver = Math.floor(copper / 100) % 100, rest = copper % 100;
  return [gold ? `${gold}g` : "", silver ? `${silver}s` : "", rest ? `${rest}c` : ""].filter(Boolean).join(" ") || "0c";
}

/** The webhook post: embeds plus the sender identity (name and, when the site address is known, the Guilded logo). */
export function buildPayload(embeds: WebhookEmbed[], opts: { lang?: "en" | "fr"; siteUrl?: string } = {}): WebhookPayload {
  const payload: WebhookPayload = { embeds: embeds.slice(0, 5), allowed_mentions: { parse: [] }, username: PREVIEW_NAME[opts.lang ?? "en"] };
  const avatar = opts.siteUrl ? httpsOnly(new URL(PREVIEW_AVATAR_PATH, opts.siteUrl).href) : undefined;
  if (avatar) payload.avatar_url = avatar;
  return payload;
}
