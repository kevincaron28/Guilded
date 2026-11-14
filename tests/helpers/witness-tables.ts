import { vi } from "vitest";

type Row = Record<string, unknown>;
const matches = (row: Row, where: Row): boolean => Object.entries(where).every(([key, condition]) => {
  const value = row[key];
  if (condition && typeof condition === "object" && !(condition instanceof Date) && !Array.isArray(condition)) {
    const c = condition as Record<string, unknown>;
    if ("startsWith" in c) return typeof value === "string" && value.startsWith(c["startsWith"] as string);
    if ("in" in c) return (c["in"] as unknown[]).includes(value);
    if ("not" in c) return value !== c["not"];
    if ("gte" in c || "lte" in c) return value instanceof Date && (!c["gte"] || value >= (c["gte"] as Date)) && (!c["lte"] || value <= (c["lte"] as Date));
    return true;
  }
  return value === condition;
});

/** In-memory DungeonRunWitness and GuildRosterEntry tables for the run trust path (run-trust.ts, storeDeviceRuns). */
export function witnessTables(rosterNames: string[] = [], seasonNumbers: number[] = [1], excludedDevices: string[] = []) {
  const witnesses: Row[] = [];
  return {
    witnesses,
    tables: {
      // (13 November 2026) The device standing read at the start of storeDeviceRuns.
      companionDevice: { findUnique: async ({ where }: { where: { id: string } }) => ({ excludedGuilds: excludedDevices.includes(where.id) ? ["g1"] : [], createdAt: new Date("2026-01-01T00:00:00Z") }) },
      officialSeason: { findMany: async () => seasonNumbers.map((number) => ({ number })) },
      guildRosterEntry: { findMany: async () => rosterNames.map((nameKey) => ({ nameKey })) },
      dungeonRunWitness: {
        findMany: async ({ where }: { where: Row }) => witnesses.filter((row) => matches(row, where)),
        count: async ({ where }: { where: Row }) => witnesses.filter((row) => matches(row, where)).length,
        upsert: async ({ where, create, update }: { where: { guildId_runRef_deviceId: Row }; create: Row; update: Row }) => {
          const key = where.guildId_runRef_deviceId;
          const found = witnesses.find((row) => row["guildId"] === key["guildId"] && row["runRef"] === key["runRef"] && row["deviceId"] === key["deviceId"]);
          if (found) Object.assign(found, update); else witnesses.push({ id: `w${witnesses.length + 1}`, ...create });
        },
        updateMany: async ({ where, data }: { where: Row; data: Row }) => { const hits = witnesses.filter((row) => matches(row, where)); hits.forEach((row) => Object.assign(row, data)); return { count: hits.length }; }
      }
    },
    updateMany: vi.fn(async () => ({ count: 0 }))
  };
}
