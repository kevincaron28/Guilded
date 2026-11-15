import { createHash } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "../generated/prisma/client.js";
import { characterKey, externalDuelSchema, recordGlobalDuels, splitName } from "./duel-global.js";
import { integrityConfig } from "./run-integrity-config.js";
import { cleanCarriedRuns, placeCarriedRun, type RunPlacement } from "./carried-runs.js";

// Records a companion carries for players near it (9.3.2, docs/plans/ADDON_ONLY_REACH_2026-11-14.md). The addon keeps the player's own
// records until a carrier is seen and offers them by whisper; a carrier's companion uploads them as `carriedRecords`.
//
// Trust: the origin of a record is only the carrier's word. So a carried record never reaches a public board on that word alone: an outside
// duel is stored held, uncounted and flagged "c" (see recordGlobalDuels' `carried`), and counts only once the other participant's own
// (non-carried) report of the same duel arrives, or both sides were carried by two different signed-in members. A carried record never
// writes into a guild.

/** What the bot advertises so a companion only sends records to a bot that handles them. */
export const CARRY_FEATURE = "carry-records";
/** A receipt for a carried record: it never marks anything held by a guild (the addon keeps these apart from run receipts). */
export const CARRY_RECEIPT_PREFIX = "carry:";
/** The kinds this bot applies. A record of any other kind is left unanswered, so a newer addon keeps it until the bot knows the kind. */
export const CARRY_KINDS = ["externalDuel", "run"] as const;
/** The most a carried record can weigh as sent (the addon's own limit is 2 KB of record text). */
export const CARRY_RECORD_MAX_JSON = 4096;
/** Records of a kind this bot does not know that one upload may carry before they count against the carrier's day. */
const MAX_UNKNOWN_KINDS = 10;

const recordSchema = z.object({
  kind: z.string().min(1).max(24),
  key: z.string().min(4).max(120).regex(/^[\w\-:.]+$/),
  author: z.string().trim().min(1).max(80),
  data: z.unknown()
});

const lower = (text: string) => text.trim().normalize("NFC").toLowerCase();
/** A character name without a realm suffix, lower case. */
const nameOf = (text: string) => lower(text.split("-")[0] ?? text);

export interface CarryResult {
  /** Receipt refs (prefixed) for every record this lane has dealt with. */
  receipts: string[];
  applied: number;
}

/** Only what an outside duel needs. Guild text, zone and the anti-forgery fields of a device upload are not taken from a carried record. */
const DUEL_KEEP = ["winner", "loser", "winnerRealm", "loserRealm", "winnerClass", "loserClass", "winnerLevel", "loserLevel", "at", "durationSec", "reason", "side"] as const;

/**
 * The carrier's OWN characters, lower case: the uploader's linked characters in the database, plus the exported character and the alts that logged in
 * on its PC. Never the snapshot's `characters` list: that is every guildmate whose addon was heard (peer digests), and treating them as the carrier's
 * own dropped every guildmate's carried record (14 November 2026).
 */
export async function ownCarrierKeys(database: PrismaClient, input: { memberId: string | null | undefined; character?: { name?: unknown } | null | undefined; alts?: readonly ({ name?: unknown } | null | undefined)[] | undefined }): Promise<Set<string>> {
  const names: unknown[] = [input.character?.name, ...(input.alts ?? []).map((alt) => alt?.name)];
  if (input.memberId) {
    const rows = await database.character.findMany({ where: { memberId: input.memberId }, select: { name: true } }).catch((error: unknown) => {
      console.error(`Carried records: own characters not read: ${error instanceof Error ? error.message : String(error)}`);
      return [] as { name: string }[];
    });
    names.push(...rows.map((row) => row.name));
  }
  return new Set(names.flatMap((name) => (typeof name === "string" && name.trim() ? [lower(name)] : [])));
}

/**
 * Applies the records a carrier brought. Never throws. `carrierKeys` are the carrier's own characters (lower case): a record about the
 * carrier's own character is its own upload's business, not a carried one. Every record looked at counts against the carrier's day, the
 * refused ones too.
 */
export async function applyCarriedRecords(database: PrismaClient, input: { carrier: string; carrierKeys: ReadonlySet<string>; records: readonly unknown[]; now?: Date; edition?: string;
  /** (9.3.3) The public run lane a carried run is placed on. Without it carried runs are refused. */ relay?: RunPlacement }): Promise<CarryResult> {
  const now = input.now ?? new Date();
  const edition = input.edition ?? "forever";
  const config = integrityConfig();
  const receipts: string[] = [];
  let applied = 0;
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let room = Math.max(0, config.carriedRecordsPerDay - await database.carriedRecord.count({ where: { carrier: input.carrier, createdAt: { gte: dayStart } } }).catch(() => config.carriedRecordsPerDay));
  /** Notes a refused record against the carrier's day (the same junk sent again is one row, not many). */
  const refuse = async (kind: string, key: string, authorKey: string, author: string, reason: string, status = "rejected") => {
    await database.carriedRecord.create({ data: { kind: kind.slice(0, 24), key: key.slice(0, 120), author: author.slice(0, 80), authorKey: authorKey.slice(0, 160), carrier: input.carrier, status } }).catch((error: unknown) => {
      // The same refusal again is one row (unique key); anything else is logged, so no outcome is silent.
      if ((error as { code?: string } | null)?.code !== "P2002") console.error(`Carried record ${kind}:${key.slice(0, 40)} refused (${reason}), row not saved: ${error instanceof Error ? error.message : String(error)}`);
    });
    console.info(`Carried record ${kind}:${key.slice(0, 40)} from ${author.slice(0, 40)} via ${input.carrier}: ${status} (${reason})`);
  };
  let unknown = 0;
  for (const raw of input.records) {
    try {
      if (room <= 0) break;
      const text = JSON.stringify(raw) ?? "";
      if (text.length > CARRY_RECORD_MAX_JSON) { room--; await refuse("invalid", createHash("sha256").update(text).digest("hex").slice(0, 32), "?", "", "too-large"); continue; }
      const parsed = recordSchema.safeParse(raw);
      if (!parsed.success) { room--; await refuse("invalid", createHash("sha256").update(text).digest("hex").slice(0, 32), "?", "", "bad-shape"); continue; }
      const { kind, key, author, data } = parsed.data;
      // A kind this bot does not know stays with the addon (no receipt); a flood of them is counted as work past the first few.
      if (!(CARRY_KINDS as readonly string[]).includes(kind)) { if (++unknown > MAX_UNKNOWN_KINDS) room--; continue; }
      const receipt = `${CARRY_RECEIPT_PREFIX}${kind}:${key}`;
      // (9.3.3) A dungeon run of a party with no companion: ranked like a single unsigned reporter's run (carried-runs.ts).
      if (kind === "run") {
        room--;
        const dealt = await placeCarriedRun(database, { carrier: input.carrier, carrierKeys: input.carrierKeys, key, author, data, now, relay: input.relay },
          (reason, status = "rejected") => refuse(kind, key, characterKey(nameOf(author), ""), author, reason, status));
        if (dealt) receipts.push(receipt);
        continue;
      }
      // An outside duel is the reporting side's own statement: the author must be that side, and the identity includes its realm.
      const row = externalDuelSchema.safeParse(data);
      if (!row.success) { room--; await refuse(kind, key, characterKey(nameOf(author), ""), author, "bad-duel-data"); receipts.push(receipt); continue; }
      const side = row.data.side === "winner" ? splitName(row.data.winner, row.data.winnerRealm) : splitName(row.data.loser, row.data.loserRealm);
      if (nameOf(side.name) !== nameOf(author)) { room--; await refuse(kind, key, characterKey(nameOf(author), ""), author, "author-not-a-side"); receipts.push(receipt); continue; }
      // A side without a realm cannot be told from another player of the same name.
      if (!side.realm.trim()) { room--; await refuse(kind, key, characterKey(nameOf(author), ""), author, "no-realm"); receipts.push(receipt); continue; }
      const authorKey = characterKey(side.name, side.realm);
      // The carrier's own character, or a record already dealt with (by this author's key only): answered, not applied again.
      if (await database.carriedRecord.findUnique({ where: { kind_authorKey_key: { kind, authorKey, key } }, select: { id: true } })) { receipts.push(receipt); continue; }
      // The carrier's own character: its own upload reports that duel. A row is saved ("own") before the receipt, so the origin never marks done a record nothing stored.
      if (input.carrierKeys.has(lower(side.name))) { room--; await refuse(kind, key, authorKey, author, "carrier's own character", "own"); receipts.push(receipt); continue; }
      room--;
      const clean: Record<string, unknown> = {};
      for (const field of DUEL_KEEP) if (row.data[field] !== undefined) clean[field] = row.data[field];
      const done = await database.$transaction(async (tx) => {
        const result = await recordGlobalDuels(tx, { reporterKey: `install:carried|${input.carrier}|${authorKey}`, carried: true }, [clean], now, edition);
        await tx.carriedRecord.create({ data: { kind, key, author: author.slice(0, 80), authorKey: authorKey.slice(0, 160), carrier: input.carrier, status: "applied" } });
        return result.recorded + result.confirmed > 0;
      }, { timeout: 30_000, maxWait: 10_000 }).catch((error: unknown) => {
        // Two carriers sending one record at the same moment: the other one stored it.
        if ((error as { code?: string } | null)?.code === "P2002") return false;
        throw error;
      });
      if (done) applied++;
      receipts.push(receipt);
    } catch (error) {
      console.error(`Carried record failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  await cleanCarriedRuns(database, now);
  return { receipts: [...new Set(receipts)], applied };
}
