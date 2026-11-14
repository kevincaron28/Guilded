import { z } from "zod";
import type { PrismaClient } from "../generated/prisma/client.js";
import { externalDuelSchema, recordGlobalDuels } from "./duel-global.js";
import { duelResultSchema, importDuelResults, importMilestones, milestoneSchema } from "./duels.js";
import { integrityConfig } from "./run-integrity-config.js";

// Records a companion carries for players near it (9.3.2, docs/plans/ADDON_ONLY_REACH_2026-11-14.md). The addon keeps the player's own
// records until a carrier is seen and offers them by whisper; a carrier's companion uploads them as `carriedRecords`. Each record is
// applied through the same code as that kind's own upload, only as a statement of its author (a player the record is about), and is
// acknowledged by key so nobody sends it again.

/** What the bot advertises so a companion only sends records to a bot that handles them. */
export const CARRY_FEATURE = "carry-records";
/** A receipt for a carried record: it never marks anything held by a guild (the addon keeps these apart from run receipts). */
export const CARRY_RECEIPT_PREFIX = "carry:";
/** The kinds this bot applies. A record of any other kind is left unanswered, so a newer addon keeps it until the bot knows the kind. */
export const CARRY_KINDS = ["externalDuel", "duel", "milestone"] as const;

const recordSchema = z.object({
  kind: z.string().min(1).max(24),
  key: z.string().min(4).max(120),
  author: z.string().trim().min(1).max(80),
  data: z.unknown()
});

const lower = (text: string) => text.trim().normalize("NFC").toLowerCase();
/** A character name without a realm suffix, lower case: the identity a record is compared by. */
const nameOf = (text: string) => lower(text.split("-")[0] ?? text);

export interface CarryResult {
  /** Receipt refs (prefixed) for every record this lane has dealt with. */
  receipts: string[];
  applied: number;
}

/** The registered guilds' linked characters that are this author (exact full name), with the other characters a guild duel names. */
async function authorCharacters(database: PrismaClient, author: string, edition: string) {
  const rows = await database.character.findMany({
    where: { gameEdition: edition, name: { equals: author.trim(), mode: "insensitive" }, member: { status: { not: "LEFT" } } },
    select: { id: true, guildId: true, name: true, realm: true, memberId: true, level: true }
  });
  return rows.filter((row) => nameOf(row.name) === nameOf(author));
}

/**
 * Applies the records a carrier brought. Never throws. `carrierKeys` are the carrier's own characters (lower case): a record about the
 * carrier's own character is its own upload's business, not a carried one.
 */
export async function applyCarriedRecords(database: PrismaClient, input: { carrier: string; carrierKeys: ReadonlySet<string>; records: readonly unknown[]; now?: Date; edition?: string }): Promise<CarryResult> {
  const now = input.now ?? new Date();
  const edition = input.edition ?? "forever";
  const config = integrityConfig();
  const receipts: string[] = [];
  let applied = 0;
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let room = Math.max(0, config.carriedRecordsPerDay - await database.carriedRecord.count({ where: { carrier: input.carrier, createdAt: { gte: dayStart } } }).catch(() => config.carriedRecordsPerDay));
  for (const raw of input.records) {
    try {
      const parsed = recordSchema.safeParse(raw);
      if (!parsed.success) continue;
      const { kind, key, author, data } = parsed.data;
      if (!(CARRY_KINDS as readonly string[]).includes(kind)) continue;
      const receipt = `${CARRY_RECEIPT_PREFIX}${kind}:${key}`;
      // The carrier's own character, or a record already applied: dealt with.
      if (input.carrierKeys.has(lower(author)) || await database.carriedRecord.findUnique({ where: { kind_key: { kind, key } }, select: { id: true } })) { receipts.push(receipt); continue; }
      // Over the carrier's day: dropped, and told as handled so it is not sent again at every sync.
      if (room <= 0) { receipts.push(receipt); continue; }
      const done = await database.$transaction(async (tx) => {
        const client = tx as unknown as PrismaClient;
        let used = false;
        if (kind === "externalDuel") {
          // Only the reporting side's own statement: the author must be the side the record says reported it.
          const row = externalDuelSchema.safeParse(data);
          if (!row.success) return false;
          const reporter = row.data.side === "winner" ? row.data.winner : row.data.loser;
          if (nameOf(reporter) !== nameOf(author)) return false;
          const result = await recordGlobalDuels(tx, { reporterKey: `install:carried-${nameOf(author)}` }, [row.data], now, edition);
          used = result.recorded + result.confirmed > 0;
        } else {
          const own = await authorCharacters(client, author, edition);
          for (const guildId of [...new Set(own.map((row) => row.guildId))].sort().slice(0, config.crossGuildMaxGuilds)) {
            const mine = own.find((row) => row.guildId === guildId)!;
            if (kind === "duel") {
              const row = duelResultSchema.safeParse(data);
              if (!row.success) continue;
              const names = [row.data.winner, row.data.loser];
              if (!names.some((name) => nameOf(name) === nameOf(author))) continue;
              const guildCharacters = await client.character.findMany({ where: { guildId, gameEdition: edition, OR: names.map((name) => ({ name: { equals: name.trim(), mode: "insensitive" as const } })) }, select: { id: true, name: true, realm: true, memberId: true, level: true } });
              const result = await importDuelResults(tx, guildId, edition, mine.memberId, guildCharacters, [row.data], now);
              used = used || result.recorded > 0;
            } else if (kind === "milestone") {
              const row = milestoneSchema.safeParse(data);
              if (!row.success || nameOf(row.data.character) !== nameOf(author)) continue;
              const result = await importMilestones(tx, guildId, edition, mine.memberId, [{ name: mine.name }], [row.data], now);
              used = used || result.recorded > 0;
            }
          }
        }
        await tx.carriedRecord.create({ data: { kind, key, author: author.slice(0, 80), carrier: input.carrier } });
        return used;
      }, { timeout: 30_000, maxWait: 10_000 }).catch((error: unknown) => {
        // Two carriers sending one record at the same moment: the other one stored it.
        if ((error as { code?: string } | null)?.code === "P2002") return false;
        throw error;
      });
      room--;
      if (done) applied++;
      receipts.push(receipt);
    } catch (error) {
      console.error(`Carried record failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { receipts: [...new Set(receipts)], applied };
}
