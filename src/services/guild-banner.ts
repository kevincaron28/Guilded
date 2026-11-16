// Painted banner at the top of a public guild page (WebP at 1600 and 800 wide, copied by the site build).
// Until guilds can pick a theme in their page settings, the theme follows the guild's id, so a guild always gets the same picture.
export const GUILD_BANNER_THEMES = ["forest", "mountain", "snow", "harbour", "cavern", "desert", "ruins", "volcano", "swamp"] as const;
export type GuildBannerTheme = (typeof GUILD_BANNER_THEMES)[number];

export function guildBannerTheme(key: string): GuildBannerTheme {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619) >>> 0;
  return GUILD_BANNER_THEMES[hash % GUILD_BANNER_THEMES.length]!;
}

const CSS = ".guild-banner{display:block;width:100%;height:auto;aspect-ratio:1600/360;object-fit:cover;border-radius:12px;border:1px solid var(--line,#3a3128);margin:0 0 14px}";

/** The banner picture, decorative (empty alt), with its own style rule so any guild page can carry it. */
export const guildBanner = (key: string): string => {
  const theme = guildBannerTheme(key);
  return `<style>${CSS}</style><img class="guild-banner" src="/images/web/banner-${theme}-1600.webp" srcset="/images/web/banner-${theme}-800.webp 800w, /images/web/banner-${theme}-1600.webp 1600w" sizes="(max-width:900px) 100vw, 900px" alt="" width="1600" height="360" loading="eager" fetchpriority="high">`;
};
