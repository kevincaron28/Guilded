// Sitemaps of the public leaderboard pages (players, guilds, runs): a sitemap index plus paginated files, so crawlers find
// every public page. Pure string builders; the data (already filtered for hidden, deleted and opted-out players) comes from
// public-leaderboard.ts. Each page is listed with its English address and the French alternate (/fr/ path), like the pages' own hreflang.

import { frenchUrl } from "./web-layout.js";

/** Entries per sitemap file (the protocol allows 50,000; smaller files stay quick to build and fetch). */
export const SITEMAP_PAGE_SIZE = 5000;
export const SITEMAP_KINDS = ["players", "guilds", "runs"] as const;
export type SitemapKind = typeof SITEMAP_KINDS[number];
export interface SitemapEntry { path: string; lastmod?: Date | null }

const xml = (text: string) => text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!);
const day = (date: Date) => date.toISOString().slice(0, 10);

/** One file of the sitemap: its URLs with the English page and its French alternate. `absolute` turns a path into a public URL. */
export function sitemapUrlset(entries: SitemapEntry[], absolute: (path: string) => string): string {
  const body = entries.map(({ path, lastmod }) => {
    const en = absolute(path);
    return `<url><loc>${xml(en)}</loc>${lastmod ? `<lastmod>${day(lastmod)}</lastmod>` : ""}`
      + `<xhtml:link rel="alternate" hreflang="en" href="${xml(en)}"/><xhtml:link rel="alternate" hreflang="fr" href="${xml(frenchUrl(en))}"/></url>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${body}</urlset>\n`;
}

/** The files of every kind for these counts: `/leaderboards/sitemap-<kind>-<page>.xml`, pages from 1. */
export function sitemapFiles(counts: Record<SitemapKind, number>): { kind: SitemapKind; page: number; path: string }[] {
  return SITEMAP_KINDS.flatMap((kind) => Array.from({ length: Math.ceil(counts[kind] / SITEMAP_PAGE_SIZE) }, (_, i) => ({ kind, page: i + 1, path: `/leaderboards/sitemap-${kind}-${i + 1}.xml` })));
}

export function sitemapIndex(files: { path: string }[], absolute: (path: string) => string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${files.map((file) => `<sitemap><loc>${xml(absolute(file.path))}</loc></sitemap>`).join("")}</sitemapindex>\n`;
}

/** `sitemap-players-2.xml` -> { kind: "players", page: 2 }, or null. */
export function parseSitemapPath(path: string): { kind: SitemapKind; page: number } | null {
  const match = /^\/leaderboards\/sitemap-(players|guilds|runs)-([1-9][0-9]{0,3})\.xml$/.exec(path);
  return match ? { kind: match[1] as SitemapKind, page: Number(match[2]) } : null;
}
