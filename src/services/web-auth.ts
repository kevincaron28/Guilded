import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// "Sign in with Discord" for guilded.kcaron.top (7.0). The website reaches the bot through the
// Cloudflare Worker, so cookies are set for the website's host. Only the `identify` scope is asked
// for; the access token is used once to read the user's ID and name, then dropped.

export interface WebAuthConfig { clientId: string; clientSecret: string; siteUrl: string; sessionSecret: string }

export function webAuthConfig(env: { DISCORD_CLIENT_ID?: string; DISCORD_OAUTH_CLIENT_SECRET?: string | undefined; PUBLIC_SITE_URL?: string | undefined; WEB_SESSION_SECRET?: string | undefined }): WebAuthConfig | null {
  if (!env.DISCORD_CLIENT_ID || !env.DISCORD_OAUTH_CLIENT_SECRET || !env.PUBLIC_SITE_URL || !env.WEB_SESSION_SECRET) return null;
  return { clientId: env.DISCORD_CLIENT_ID, clientSecret: env.DISCORD_OAUTH_CLIENT_SECRET, siteUrl: new URL(env.PUBLIC_SITE_URL).origin, sessionSecret: env.WEB_SESSION_SECRET };
}

// __Host-: the browser keeps it only for this exact host, over HTTPS, at path /.
export const SESSION_COOKIE = "__Host-guilded_session";
export const STATE_COOKIE = "__Host-guilded_oauth";
export const SESSION_DAYS = 30;
const STATE_MINUTES = 10;

const mac = (secret: string, value: string) => createHmac("sha256", secret).update(value).digest("base64url");

function equal(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function sign(secret: string, value: string): string { return `${value}.${mac(secret, value)}`; }

export function unsign(secret: string, signed: string | undefined): string | null {
  if (!signed) return null;
  const dot = signed.lastIndexOf(".");
  if (dot <= 0) return null;
  const value = signed.slice(0, dot);
  return equal(signed.slice(dot + 1), mac(secret, value)) ? value : null;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    if (!name || Object.hasOwn(cookies, name)) continue;
    try { cookies[name] = decodeURIComponent(part.slice(index + 1).trim()); } catch { /* a garbled cookie is ignored */ }
  }
  return cookies;
}

export function serializeCookie(name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${encodeURIComponent(value)}; Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}
export const clearCookie = (name: string) => serializeCookie(name, "", 0);

export const newToken = () => randomBytes(32).toString("base64url");
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

// One CSRF token per session, put in every form as a hidden field. A cross-site page cannot read
// it, and the session cookie alone is not enough to post.
export const csrfToken = (secret: string, sessionToken: string) => mac(secret, `csrf:${sessionToken}`);
export function checkCsrf(secret: string, sessionToken: string | null, submitted: string | undefined): boolean {
  return Boolean(sessionToken && submitted && equal(submitted, csrfToken(secret, sessionToken)));
}

// A form post must come from the website itself: browsers send Origin on every POST (Referer as
// a fallback for older ones). Missing both is refused too.
export function sameOrigin(headers: { origin?: string | undefined; referer?: string | undefined }, siteUrl: string): boolean {
  const site = new URL(siteUrl).origin;
  if (headers.origin) return headers.origin === site;
  if (headers.referer) {
    try { return new URL(headers.referer).origin === site; } catch { return false; }
  }
  return false;
}

// Where to go after signing in: only this website's own pages, never another address.
// Public data pages may sit in an edition's section (/retail/leaderboards/: site/nav.mjs).
const RETURN_PATH = /^\/(?:me|(?:(?:forever|classic-era|tbc|mists|retail)\/)?(?:recruitment|leaderboards|players))(?:\/[A-Za-z0-9._~/-]*)?(?:\?[A-Za-z0-9._~=&%+-]*)?$/;
export function safeReturnPath(path: string | null | undefined): string {
  return path && path.length <= 300 && RETURN_PATH.test(path) && !path.includes("//") ? path : "/me/";
}

export function authorizeUrl(auth: WebAuthConfig, state: string): string {
  const url = new URL("https://discord.com/oauth2/authorize");
  url.search = new URLSearchParams({ response_type: "code", client_id: auth.clientId, scope: "identify", redirect_uri: `${auth.siteUrl}/auth/callback`, state, prompt: "none" }).toString();
  return url.href;
}

export function stateCookie(auth: WebAuthConfig, state: string, returnPath: string, now: Date): string {
  const value = sign(auth.sessionSecret, `${state}|${now.getTime() + STATE_MINUTES * 60_000}|${returnPath}`);
  return serializeCookie(STATE_COOKIE, value, STATE_MINUTES * 60);
}

export function readStateCookie(auth: WebAuthConfig, cookie: string | undefined, state: string | null, now: Date): { returnPath: string } | null {
  const value = unsign(auth.sessionSecret, cookie);
  if (!value || !state) return null;
  const [saved, expires, ...rest] = value.split("|");
  if (!saved || !equal(saved, state) || !(Number(expires) > now.getTime())) return null;
  return { returnPath: safeReturnPath(rest.join("|")) };
}

export interface DiscordIdentity { id: string; username: string; displayName: string | null }

// Code -> token -> /users/@me. Throws a short message when Discord refuses.
export async function exchangeCode(auth: WebAuthConfig, code: string, fetcher: typeof fetch = fetch): Promise<DiscordIdentity> {
  const tokenResponse = await fetcher("https://discord.com/api/v10/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: `${auth.siteUrl}/auth/callback`, client_id: auth.clientId, client_secret: auth.clientSecret }).toString(),
    signal: AbortSignal.timeout(8_000)
  });
  if (!tokenResponse.ok) throw new Error("Discord refused the sign-in code.");
  const token = await tokenResponse.json() as { access_token?: unknown; token_type?: unknown; scope?: unknown };
  if (typeof token.access_token !== "string") throw new Error("Discord sent no access token.");
  const userResponse = await fetcher("https://discord.com/api/v10/users/@me", {
    headers: { authorization: `Bearer ${token.access_token}`, accept: "application/json" }, signal: AbortSignal.timeout(8_000)
  });
  if (!userResponse.ok) throw new Error("Discord did not return the account.");
  const user = await userResponse.json() as { id?: unknown; username?: unknown; global_name?: unknown };
  if (typeof user.id !== "string" || !/^\d{17,20}$/.test(user.id) || typeof user.username !== "string") throw new Error("Discord returned an unexpected account.");
  return { id: user.id, username: user.username.slice(0, 40), displayName: typeof user.global_name === "string" ? user.global_name.slice(0, 40) : null };
}
