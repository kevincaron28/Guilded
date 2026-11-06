import { hostedPilot } from "../hosted-pilot.js";
import type { Client } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { hasPermission } from "../permissions.js";
import { hashCompanionSecret } from "./character-pairing.js";
import { parseAddonSnapshot, type AddonSnapshot } from "../integrations/addon.js";
import { currentGuildScope } from "./guild-scope.js";
import { characterKey, foreverSameName } from "../../companion/character-identity.mjs";
import { gameEditionOf } from "./game-edition.js";
import { relayableDungeonRuns } from "./guildmate-relay.js";

// A credential is revocable and scoped to one active Discord member in one guild.
// Never accept the old server-wide upload token as member authorization.
export async function companionAccess(database: PrismaClient, client: Client | undefined, guildId: string, discordId: string, secret: string) {
  if (!hostedPilot.allows(discordId) || !client || secret.length < 32 || secret.length > 256) return null;
  const credential = await database.companionCredential.findFirst({
    where: { tokenHash: hashCompanionSecret(secret), revokedAt: null, member: { guildId, status: "ACTIVE" } },
    select: { memberId: true, member: { select: { discordUserId: true } } }
  });
  if (!credential) return null;
  // Force a fresh fetch: a demoted or departed member must not retain officer access.
  const guild = await client.guilds.fetch(discordId);
  const member = await guild.members.fetch({ user: credential.member.discordUserId, force: true }).catch(() => null);
  if (!member) return null;
  const scope = currentGuildScope();
  if (scope?.memberRoleId && !member.permissions.has("Administrator") && !member.roles.cache.has(scope.memberRoleId)) return null;
  return { memberId: credential.memberId, actorId: member.id, officer: hasPermission(member, "officer"), raidLeader: hasPermission(member, "raidLeader") };
}

// Personal companions cannot change the ledger, other players' readiness, prices,
// attendance or reserves. Build an allowlist, so newly added fields default to denied.
export function personalSnapshot(snapshot: AddonSnapshot, owned: { name: string; realm: string }[]): AddonSnapshot {
  const edition = gameEditionOf(snapshot);
  const key = (name: string, realm: string) => edition === "forever" ? `${name.toLowerCase()}\0${realm.toLowerCase()}` : characterKey(name, realm, edition);
  const names = new Set(owned.map((c) => key(c.name, c.realm)));
  // WoW Forever, 8.5: an owned row may still hold the pre-8.5 first name ("Lebowski") while the
  // upload says "Lebowski Holyroller"; that counts as the member's own only when that single
  // owned row is the match (foreverSameName). Their own upload then renames the row.
  // Only for characters this PC reports as its own (character + alts), never a guildmate's.
  const pcNames = new Set([...(snapshot.character ? [snapshot.character] : []), ...snapshot.alts].map((c) => c.name.trim().toLowerCase()));
  const looseOwn = (name: string) => edition === "forever" && pcNames.has(name.split("-")[0]!.trim().toLowerCase())
    && owned.filter((c) => foreverSameName(c.name, name)).length === 1;
  const own = (c: { character: string; realm: string }) => names.has(key(c.character, c.realm)) || looseOwn(c.character);
  const ownCharacter = (c: { name: string; realm: string }) => names.has(key(c.name, c.realm)) || looseOwn(c.name);
  const ownNames = new Set(owned.map((c) => c.name.toLowerCase()));
  const ownsName = (name: string) => ownNames.has(name.split("-")[0]!.trim().toLowerCase()) || looseOwn(name);
  return parseAddonSnapshot({
    source: snapshot.source, exportedAt: snapshot.exportedAt, wowGuild: snapshot.wowGuild,
    gameEdition: snapshot.gameEdition, interface: snapshot.interface,
    ...(snapshot.character && ownCharacter(snapshot.character) ? { character: snapshot.character } : {}),
    alts: snapshot.alts.filter(ownCharacter),
    readiness: snapshot.readiness.filter(own), attunements: snapshot.attunements.filter(own),
    recipes: snapshot.recipes.filter(own), cooldowns: snapshot.cooldowns.filter(own),
    recipeNames: Object.fromEntries(Object.entries(snapshot.recipeNames).filter(([key]) => snapshot.recipes.filter(own).some((set) => set.keys.includes(Number(key))))),
    // Own postmatch reports only. record() still requires Discord consent and drops the rest.
    battlegroundReports: snapshot.battlegroundReports.filter((row) => row.edition === edition && names.has(key(row.character, row.realm))),
    // Duels where the member took part, and the member's own milestones (names are matched on apply).
    duelResults: snapshot.duelResults.filter((row) => { const r = row as { winner?: unknown; loser?: unknown } | null; return [r?.winner, r?.loser].some((n) => typeof n === "string" && ownsName(n)); }),
    milestones: snapshot.milestones.filter((row) => { const c = (row as { character?: unknown } | null)?.character; return typeof c === "string" && ownsName(c); }),
    // 8.5: the member's own dungeon runs and guildmates' runs reported by someone who played them
    // (guildmate-relay.ts). The usual run validation and one-row-per-run-id still apply on import.
    dungeonRuns: relayableDungeonRuns(snapshot.dungeonRuns, ownNames)
  });
}
