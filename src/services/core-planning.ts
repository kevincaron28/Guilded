// Supported raid formats; change here if the game's formats change later.
export const CORE_RAID_SIZES: readonly number[] = [10, 20, 40];

export function coreComposition(size: string, tanks: string, healers: string, dps: string) {
  const values = [size, tanks, healers, dps].map(value => value.trim());
  if (!values.every(value => /^\d{1,2}$/.test(value))) throw new Error("Enter whole numbers for size, tanks, healers and DPS / Indique des nombres entiers.");
  const [raidSize, tankLimit, healerLimit, dpsLimit] = values.map(Number) as [number, number, number, number];
  if (!CORE_RAID_SIZES.includes(raidSize) || tankLimit + healerLimit + dpsLimit !== raidSize) {
    throw new Error("Choose 10, 20 or 40 players; tanks + healers + DPS must equal that size / Choisis 10, 20 ou 40 joueurs; la somme des rôles doit correspondre.");
  }
  return { raidSize, tankLimit, healerLimit, dpsLimit };
}

export function planningOptions(start: string, days: string) {
  const weeklyStartDate = start.trim() || null;
  if (weeklyStartDate && (!/^\d{4}-\d{2}-\d{2}$/.test(weeklyStartDate) ||
    !Number.isFinite(Date.parse(weeklyStartDate)) || new Date(weeklyStartDate).toISOString().slice(0, 10) !== weeklyStartDate)) {
    throw new Error("Start date must be YYYY-MM-DD / Date de début : AAAA-MM-JJ.");
  }
  if (!/^\d{1,2}$/.test(days.trim()) || Number(days) < 1 || Number(days) > 90) throw new Error("Planning window: 1–90 days / Préparation : 1 à 90 jours.");
  return { weeklyStartDate, weeklyHorizonDays: Number(days) };
}
