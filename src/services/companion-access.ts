import type { Client } from "discord.js";
import type { PrismaClient } from "@prisma/client";
import { hasPermission } from "../permissions.js";
import { hashCompanionSecret } from "./character-pairing.js";
import { parseAddonSnapshot, type AddonSnapshot } from "../integrations/addon.js";

// A credential is revocable and scoped to one active Discord member in one guild.
// Never accept the old server-wide upload token as member authorization.
export async function companionAccess(database: PrismaClient, client: Client | undefined, guildId: string, discordId: string, secret: string) {
  if (!client || secret.length < 32 || secret.length > 256) return null;
  const credential = await database.companionCredential.findFirst({
    where: { tokenHash: hashCompanionSecret(secret), revokedAt: null, member: { guildId, status: "ACTIVE" } },
    select: { memberId: true, member: { select: { discordUserId: true } } }
  });
  if (!credential) return null;
  // Force a fresh fetch: a demoted or departed member must not retain officer access.
  const guild = await client.guilds.fetch(discordId);
  const member = await guild.members.fetch({ user: credential.member.discordUserId, force: true }).catch(() => null);
  if (!member) return null;
  return { memberId: credential.memberId, actorId: member.id, officer: hasPermission(member, "officer") };
}

// Personal companions cannot change the ledger, other players' readiness, prices,
// attendance or reserves. Build an allowlist, so newly added fields default to denied.
export function personalSnapshot(snapshot: AddonSnapshot, owned: { name: string; realm: string }[]): AddonSnapshot {
  const key = (name: string, realm: string) => `${name.toLowerCase()}\0${realm.toLowerCase()}`;
  const names = new Set(owned.map((c) => key(c.name, c.realm)));
  const own = (c: { character: string; realm: string }) => names.has(key(c.character, c.realm));
  const ownCharacter = (c: { name: string; realm: string }) => names.has(key(c.name, c.realm));
  return parseAddonSnapshot({
    source: snapshot.source, exportedAt: snapshot.exportedAt, wowGuild: snapshot.wowGuild,
    ...(snapshot.character && ownCharacter(snapshot.character) ? { character: snapshot.character } : {}),
    alts: snapshot.alts.filter(ownCharacter),
    readiness: snapshot.readiness.filter(own), attunements: snapshot.attunements.filter(own),
    recipes: snapshot.recipes.filter(own), cooldowns: snapshot.cooldowns.filter(own),
    recipeNames: Object.fromEntries(Object.entries(snapshot.recipeNames).filter(([key]) => snapshot.recipes.filter(own).some((set) => set.keys.includes(Number(key)))))
  });
}
