import { randomInt } from "node:crypto";
import { escapeMarkdown, type Client } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { AddonCharacter } from "../integrations/addon.js";
import { t, type Lang } from "../i18n.js";
import { findCharacter } from "./character-match.js";
import { linkPairedCharacter } from "./character-pairing.js";
import { postToLogChannel } from "./housekeeping.js";
import { characterKey } from "../../companion/character-identity.mjs";
import { gameEditionOf } from "./game-edition.js";

// Linking without a companion: a member gets one code (/character pair, the welcome button) and
// pastes `/guilded verify CODE` in WoW chat once. The addon keeps it with the account's saved data,
// so every character they play repeats it in the guild digest. Every guildmate's addon keeps a
// digest only under the name of the character the game says sent it, and a companion upload brings
// it here: the code says which member, the game says which character. Someone repeating a
// guildmate's code can only hand their own character to that guildmate, who gets a DM.
//
// An officer's upload is trusted. Since 8.1 a paired member's upload links too, so nobody waits
// for an officer to be online, but provisionally: that member's companion sends whatever its saved
// file says. The next officer upload confirms the link, or moves the character to the member whose
// code the officer's addon heard. Each provisional link is logged with the member who reported it.

// Letters only, without I and O: read on one screen, typed on another. Older officer addons also
// read any NAME:DIGITS piece of a digest as a profession, which a letters-only code never is.
const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LENGTH = 8;

export function newVerifyCode(): string {
  let code = "";
  for (let index = 0; index < LENGTH; index++) code += LETTERS[randomInt(LETTERS.length)];
  return code;
}

/** ABCD-EFGH, the way members see and type it. */
export const formatVerifyCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

/** Accepts what people paste: lower case, a dash, spaces. */
export function normalizeVerifyCode(text: unknown): string | null {
  if (typeof text !== "string" || text.length > 40) return null;
  const code = text.toUpperCase().replace(/[^A-Z]/g, "");
  return code.length === LENGTH && [...code].every((letter) => LETTERS.includes(letter)) ? code : null;
}

/** The member's code, made the first time. It never changes, so the line pasted in game keeps working. */
export async function verifyCodeFor(database: PrismaClient, guildId: string, memberId: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      const row = await database.characterVerifyCode.upsert({
        where: { guildId_memberId: { guildId, memberId } },
        create: { guildId, memberId, code: newVerifyCode() },
        update: {}
      });
      return row.code;
    } catch (error) {
      // Two requests at once, or (rarely) a code already taken: try again.
      if (attempt >= 3) throw error;
    }
  }
}

export interface VerifiedCharacter {
  discordUserId: string;
  name: string;
  /** linked: now theirs. taken: already linked to someone else (said once). */
  status: "linked" | "taken";
  isMain: boolean;
  /** Linked from a member's (not an officer's) upload: the Discord ID of that member. */
  reportedBy?: string;
  /** An officer's upload moved this character away from this provisional owner. */
  movedFrom?: string;
}

/** A member's upload links at most this many guildmates' characters at once. */
const PROVISIONAL_PER_UPLOAD = 5;

/**
 * Characters in an upload that carry a member's code. An officer's upload links and confirms; a
 * paired member's upload (uploader.memberId) links only unowned characters, provisionally.
 */
export async function linkVerifiedCharacters(database: PrismaClient, guildId: string, uploader: { officer: boolean; memberId?: string | null }, entries: readonly AddonCharacter[]): Promise<VerifiedCharacter[]> {
  if (!uploader.officer && !uploader.memberId) return [];
  const wanted = new Map<string, { entry: AddonCharacter; code: string }>();
  for (const entry of entries) {
    const code = normalizeVerifyCode(entry.verify);
    const key = characterKey(entry.name, entry.realm, gameEditionOf(entry));
    if (code && entry.class && !wanted.has(key)) wanted.set(key, { entry, code });
  }
  if (!wanted.size) return [];
  const codes = await database.characterVerifyCode.findMany({
    where: { guildId, code: { in: [...new Set([...wanted.values()].map((item) => item.code))] } },
    select: { code: true, memberId: true, member: { select: { discordUserId: true } } }
  });
  if (!codes.length) return [];
  const owners = new Map(codes.map((row) => [row.code, row]));
  const claims = await database.characterVerifyClaim.findMany({
    where: { guildId, nameKey: { in: [...wanted.keys()] } },
    select: { memberId: true, nameKey: true, status: true }
  });
  const claimed = new Map(claims.map((claim) => [`${claim.memberId}\n${claim.nameKey}`, claim.status]));
  const linked = await database.character.findMany({ where: { member: { guildId } }, select: { id: true, name: true, realm: true, memberId: true, gameEdition: true, member: { select: { discordUserId: true } } } });
  const remember = (memberId: string, key: string, status: "LINKED" | "TAKEN" | "PROVISIONAL" | "REMOVED") => database.characterVerifyClaim.upsert({
    where: { guildId_memberId_nameKey: { guildId, memberId, nameKey: key } },
    create: { guildId, memberId, nameKey: key, status },
    update: { status }
  });
  const reporter = uploader.officer ? null : await database.member.findUnique({ where: { id: uploader.memberId! }, select: { discordUserId: true } });

  const results: VerifiedCharacter[] = [];
  let provisional = 0;
  for (const [key, { entry, code }] of wanted) {
    const owner = owners.get(code);
    if (!owner) continue;
    const before = claimed.get(`${owner.memberId}\n${key}`);
    if (before === "BLOCKED" || before === "REMOVED") continue;
    const existing = findCharacter(linked, entry.name, entry.realm, gameEditionOf(entry));
    if (existing?.memberId === owner.memberId) {
      // An officer's addon heard the same code: the provisional link is now confirmed.
      if (uploader.officer && before === "PROVISIONAL") await remember(owner.memberId, key, "LINKED");
      continue;
    }
    if (existing && uploader.officer && claimed.get(`${existing.memberId}\n${key}`) === "PROVISIONAL") {
      // Preserve the character ID and all dependent history. Ownership and claims
      // change together, and concurrent confirmation/correction must not be lost.
      const from = existing;
      const moved = await database.$transaction(async (tx) => {
        const current = findCharacter(await tx.character.findMany({ where: { member: { guildId } } }), entry.name, entry.realm, gameEditionOf(entry));
        if (!current || current.id !== from.id || current.memberId !== from.memberId) return null;
        const provisionalClaim = await tx.characterVerifyClaim.findFirst({ where: { guildId, memberId: from.memberId, nameKey: key, status: "PROVISIONAL" } });
        if (!provisionalClaim) return null;
        const blocked = await tx.characterVerifyClaim.findMany({ where: { guildId, memberId: owner.memberId, nameKey: { in: [key] } } });
        if (blocked.some((claim) => claim.memberId === owner.memberId && (claim.status === "REMOVED" || claim.status === "BLOCKED"))) return null;
        const isMain = (await tx.character.count({ where: { memberId: owner.memberId, isMain: true } })) === 0;
        const character = await tx.character.update({ where: { id: from.id }, data: { memberId: owner.memberId, isMain } });
        for (const [memberId, status] of [[from.memberId, "REMOVED"], [owner.memberId, "LINKED"]] as const) {
          await tx.characterVerifyClaim.upsert({
            where: { guildId_memberId_nameKey: { guildId, memberId, nameKey: key } },
            create: { guildId, memberId, nameKey: key, status }, update: { status }
          });
        }
        return character;
      }, { isolationLevel: "Serializable" });
      if (moved) {
        linked.splice(linked.indexOf(from), 1, { ...from, memberId: owner.memberId, member: { discordUserId: owner.member.discordUserId } });
        results.push({ discordUserId: owner.member.discordUserId, name: entry.name, status: "linked", isMain: moved.isMain, movedFrom: from.member.discordUserId });
      }
      continue;
    }
    if (existing) {
      // A member's upload says nothing about taken characters: only an officer's is sure enough.
      if (uploader.officer && before !== "TAKEN") {
        await remember(owner.memberId, key, "TAKEN");
        results.push({ discordUserId: owner.member.discordUserId, name: entry.name, status: "taken", isMain: false });
      }
      continue;
    }
    if (!uploader.officer && ++provisional > PROVISIONAL_PER_UPLOAD) continue;
    if (await linkPairedCharacter(database, guildId, owner.memberId, entry) !== "linked") continue;
    await remember(owner.memberId, key, uploader.officer ? "LINKED" : "PROVISIONAL");
    const created = await database.character.findFirst({ where: { memberId: owner.memberId, name: entry.name, realm: entry.realm, gameEdition: gameEditionOf(entry) }, select: { id: true, isMain: true } });
    linked.push({ id: created?.id ?? "", name: entry.name, realm: entry.realm, memberId: owner.memberId, gameEdition: gameEditionOf(entry), member: { discordUserId: owner.member.discordUserId } });
    results.push({ discordUserId: owner.member.discordUserId, name: entry.name, status: "linked", isMain: created?.isMain ?? false,
      ...(reporter ? { reportedBy: reporter.discordUserId } : {}) });
  }
  return results;
}

/** A DM to each member about what their code did; officers see new links in the log channel. Never throws. */
export async function tellVerified(client: Client, discordGuildId: string, lang: Lang, results: readonly VerifiedCharacter[]): Promise<void> {
  const discordGuild = await client.guilds.fetch(discordGuildId).catch(() => null);
  const server = escapeMarkdown(discordGuild?.name ?? "Discord");
  for (const result of results) {
    const name = escapeMarkdown(result.name);
    const content = result.status === "linked"
      ? t(lang, "verify.linked", { name, server, kind: t(lang, result.isMain ? "character.mainKind" : "character.altKind") })
      : t(lang, "verify.taken", { name, server });
    await client.users.send(result.discordUserId, { content, allowedMentions: { parse: [] } }).catch(() => undefined);
  }
  for (const result of results) {
    if (!result.movedFrom) continue;
    await client.users.send(result.movedFrom, { content: t(lang, "verify.moved", { name: escapeMarkdown(result.name), server }), allowedMentions: { parse: [] } }).catch(() => undefined);
  }
  const linked = results.filter((result) => result.status === "linked");
  if (discordGuild && linked.length) {
    await postToLogChannel(discordGuild, linked.map((result) => `🔗 ${result.name} was linked to <@${result.discordUserId}> by their /guilded verify code`
      + (result.movedFrom ? ` (an officer's sync moved it from <@${result.movedFrom}>, whose link came from a guildmate's report).`
        : result.reportedBy ? ` (heard by <@${result.reportedBy}>'s addon; the next officer sync confirms it).` : ".")).join("\n"));
  }
}

/**
 * After an unlink: the code this character keeps repeating must not link it to that member again.
 * An officer's unlink (byOfficer) is REMOVED: that member's own companion uploads don't relink it either.
 */
export async function blockVerifiedCharacter(database: PrismaClient, guildId: string, memberId: string, name: string, realm = "", gameEdition = "forever", byOfficer = false): Promise<void> {
  const key = characterKey(name, realm, gameEdition);
  const status = byOfficer ? "REMOVED" : "BLOCKED";
  await database.characterVerifyClaim.upsert({
    where: { guildId_memberId_nameKey: { guildId, memberId, nameKey: key } },
    create: { guildId, memberId, nameKey: key, status },
    update: { status }
  });
}
