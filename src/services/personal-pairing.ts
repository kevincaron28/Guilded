import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { hashCompanionSecret } from "./character-pairing.js";

// Personal companion codes (7.0): a signed-in website account pairs the Guilded companion
// without a guild, to send its own dungeon runs to the public leaderboards. Same rules as
// /character pair: 15 minutes, one use, one active credential per account. Codes start with
// "P", which a guild code (hexadecimal) never does, so one pairing endpoint serves both.

const LIFETIME_MS = 15 * 60_000;
export const isPersonalCode = (code: string) => /^P[0-9A-F]{11}$/.test(code.trim().toUpperCase());

export interface PersonalStore {
  savePairing(accountId: string, codeHash: string, expiresAt: Date): Promise<void>;
  /** The account of a live, unused code, marking it used (once only). */
  consumePairing(codeHash: string, now: Date): Promise<string | null>;
  replaceCredential(accountId: string, tokenHash: string): Promise<void>;
  credentialAccount(tokenHash: string): Promise<{ accountId: string; username: string } | null>;
  revokeCredentials(accountId: string): Promise<void>;
  hasCredential(accountId: string): Promise<boolean>;
}

export async function issuePersonalCode(store: PersonalStore, accountId: string, now = new Date()) {
  const code = `P${randomBytes(6).toString("hex").toUpperCase().slice(0, 11)}`;
  const expiresAt = new Date(now.getTime() + LIFETIME_MS);
  await store.savePairing(accountId, hashCompanionSecret(code), expiresAt);
  return { code, expiresAt };
}

export async function exchangePersonalCode(store: PersonalStore, code: string, now = new Date()): Promise<{ companionCredential: string } | null> {
  if (!isPersonalCode(code)) return null;
  const accountId = await store.consumePairing(hashCompanionSecret(code.trim().toUpperCase()), now);
  if (!accountId) return null;
  return issuePersonalCredential(store, accountId);
}

// Also used by the companion's Discord sign-in (companion-signin.ts), which needs no code.
export async function issuePersonalCredential(store: PersonalStore, accountId: string): Promise<{ companionCredential: string }> {
  const companionCredential = randomBytes(32).toString("base64url");
  await store.replaceCredential(accountId, hashCompanionSecret(companionCredential));
  return { companionCredential };
}

export async function personalAccess(store: PersonalStore, secret: string | undefined) {
  if (typeof secret !== "string" || secret.length < 32 || secret.length > 256) return null;
  return store.credentialAccount(hashCompanionSecret(secret));
}

export function prismaPersonalStore(database: PrismaClient): PersonalStore {
  return {
    async savePairing(accountId, codeHash, expiresAt) {
      await database.webPairing.upsert({ where: { accountId }, create: { accountId, codeHash, expiresAt }, update: { codeHash, expiresAt, consumedAt: null } });
    },
    async consumePairing(codeHash, now) {
      const pairing = await database.webPairing.findUnique({ where: { codeHash }, select: { id: true, accountId: true } });
      if (!pairing) return null;
      const used = await database.webPairing.updateMany({ where: { id: pairing.id, consumedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now } });
      return used.count === 1 ? pairing.accountId : null;
    },
    async replaceCredential(accountId, tokenHash) {
      await database.$transaction([
        database.webCompanionCredential.updateMany({ where: { accountId, revokedAt: null }, data: { revokedAt: new Date() } }),
        database.webCompanionCredential.create({ data: { accountId, tokenHash } })
      ]);
    },
    async credentialAccount(tokenHash) {
      const row = await database.webCompanionCredential.findFirst({ where: { tokenHash, revokedAt: null }, select: { accountId: true, account: { select: { username: true } } } });
      return row ? { accountId: row.accountId, username: row.account.username } : null;
    },
    async revokeCredentials(accountId) { await database.webCompanionCredential.updateMany({ where: { accountId, revokedAt: null }, data: { revokedAt: new Date() } }); },
    async hasCredential(accountId) { return (await database.webCompanionCredential.count({ where: { accountId, revokedAt: null } })) > 0; }
  };
}
