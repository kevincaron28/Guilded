import type { PrismaClient } from "@prisma/client";

const TAG_NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;
export const MAX_TAG_LENGTH = 1900;

export function normalizeTagName(name: string): string {
  const normalized = name.trim().toLowerCase();
  if (!TAG_NAME.test(normalized)) {
    throw new Error("Tag names use 1-32 letters, numbers, dashes, or underscores.");
  }
  return normalized;
}

export function createTagService(database: PrismaClient) {
  return {
    async set(guildId: string, name: string, content: string, createdBy: string) {
      const key = normalizeTagName(name);
      const text = content.trim();
      if (text.length < 1) throw new Error("Tag content cannot be empty.");
      if (text.length > MAX_TAG_LENGTH) throw new Error(`Tag content is limited to ${MAX_TAG_LENGTH} characters.`);
      return database.tag.upsert({
        where: { guildId_name: { guildId, name: key } },
        create: { guildId, name: key, content: text, createdBy },
        update: { content: text, createdBy }
      });
    },

    get(guildId: string, name: string) {
      return database.tag.findUnique({ where: { guildId_name: { guildId, name: normalizeTagName(name) } } });
    },

    async remove(guildId: string, name: string) {
      const result = await database.tag.deleteMany({ where: { guildId, name: normalizeTagName(name) } });
      if (result.count === 0) throw new Error("No tag with that name exists.");
    },

    list(guildId: string) {
      return database.tag.findMany({ where: { guildId }, orderBy: { name: "asc" }, select: { name: true } });
    }
  };
}
