import { paintedKey } from "./dungeon-card.js";

// The painted dungeon pictures on the website: site/dungeon-art/<key>.jpg is published by the site build (scripts/dungeon-thumbs.mjs)
// as /images/dungeons/<key>-480.webp (480 x 252) and <key>-1200.webp (1200 x 630). `paintedKey` maps an English or French
// dungeon name to <key>; a dungeon without a painting gets a quiet placeholder of the same size, so rows never shift.

/** The picture key of a dungeon name (or of the first of several names that has one), or null. */
export const dungeonArtKey = (...names: (string | null | undefined)[]): string | null => {
  for (const name of names) { const key = name ? paintedKey(name) : undefined; if (key) return key; }
  return null;
};

/** A 64 x 34 rounded thumbnail for table rows and strips. Decorative (empty alt), lazy, sized, so nothing moves while it loads. */
export const dungeonThumb = (...names: (string | null | undefined)[]): string => {
  const key = dungeonArtKey(...names);
  return key
    ? `<img class="dthumb" src="/images/dungeons/${key}-480.webp" alt="" width="64" height="34" loading="lazy" decoding="async">`
    : `<span class="dthumb ph" aria-hidden="true"></span>`;
};

/** The wide header of one dungeon's page: its painting under a dark overlay with the name and a line of facts on top. */
export const dungeonHeader = (title: string, facts: string[], ...names: (string | null | undefined)[]): string => {
  const key = dungeonArtKey(...names);
  const text = `<h2>${title}</h2>${facts.length ? `<p>${facts.join(" · ")}</p>` : ""}`;
  if (!key) return `<header class="dungeon-head plain">${text}</header>`;
  return `<header class="dungeon-head"><img src="/images/dungeons/${key}-480.webp" srcset="/images/dungeons/${key}-480.webp 480w, /images/dungeons/${key}-1200.webp 1200w" sizes="(max-width:900px) 100vw, 900px" alt="" width="1200" height="315" loading="eager" fetchpriority="high"><div class="shade"></div><div class="text">${text}</div></header>`;
};

/** Left-border class colour for rank rows: `.rk-c-<class>` (class names are the site's `c-<class>` slugs). */
export const classBorder = (slug: string | null | undefined): string => slug ? ` rk-c-${slug}` : "";
