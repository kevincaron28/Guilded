import type { PrismaClient } from "@prisma/client";

type Db = Pick<PrismaClient, "guildSettings" | "raidCore">;
export const CORE_REQUIRED = "Le butin et les EP/GP sont propres à chaque core. Choisis un core ou un raid de core; dans l'addon : /guilded core <nom>.";

export async function requireCorePool(database: Db, guildId: string, coreId: string | null | undefined) {
  const settings = await database.guildSettings?.findUnique({ where: { guildId }, select: { coreLootOnly: true } });
  if (!settings?.coreLootOnly) return;
  if (!coreId) throw new Error(CORE_REQUIRED);
  const core = await database.raidCore.findFirst({ where: { id: coreId, guildId, separatePool: true }, select: { id: true } });
  if (!core) throw new Error(CORE_REQUIRED);
}
