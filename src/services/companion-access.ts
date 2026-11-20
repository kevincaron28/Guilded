import { hostedPilot } from "../hosted-pilot.js";
import type { Client } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { hasPermission } from "../permissions.js";
import { hashCompanionSecret } from "./character-pairing.js";
import { noteCredentialUse } from "./credential-use.js";
import { credentialBySecret } from "./companion-renew.js";
import { parseAddonSnapshot, type AddonSnapshot } from "../integrations/addon.js";
import { currentGuildScope } from "./guild-scope.js";
import { characterKey, idKey, sameCharacter } from "../../companion/character-identity.mjs";
import { gameEditionOf } from "./game-edition.js";
import { relayableCraftData, relayableDungeonRuns, type RelayLinkedCharacter } from "./guildmate-relay.js";

// A credential is revocable and scoped to one active Discord member in one guild.
// Never accept the old server-wide upload token as member authorization.
// previousSecretToo: the phone's alert settings also accept the secret a renewal replaced less than a day ago.
export interface CompanionAccessOptions {
  /** The credential row the caller just read (member id and Discord user): skips the second lookup of the same credential. */
  known?: { memberId: string; discordUserId: string } | undefined;
  /** Reuse this member's Discord role check for this many ms (uploads send several parts in a burst; 0 = always fetch). */
  cacheMs?: number;
}
type Access = { memberId: string; actorId: string; officer: boolean; raidLeader: boolean };
const roleChecks = new Map<string, { at: number; value: Access }>();

export async function companionAccess(database: PrismaClient, client: Client | undefined, guildId: string, discordId: string, secret: string, previousSecretToo = false, options: CompanionAccessOptions = {}) {
  if (!hostedPilot.allows(discordId) || secret.length < 32 || secret.length > 256) return null;
  if (!client) throw new CompanionUnavailable();
  const credential = options.known ? { memberId: options.known.memberId, member: { discordUserId: options.known.discordUserId } } : await database.companionCredential.findFirst({
    where: { ...(previousSecretToo ? credentialBySecret(secret) : { tokenHash: hashCompanionSecret(secret) }), revokedAt: null, member: { guildId, status: "ACTIVE" } },
    select: { memberId: true, member: { select: { discordUserId: true } } }
  });
  if (!credential) return null;
  noteCredentialUse(database.companionCredential, hashCompanionSecret(secret));
  const cacheKey = `${guildId}:${credential.member.discordUserId}`;
  const cacheMs = options.cacheMs ?? 0;
  const cached = cacheMs > 0 ? roleChecks.get(cacheKey) : undefined;
  if (cached && Date.now() - cached.at < cacheMs && cached.value.memberId === credential.memberId) return cached.value;
  // Force a fresh fetch: a demoted or departed member must not retain officer access.
  const guild = await client.guilds.fetch(discordId);
  const member = await guild.members.fetch({ user: credential.member.discordUserId, force: true }).catch((error: unknown) => {
    if (error && typeof error === "object" && "code" in error && error.code === 10007) return null;
    throw new CompanionUnavailable();
  });
  if (!member) return null;
  const scope = currentGuildScope();
  if (scope?.memberRoleId && !member.permissions.has("Administrator") && !member.roles.cache.has(scope.memberRoleId)) return null;
  const value: Access = { memberId: credential.memberId, actorId: member.id, officer: hasPermission(member, "officer"), raidLeader: hasPermission(member, "raidLeader") };
  if (cacheMs > 0) {
    if (roleChecks.size > 500) roleChecks.clear();
    roleChecks.set(cacheKey, { at: Date.now(), value });
  }
  return value;
}

export class CompanionUnavailable extends Error {
  constructor() { super("Discord membership could not be checked. Try again shortly."); }
}

// Personal companions cannot change the ledger, other players' readiness, prices,
// attendance or reserves. Build an allowlist, so newly added fields default to denied.
export function personalSnapshot(snapshot: AddonSnapshot, owned: { name: string; realm: string; wowId?: bigint | null }[],
  guildmates?: { uploaderMemberId: string; linked: readonly RelayLinkedCharacter[]; now?: Date }): AddonSnapshot {
  const edition = gameEditionOf(snapshot);
  const key = (name: string, realm: string) => edition === "forever" ? `${name.toLowerCase()}\0${realm.toLowerCase()}` : characterKey(name, realm, edition);
  const names = new Set(owned.map((c) => key(c.name, c.realm)));
  // WoW Forever, 8.5: an owned row may still hold the pre-8.5 first name ("Lebowski") while the
  // upload says "Lebowski Holyroller"; that counts as the member's own only when that single
  // owned row is the match (foreverSameName). Their own upload then renames the row.
  // Only for characters this PC reports as its own (character + alts), never a guildmate's.
  const pcNames = new Set([...(snapshot.character ? [snapshot.character] : []), ...snapshot.alts].map((c) => c.name.trim().toLowerCase()));
  // Character ids (docs/plans/CHARACTER_ID_MATCHING_2026-11-20.md): a report carrying a game id is the member's own exactly when an owned
  // row holds that id (a renamed character still is, a namesake never is). A report without an id, or an owned row without one, keeps the
  // name rules above. Both ids known: the ids alone decide, so an exact name never overrides a different id.
  const heldIds = new Set(owned.flatMap((c) => { const id = idKey(c.wowId); return id === null ? [] : [id]; }));
  const ownedRows = new Map<string, typeof owned>();
  for (const c of owned) { const k = key(c.name, c.realm); ownedRows.set(k, [...(ownedRows.get(k) ?? []), c]); }
  const sameName = (name: string, realm: string, id?: unknown) => {
    if (!names.has(key(name, realm))) return false;
    const reported = idKey(id);
    // A report with an id never claims an owned row that holds a different id.
    return reported === null || (ownedRows.get(key(name, realm)) ?? []).some((c) => idKey(c.wowId) === null || idKey(c.wowId) === reported);
  };
  const byId = (id?: unknown) => { const reported = idKey(id); return reported !== null && heldIds.has(reported); };
  const looseOwn = (name: string, id?: unknown) => edition === "forever" && pcNames.has(name.split("-")[0]!.trim().toLowerCase())
    && owned.filter((c) => sameCharacter(c.name, name, c.wowId, id)).length === 1;
  // A character this PC reports under a new name but an id an owned row holds: its other rows (readiness, recipes) still belong to the member.
  for (const c of [...(snapshot.character ? [snapshot.character] : []), ...snapshot.alts]) if (edition === "forever" && byId((c as { id?: unknown }).id)) names.add(key(c.name, c.realm));
  const own = (c: { character: string; realm: string }) => sameName(c.character, c.realm) || looseOwn(c.character);
  const ownCharacter = (c: { name: string; realm: string; id?: unknown }) => (edition === "forever" && byId(c.id)) || sameName(c.name, c.realm, c.id) || looseOwn(c.name, c.id);
  // 9.1: guildmates' crafting data the uploader's addon heard (only for characters already linked in this guild).
  const crafts = guildmates ? relayableCraftData(snapshot, guildmates.uploaderMemberId, guildmates.linked, guildmates.now) : null;
  const ownNames = new Set(owned.map((c) => c.name.toLowerCase()));
  const ownIds = new Map(owned.flatMap((c) => c.wowId === null || c.wowId === undefined ? [] : [[c.name.toLowerCase(), c.wowId] as const]));
  const ownsName = (name: string) => ownNames.has(name.split("-")[0]!.trim().toLowerCase()) || looseOwn(name);
  return parseAddonSnapshot({
    source: snapshot.source, exportedAt: snapshot.exportedAt, wowGuild: snapshot.wowGuild,
    gameEdition: snapshot.gameEdition, interface: snapshot.interface,
    ...(snapshot.character && ownCharacter(snapshot.character) ? { character: snapshot.character } : {}),
    alts: snapshot.alts.filter(ownCharacter),
    readiness: snapshot.readiness.filter(own), attunements: [...snapshot.attunements.filter(own), ...(crafts?.attunements ?? [])],
    recipes: [...snapshot.recipes.filter(own), ...(crafts?.recipes ?? [])], cooldowns: [...snapshot.cooldowns.filter(own), ...(crafts?.cooldowns ?? [])],
    recipeNames: { ...Object.fromEntries(Object.entries(snapshot.recipeNames).filter(([key]) => snapshot.recipes.filter(own).some((set) => set.keys.includes(Number(key))))), ...(crafts?.recipeNames ?? {}) },
    // Own postmatch reports only. record() still requires Discord consent and drops the rest.
    battlegroundReports: snapshot.battlegroundReports.filter((row) => row.edition === edition && sameName(row.character, row.realm)),
    // Duels where the member took part, and the member's own milestones (names are matched on apply).
    duelResults: snapshot.duelResults.filter((row) => { const r = row as { winner?: unknown; loser?: unknown } | null; return [r?.winner, r?.loser].some((n) => typeof n === "string" && ownsName(n)); }),
    // Duels outside the guild: only the ones this member reported as a side of the duel (the record's own side decides).
    externalDuels: snapshot.externalDuels.filter((row) => { const r = row as { winner?: unknown; loser?: unknown; side?: unknown } | null; const name = r?.side === "winner" ? r.winner : r?.side === "loser" ? r.loser : null; return typeof name === "string" && ownsName(name); }),
    milestones: snapshot.milestones.filter((row) => { const c = (row as { character?: unknown } | null)?.character; return typeof c === "string" && ownsName(c); }),
    // 8.5: the member's own dungeon runs and guildmates' runs reported by someone who played them
    // (guildmate-relay.ts). The usual run validation and one-row-per-run-id still apply on import.
    dungeonRuns: relayableDungeonRuns(snapshot.dungeonRuns, ownNames, undefined, ownIds)
  });
}
