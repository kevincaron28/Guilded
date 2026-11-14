/** Public pages the app opens in the browser. The hosted site moved to guildedwow.com on 12 November 2026. */
export const DEFAULT_WEB_ORIGIN = "https://guildedwow.com";
/** Hosts whose /app/ links open the app: the current site and the address older links and notices still use. */
export const APP_LINK_ORIGINS = [DEFAULT_WEB_ORIGIN, "https://guilded.kcaron.top"];
export const PRIVACY_URL = `${DEFAULT_WEB_ORIGIN}/docs/PRIVACY`;
/** "Delete my data" lives on the website of the server the member signed in to; it asks for the Discord sign-in first. */
export function deleteDataUrl(webOrigin: string): string {
  return `${webOrigin.replace(/\/+$/, "")}/auth/login?return=%2Fme%2Fdata`;
}
