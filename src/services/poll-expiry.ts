import type { PrismaClient } from "../generated/prisma/client.js";
import { pilotGuildScope } from "../hosted-pilot.js";
import { enqueueDiscordJob } from "./discord-jobs.js";

export async function queueExpiredPolls(database: PrismaClient, now = new Date()) {
  const polls = await database.poll.findMany({ where: { ...pilotGuildScope, closed: false, closesAt: { lte: now } },
    select: { id: true, guildId: true }, orderBy: { closesAt: "asc" }, take: 100 });
  for (const poll of polls) await database.$transaction(async tx => {
    const closed = await tx.poll.updateMany({ where: { id: poll.id, guildId: poll.guildId, closed: false, closesAt: { lte: now } }, data: { closed: true } });
    if (closed.count) await enqueueDiscordJob(tx, poll.guildId, `poll-expiry:${poll.id}`, "POLL_REFRESH", { pollId: poll.id });
  });
}
