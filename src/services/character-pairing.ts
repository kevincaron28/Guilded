import { createHash, randomBytes } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { AddonCharacter } from "../integrations/addon.js";
import { findCharacter } from "./character-match.js";
import { normalizeClassName, normalizeRaceName } from "./character-import.js";
import { nameKey } from "./roster-discovery.js";

const PAIRING_CODE_LIFETIME_MS = 15 * 60_000;
type Tx = Prisma.TransactionClient;

export function hashCompanionSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

// Creates the exporter's own character (professions + unclaimed cleanup
// included). Shared by the immediate upload-time link (linkPairedCharacter,
// its own transaction) and the apply-time safety net in addon-import.ts
// (already inside its own transaction) so the two never drift apart.
export async function createSelfCharacter(tx: Tx, guildId: string, memberId: string, self: AddonCharacter) {
  const hasMain = (await tx.character.count({ where: { memberId, isMain: true } })) > 0;
  const created = await tx.character.create({
    data: {
      memberId,
      name: self.name,
      realm: self.realm,
      className: normalizeClassName(self.class as string),
      race: self.race ? normalizeRaceName(self.race) : null,
      level: self.level >= 1 ? self.level : null,
      spec: self.spec || null,
      isMain: !hasMain,
      professionsUpdatedAt: self.professionsComplete === true ? self.professionsAt ?? new Date() : null,
      lastSeenAt: new Date()
    }
  });
  for (const profession of self.professions) {
    await tx.professionSkill.upsert({
      where: { characterId_profession: { characterId: created.id, profession: profession.name } },
      create: { characterId: created.id, profession: profession.name, skillLevel: profession.skillLevel },
      update: { skillLevel: profession.skillLevel }
    });
  }
  await tx.unclaimedCharacter.deleteMany({ where: { guildId, nameKey: nameKey(self.name) } });
  return created;
}

export async function linkPairedCharacter(database: PrismaClient, guildId: string, memberId: string, self: AddonCharacter) {
  if (!self.class) return "missing-class" as const;
  return database.$transaction(async (tx) => {
    const characters = await tx.character.findMany({
      where: { member: { guildId } },
      include: { member: true }
    });
    const existing = findCharacter(characters, self.name, self.realm);
    if (existing && existing.memberId !== memberId) return "owned-by-another" as const;

    if (existing) {
      await tx.character.update({
        where: { id: existing.id },
        data: {
          className: normalizeClassName(self.class as string),
          race: self.race ? normalizeRaceName(self.race) : null,
          level: self.level >= 1 ? self.level : null,
          spec: self.spec || null,
          lastSeenAt: new Date()
        }
      });
      return "already-linked" as const;
    }
    await createSelfCharacter(tx, guildId, memberId, self);
    return "linked" as const;
  });
}

// Revokes every credential this member currently has (unlinking them from
// every paired companion). Used when an officer unlinks a character from
// someone else's account (so a paired upload can't silently relink it right
// back) and when the member re-pairs (one active credential at a time).
export async function revokeCompanionCredentials(database: PrismaClient | Tx, memberId: string): Promise<void> {
  await database.companionCredential.updateMany({ where: { memberId, revokedAt: null }, data: { revokedAt: new Date() } });
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

export async function exchangeCharacterPairingCode(database: PrismaClient, guildDiscordId: string, submittedCode: string, now = new Date()) {
  const codeHash = hashCompanionSecret(submittedCode.trim().toUpperCase());
  const credential = randomBytes(32).toString("base64url");

  return database.$transaction(async (tx) => {
    const pairing = await tx.characterPairing.findFirst({
      where: { codeHash, guild: { discordId: guildDiscordId }, expiresAt: { gt: now }, consumedAt: null },
      select: { id: true, memberId: true, member: { select: { discordUserId: true } } }
    });
    if (!pairing) throw new Error("Pairing code is invalid, expired, or already used. Generate a new one with /character pair.");

    const consumed = await tx.characterPairing.updateMany({
      where: { id: pairing.id, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now }
    });
    if (consumed.count !== 1) throw new Error("Pairing code is invalid, expired, or already used. Generate a new one with /character pair.");

    // One active credential per member: re-pairing (lost laptop, new PC,
    // starting over) replaces the old companion's access instead of leaving
    // it valid forever alongside the new one.
    await revokeCompanionCredentials(tx, pairing.memberId);
    await tx.companionCredential.create({
      data: { memberId: pairing.memberId, tokenHash: hashCompanionSecret(credential) }
    });
    return { companionCredential: credential, discordUserId: pairing.member.discordUserId };
  });
}
