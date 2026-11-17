import type { PrismaClient } from "../generated/prisma/client.js";

// After a restart every cache is cold (a deploy restart gave 20-36 s standings answers, 16 Nov 2026). Shortly after
// ClientReady the bot builds the standings once for a few guilds whose companions were active lately, in the
// background, so the database pool, the query plans and the code are warm when the first polls arrive.
// The answer itself is not cached here: that cache is keyed per member and its header belongs to the API.

export interface WarmupRow { guildId: string; memberId: string; discordUserId: string; guildDiscordId: string; lastUsedAt: Date | null }
export interface WarmupTarget { guildId: string; guildDiscordId: string; memberId: string; actorId: string }

export const WARMUP_WINDOW_MS = 6 * 3_600_000;
export const WARMUP_MAX_GUILDS = 6;

/** One member per guild (the most recently active), most recently active guilds first, at most `max`. */
export function selectWarmupTargets(rows: WarmupRow[], now: number, max = WARMUP_MAX_GUILDS, windowMs = WARMUP_WINDOW_MS): WarmupTarget[] {
  const recent = rows
    .filter((row) => row.lastUsedAt && now - row.lastUsedAt.getTime() <= windowMs && row.lastUsedAt.getTime() <= now + 60_000)
    .sort((a, b) => b.lastUsedAt!.getTime() - a.lastUsedAt!.getTime());
  const seen = new Set<string>();
  const out: WarmupTarget[] = [];
  for (const row of recent) {
    if (seen.has(row.guildId)) continue;
    seen.add(row.guildId);
    out.push({ guildId: row.guildId, guildDiscordId: row.guildDiscordId, memberId: row.memberId, actorId: row.discordUserId });
    if (out.length >= max) break;
  }
  return out;
}

export interface WarmupDeps {
  build: (target: WarmupTarget) => Promise<unknown>;
  pauseMs?: number;
  timeoutMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Builds for each target in turn (never in parallel), with a pause between and a time limit on each. Never throws. */
export async function warmStandings(prisma: PrismaClient, deps: WarmupDeps): Promise<{ warmed: number; failed: number }> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let rows: WarmupRow[];
  try {
    const credentials = await prisma.companionCredential.findMany({
      where: { revokedAt: null, lastUsedAt: { gte: new Date(now() - WARMUP_WINDOW_MS) } },
      orderBy: { lastUsedAt: "desc" },
      take: 200,
      select: { memberId: true, lastUsedAt: true, member: { select: { discordUserId: true, guildId: true, guild: { select: { discordId: true } } } } }
    });
    rows = credentials.map((credential) => ({ guildId: credential.member.guildId, memberId: credential.memberId, discordUserId: credential.member.discordUserId,
      guildDiscordId: credential.member.guild.discordId, lastUsedAt: credential.lastUsedAt }));
  } catch (error) {
    console.info(`Standings warm-up skipped (${(error as Error).message}).`);
    return { warmed: 0, failed: 0 };
  }
  let warmed = 0, failed = 0;
  for (const target of selectWarmupTargets(rows, now())) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([deps.build(target), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("took too long")), deps.timeoutMs ?? 40_000); timer.unref?.(); })]);
      warmed++;
    } catch (error) {
      failed++;
      console.info(`Standings warm-up for guild ${target.guildId} failed (${(error as Error).message}).`);
    } finally { clearTimeout(timer); }
    await sleep(deps.pauseMs ?? 3_000);
  }
  if (warmed + failed > 0) console.info(`Standings warm-up: ${warmed} guild(s) warmed, ${failed} failed.`);
  return { warmed, failed };
}
