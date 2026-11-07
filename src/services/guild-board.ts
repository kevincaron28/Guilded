import type { PrismaClient } from "../generated/prisma/client.js";
import { tallyVotes } from "./poll.js";

// 9.1 in-game guild board (docs/GUILD_BOARD.md). Officers' news posts and the open Discord polls
// reach the addon's Board page through the standings feed; members vote in game and their companion
// uploads the vote, recorded exactly like a Discord button vote (one vote per member, changeable
// while the poll is open). On by default; officers turn it off with /poll board.

type Db = Pick<PrismaClient, "poll" | "pollVote" | "boardPost" | "guildSettings" | "character">;

// Kept small: the board is in the shared part of every member's feed.
export const BOARD_LIMITS = { news: 5, newsChars: 300, newsDays: 60, polls: 5, optionChars: 80, questionChars: 250 } as const;
export const MAX_BOARD_POST = 500;

export interface AddonBoard {
  enabled: boolean;
  news?: { id: string; at: number; by: string; text: string; ref?: string }[];
  polls?: { id: string; q: string; opts: string[]; counts: number[]; total: number; max: number; closes: number | null; at: number }[];
}

const epoch = (date: Date) => Math.floor(date.getTime() / 1000);
// Plain text for the game: no chat escapes ("|") and no control characters.
// eslint-disable-next-line no-control-regex
export const boardText = (value: string, max: number) => value.replace(/[|\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

export async function boardEnabled(database: Pick<PrismaClient, "guildSettings">, guildId: string): Promise<boolean> {
  const settings = await database.guildSettings.findUnique({ where: { guildId }, select: { guildBoardEnabled: true } });
  return settings?.guildBoardEnabled !== false;
}

function isOpen(poll: { closed: boolean; closesAt: Date | null }, now = Date.now()): boolean {
  return !poll.closed && !(poll.closesAt && poll.closesAt.getTime() <= now);
}

/** The shared board for the addon: recent news and open polls with their counts. */
export async function boardForAddon(database: Db, guildId: string, now = new Date()): Promise<AddonBoard> {
  if (!await boardEnabled(database, guildId)) return { enabled: false };
  const posts = await database.boardPost.findMany({
    where: { guildId, removedAt: null, createdAt: { gte: new Date(now.getTime() - BOARD_LIMITS.newsDays * 86_400_000) } },
    orderBy: { createdAt: "desc" }, take: BOARD_LIMITS.news, select: { id: true, body: true, author: true, createdAt: true, clientRef: true }
  });
  const polls = (await database.poll.findMany({
    where: { guildId, closed: false, OR: [{ closesAt: null }, { closesAt: { gt: now } }] },
    orderBy: { createdAt: "desc" }, take: BOARD_LIMITS.polls,
    select: { id: true, question: true, options: true, maxChoices: true, closesAt: true, createdAt: true }
  }));
  const votes = polls.length ? await database.pollVote.findMany({ where: { pollId: { in: polls.map((poll) => poll.id) } }, select: { pollId: true, option: true, memberId: true } }) : [];
  return {
    enabled: true,
    news: posts.map((post) => ({ id: post.id, at: epoch(post.createdAt), by: boardText(post.author, 40), text: boardText(post.body, BOARD_LIMITS.newsChars), ...(post.clientRef ? { ref: post.clientRef } : {}) })),
    polls: polls.map((poll) => {
      const mine = votes.filter((vote) => vote.pollId === poll.id);
      return {
        id: poll.id, q: boardText(poll.question, BOARD_LIMITS.questionChars), opts: poll.options.map((option) => boardText(option, BOARD_LIMITS.optionChars)),
        counts: tallyVotes(poll.options.length, mine), total: new Set(mine.map((vote) => vote.memberId)).size,
        max: poll.maxChoices ?? 1, closes: poll.closesAt ? epoch(poll.closesAt) : null, at: epoch(poll.createdAt)
      };
    })
  };
}

/** This member's current picks on the open polls (personal part), so the addon shows its own vote. */
export async function myBoardVotes(database: Db, guildId: string, memberId: string, now = new Date()): Promise<Record<string, number[]>> {
  const votes = await database.pollVote.findMany({
    where: { memberId, poll: { guildId, closed: false, OR: [{ closesAt: null }, { closesAt: { gt: now } }] } },
    select: { pollId: true, option: true }
  });
  const mine: Record<string, number[]> = {};
  for (const vote of votes) (mine[vote.pollId] ??= []).push(vote.option);
  for (const picks of Object.values(mine)) picks.sort((a, b) => a - b);
  return mine;
}

export interface BoardVote { poll: string; picks: number[]; at: number; name?: string }

const POLL_ID = /^[A-Za-z0-9_-]{6,40}$/;
const NAME = /^[^|\p{Cc}]{1,80}$/u;

/** Votes from an upload (the addon's own, or guildmates' heard in game): malformed rows are dropped. */
export function parseAddonBoardVotes(raw: unknown, withName = false): BoardVote[] {
  if (!Array.isArray(raw)) return [];
  const nowSeconds = Date.now() / 1000;
  const seen = new Set<string>();
  return raw.flatMap((row): BoardVote[] => {
    if (!row || typeof row !== "object") return [];
    const { poll, picks, at, name } = row as Record<string, unknown>;
    if (typeof poll !== "string" || !POLL_ID.test(poll) || !Array.isArray(picks) || picks.length > 25) return [];
    if (typeof at !== "number" || !Number.isSafeInteger(at) || at < 1_600_000_000 || at > nowSeconds + 600) return [];
    if (!picks.every((pick) => Number.isInteger(pick) && pick >= 0 && pick < 25)) return [];
    if (withName && (typeof name !== "string" || !NAME.test(name))) return [];
    const key = `${poll}:${withName ? String(name).toLowerCase() : ""}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ poll, picks: [...new Set(picks as number[])].sort((a, b) => a - b), at, ...(withName ? { name: name as string } : {}) }];
  }).slice(0, 50);
}

/**
 * Sets one member's picks on one poll to exactly `picks` (empty takes the vote back). The same as
 * Discord's rules: open polls only, existing options only, at most the poll's number of picks. A vote
 * made in game before the member's latest Discord vote never replaces it. Returns whether it changed.
 */
export async function setBoardPicks(database: Db, guildId: string, memberId: string, vote: BoardVote): Promise<boolean> {
  const poll = await database.poll.findFirst({ where: { id: vote.poll, guildId }, select: { id: true, options: true, maxChoices: true, closed: true, closesAt: true } });
  if (!poll || !isOpen(poll)) return false;
  const picks = vote.picks.filter((pick) => pick < poll.options.length);
  if (picks.length !== vote.picks.length || picks.length > (poll.maxChoices ?? 1)) return false;
  const current = await database.pollVote.findMany({ where: { pollId: poll.id, memberId }, select: { option: true, votedAt: true } });
  if (current.some((row) => epoch(row.votedAt) > vote.at)) return false;
  const have = new Set(current.map((row) => row.option));
  if (have.size === picks.length && picks.every((pick) => have.has(pick))) return false;
  await database.pollVote.deleteMany({ where: { pollId: poll.id, memberId, option: { notIn: picks } } });
  for (const option of picks) if (!have.has(option)) {
    await database.pollVote.upsert({ where: { pollId_memberId_option: { pollId: poll.id, memberId, option } }, create: { pollId: poll.id, memberId, option, votedAt: new Date(vote.at * 1000) }, update: {} });
  }
  return true;
}

/** The uploader's own votes. Returns the polls that changed (their Discord message is refreshed). */
export async function applyBoardVotes(database: Db, guildId: string, memberId: string, votes: BoardVote[]): Promise<string[]> {
  if (!votes.length || !await boardEnabled(database, guildId)) return [];
  const changed: string[] = [];
  for (const vote of votes) if (await setBoardPicks(database, guildId, memberId, vote)) changed.push(vote.poll);
  return changed;
}

/**
 * Guildmates' votes the uploader's addon heard in game (members without the companion, Track K's
 * relay pattern): recorded for the member who has that character linked in this guild, never for the
 * uploader (their own votes are first-hand) and never over a newer vote. Unlinked names are skipped.
 */
export async function applyRelayedBoardVotes(database: Db, guildId: string, uploaderMemberId: string, votes: BoardVote[]): Promise<string[]> {
  if (!votes.length || !await boardEnabled(database, guildId)) return [];
  const names = [...new Set(votes.flatMap((vote) => vote.name ? [vote.name.toLowerCase()] : []))];
  const characters = await database.character.findMany({ where: { member: { guildId } }, select: { name: true, displayName: true, memberId: true } });
  const owner = new Map<string, string>();
  for (const character of characters) for (const key of [character.name, character.displayName]) {
    if (key && names.includes(key.toLowerCase())) owner.set(key.toLowerCase(), character.memberId);
  }
  const changed: string[] = [];
  for (const vote of votes) {
    const memberId = vote.name ? owner.get(vote.name.toLowerCase()) : undefined;
    if (!memberId || memberId === uploaderMemberId) continue;
    if (await setBoardPicks(database, guildId, memberId, vote)) changed.push(vote.poll);
  }
  return [...new Set(changed)];
}

export interface AddonBoardPost { ref: string; text: string; at: number }

/** News posts written in game by an officer (the addon's Board page). */
export function parseAddonBoardPosts(raw: unknown): AddonBoardPost[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((row): AddonBoardPost[] => {
    if (!row || typeof row !== "object") return [];
    const { ref, text, at } = row as Record<string, unknown>;
    if (typeof ref !== "string" || !/^[A-Za-z0-9-]{6,40}$/.test(ref) || typeof text !== "string" || typeof at !== "number" || !Number.isSafeInteger(at)) return [];
    const body = boardText(text, MAX_BOARD_POST);
    return body.length >= 3 ? [{ ref, text: body, at }] : [];
  }).slice(0, 5);
}

export function createBoardService(database: Pick<PrismaClient, "boardPost">) {
  return {
    async post(input: { guildId: string; body: string; author: string; authorId?: string | null; memberId?: string | null; source?: "discord" | "game"; clientRef?: string | null }) {
      const body = boardText(input.body, MAX_BOARD_POST);
      if (body.length < 3) throw new Error("Write the news first (at least 3 characters).");
      return database.boardPost.create({ data: { guildId: input.guildId, body, author: boardText(input.author, 80) || "Officer", authorId: input.authorId ?? null,
        memberId: input.memberId ?? null, source: input.source ?? "discord", clientRef: input.clientRef ?? null } });
    },
    setMessage(id: string, channelId: string, messageId: string) {
      return database.boardPost.update({ where: { id }, data: { channelId, messageId } });
    },
    async remove(id: string, guildId: string) {
      const post = await database.boardPost.findFirst({ where: { id, guildId, removedAt: null } });
      if (!post) throw new Error("That news post is not on the board.");
      return database.boardPost.update({ where: { id }, data: { removedAt: new Date() } });
    },
    recent(guildId: string, take = 25) {
      return database.boardPost.findMany({ where: { guildId, removedAt: null }, orderBy: { createdAt: "desc" }, take });
    },
    /** Officer posts from the game, each ref once. Returns the posts created now. */
    async fromAddon(guildId: string, memberId: string, author: string, posts: AddonBoardPost[]) {
      const created = [];
      for (const post of posts) {
        if (await database.boardPost.findUnique({ where: { guildId_clientRef: { guildId, clientRef: post.ref } } })) continue;
        created.push(await database.boardPost.create({ data: { guildId, body: post.text, author: boardText(author, 80) || "Officer", memberId, source: "game", clientRef: post.ref } })
          .catch(() => null));
      }
      return created.filter((post): post is NonNullable<typeof post> => post !== null);
    }
  };
}
