import { siteUrl } from "../site-url.js";
import { editionHref } from "../../site/nav.mjs";

// Search-result metadata of the public player, run and guild pages: unique titles and schema.org JSON-LD. Pure.

/** The public address of a page path inside the current edition's section, as the page's own canonical link writes it. */
export const publicUrl = (path: string, edition: string) => siteUrl(editionHref(path.replace(/\/+$/, "") || "/", edition).split("?")[0]!);

export function breadcrumbLd(items: { name: string; url: string }[]) {
  return { "@type": "BreadcrumbList", itemListElement: items.map((item, i) => ({ "@type": "ListItem", position: i + 1, name: item.name, item: item.url })) };
}

/** One JSON-LD graph: the page's own entity plus its breadcrumb trail. */
export const ldGraph = (...nodes: Record<string, unknown>[]) => ({ "@context": "https://schema.org", "@graph": nodes });

/** "Name: facts | Guilded" for a result title. */
export const seoTitle = (name: string, facts: string) => `${name}: ${facts} | Guilded`;
