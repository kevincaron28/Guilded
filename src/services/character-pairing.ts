import { createHash, randomBytes } from "node:crypto";
import { mergeProfessionSkills } from "./profession-names.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import type { AddonCharacter } from "../integrations/addon.js";
import { findCharacter } from "./character-match.js";
import { normalizeClassName, normalizeRaceName } from "./character-import.js";
import { characterKey, foreverSameName } from "../../companion/character-identity.mjs";
import { guildRankUpdate } from "./guild-rank.js";
import { gameEditionOf } from "./game-edition.js";

const PAIRING_CODE_LIFETIME_MS = 15 * 60_000;
type Tx = Prisma.TransactionClient;

export function hashCompanionSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

// Creates the exporter's own character (professions + unclaimed cleanup
// included). Shared by the immediate upload-time link (linkPairedCharacter,
// its own transaction) and the apply-time safety net in addon-import.ts
// (already inside its own transaction) so the two never drift apart.
// confirm: the member's own signed-in companion (or an officer) brought it, so it is confirmed, not only
// reported (Character.confirmedAt, the "reported, not verified" label in character-trust.ts).
export async function createSelfCharacter(tx: Tx, guildId: string, memberId: string, self: AddonCharacter, confirm = false) {
  const hasMain = (await tx.character.count({ where: { memberId, isMain: true } })) > 0;
  const created = await tx.character.create({
    data: {
      memberId,
      guildId,
      name: self.name,
      gameEdition: gameEditionOf(self),
      ...(self.displayName ? { displayName: self.displayName } : {}),
      realm: self.realm,
      className: normalizeClassName(self.class as string),
      race: self.race ? normalizeRaceName(self.race) : null,
      level: self.level >= 1 ? self.level : null,
      spec: self.spec || null,

      ...guildRankUpdate(self),
      isMain: !hasMain,
      professionsUpdatedAt: self.professionsComplete === true ? self.professionsAt ?? new Date() : null,
      lastSeenAt: new Date(),
      ...(confirm ? { confirmedAt: new Date() } : {})
    }
  });
  for (const profession of mergeProfessionSkills(self.professions)) {
    await tx.professionSkill.upsert({
      where: { characterId_profession: { characterId: created.id, profession: profession.name } },
      create: { characterId: created.id, profession: profession.name, skillLevel: profession.skillLevel },
      update: { skillLevel: profession.skillLevel }
    });
  }
  await tx.unclaimedCharacter.deleteMany({ where: { guildId, nameKey: characterKey(self.name, self.realm, gameEditionOf(self)) } });
  return created;
}

export async function linkPairedCharacter(database: PrismaClient, guildId: string, memberId: string, self: AddonCharacter, options: { confirm?: boolean } = {}) {
  if (!self.class) return "missing-class" as const;
  try {
    return await linkPairedCharacterOnce(database, guildId, memberId, self, options.confirm === true);
  } catch (error) {
    // A parallel request linked this character between our look and our create (unique constraint, P2002):
    // it is linked, so say so and let the upload carry on.
    if ((error as { code?: string } | null)?.code === "P2002") return "already-linked" as const;
    throw error;
  }
}

async function linkPairedCharacterOnce(database: PrismaClient, guildId: string, memberId: string, self: AddonCharacter, confirm: boolean) {
  return database.$transaction(async (tx) => {
    const characters = await tx.character.findMany({
      where: { member: { guildId } },
      include: { member: true }
    });
    const existing = findCharacter(characters, self.name, self.realm, gameEditionOf(self));
    if (existing && existing.memberId !== memberId) return "owned-by-another" as const;

    if (existing) {
      // WoW Forever, 8.5: the member's own upload names this character in full ("Lebowski
      // Holyroller") while the row still has the pre-8.5 first-name key: it takes the full name,
      // so the member's other "Lebowski" alts become their own rows instead of sharing this one.
      const upgradeName = gameEditionOf(self) === "forever" && !existing.name.trim().includes(" ")
        && self.name.trim().includes(" ") && foreverSameName(existing.name, self.name);
      await tx.character.update({
        where: { id: existing.id },
        data: {
          ...(upgradeName ? { name: self.name.trim().replace(/\s+/g, " "), legacyName: existing.name } : {}),
          ...(self.displayName ? { displayName: self.displayName } : {}),
          className: normalizeClassName(self.class as string),
          race: self.race ? normalizeRaceName(self.race) : null,
          level: self.level >= 1 ? self.level : null,
          spec: self.spec || null,

          ...guildRankUpdate(self),
          lastSeenAt: new Date(),
          ...(confirm && !existing.confirmedAt ? { confirmedAt: new Date() } : {})
        }
      });
      return "already-linked" as const;
    }
    // An officer took this character away from this member: their uploads must not link it back.
    const removed = await tx.characterVerifyClaim.findFirst({
      where: { guildId, memberId, nameKey: characterKey(self.name, self.realm, gameEditionOf(self)), status: "REMOVED" },
      select: { id: true }
    });
    if (removed) return "removed-by-officer" as const;
    await createSelfCharacter(tx, guildId, memberId, self, confirm);
    return "linked" as const;
  // 9.0.8: its own budget. The 5 s default ran out while a big upload's import held the database (P2028, 9 November).
  }, { timeout: 20_000, maxWait: 10_000 });
}

// Revokes every credential this member currently has (unlinking them from
// every paired companion). An officer's unlink no longer needs this: it marks
// the character REMOVED, which linkPairedCharacter respects.
export async function revokeCompanionCredentials(database: PrismaClient | Tx, memberId: string): Promise<void> {
  await database.companionCredential.updateMany({ where: { memberId, revokedAt: null }, data: { revokedAt: new Date() } });
}

// A fresh companion credential for this device, retaining other devices: the companion's
// Discord sign-in (companion-signin.ts) uses it after checking the member is in the server.
export async function issueMemberCredential(database: PrismaClient, memberId: string, deviceName = "Paired companion"): Promise<string> {
  const credential = randomBytes(32).toString("base64url");
  await database.$transaction(async (tx) => {
    await tx.companionCredential.create({ data: { memberId, deviceName: cleanDeviceName(deviceName), tokenHash: hashCompanionSecret(credential) } });
  });
  return credential;
}

export async function issueCharacterPairingCode(database: PrismaClient, guildId: string, memberId: string, now = new Date()) {
  const code = randomBytes(6).toString("hex").toUpperCase();
  const expiresAt = new Date(now.getTime() + PAIRING_CODE_LIFETIME_MS);
  await database.characterPairing.upsert({
    where: { guildId_memberId: { guildId, memberId } },
    create: { guildId, memberId, codeHash: hashCompanionSecret(code), expiresAt },
    update: { codeHash: hashCompanionSecret(code), expiresAt, consumedAt: null }
  });
  return { code, expiresAt };
}

// Lets a member connect with the code alone: the server comes from the code. Codes are 48 random
// bits and live 15 minutes, so two servers sharing one is unlikely; then the companion asks for the ID.
export async function findPairingServer(database: PrismaClient, submittedCode: string, now = new Date()): Promise<string | "ambiguous" | null> {
  const rows = await database.characterPairing.findMany({
    where: { codeHash: hashCompanionSecret(submittedCode.trim().toUpperCase()), expiresAt: { gt: now }, consumedAt: null },
    select: { guild: { select: { discordId: true } } },
    take: 2
  });
  const servers = new Set(rows.map((row) => row.guild.discordId));
  if (servers.size > 1) return "ambiguous";
  return rows[0]?.guild.discordId ?? null;
}

export async function exchangeCharacterPairingCode(database: PrismaClient, guildDiscordId: string, submittedCode: string, now = new Date()) {
  const codeHash = hashCompanionSecret(submittedCode.trim().toUpperCase());
  const credential = randomBytes(32).toString("base64url");

  return database.$transaction(async (tx) => {
    const pairing = await tx.characterPairing.findFirst({
      where: { codeHash, guild: { discordId: guildDiscordId }, expiresAt: { gt: now }, consumedAt: null },
      select: { id: true, memberId: true, guild: { select: { id: true, name: true, gameEdition: true } }, member: { select: { discordUserId: true } } }
    });
    if (!pairing) throw new Error("Pairing code is invalid, expired, or already used. Generate a new one with /character pair.");

    const consumed = await tx.characterPairing.updateMany({
      where: { id: pairing.id, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now }
    });
    if (consumed.count !== 1) throw new Error("Pairing code is invalid, expired, or already used. Generate a new one with /character pair.");

    // Each successful exchange connects one device. Lost devices can be revoked
    // individually (or all at once) from the authenticated connections page.
    await tx.companionCredential.create({
      data: { memberId: pairing.memberId, tokenHash: hashCompanionSecret(credential) }
    });
    return { companionCredential: credential, discordUserId: pairing.member.discordUserId,
      ...(pairing.guild ? { wowGuildId: pairing.guild.id, wowGuildName: pairing.guild.name, gameEdition: pairing.guild.gameEdition } : {}) };
  });
}

export function cleanDeviceName(value: string): string {
  // Strip C0 controls from device labels received from forms.
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 80) || "Paired companion";
}
