import type { PrismaClient } from "../generated/prisma/client.js";
import type { ScoreCard } from "./score-card.js";

// 9.1 character pictures on cards (docs/CHARACTER_PICTURES.md, slice 2). At delivery, never in the stored definition:
//   - a dungeon card gets each guild party member's picture thumb, drawn in place of the role disc;
//   - a card about one member (achievement unlocks: `cardMember`) gets that member's character picture as its portrait,
//     replacing the Discord avatar withDiscordMember added (which stays the fallback).
// Order for a picture slot: character picture -> Discord avatar -> the plain role disc / no portrait.
// Cards post in the guild's own Discord, so "guild" and "public" pictures both show. Nothing shows when the server
// switch is off, a picture was removed, or anything fails (the card is drawn as before).

type Db = Pick<PrismaClient, "guildSettings" | "characterPicture">;
const MAX_PARTY = 40;

const key = (name: string) => name.trim().toLowerCase();
/** The addon's party name ("Name" or "Name-Realm"), without the realm. */
const bareName = (name: string) => key(name.split("-")[0] ?? name);

export async function withCardPictures(db: Db, guildId: string, card: ScoreCard, cardMember?: string): Promise<ScoreCard> {
  try {
    const wantsParty = Boolean(card.dungeon?.party.some(member => member.guild && member.character));
    const wantsMember = Boolean(cardMember && !card.dungeon && !card.ladder && !card.roster);
    if (!wantsParty && !wantsMember) return card;
    const settings = await db.guildSettings.findUnique({ where: { guildId }, select: { characterPicturesEnabled: true } });
    if (settings?.characterPicturesEnabled === false) return card;
    if (wantsParty) return await withPartyPictures(db, guildId, card);
    const picture = await db.characterPicture.findFirst({
      where: { guildId, status: "ok", character: { member: { guildId, discordUserId: cardMember!, status: "ACTIVE" } } },
      orderBy: [{ character: { isMain: "desc" } }, { updatedAt: "desc" }], select: { thumb: true }
    });
    return picture?.thumb.length ? { ...card, portrait: Buffer.from(picture.thumb).toString("base64") } : card;
  } catch { return card; }
}

async function withPartyPictures(db: Db, guildId: string, card: ScoreCard): Promise<ScoreCard> {
  const party = card.dungeon!.party.slice(0, MAX_PARTY);
  const wanted = new Set(party.flatMap(member => member.guild && member.character ? [bareName(member.character), key(member.name)] : []));
  // Names first (no bytes), then the thumbs of the characters in this party only.
  const rows = await db.characterPicture.findMany({
    where: { guildId, status: "ok", character: { member: { guildId } } },
    select: { characterId: true, character: { select: { name: true, displayName: true } } }, take: 2_000
  });
  const byName = new Map<string, string>();
  for (const row of rows) {
    for (const name of [row.character.name, row.character.displayName]) {
      if (!name || !wanted.has(key(name))) continue;
      // Two characters answering to one name: show neither rather than guess.
      byName.set(key(name), byName.has(key(name)) && byName.get(key(name)) !== row.characterId ? "" : row.characterId);
    }
  }
  const ids = [...new Set([...byName.values()].filter(Boolean))];
  if (!ids.length) return card;
  const thumbs = new Map((await db.characterPicture.findMany({ where: { characterId: { in: ids }, status: "ok" }, select: { characterId: true, thumb: true } }))
    .filter(row => row.thumb.length).map(row => [row.characterId, Buffer.from(row.thumb).toString("base64")]));
  const pictureOf = (member: (typeof party)[number]) => {
    if (!member.guild || !member.character) return undefined;
    const id = byName.get(key(member.name)) || byName.get(bareName(member.character));
    return id ? thumbs.get(id) : undefined;
  };
  return { ...card, dungeon: { ...card.dungeon!, party: card.dungeon!.party.map((member, index) => {
    const portrait = index < MAX_PARTY ? pictureOf(member) : undefined;
    return portrait ? { ...member, portrait } : member;
  }) } };
}
