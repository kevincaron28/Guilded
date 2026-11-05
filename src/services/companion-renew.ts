import type { PrismaClient } from "../generated/prisma/client.js";
import { hashCompanionSecret } from "./character-pairing.js";

// The caller saves its proposed secret before sending. Retrying a lost response
// is safe: the previous secret can only confirm the exact same rotation.
export async function renewCompanionCredential(database: PrismaClient, secret: unknown, next: unknown, now = new Date()): Promise<boolean> {
  if (typeof secret !== "string" || typeof next !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(next) || !/^[A-Za-z0-9_-]{32,100}$/.test(secret) || secret === next) return false;
  const oldHash = hashCompanionSecret(secret), nextHash = hashCompanionSecret(next);
  return database.$transaction(async tx => {
    for (const personal of [false, true]) {
      const update = { where: { tokenHash: oldHash, revokedAt: null }, data: {
        tokenHash: nextHash, previousTokenHash: oldHash, previousValidUntil: new Date(now.getTime() + 86_400_000)
      } };
      const changed = personal ? await tx.webCompanionCredential.updateMany(update) : await tx.companionCredential.updateMany(update);
      if (changed.count) return true;
      const query = { where: { tokenHash: nextHash, previousTokenHash: oldHash, previousValidUntil: { gt: now }, revokedAt: null }, select: { id: true } } as const;
      const retried = personal ? await tx.webCompanionCredential.findFirst(query) : await tx.companionCredential.findFirst(query);
      if (retried) return true;
    }
    return false;
  });
}
