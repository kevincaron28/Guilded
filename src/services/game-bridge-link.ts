import { escapeMarkdown, type Client, type Guild as DiscordGuild } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { characterKey } from "../../companion/character-identity.mjs";
import { claimCharacter, declinedKeys } from "./character-autolink.js";
import { evidenceRank, evidenceOf } from "./character-move.js";
import { tellAutoLinked } from "./companion-link-dm.js";
import { createGuildService } from "./guild.js";
import { postToLogChannel } from "./housekeeping.js";
import { foldKey } from "./invite-queue.js";
import { syncMemberNickname } from "./nickname-sync.js";

// 19 November 2026 (owner request, "why can't we use this to link also?"). WoW Forever lets a player link Discord in the game, and their
// guild chat is then relayed into a Discord channel as a message written by the real Discord user, carrying the character's full name
// (the message's `lobby_member.additional_name`) and WoW's own Discord application id. Only that player's game client can post as them
// with that name, so the game itself vouches that this Discord user plays that character: link evidence "game" (confirmed).
//
// Nothing here reads message text, so it works with the Message Content intent off: author, application_id, flags and lobby_member are
// not message content. discord.js does not keep lobby_member on its Message class, so the raw gateway packet is read
// (client.on("raw"), main.ts); the backfill script reads the same fields from the REST API.
//
// Never moves a character held by another member: one officer-log line (at most one per character per day) and an officer decides.
// A character the member unlinked themselves, or an officer removed, is not linked back by chat (BLOCKED / REMOVED marks).

/** WoW's own Discord application: the relayed guild chat carries it as `application_id`. */
export const WOW_BRIDGE_APP_ID = "1384671873593512078";
/** The message flag the relay sets (undocumented bit 16). */
export const BRIDGE_MESSAGE_FLAG = 65536;

export interface BridgeMessage {
  guildDiscordId: string;
  channelId: string;
  messageId: string;
  discordUserId: string;
  /** The Discord name to show for the member (global name or username); never used as proof. */
  displayName: string;
  /** The character's full in-game name from the relay ("Mister Haragot"). */
  characterName: string;
}

export function allowedBridgeApps(setting: string | null | undefined): string[] {
  const ids = (setting ?? "").split(/[,\s]+/).map((id) => id.trim()).filter((id) => /^\d{5,25}$/.test(id));
  return ids.length ? ids : [WOW_BRIDGE_APP_ID];
}

const clean = (value: unknown, max: number) => typeof value === "string" ? value.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";

/**
 * A relayed guild-chat message from a raw gateway MESSAGE_CREATE packet's data or a REST message object, or null for anything else
 * (a normal message, another application, a bot author). `guildId` is for REST messages, which carry none.
 */
export function detectBridgeMessage(data: unknown, allowedApps: readonly string[] = [WOW_BRIDGE_APP_ID], guildId?: string): BridgeMessage | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const author = d["author"] as Record<string, unknown> | undefined;
  const lobby = d["lobby_member"] as Record<string, unknown> | undefined;
  const guild = typeof d["guild_id"] === "string" ? d["guild_id"] : guildId;
  if (!guild || !author || typeof author["id"] !== "string" || author["bot"] === true || !lobby) return null;
  const app = d["application_id"];
  if (typeof app !== "string" || !allowedApps.includes(app)) return null;
  if (!(Number(d["flags"] ?? 0) & BRIDGE_MESSAGE_FLAG)) return null;
  const characterName = clean(lobby["additional_name"], 64);
  if (!characterName || typeof d["id"] !== "string" || typeof d["channel_id"] !== "string") return null;
  return {
    guildDiscordId: guild, channelId: d["channel_id"], messageId: d["id"], discordUserId: author["id"],
    displayName: clean(author["global_name"], 80) || clean(author["username"], 80) || "Member", characterName
  };
}

export type BridgeOutcome =
  | "off" | "not-set-up" | "cached" | "linked" | "upgraded" | "already" | "conflict" | "declined" | "ambiguous" | "unknown";

type Database = PrismaClient;

// In-memory caches: a chatty player posts all night, so after the first message nothing touches the database for six hours.
const SEEN_TTL_MS = 6 * 60 * 60_000;
const RETRY_TTL_MS = 10 * 60_000; // "no roster row yet": look again soon, the next guild sync may bring it
const CONFLICT_LOG_TTL_MS = 24 * 60 * 60_000;
const seen = new Map<string, number>();
const conflictLogged = new Map<string, number>();

/** Test hook. */
export function resetGameBridgeCaches(): void { seen.clear(); conflictLogged.clear(); }

function sweep(map: Map<string, number>, now: number): void {
  if (map.size < 5_000) return;
  for (const [key, until] of map) if (until <= now) map.delete(key);
}

/** The spellings one in-game name can have in the roster: itself, and the doubled form ("Xaldin" <-> "Xaldin Xaldin", #1140). */
export function bridgeNameForms(name: string): string[] {
  const full = foldKey(name);
  const words = full.split(" ").filter(Boolean);
  const forms = new Set([full]);
  if (words.length === 1) forms.add(`${full} ${full}`);
  if (words.length === 2 && words[0] === words[1]) forms.add(words[0]!);
  return [...forms];
}

interface Sink {
  client: Pick<Client, "guilds" | "users">;
}

/**
 * Applies one relayed message. Never throws. `apply` false (backfill dry run) only reports what would happen and changes nothing.
 * `discordGuild` is the server's Discord guild when known (needed for the officer line and the nickname; the backfill passes none).
 */
export async function applyBridgeLink(
  database: Database, bridge: BridgeMessage,
  options: { client?: Sink["client"] | null; discordGuild?: DiscordGuild | null; apply?: boolean; now?: number } = {}
): Promise<{ outcome: BridgeOutcome; character?: string }> {
  const now = options.now ?? Date.now();
  const apply = options.apply !== false;
  const cacheKey = `${bridge.guildDiscordId}:${bridge.discordUserId}:${foldKey(bridge.characterName)}`;
  if (apply && (seen.get(cacheKey) ?? 0) > now) return { outcome: "cached" };
  const remember = (ms: number) => { if (apply) { seen.set(cacheKey, now + ms); sweep(seen, now); } };
  try {
    const guild = await database.guild.findFirst({
      where: { discordId: bridge.guildDiscordId, scopeKey: "default" },
      select: { id: true, settings: { select: { gameBridgeLinkEnabled: true } } }
    });
    if (!guild) return { outcome: "not-set-up" };
    if (guild.settings?.gameBridgeLinkEnabled === false) return { outcome: "off" };
    const guildId = guild.id;
    const forms = bridgeNameForms(bridge.characterName);
    const first = bridge.characterName.split(" ")[0]!;
    const same = (row: { name: string; displayName?: string | null }) => forms.includes(foldKey(row.name)) || (row.displayName ? forms.includes(foldKey(row.displayName)) : false);
    const person = await database.member.findFirst({ where: { guildId, discordUserId: bridge.discordUserId }, select: { id: true, displayName: true } });

    // 1. A linked character with that name: the author's own (upgrade weaker proof) or another member's (never moved).
    const held = (await database.character.findMany({
      where: { guildId, name: { startsWith: first, mode: "insensitive" } },
      select: { id: true, name: true, displayName: true, memberId: true, linkEvidence: true, confirmedAt: true, member: { select: { displayName: true } } }, take: 200
    })).filter(same);
    const mine = person ? held.find((row) => row.memberId === person.id) : undefined;
    if (mine) {
      if (evidenceRank(evidenceOf(mine)) >= evidenceRank("game")) { remember(SEEN_TTL_MS); return { outcome: "already", character: mine.name }; }
      if (!apply) return { outcome: "upgraded", character: mine.name };
      await database.character.update({ where: { id: mine.id }, data: { linkEvidence: "game", confirmedAt: mine.confirmedAt ?? new Date(now) } });
      remember(SEEN_TTL_MS);
      await refreshNickname(database, options.discordGuild, person!.id);
      return { outcome: "upgraded", character: mine.name };
    }
    const holder = held[0];
    if (holder) {
      if (apply) {
        await logConflict(options.discordGuild, holder, bridge, person?.displayName ?? bridge.displayName, now);
        remember(SEEN_TTL_MS);
      }
      return { outcome: "conflict", character: holder.name };
    }

    // 2. A discovered (unclaimed) character with that name: the full-name row wins over an old first-name-only row.
    const matching = (await database.unclaimedCharacter.findMany({ where: { guildId }, select: { id: true, name: true, displayName: true, realm: true, gameEdition: true }, take: 5_000 })).filter(same);
    // The row spelled exactly as the game says wins; then a doubled/first-name spelling of it.
    const exact = matching.filter((row) => foldKey(row.name) === forms[0]);
    const near = matching.filter((row) => forms.includes(foldKey(row.name)));
    const rows = exact.length ? exact : near.length ? near : matching;
    if (rows.length > 1) { remember(RETRY_TTL_MS); return { outcome: "ambiguous" }; }
    const row = rows[0];

    // The member's own "not mine" (or an officer's removal) stands: chat never links it back.
    const keys = row ? [characterKey(row.name, row.realm, row.gameEdition ?? "forever")] : forms.map((form) => characterKey(form, "", "forever"));
    if (person && await declinedKeys(database, guildId, person.id, keys)) { remember(SEEN_TTL_MS); return { outcome: "declined", character: row?.name ?? bridge.characterName }; }
    if (!row) { remember(RETRY_TTL_MS); return { outcome: "unknown" }; }
    if (!apply) return { outcome: "linked", character: row.name };

    const guildService = createGuildService(database);
    const member = person ?? await guildService.ensureMember(guildId, bridge.discordUserId, bridge.displayName);
    const before = await database.character.count({ where: { memberId: member.id } });
    // The same claim as /character link with a name; the proof is then raised from "named" to "game".
    let claimed: { row: { name: string } };
    try { claimed = await claimCharacter(database, guildId, member.id, row.id); } catch { remember(RETRY_TTL_MS); return { outcome: "unknown" }; }
    await database.character.updateMany({ where: { memberId: member.id, name: claimed.row.name, guildId }, data: { linkEvidence: "game", confirmedAt: new Date(now) } });
    remember(SEEN_TTL_MS);
    if (options.client) await tellAutoLinked(options.client as never, database as never, bridge.guildDiscordId, guildId, [{ memberId: member.id, count: Math.max(1, (await database.character.count({ where: { memberId: member.id } })) - before) }]);
    await refreshNickname(database, options.discordGuild, member.id);
    return { outcome: "linked", character: claimed.row.name };
  } catch (error) {
    console.warn("Game bridge link failed", error);
    return { outcome: "unknown" };
  }
}

async function refreshNickname(database: Database, discordGuild: DiscordGuild | null | undefined, memberId: string): Promise<void> {
  if (discordGuild) await syncMemberNickname(database, discordGuild, { memberId }).catch(() => undefined);
}

async function logConflict(discordGuild: DiscordGuild | null | undefined, holder: { id: string; name: string; displayName: string | null; member: { displayName: string } }, bridge: BridgeMessage, claimant: string, now: number): Promise<void> {
  if (!discordGuild || (conflictLogged.get(holder.id) ?? 0) > now) return;
  conflictLogged.set(holder.id, now + CONFLICT_LOG_TTL_MS);
  sweep(conflictLogged, now);
  const name = escapeMarkdown(holder.displayName ?? holder.name), owner = escapeMarkdown(holder.member.displayName), other = escapeMarkdown(claimant);
  await postToLogChannel(discordGuild, (lang) => lang === "fr"
    ? `Lien Discord de WoW : **${other}** parle en jeu avec **${name}**, mais ce personnage est lié à **${owner}**. Rien n'a été déplacé; un officier peut le faire avec \`/officer character move\`.`
    : `WoW's Discord link: **${other}** chats in game as **${name}**, but that character is linked to **${owner}**. Nothing was moved; an officer can move it with \`/officer character move\`.`);
}

/** The gateway hook (main.ts): raw MESSAGE_CREATE packets only, one cheap check before anything else. */
export function handleRawBridgePacket(client: Client, database: Database, packet: { t?: string | null; d?: unknown }, allowedApps: readonly string[], allows: (guildDiscordId: string) => boolean = () => true): Promise<BridgeOutcome | null> {
  if (packet.t !== "MESSAGE_CREATE") return Promise.resolve(null);
  const bridge = detectBridgeMessage(packet.d, allowedApps);
  if (!bridge || !allows(bridge.guildDiscordId)) return Promise.resolve(null);
  const discordGuild = client.guilds.cache.get(bridge.guildDiscordId) ?? null;
  return applyBridgeLink(database, bridge, { client, discordGuild }).then((result) => result.outcome);
}
