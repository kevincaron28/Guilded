/** Public pages the app opens in the browser. The hosted site moved to guildedwow.com on 12 November 2026. */
export const DEFAULT_WEB_ORIGIN = "https://guildedwow.com";
/** Hosts whose /app/ links open the app: the current site and the address older links and notices still use. */
export const APP_LINK_ORIGINS = [DEFAULT_WEB_ORIGIN, "https://guilded.kcaron.top"];
export const PRIVACY_URL = `${DEFAULT_WEB_ORIGIN}/docs/PRIVACY`;
/**
 * The public page that explains how to delete an account and its data (no sign-in needed to read it). The app itself
 * deletes through the API (GuildedClient.deleteMyData); this page is for someone who is signed out or whose server
 * does not offer the route yet. One constant, so the address can follow the website when its deletion page moves.
 */
export const DELETE_INFO_URL = `${DEFAULT_WEB_ORIGIN}/docs/PRIVACY#choices-access-and-deletion`;
