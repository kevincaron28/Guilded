import { z } from "zod";

export const BNET_REGIONS = ["us", "eu", "kr", "tw"] as const;
export const BNET_EDITIONS = ["retail", "classic-era", "classic-tbc", "classic-mists"] as const;
export type BnetRegion = typeof BNET_REGIONS[number];
export type BnetEdition = typeof BNET_EDITIONS[number];
const namespaces: Record<BnetEdition, string> = { retail: "profile", "classic-era": "profile-classic1x", "classic-tbc": "profile-classicann", "classic-mists": "profile-classic" };
export interface BattleNetConfig { clientId: string; clientSecret: string; siteUrl: string }
export function battleNetConfig(env: { BATTLENET_CLIENT_ID?: string | undefined; BATTLENET_CLIENT_SECRET?: string | undefined; PUBLIC_SITE_URL?: string | undefined }): BattleNetConfig | null {
  if (!env.BATTLENET_CLIENT_ID || !env.BATTLENET_CLIENT_SECRET || !env.PUBLIC_SITE_URL) return null;
  return { clientId: env.BATTLENET_CLIENT_ID, clientSecret: env.BATTLENET_CLIENT_SECRET, siteUrl: new URL(env.PUBLIC_SITE_URL).origin };
}
export interface DiscoveredCharacter { region: BnetRegion; gameEdition: BnetEdition; realmId: number; characterId: number; name: string; realm: string }
export interface BattleNetDiscovery { subject: string; battleTag: string; characters: DiscoveredCharacter[]; region: BnetRegion; gameEdition: BnetEdition; verifiedAt: Date }
export const discoveredKey = (c: DiscoveredCharacter) => `${c.region}:${c.gameEdition}:${c.realmId}:${c.characterId}`;
export function battleNetAuthorize(config: BattleNetConfig, state: string) {
  const url = new URL("https://oauth.battle.net/authorize");
  url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: `${config.siteUrl}/me/battlenet/callback`, response_type: "code", scope: "openid wow.profile", state }).toString();
  return url.href;
}
const positiveId = z.number().int().positive().max(2147483647);
const characterSchema = z.object({ id: positiveId, name: z.string().min(1).max(100), realm: z.object({ id: positiveId, slug: z.string().min(1).max(100) }) });
const accountSchema = z.object({ wow_accounts: z.array(z.object({ characters: z.array(characterSchema).max(500) })).max(50) });

// No API-supplied URLs are followed, and no access/refresh token is persisted.
// Expired consent is renewed explicitly in Blizzard's own browser flow.
export async function discoverBattleNet(config: BattleNetConfig, code: string, region: BnetRegion, edition: BnetEdition, fetcher: typeof fetch = fetch): Promise<BattleNetDiscovery> {
  const signal = AbortSignal.timeout(15_000); // Stay inside the website proxy deadline.
  async function json(url: string, init: RequestInit) {
    const response = await fetcher(url, { ...init, redirect: "error", signal });
    if (!response.ok) throw new Error("Battle.net could not provide this account or edition. Reconnect or keep using addon sync.");
    const text = await response.text();
    if (text.length > 2_000_000) throw new Error("Battle.net returned too much data. Try again later.");
    return JSON.parse(text) as unknown;
  }
  const token = z.object({ access_token: z.string().min(1).max(4096), scope: z.string().optional() }).parse(await json("https://oauth.battle.net/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}` },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: `${config.siteUrl}/me/battlenet/callback` }).toString()
  }));
  if (token.scope && !token.scope.split(/\s+/).includes("wow.profile")) throw new Error("Character access was not granted. Addon sync remains available.");
  const headers = { authorization: `Bearer ${token.access_token}`, accept: "application/json" };
  const identity = z.object({ sub: z.union([z.string().regex(/^\d+$/), positiveId]).optional(), id: positiveId.optional(), battletag: z.string().min(1).max(100) }).parse(await json("https://oauth.battle.net/userinfo", { headers }));
  const subject = String(identity.sub ?? identity.id ?? "");
  if (!subject) throw new Error("Battle.net did not return a stable account ID.");
  const url = new URL(`https://${region}.api.blizzard.com/profile/user/wow`);
  url.search = new URLSearchParams({ namespace: `${namespaces[edition]}-${region}`, locale: "en_US" }).toString();
  const account = accountSchema.parse(await json(url.href, { headers }));
  const characters = [...new Map(account.wow_accounts.flatMap(a => a.characters).map(c => {
    const row = { region, gameEdition: edition, realmId: c.realm.id, characterId: c.id, name: c.name, realm: c.realm.slug };
    return [discoveredKey(row), row] as const;
  })).values()];
  if (characters.length > 500) throw new Error("Too many characters were returned. No selection was saved.");
  return { subject, battleTag: identity.battletag, characters, region, gameEdition: edition, verifiedAt: new Date() };
}
