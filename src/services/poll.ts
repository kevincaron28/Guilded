import type { PrismaClient } from "@prisma/client";

// Officer polls with button voting. One vote per member; voting again
// changes the vote. Results are counts only (votes are not shown by name).

export const MAX_OPTIONS = 5;

type Db = PrismaClient;

export function cleanOptions(raw: (string | null)[]): string[] {
  const options = raw.map((option) => option?.trim() ?? "").filter((option) => option.length > 0);
  if (options.length < 2) throw new Error("A poll needs at least 2 options.");
  if (new Set(options.map((option) => option.toLowerCase())).size !== options.length) throw new Error("Poll options must be different.");
  return options.slice(0, MAX_OPTIONS).map((option) => option.slice(0, 80));
}

export function tallyVotes(optionCount: number, votes: { option: number }[]): number[] {
  const counts = Array.from({ length: optionCount }, () => 0);
  for (const vote of votes) if (vote.option >= 0 && vote.option < optionCount) counts[vote.option] = (counts[vote.option] ?? 0) + 1;
  return counts;
}

// "██████░░░░ 60% (3)" style bar.
export function resultBar(count: number, total: number, width = 10): string {
  const share = total > 0 ? count / total : 0;
  const filled = Math.round(share * width);
  return `${"█".repeat(filled)}${"░".repeat(width - filled)} ${Math.round(share * 100)}% (${count})`;
}

export function createPollService(database: Db) {
  return {
    create(input: { guildId: string; question: string; options: string[]; createdBy: string; closesAt?: Date | null }) {
      const question = input.question.trim();
      if (question.length < 3) throw new Error("Write the question first (at least 3 characters).");
      return database.poll.create({
        data: { guildId: input.guildId, question: question.slice(0, 250), options: input.options, createdBy: input.createdBy, closesAt: input.closesAt ?? null }
      });
    },

    setMessage(pollId: string, channelId: string, messageId: string) {
      return database.poll.update({ where: { id: pollId }, data: { channelId, messageId } });
    },

    async vote(pollId: string, guildId: string, memberId: string, option: number) {
      const poll = await database.poll.findFirst({ where: { id: pollId, guildId } });
      if (!poll) throw new Error("That poll no longer exists.");
      if (poll.closed || (poll.closesAt && poll.closesAt.getTime() <= Date.now())) throw new Error("This poll is closed.");
      if (!Number.isInteger(option) || option < 0 || option >= poll.options.length) throw new Error("That option does not exist.");
      await database.pollVote.upsert({
        where: { pollId_memberId: { pollId, memberId } },
        create: { pollId, memberId, option },
        update: { option, votedAt: new Date() }
      });
      return poll;
    },

    async results(pollId: string) {
      const poll = await database.poll.findUniqueOrThrow({ where: { id: pollId } });
      const votes = await database.pollVote.findMany({ where: { pollId }, select: { option: true } });
      return { poll, counts: tallyVotes(poll.options.length, votes), total: votes.length };
    },

    async close(pollId: string, guildId: string) {
      const poll = await database.poll.findFirst({ where: { id: pollId, guildId } });
      if (!poll) throw new Error("Poll not found in this guild.");
      if (poll.closed) throw new Error("That poll is already closed.");
      return database.poll.update({ where: { id: pollId }, data: { closed: true } });
    }
  };
}
