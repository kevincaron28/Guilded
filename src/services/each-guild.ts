/**
 * Runs a scheduled job for each server in turn. One server's failure (a Discord refusal, a database timeout) is
 * reported for that server and the loop goes on: a plain `for ... await` stopped at the first error, so every server
 * after it in the list missed that cycle (scheduled events, raid signup repair, voice checkpoints, 20 Nov 2026).
 */
export async function eachGuild<G>(guilds: Iterable<G>, work: (guild: G) => Promise<unknown>, onError: (error: unknown, guild: G) => void): Promise<void> {
  for (const guild of guilds) {
    try { await work(guild); } catch (error) { onError(error, guild); }
  }
}
