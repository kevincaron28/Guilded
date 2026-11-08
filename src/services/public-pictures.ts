import type { PrismaClient } from "../generated/prisma/client.js";

// Character pictures on pages anyone can open (docs/CHARACTER_PICTURES.md, extras after slice 3):
// the /players/ search cards, the leaderboard character page and its card, and the profile share image.
// These pages are the same for every viewer and are shared as link previews, so they only ever use a
// picture its owner set to Public. Guild-only pictures stay on the player profile, where each viewer is
// checked. A picture shows only while it is "ok", its server's switch is on and the site serves that server.
// When two different characters answer to one name and realm, none is shown rather than a guess.

type Db = Pick<PrismaClient, "characterPicture" | "webAccount">;
export interface PublicPicture { characterId: string; version: number; thumb: Buffer }
/** One search card's character: the account and the character name/realm the card shows. */
export interface CardCharacter { id: string; character: string; realm: string }

const GUILD_SELECT = { member: { select: { discordUserId: true, guild: { select: { discordId: true, settings: { select: { characterPicturesEnabled: true } } } } } } } as const;
const lower = (text: string | null | undefined) => (text ?? "").trim().toLowerCase();
const MEMBER = { status: "ACTIVE", isTest: false } as const;

export function publicPictures(db: Db, allows: (discordGuildId: string) => boolean) {
  const shown = (guild: { discordId: string; settings: { characterPicturesEnabled: boolean } | null }) => allows(guild.discordId) && guild.settings?.characterPicturesEnabled !== false;
  return {
    /** The public picture of the character a leaderboard page is about, by name (or display name) and realm. */
    async byCharacter(name: string, realm: string | null): Promise<PublicPicture | null> {
      try {
        const named = { OR: [{ name: { equals: name, mode: "insensitive" as const } }, { displayName: { equals: name, mode: "insensitive" as const } }] };
        const rows = await db.characterPicture.findMany({
          where: { status: "ok", visibility: "public", character: { ...named, ...(realm ? { realm: { equals: realm, mode: "insensitive" as const } } : {}), member: MEMBER } },
          select: { characterId: true, version: true, thumb: true, character: { select: GUILD_SELECT } }, take: 5
        });
        const usable = rows.filter(row => shown(row.character.member.guild) && row.thumb.length);
        return usable.length === 1 ? { characterId: usable[0]!.characterId, version: usable[0]!.version, thumb: Buffer.from(usable[0]!.thumb) } : null;
      } catch { return null; }
    },
    /** A web account's public picture for its share image: the main character's first. */
    async byAccount(discordUserId: string, includeGuildOnly = false): Promise<PublicPicture | null> {
      try {
        const rows = await db.characterPicture.findMany({
          where: { status: "ok", ...(includeGuildOnly ? {} : { visibility: "public" }), character: { member: { ...MEMBER, discordUserId } } },
          orderBy: [{ character: { isMain: "desc" } }, { updatedAt: "desc" }],
          select: { characterId: true, version: true, thumb: true, character: { select: GUILD_SELECT } }, take: 10
        });
        const row = rows.find(r => shown(r.character.member.guild) && r.thumb.length);
        return row ? { characterId: row.characterId, version: row.version, thumb: Buffer.from(row.thumb) } : null;
      } catch { return null; }
    },
    /** Search cards: the public picture of each card's character, in two queries for the whole page (no image bytes). */
    async forCards(cards: CardCharacter[]): Promise<Map<string, { characterId: string; version: number }>> {
      const found = new Map<string, { characterId: string; version: number }>();
      if (!cards.length) return found;
      try {
        const accounts = await db.webAccount.findMany({ where: { id: { in: [...new Set(cards.map(card => card.id))] } }, select: { id: true, discordUserId: true } });
        const userOf = new Map(accounts.map(account => [account.id, account.discordUserId]));
        if (!userOf.size) return found;
        const rows = await db.characterPicture.findMany({
          where: { status: "ok", visibility: "public", character: { member: { ...MEMBER, discordUserId: { in: [...new Set(userOf.values())] } } } },
          select: { characterId: true, version: true, character: { select: { name: true, displayName: true, realm: true, ...GUILD_SELECT } } }, take: 500
        });
        for (const card of cards) {
          const user = userOf.get(card.id);
          const matches = rows.filter(row => row.character.member.discordUserId === user && shown(row.character.member.guild)
            && lower(row.character.realm) === lower(card.realm)
            && [row.character.displayName, row.character.name].some(n => lower(n) === lower(card.character)));
          if (new Set(matches.map(row => row.characterId)).size === 1) found.set(card.id, { characterId: matches[0]!.characterId, version: matches[0]!.version });
        }
      } catch { /* the cards show without pictures */ }
      return found;
    }
  };
}
export type PublicPictureLookup = ReturnType<typeof publicPictures>;
