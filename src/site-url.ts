// The one place the bot decides its public website address (docs/plans/GUILDEDWOW_DOMAIN.md).
// PUBLIC_SITE_URL (the same value Discord sign-in uses as its redirect base) wins; otherwise the canonical
// guildedwow.com is used (guilded.kcaron.top stays a legacy host that redirects).
export const DEFAULT_SITE_ORIGIN = "https://guildedwow.com";
// Addresses that keep answering forever because released companions, addons and phone apps contain them.
export const LEGACY_SITE_HOSTS = ["guilded.kcaron.top"] as const;

export function siteOrigin(env: { PUBLIC_SITE_URL?: string | undefined } = process.env as { PUBLIC_SITE_URL?: string | undefined }): string {
  const configured = env.PUBLIC_SITE_URL?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === "https:") return url.origin;
    } catch { /* fall back to the default */ }
  }
  return DEFAULT_SITE_ORIGIN;
}

export const siteUrl = (path = "/", env?: { PUBLIC_SITE_URL?: string | undefined }): string => `${siteOrigin(env)}${path.startsWith("/") ? path : `/${path}`}`;
