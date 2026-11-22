import type { PrismaClient } from "../generated/prisma/client.js";
import { characterTrustMap } from "./character-trust.js";
import { pointsFilter } from "./dungeon-stats.js";
import { newToken, serializeCookie, sign, unsign, type WebAuthConfig } from "./web-auth.js";

// Discord Linked Roles (application role connections), docs/LINKED_ROLES.md.
// A member's best confirmed WoW Forever character is shown on their Discord profile and servers can
// gate roles on it (Server Settings > Roles > Links). Values are pushed once, when the member opens the
// "Linked Roles Verification URL" and finishes Discord's consent screen. No token is stored: nothing
// here needs a migration, and the member opens the link again to refresh their values.

export const PLATFORM_NAME = "WoW Forever";
export const LINKED_ROLES_PATH = "/auth/linked-roles";
export const LINKED_ROLES_CALLBACK_PATH = "/auth/linked-roles/callback";
export const LINKED_ROLES_COOKIE = "__Host-guilded_linked_roles";
export const LINKED_ROLES_SCOPE = "identify role_connections.write";
const STATE_MINUTES = 10;
const API = "https://discord.com/api/v10";

// Discord's metadata record types.
export const METADATA_TYPE = {
  INTEGER_LESS_THAN_OR_EQUAL: 1,
  INTEGER_GREATER_THAN_OR_EQUAL: 2,
  BOOLEAN_EQUAL: 7
} as const;

export interface MetadataRecord {
  key: string;
  name: string;
  description: string;
  type: number;
  name_localizations: { fr: string };
  description_localizations: { fr: string };
}

/** The five records servers can build role requirements on (Discord allows five per application). */
export function metadataRecords(): MetadataRecord[] {
  return [
    {
      key: "character_level", type: METADATA_TYPE.INTEGER_GREATER_THAN_OR_EQUAL,
      name: "Character level at least", description: "Level of the member's verified WoW Forever character",
      name_localizations: { fr: "Niveau du personnage au moins" }, description_localizations: { fr: "Niveau du personnage WoW Forever vérifié du membre" }
    },
    {
      key: "dungeon_score", type: METADATA_TYPE.INTEGER_GREATER_THAN_OR_EQUAL,
      name: "Dungeon score at least", description: "Guilded dungeon points earned this season",
      name_localizations: { fr: "Pointage de donjons au moins" }, description_localizations: { fr: "Points de donjons Guilded gagnés cette saison" }
    },
    {
      key: "guild_rank", type: METADATA_TYPE.INTEGER_LESS_THAN_OR_EQUAL,
      name: "Guild rank at most", description: "In-game guild rank number: 0 is the guild master, 1 the next rank, and so on",
      name_localizations: { fr: "Rang de guilde au plus" }, description_localizations: { fr: "Numéro du rang de guilde en jeu : 0 est le maître de guilde, 1 le rang suivant, etc." }
    },
    {
      key: "in_guild", type: METADATA_TYPE.BOOLEAN_EQUAL,
      name: "In a WoW guild", description: "The verified character is in a guild Guilded knows",
      name_localizations: { fr: "Dans une guilde WoW" }, description_localizations: { fr: "Le personnage vérifié est dans une guilde connue de Guilded" }
    },
    {
      key: "member_days", type: METADATA_TYPE.INTEGER_GREATER_THAN_OR_EQUAL,
      name: "Days with Guilded at least", description: "Days since the member joined a Guilded server",
      name_localizations: { fr: "Jours avec Guilded au moins" }, description_localizations: { fr: "Jours depuis que le membre a rejoint un serveur Guilded" }
    }
  ];
}

/** Discord's limits: 5 records, key a-z0-9_ up to 50, name 100, description 200, same for each localization. */
export function metadataProblems(records: readonly MetadataRecord[] = metadataRecords()): string[] {
  const problems: string[] = [];
  if (records.length > 5) problems.push("more than 5 records");
  const keys = new Set<string>();
  for (const record of records) {
    if (!/^[a-z0-9_]{1,50}$/.test(record.key)) problems.push(`${record.key}: bad key`);
    if (keys.has(record.key)) problems.push(`${record.key}: duplicate key`);
    keys.add(record.key);
    if (record.name.length < 1 || record.name.length > 100) problems.push(`${record.key}: name length`);
    if (record.description.length < 1 || record.description.length > 200) problems.push(`${record.key}: description length`);
    if (record.name_localizations.fr.length < 1 || record.name_localizations.fr.length > 100) problems.push(`${record.key}: French name length`);
    if (record.description_localizations.fr.length < 1 || record.description_localizations.fr.length > 200) problems.push(`${record.key}: French description length`);
    if (![1, 2, 3, 4, 5, 6, 7, 8].includes(record.type)) problems.push(`${record.key}: bad type`);
  }
  return problems;
}

/** Owner-run (scripts/register-role-connections.ts), never at bot start: replaces the application's metadata schema. */
export async function registerMetadata(botToken: string, applicationId: string, fetcher: typeof fetch = fetch): Promise<MetadataRecord[]> {
  const records = metadataRecords();
  const problems = metadataProblems(records);
  if (problems.length) throw new Error(`Metadata is invalid: ${problems.join("; ")}`);
  const response = await fetcher(`${API}/applications/${applicationId}/role-connections/metadata`, {
    method: "PUT",
    headers: { authorization: `Bot ${botToken}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(records),
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`Discord refused the metadata (${response.status}).`);
  return records;
}

// --- What the member shows ---------------------------------------------------------------------------

export interface Candidate {
  name: string;
  level: number | null;
  isMain: boolean;
  guildRankIndex: number | null;
  memberId: string;
  guildId: string;
  memberSince: Date;
  evidenceRank: number;
}

/** The character shown: the chosen main first, then the highest level, then the strongest proof, then the name. */
export function pickCharacter(candidates: readonly Candidate[]): Candidate | null {
  const sorted = [...candidates].sort((a, b) =>
    Number(b.isMain) - Number(a.isMain) || (b.level ?? 0) - (a.level ?? 0) || b.evidenceRank - a.evidenceRank || a.name.localeCompare(b.name));
  return sorted[0] ?? null;
}

export type MetadataValues = Record<string, string | number | boolean>;

const DAY_MS = 86_400_000;

/** Pure: the metadata Discord stores. A value that is unknown is left out so a requirement on it fails, not passes. */
export function metadataValues(pick: Candidate, dungeonScore: number, oldestMemberSince: Date, now: Date): MetadataValues {
  const values: MetadataValues = {
    dungeon_score: Math.max(0, Math.floor(dungeonScore)),
    in_guild: pick.guildRankIndex !== null,
    member_days: Math.max(0, Math.floor((now.getTime() - oldestMemberSince.getTime()) / DAY_MS))
  };
  if (pick.level !== null && pick.level > 0) values['character_level'] = Math.floor(pick.level);
  if (pick.guildRankIndex !== null && pick.guildRankIndex >= 0) values['guild_rank'] = Math.floor(pick.guildRankIndex);
  return values;
}

export interface RoleConnection { platform_name: string; platform_username: string; metadata: MetadataValues }

export function roleConnectionBody(pick: Candidate, values: MetadataValues): RoleConnection {
  return { platform_name: PLATFORM_NAME, platform_username: pick.name.slice(0, 100), metadata: values };
}

type Db = Pick<PrismaClient, "character" | "characterVerifyClaim" | "guildRosterEntry" | "dungeonPointTransaction" | "dungeonSeason">;
const EVIDENCE = ["named", "companion", "heard", "game", "officer"];

/** The member's confirmed characters (links an officer, the game or their own synced companion vouched for; never merely reported ones). */
export async function loadProfile(db: Db, discordUserId: string, now: Date): Promise<{ connection: RoleConnection; character: string } | null> {
  const rows = await db.character.findMany({
    where: { member: { discordUserId, isTest: false, status: { not: "LEFT" } } },
    select: { id: true, memberId: true, guildId: true, name: true, realm: true, gameEdition: true, level: true, isMain: true, confirmedAt: true, linkEvidence: true, guildRankIndex: true, member: { select: { createdAt: true } } }
  });
  if (!rows.length) return null;
  const trust = new Map<string, string>();
  for (const guildId of new Set(rows.map((row) => row.guildId))) {
    const inGuild = rows.filter((row) => row.guildId === guildId);
    for (const [id, value] of await characterTrustMap(db, guildId, inGuild)) trust.set(id, value);
  }
  const confirmed = rows.filter((row) => trust.get(row.id) === "confirmed");
  const pick = pickCharacter(confirmed.map((row): Candidate => ({
    name: row.name, level: row.level, isMain: row.isMain, guildRankIndex: row.guildRankIndex, memberId: row.memberId, guildId: row.guildId,
    memberSince: row.member.createdAt, evidenceRank: EVIDENCE.indexOf(row.linkEvidence ?? "") + 1
  })));
  if (!pick) return null;
  const total = await db.dungeonPointTransaction.aggregate({ where: { ...(await pointsFilter(db, pick.guildId, "season", now)), memberId: pick.memberId }, _sum: { amount: true } });
  const oldest = rows.reduce((first, row) => row.member.createdAt < first ? row.member.createdAt : first, pick.memberSince);
  return { connection: roleConnectionBody(pick, metadataValues(pick, total._sum.amount ?? 0, oldest, now)), character: pick.name };
}

// --- OAuth ---------------------------------------------------------------------------------------------

export const callbackUrl = (auth: WebAuthConfig) => `${auth.siteUrl}${LINKED_ROLES_CALLBACK_PATH}`;

export function authorizeUrl(auth: WebAuthConfig, state: string): string {
  const url = new URL("https://discord.com/oauth2/authorize");
  url.search = new URLSearchParams({ response_type: "code", client_id: auth.clientId, scope: LINKED_ROLES_SCOPE, redirect_uri: callbackUrl(auth), state, prompt: "consent" }).toString();
  return url.href;
}

export function newState(auth: WebAuthConfig, now: Date): { state: string; cookie: string } {
  const state = newToken();
  const value = sign(auth.sessionSecret, `${state}|${now.getTime() + STATE_MINUTES * 60_000}`);
  return { state, cookie: serializeCookie(LINKED_ROLES_COOKIE, value, STATE_MINUTES * 60) };
}

/** True only when the cookie was signed here, has not expired, and holds the state Discord sent back. */
export function stateMatches(auth: WebAuthConfig, cookie: string | undefined, state: string | null, now: Date): boolean {
  const value = unsign(auth.sessionSecret, cookie);
  if (!value || !state) return false;
  const [saved, expires] = value.split("|");
  return saved === state && Number(expires) > now.getTime();
}

/** Code -> access token (kept in memory for this one request) and the user's id. */
export async function exchangeLinkedRolesCode(auth: WebAuthConfig, code: string, fetcher: typeof fetch = fetch): Promise<{ accessToken: string; userId: string }> {
  const tokenResponse = await fetcher(`${API}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: callbackUrl(auth), client_id: auth.clientId, client_secret: auth.clientSecret }).toString(),
    signal: AbortSignal.timeout(8_000)
  });
  if (!tokenResponse.ok) throw new Error("Discord refused the code.");
  const token = await tokenResponse.json() as { access_token?: unknown; scope?: unknown };
  if (typeof token.access_token !== "string") throw new Error("Discord sent no access token.");
  if (typeof token.scope !== "string" || !token.scope.split(" ").includes("role_connections.write")) throw new Error("The role connection permission was not granted.");
  const userResponse = await fetcher(`${API}/users/@me`, { headers: { authorization: `Bearer ${token.access_token}`, accept: "application/json" }, signal: AbortSignal.timeout(8_000) });
  if (!userResponse.ok) throw new Error("Discord did not return the account.");
  const user = await userResponse.json() as { id?: unknown };
  if (typeof user.id !== "string" || !/^\d{17,20}$/.test(user.id)) throw new Error("Discord returned an unexpected account.");
  return { accessToken: token.access_token, userId: user.id };
}

export async function pushRoleConnection(auth: WebAuthConfig, accessToken: string, connection: RoleConnection, fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher(`${API}/users/@me/applications/${auth.clientId}/role-connection`, {
    method: "PUT",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(connection),
    signal: AbortSignal.timeout(8_000)
  });
  if (!response.ok) throw new Error(`Discord refused the role connection (${response.status}).`);
}
