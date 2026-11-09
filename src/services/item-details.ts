import { EmbedBuilder } from "discord.js";
import type { Lang } from "../i18n.js";
import { sanitizeName } from "./item-preview-embed.js";
import { nullItemDataProvider, type ItemDataProvider } from "./item-preview-data.js";

// 8.5 track D (request 9): the "Details" of a recipe's item, shared by the Discord button and the gallery page.
// Only what an authoritative provider (or the item id itself) says is shown; the default provider knows nothing,
// so Details then gives the id and a Wowhead link and says plainly that stats are not available yet.
// Track C builds a compact Details button for item links in chat; both use the item-preview data seam, so a provider
// connected there lights up both places.

export const QUALITY_NAMES: Record<Lang, string[]> = {
  en: ["Poor", "Common", "Uncommon", "Rare", "Epic", "Legendary"],
  fr: ["Médiocre", "Commun", "Inhabituel", "Rare", "Épique", "Légendaire"]
};
const QUALITY_COLORS = [0x9d9d9d, 0xffffff, 0x1eff00, 0x0070dd, 0xa335ee, 0xff8000];

export interface ItemDetailView {
  itemKey: number; name: string; quality?: number; summary?: string; url: string; iconUrl?: string;
  /** True when a provider supplied stats; false when only the id is known. */
  hasStats: boolean;
  /** Classic Era data shown because Forever does not know this id (may differ in Forever). */
  classicFallback?: boolean;
}

const httpsOnly = (url?: string) => { try { return url && new URL(url).protocol === "https:" ? url : undefined; } catch { return undefined; } };

export async function itemDetails(itemKey: number, itemName: string, provider: ItemDataProvider = nullItemDataProvider, lang: Lang = "en"): Promise<ItemDetailView> {
  const found = await provider.lookup({ itemId: itemKey, name: itemName, verified: true }).catch(() => null);
  const local = lang === "fr" && found?.fr ? found.fr : found;
  const view: ItemDetailView = { itemKey, name: local?.name ?? itemName, url: httpsOnly(found?.url) ?? `https://www.wowhead.com/classic/item=${itemKey}`, hasStats: !!(found?.summary || found?.quality !== undefined) };
  if (found?.quality !== undefined) view.quality = found.quality;
  const summary = local?.summary ?? found?.summary;
  if (summary) view.summary = summary;
  if (found?.source === "classic1x") view.classicFallback = true;
  const icon = httpsOnly(found?.iconUrl);
  if (icon) view.iconUrl = icon;
  return view;
}

/** Plain lines for either surface. */
export function itemDetailLines(view: ItemDetailView, lang: Lang = "en"): string[] {
  const fr = lang === "fr";
  const lines: string[] = [];
  if (view.quality !== undefined && QUALITY_NAMES[lang][view.quality]) lines.push(QUALITY_NAMES[lang][view.quality]!);
  if (view.summary) lines.push(view.summary.slice(0, 200));
  lines.push(fr ? `Objet n° ${view.itemKey}` : `Item ID ${view.itemKey}`);
  if (view.classicFallback) lines.push(fr ? "Données de Classic Era : WoW Forever ne connaît pas cet objet, il peut y être différent." : "Classic Era data: WoW Forever does not list this item, so it may differ there.");
  if (!view.hasStats) lines.push(fr ? "Les statistiques ne sont pas encore disponibles ici; voyez le lien." : "Stats are not available here yet; see the link.");
  else lines.push(fr ? "Données d'objet : Blizzard" : "Item data: Blizzard");
  return lines;
}

export function itemDetailsEmbed(view: ItemDetailView, lang: Lang = "en"): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(view.quality !== undefined ? QUALITY_COLORS[view.quality] ?? 0x5865f2 : 0x5865f2)
    .setTitle(sanitizeName(view.name, 200)).setURL(view.url).setDescription(itemDetailLines(view, lang).map(line => sanitizeName(line, 200)).join("\n"));
  if (view.iconUrl) embed.setThumbnail(view.iconUrl);
  return embed;
}
