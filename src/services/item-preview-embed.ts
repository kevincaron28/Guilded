import type { ParsedItem } from "./item-links.js";
import type { ItemDetails } from "./item-preview-data.js";

export interface WebhookEmbed {
  title: string; description?: string; url?: string; color: number;
  thumbnail?: { url: string }; footer?: { text: string };
}
export interface WebhookPayload { embeds: WebhookEmbed[]; allowed_mentions: { parse: never[] } }

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

export function buildItemEmbed(item: ParsedItem, found: ItemDetails | null, lang: "en" | "fr" = "en"): WebhookEmbed {
  const fr = lang === "fr";
  // A name-only link counts as known only when the source found exactly one item with that exact name.
  const nameMatch = !item.verified && found?.matchedBy === "name" && found.itemId ? found.itemId : null;
  const details = item.verified || nameMatch ? found : null;
  const local = fr && details?.fr ? details.fr : details;
  const quality = details?.quality ?? item.quality;
  const color = quality !== undefined && QUALITY_COLOR[quality] !== undefined ? QUALITY_COLOR[quality]! : NEUTRAL;
  const lines: string[] = [];
  const qualityName = (fr ? QUALITY_NAME_FR : QUALITY_NAME)[quality ?? -1];
  if (qualityName) lines.push(qualityName);
  const summary = local?.summary ?? details?.summary;
  if (summary) lines.push(sanitizeName(summary, 200));
  if (item.verified) {
    lines.push(fr ? `Objet n° ${item.itemId}` : `Item ID ${item.itemId}`);
    if (item.suffixId) lines.push(fr ? `Suffixe aléatoire ${item.suffixId}` : `Random suffix ${item.suffixId}`);
    if (item.enchantId) lines.push(fr ? `Enchantement ${item.enchantId}` : `Enchant ${item.enchantId}`);
  } else if (nameMatch) {
    lines.push(fr ? `Objet n° ${nameMatch} (trouvé par son nom exact)` : `Item ID ${nameMatch} (matched by its exact name)`);
  } else {
    lines.push(fr ? "Non vérifié : seul le nom a été partagé, aucune statistique n'est montrée." : "Unverified: only the name was shared, so no stats are shown.");
  }
  if (details?.source === "classic1x") lines.push(fr ? "Données de Classic Era : WoW Forever ne connaît pas cet objet, il peut y être différent." : "Classic Era data: WoW Forever does not list this item, so it may differ there.");
  const embed: WebhookEmbed = {
    title: sanitizeName(local?.name ?? details?.name ?? item.name),
    description: lines.join("\n").slice(0, 400),
    color,
    footer: { text: item.verified || nameMatch ? (fr ? "Aperçu d'objet Guilded" : "Guilded item preview") : (fr ? "Aperçu d'objet Guilded (non vérifié)" : "Guilded item preview (unverified)") }
  };
  // A link is offered only for a verified numeric id (or one a provider vouched for).
  const url = httpsOnly(details?.url) ?? (item.verified && item.itemId ? `https://www.wowhead.com/classic/item=${item.itemId}` : undefined);
  if (url) embed.url = url;
  const icon = httpsOnly(details?.iconUrl);
  if (icon) embed.thumbnail = { url: icon };
  return embed;
}

export function buildPayload(embeds: WebhookEmbed[]): WebhookPayload {
  return { embeds: embeds.slice(0, 5), allowed_mentions: { parse: [] } };
}
