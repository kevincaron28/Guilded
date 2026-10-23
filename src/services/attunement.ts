import type { PrismaClient } from "@prisma/client";

export function createAttunementService(database: PrismaClient) {
  return {
    set(characterId: string, name: string, completed: boolean, source: string) {
      const trimmed = name.trim();
      if (trimmed.length < 2) throw new Error("Attunement name is required");
      return database.characterAttunement.upsert({
        where: { characterId_name: { characterId, name: trimmed } },
        create: { characterId, name: trimmed, completed, source, completedAt: new Date() },
        update: { completed, source, completedAt: new Date() }
      });
    },

    list(characterId: string) {
      return database.characterAttunement.findMany({
        where: { characterId },
        orderBy: { name: "asc" }
      });
    }
  };
}
