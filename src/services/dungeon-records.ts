import { escapeMarkdown } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { Lang } from "../i18n.js";
import type { DungeonImportResult } from "./dungeon-import.js";
import { formatDuration } from "./dungeon-rules.js";
import { guildPlayers } from "./dungeon-card.js";
import { displayCharacterName, loadFullNameBook } from "./character-display.js";

// 9.1 guild records and challenges (docs/plans/RECORDS_AND_RECAPS.md). A run that beats the guild's fastest clear or a boss's
// fastest kill, or completes a challenge for the first time on that dungeon, is stored once as a DungeonHighlight (the unique
// key makes a re-upload or a second observer harmless) and called out on the run's own post. Simulations never count.

export type HighlightKind = "clear" | "boss" | "first" | "deathless" | "guild5";
export interface DungeonHighlightItem {
  kind: HighlightKind; key: string; instanceId: number; difficultyId: number; dungeonName: string;
  /** Boss name, for a boss record. */
  label?: string; valueSec?: number; previousSec?: number; players: string[];
  /** A clear record only, not stored: the guild members of the run that held the record before (full names). */
  previousPlayers?: string[];
}
type Encounter = NonNullable<DungeonImportResult["encounters"]>[number];
/** What an earlier guild clear of the same dungeon tells us. */
export interface PriorClear { difficultyId: number; endedAt: number; kills: BossKill[]; deathless: boolean; allGuild: boolean }
export interface BossKill { id: number; name: string; sec: number }

const MIN_KILL_SEC = 3, MAX_KILL_SEC = 3600;

/** Successful boss kills with both a pull and a kill time, as pull → kill seconds. One per encounter (the fastest). */
export function bossKills(encounters: readonly Partial<Encounter>[] | null | undefined): BossKill[] {
  const best = new Map<number, BossKill>();
  for (const event of encounters ?? []) {
    if (!event?.success || typeof event.id !== "number" || typeof event.at !== "number" || typeof event.startedAt !== "number") continue;
    const sec = event.at - event.startedAt;
    if (sec < MIN_KILL_SEC || sec > MAX_KILL_SEC) continue;
    const previous = best.get(event.id);
    if (!previous || sec < previous.sec) best.set(event.id, { id: event.id, name: event.name || `#${event.id}`, sec });
  }
  return [...best.values()];
}

/** Every party member was tracked and nobody died (two players at least, so a solo clear is not a "flawless group"). */
export function isDeathless(deaths: readonly (number | null | undefined)[]): boolean {
  return deaths.length >= 2 && deaths.every(value => value === 0);
}

function runIsDeathless(run: DungeonImportResult): boolean {
  const details = run.playerDetails ?? [];
  return details.length >= run.players.length && isDeathless(details.map(detail => detail.deaths));
}
function runIsAllGuild(run: DungeonImportResult): boolean {
  const party = new Set(run.players.map(name => name.toLowerCase()));
  const guild = new Set([...guildPlayers(run)].map(name => name.toLowerCase()));
  return party.size >= 5 && [...party].every(name => guild.has(name));
}

/**
 * Pure: the records and challenges this completed run sets, judged against the guild's earlier clears of the same dungeon (any
 * difficulty; each check filters to the run's own). `run.guildRecord` is the import's own record decision (the card badge), reused
 * as is. A first kill of a boss only sets the bar: it is not announced as a record.
 */
export function runHighlights(run: DungeonImportResult, prior: readonly PriorClear[]): DungeonHighlightItem[] {
  if (!run.runId || !run.valid || run.state !== "COMPLETED" || run.durationSec === null || run.runRef.startsWith("SIM-")) return [];
  const sameDifficulty = prior.filter(row => row.difficultyId === run.difficultyId);
  const base = { instanceId: instanceOf(run), difficultyId: run.difficultyId, dungeonName: run.dungeonName,
    players: [...guildPlayers(run)].map(name => run.fullNames?.[name] ?? name) };
  const route = `${base.instanceId}:${run.difficultyId}`;
  const out: DungeonHighlightItem[] = [];
  if (!sameDifficulty.length) out.push({ ...base, kind: "first", key: `first:${route}`, valueSec: run.durationSec });
  if (run.guildRecord && run.previousGuildBest !== null)
    out.push({ ...base, kind: "clear", key: `clear:${route}:${run.runId}`, valueSec: run.durationSec, previousSec: run.previousGuildBest });
  for (const kill of bossKills(run.encounters)) {
    const earlier = sameDifficulty.flatMap(row => row.kills.filter(other => other.id === kill.id).map(other => other.sec));
    if (earlier.length && kill.sec < Math.min(...earlier))
      out.push({ ...base, kind: "boss", key: `boss:${kill.id}:${run.difficultyId}:${run.runId}`, label: kill.name, valueSec: kill.sec, previousSec: Math.min(...earlier) });
  }
  if (runIsDeathless(run) && !sameDifficulty.some(row => row.deathless)) out.push({ ...base, kind: "deathless", key: `deathless:${route}`, valueSec: run.durationSec });
  if (runIsAllGuild(run) && !sameDifficulty.some(row => row.allGuild)) out.push({ ...base, kind: "guild5", key: `guild5:${route}`, valueSec: run.durationSec });
  return out;
}

const instanceOf = (run: DungeonImportResult) => run.instanceId ?? 0;

/** The guild members (full names) of the earliest clear that set the record this run just beat. Empty when it cannot be found. */
async function previousHolders(db: RecordsDb, guildId: string, item: DungeonHighlightItem, runId: string): Promise<string[]> {
  try {
    const previous = await db.dungeonRun.findFirst({
      where: { guildId, instanceId: item.instanceId, difficultyId: item.difficultyId, valid: true, state: "COMPLETED", durationSec: item.previousSec ?? -1,
        id: { not: runId }, NOT: { runRef: { startsWith: "SIM-" } } },
      orderBy: { endedAt: "asc" }, select: { players: { where: GUILD_PLAYER, select: { character: true } } }
    });
    if (!previous?.players.length) return [];
    const book = await loadFullNameBook(db, guildId);
    return [...new Set(previous.players.map(player => displayCharacterName(player.character, book)))].slice(0, 5);
  } catch { return []; }
}

type RecordsDb = Pick<PrismaClient, "dungeonRun" | "dungeonHighlight"> & Partial<Pick<PrismaClient, "character" | "unclaimedCharacter" | "guildRosterEntry">>;
const GUILD_PLAYER = { OR: [{ memberId: { not: null } }, { inGuild: true }] };

/**
 * Stores the records and challenges of the newly imported runs and attaches the NEW ones to each result as `highlights` (an
 * item already stored by an earlier upload is not repeated). Runs of the same upload are judged oldest first, each counting as
 * history for the next. Never throws: highlights are extras, the run post goes out without them.
 */
export async function recordRunHighlights(db: RecordsDb, guildId: string, results: DungeonImportResult[]): Promise<void> {
  try {
    const runs = results.filter(run => run.runId && run.valid && run.state === "COMPLETED" && run.durationSec !== null && !run.runRef.startsWith("SIM-") && guildPlayers(run).size > 0);
    if (!runs.length) return;
    const stored = await db.dungeonRun.findMany({ where: { guildId, id: { in: runs.map(run => run.runId!) } }, select: { id: true, instanceId: true, endedAt: true } });
    const instanceById = new Map(stored.map(row => [row.id, row.instanceId]));
    const instances = [...new Set(stored.map(row => row.instanceId))];
    const history = await db.dungeonRun.findMany({
      where: { guildId, instanceId: { in: instances }, valid: true, state: "COMPLETED", durationSec: { not: null }, id: { notIn: runs.map(run => run.runId!) },
        NOT: { runRef: { startsWith: "SIM-" } }, players: { some: GUILD_PLAYER } },
      select: { instanceId: true, difficultyId: true, endedAt: true, competitionData: true, players: { select: { deaths: true, inGuild: true, memberId: true } } },
      orderBy: { endedAt: "desc" }, take: 3000
    });
    const prior = new Map<number, PriorClear[]>();
    for (const row of history) prior.set(row.instanceId, [...(prior.get(row.instanceId) ?? []), {
      difficultyId: row.difficultyId, endedAt: Math.floor((row.endedAt?.getTime() ?? 0) / 1000),
      kills: bossKills((row.competitionData as { encounters?: Encounter[] } | null)?.encounters),
      deathless: isDeathless(row.players.map(player => player.deaths)),
      allGuild: row.players.length >= 5 && row.players.every(player => player.inGuild || player.memberId !== null)
    }]);
    for (const run of [...runs].sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0))) {
      const instanceId = instanceById.get(run.runId!);
      if (instanceId === undefined) continue;
      const earlier = (prior.get(instanceId) ?? []).filter(row => !run.endedAt || row.endedAt <= run.endedAt);
      const items = runHighlights({ ...run, instanceId }, earlier);
      if (items.length) {
        const known = new Set((await db.dungeonHighlight.findMany({ where: { guildId, key: { in: items.map(item => item.key) } }, select: { key: true } })).map(row => row.key));
        const fresh = items.filter(item => !known.has(item.key));
        if (fresh.length) {
          for (const item of fresh) if (item.kind === "clear" && item.previousSec !== undefined) item.previousPlayers = await previousHolders(db, guildId, item, run.runId!);
          await db.dungeonHighlight.createMany({ skipDuplicates: true, data: fresh.map(item => ({ guildId, runId: run.runId!, key: item.key, kind: item.kind,
            instanceId: item.instanceId, difficultyId: item.difficultyId, dungeonName: item.dungeonName, label: item.label ?? null,
            valueSec: item.valueSec ?? null, previousSec: item.previousSec ?? null, players: item.players.slice(0, 10) })) });
          run.highlights = fresh;
        }
      }
      prior.set(instanceId, [...(prior.get(instanceId) ?? []), { difficultyId: run.difficultyId, endedAt: run.endedAt ?? 0, kills: bossKills(run.encounters),
        deathless: runIsDeathless(run), allGuild: runIsAllGuild(run) }]);
    }
  } catch (error) {
    console.error("Dungeon highlights failed", error);
  }
}

/** One line per highlight, for the run post's embed and the recap. */
export function highlightText(item: Pick<DungeonHighlightItem, "kind" | "label" | "valueSec" | "previousSec" | "dungeonName">, lang: Lang, withDungeon = false): string {
  const fr = lang === "fr", time = item.valueSec !== undefined ? formatDuration(item.valueSec) : "";
  const before = item.previousSec !== undefined ? ` (${fr ? "avant" : "was"} ${formatDuration(item.previousSec)})` : "";
  const where = withDungeon ? ` · ${escapeMarkdown(item.dungeonName)}` : "";
  const boss = escapeMarkdown(item.label ?? "");
  switch (item.kind) {
    case "clear": return `🏆 ${fr ? "Record de guilde" : "Guild record"}${where}: **${time}**${before}`;
    case "boss": return `⚔️ ${fr ? `Kill le plus rapide de ${boss}` : `Fastest ${boss} kill`}${where}: **${time}**${before}`;
    case "first": return `🚩 ${fr ? "Premier parcours de la guilde" : "First guild clear"}${where}`;
    case "deathless": return `🛡️ ${fr ? "Parcours sans mort" : "Flawless clear"}${where}: ${fr ? "personne n'est tombé" : "nobody died"}`;
    case "guild5": return `⚜️ ${fr ? "Groupe 100 % guilde" : "All-guild party"}${where}`;
  }
}

/** Short badge text for the run card. */
export function highlightBadge(item: Pick<DungeonHighlightItem, "kind" | "label">, lang: Lang): string {
  const fr = lang === "fr";
  switch (item.kind) {
    case "clear": return fr ? "Nouveau record de guilde" : "New guild record";
    case "boss": return fr ? `Record : ${item.label}` : `${item.label} record`;
    case "first": return fr ? "Premier parcours de la guilde" : "First guild clear";
    case "deathless": return fr ? "Sans mort" : "Flawless";
    case "guild5": return fr ? "Groupe 100 % guilde" : "All-guild party";
  }
}

/** The run post's lead line: what fell, in a few words, with the dungeon. */
export function highlightHeadline(items: readonly DungeonHighlightItem[], dungeon: string, lang: Lang): string | undefined {
  if (!items.length) return undefined;
  const order: HighlightKind[] = ["clear", "boss", "first", "deathless", "guild5"];
  const sorted = [...items].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  const words = [...new Set(sorted.map(item => highlightBadge(item, lang)))].slice(0, 3).join(" · ");
  return `🏆 **${escapeMarkdown(words)}** · ${escapeMarkdown(dungeon)}`.slice(0, 300);
}

export interface BossRecordRow { encounterId: number; boss: string; dungeonName: string; difficultyId: number; sec: number; endedAt: Date | null; players: string[] }

/**
 * The guild's fastest kill of every boss, all time, from the stored runs' encounters (first kills included: the board shows
 * the standing best, not only beaten records). Newest records first.
 */
export async function guildBossRecords(db: Pick<PrismaClient, "dungeonRun"> & Partial<Pick<PrismaClient, "character" | "unclaimedCharacter" | "guildRosterEntry">>, guildId: string): Promise<BossRecordRow[]> {
  const runs = await db.dungeonRun.findMany({
    where: { guildId, valid: true, state: "COMPLETED", durationSec: { not: null }, NOT: { runRef: { startsWith: "SIM-" } }, players: { some: GUILD_PLAYER } },
    select: { dungeonName: true, difficultyId: true, endedAt: true, competitionData: true, players: { where: GUILD_PLAYER, select: { character: true } } },
    orderBy: { endedAt: "asc" }, take: 3000
  });
  const best = new Map<string, BossRecordRow>();
  for (const run of runs) for (const kill of bossKills((run.competitionData as { encounters?: Encounter[] } | null)?.encounters)) {
    const key = `${kill.id}:${run.difficultyId}`, previous = best.get(key);
    if (!previous || kill.sec < previous.sec) best.set(key, { encounterId: kill.id, boss: kill.name, dungeonName: run.dungeonName, difficultyId: run.difficultyId, sec: kill.sec, endedAt: run.endedAt,
      players: run.players.map(player => player.character) });
  }
  if (!best.size) return [];
  const book = await loadFullNameBook(db, guildId);
  return [...best.values()].map(row => ({ ...row, players: row.players.map(name => displayCharacterName(name, book)) }))
    .sort((a, b) => (b.endedAt?.getTime() ?? 0) - (a.endedAt?.getTime() ?? 0));
}

/** Compact lines for the records board ("Fastest boss kills"), within `budget` characters. */
export function bossRecordLines(rows: readonly BossRecordRow[], budget = 1000): string[] {
  const lines: string[] = [];
  let used = 0;
  for (const row of rows) {
    const names = row.players.slice(0, 3).join(", ") + (row.players.length > 3 ? ` +${row.players.length - 3}` : "");
    const line = `⚔️ **${escapeMarkdown(row.boss)}** (${escapeMarkdown(row.dungeonName)}) · ${formatDuration(row.sec)}${names ? ` · ${escapeMarkdown(names)}` : ""}`;
    if (used + line.length + 1 > budget) break;
    lines.push(line); used += line.length + 1;
  }
  return lines;
}
