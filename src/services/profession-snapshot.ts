import type { Prisma } from "@prisma/client";

type Tx = Pick<Prisma.TransactionClient, "character" | "professionSkill" | "recipeKnown" | "professionCooldown">;

// Only an explicit complete self-report may remove professions. An absent API is unknown.
export async function syncProfessionSnapshot(tx: Tx, guildId: string, character: { id: string; name: string; realm: string },
  professions: { name: string; skillLevel: number }[], complete: boolean, at: Date): Promise<boolean> {
  const current = await tx.character.findUnique({ where: { id: character.id }, select: { professionsUpdatedAt: true } });
  if (current?.professionsUpdatedAt && (!complete || current.professionsUpdatedAt >= at)) return false;
  const names = [...new Set(professions.map((profession) => profession.name.trim()).filter(Boolean))];
  if (complete) {
    await tx.character.update({ where: { id: character.id }, data: { professionsUpdatedAt: at } });
    await tx.professionSkill.deleteMany({ where: { characterId: character.id, profession: { notIn: names } } });
    await tx.recipeKnown.deleteMany({ where: { guildId, character: character.name, realm: character.realm, profession: { notIn: names } } });
    await tx.professionCooldown.deleteMany({ where: { guildId, character: character.name, realm: character.realm, profession: { notIn: names } } });
  }
  for (const profession of professions) {
    const name = profession.name.trim();
    if (!name) continue;
    await tx.professionSkill.upsert({ where: { characterId_profession: { characterId: character.id, profession: name } },
      create: { characterId: character.id, profession: name, skillLevel: profession.skillLevel }, update: { skillLevel: profession.skillLevel } });
  }
  return true;
}
