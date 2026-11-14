// The bosses of a dungeon, as the addon reports them (native encounter ids). Only dungeons whose bosses were read from real runs are listed;
// for any other dungeon the bot knows no boss list and treats the run as having no boss information.

export interface RouteBoss {
  id: number;
  name: string;
  /** Required to finish the dungeon. Every other boss is optional. */
  final?: boolean;
}

export interface RouteBosses { instanceId: number; name: string; bosses: readonly RouteBoss[] }

/** The Drowned City (instance 2970), read from the guild's runs of 10-14 November 2026. */
export const ROUTE_BOSSES: readonly RouteBosses[] = [
  { instanceId: 2970, name: "The Drowned City", bosses: [
    { id: 3474, name: "Zul'Alai" },
    { id: 3475, name: "Var'Taka" },
    { id: 3476, name: "Captain Dreadrise" },
    { id: 3478, name: "Deathless Guardians" },
    { id: 3479, name: "Min'loth the Serpent", final: true },
    { id: 3511, name: "Primeval Elemental" }
  ] }
];

export const routeBosses = (instanceId: number): RouteBosses | null => ROUTE_BOSSES.find((route) => route.instanceId === instanceId) ?? null;

/** The boss that ends this dungeon, or null when the bot has no boss list for it. */
export const finalBossOf = (instanceId: number): RouteBoss | null => routeBosses(instanceId)?.bosses.find((boss) => boss.final) ?? null;
