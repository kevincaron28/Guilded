import { randomInt } from "node:crypto";
import { escapeMarkdown, type Client } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { AddonCharacter } from "../integrations/addon.js";
import { t, type Lang } from "../i18n.js";
import { findCharacter } from "./character-match.js";
import { linkPairedCharacter } from "./character-pairing.js";
import { postToLogChannel } from "./housekeeping.js";
import { nameKey } from "./roster-discovery.js";

// Linking without a companion: a member gets one code (/character pair, the welcome button) and
// pastes `/guilded verify CODE` in WoW chat once. The addon keeps it with the account's saved data,
// so every character they play repeats it in the guild digest. An officer's addon keeps a digest
// only under the name of the character the game says sent it, and that officer's companion upload
// brings it here: the code says which member, the game says which character. Someone repeating a
// guildmate's code can only hand their own character to that guildmate, who gets a DM.

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
}

/**
 * Characters in an upload that carry a member's code. Only an officer's upload counts: a member's
 * own companion sends whatever its saved file says, so it could pair any name with its own code.
 */
export async function linkVerifiedCharacters(database: PrismaClient, guildId: string, uploader: { officer: boolean }, entries: readonly AddonCharacter[]): Promise<VerifiedCharacter[]> {
  if (!uploader.officer) return [];
  const wanted = new Map<string, { entry: AddonCharacter; code: string }>();
  for (const entry of entries) {
    const code = normalizeVerifyCode(entry.verify);
    if (code && entry.class && !wanted.has(nameKey(entry.name))) wanted.set(nameKey(entry.name), { entry, code });
  }
  if (!wanted.size) return [];
  const codes = await database.characterVerifyCode.findMany({
    where: { guildId, code: { in: [...new Set([...wanted.values()].map((item) => item.code))] } },
    select: { code: true, memberId: true, member: { select: { discordUserId: true } } }
  });
  if (!codes.length) return [];
  const owners = new Map(codes.map((row) => [row.code, row]));
  const claims = await database.characterVerifyClaim.findMany({
    where: { guildId, memberId: { in: codes.map((row) => row.memberId) } },
    select: { memberId: true, nameKey: true, status: true }
  });
  const claimed = new Map(claims.map((claim) => [`${claim.memberId}\n${claim.nameKey}`, claim.status]));
  const linked = await database.character.findMany({ where: { member: { guildId } }, select: { name: true, realm: true, memberId: true } });
  const remember = (memberId: string, key: string, status: "LINKED" | "TAKEN") => database.characterVerifyClaim.upsert({
    where: { guildId_memberId_nameKey: { guildId, memberId, nameKey: key } },
    create: { guildId, memberId, nameKey: key, status },
    update: { status }
  });

  const results: VerifiedCharacter[] = [];
  for (const [key, { entry, code }] of wanted) {
    const owner = owners.get(code);
    if (!owner) continue;
    const before = claimed.get(`${owner.memberId}\n${key}`);
    if (before === "BLOCKED") continue;
    const existing = findCharacter(linked, entry.name, entry.realm);
    if (existing?.memberId === owner.memberId) continue;
    if (existing) {
      if (before !== "TAKEN") {
        await remember(owner.memberId, key, "TAKEN");
        results.push({ discordUserId: owner.member.discordUserId, name: entry.name, status: "taken", isMain: false });
      }
      continue;
    }
    if (await linkPairedCharacter(database, guildId, owner.memberId, entry) !== "linked") continue;
    await remember(owner.memberId, key, "LINKED");
    linked.push({ name: entry.name, realm: entry.realm, memberId: owner.memberId });
    const created = await database.character.findFirst({ where: { memberId: owner.memberId, name: entry.name }, select: { isMain: true } });
    results.push({ discordUserId: owner.member.discordUserId, name: entry.name, status: "linked", isMain: created?.isMain ?? false });
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
  const linked = results.filter((result) => result.status === "linked");
  if (discordGuild && linked.length) {
    await postToLogChannel(discordGuild, linked.map((result) => `🔗 ${result.name} was linked to <@${result.discordUserId}> by their /guilded verify code.`).join("\n"));
  }
}

/** After an unlink: the code this character keeps repeating must not link it to that member again. */
export async function blockVerifiedCharacter(database: PrismaClient, guildId: string, memberId: string, name: string): Promise<void> {
  const key = nameKey(name);
  await database.characterVerifyClaim.upsert({
    where: { guildId_memberId_nameKey: { guildId, memberId, nameKey: key } },
    create: { guildId, memberId, nameKey: key, status: "BLOCKED" },
    update: { status: "BLOCKED" }
  });
}
