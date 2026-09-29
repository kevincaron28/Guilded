import type { PrismaClient } from "@prisma/client";
import { asLootMode, effectiveRules, type LootMode } from "./core-rules.js";
import { createItemValueService, type ValueRow } from "./item-values.js";

// What the addon needs to run loot the way each raid core has chosen: the loot system, the
// set item prices, and (for a core with its own point pool) that pool's standings. The
// companion writes it into Standings.lua next to the guild standings.

export interface LootRulesForAddon {
  default: LootMode;
  minimumBid: number;
  /** Prices for raids that belong to no core. */
  values: { key: string; id: number | null; gp: number }[];
  cores: {
    id: string;
    name: string;
    mode: LootMode;
    separatePool: boolean;
    reserves: number;
    baseGp: number;
    offspecPercent: number;
    minEp: number;
    values: { key: string; id: number | null; gp: number }[];
    /** Only for a core with its own pool. */
    standings: { character: string; main: boolean; ep: number; gp: number }[];
    /** Who is in the core, by in-game character (see coreRosterRows). */
    roster: CoreRosterRow[];
  }[];
}

// One character of a core's roster: the one a player brings to the core (else their main), plus
// one row per backup character with its own role. `member` (their Discord name) ties a player's
// rows together; `spot` is "main", "bench" or "trial"; `backup` marks a backup character.
export interface CoreRosterRow { name: string; member: string; role: string; spot: "main" | "bench" | "trial"; backup: boolean }

type SpotForRoster = {
  role: string; bench: boolean; trial: boolean;
  member: { displayName: string; characters: { name: string }[] };
  character: { name: string } | null;
  backups: { role: string; character: { name: string } }[];
};

export function coreRosterRows(spots: SpotForRoster[]): CoreRosterRow[] {
  return spots.flatMap((spot) => {
    const spotKind = spot.trial ? "trial" : spot.bench ? "bench" : "main";
    const name = spot.character?.name ?? spot.member.characters[0]?.name;
    const rows: CoreRosterRow[] = name ? [{ name, member: spot.member.displayName, role: spot.role, spot: spotKind, backup: false }] : [];
    for (const backup of spot.backups) {
      rows.push({ name: backup.character.name, member: spot.member.displayName, role: backup.role, spot: spotKind, backup: true });
    }
    return rows;
  });
}

const MAX_VALUES = 400;
const slim = (rows: ValueRow[]) => rows.slice(0, MAX_VALUES).map((row) => ({ key: row.key, id: row.id, gp: row.gp }));

type Db = Pick<PrismaClient, "guildSettings" | "raidCore" | "coreItemValue">;

export async function lootRulesForAddon(
  database: Db, guildId: string,
  poolStandings: (coreId: string, baseGp: number) => Promise<{ character: string; main: boolean; ep: number; gp: number }[]>
): Promise<LootRulesForAddon> {
  const [settings, cores] = await Promise.all([
    database.guildSettings.findUnique({ where: { guildId } }),
    database.raidCore.findMany({
      where: { guildId }, orderBy: { name: "asc" }, take: 30,
      include: { members: { include: {
        member: { select: { displayName: true, characters: { select: { name: true }, orderBy: { isMain: "desc" }, take: 1 } } },
        character: { select: { name: true } },
        backups: { select: { role: true, character: { select: { name: true } } } }
      } } }
    })
  ]);
  const values = createItemValueService(database);
  const out: LootRulesForAddon = {
    default: asLootMode(settings?.lootMode),
    minimumBid: settings?.minimumBid ?? 10,
    values: slim(await values.effective(guildId, null)),
    cores: []
  };
  for (const core of cores) {
    const rules = effectiveRules(settings, core);
    out.cores.push({
      id: core.id, name: core.name, mode: rules.lootMode, separatePool: rules.separatePool, reserves: rules.reservesPerPlayer, baseGp: rules.baseGp,
      offspecPercent: rules.offspecPercent, minEp: rules.minEp,
      values: rules.lootMode === "PRIORITY" ? slim(await values.effective(guildId, core.id)) : [],
      standings: rules.separatePool ? await poolStandings(core.id, rules.baseGp) : [],
      roster: coreRosterRows(core.members)
    });
  }
  return out;
}
