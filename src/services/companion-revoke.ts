import type { PrismaClient } from "../generated/prisma/client.js";
import { hashCompanionSecret } from "./character-pairing.js";

// Possession permits revoking this exact credential even after guild membership
// or hosted approval changes. Never revoke other devices/account credentials.
export async function revokeCompanionCredential(database: Pick<PrismaClient, "companionCredential" | "webCompanionCredential">, secret: unknown): Promise<boolean> {
  if (typeof secret !== "string" || !/^[A-Za-z0-9_-]{32,100}$/.test(secret)) return false;
  const tokenHash = hashCompanionSecret(secret);
  const now = new Date();
  const query = { where: { OR: [{ tokenHash }, { previousTokenHash: tokenHash, previousValidUntil: { gt: now } }], revokedAt: null }, data: { revokedAt: now } };
  await Promise.all([database.companionCredential.updateMany(query), database.webCompanionCredential.updateMany(query)]);
  return true;
}
