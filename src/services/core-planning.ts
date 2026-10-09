export function coreComposition(size: string, tanks: string, healers: string, dps: string) {
  const values = [size, tanks, healers, dps].map(value => value.trim());
  if (!values.every(value => /^\d{1,2}$/.test(value))) throw new Error("Enter whole numbers for size, tanks, healers and DPS / Indique des nombres entiers.");
  const [raidSize, tankLimit, healerLimit, dpsLimit] = values.map(Number) as [number, number, number, number];
  if (raidSize < 1 || raidSize > 40 || tankLimit + healerLimit + dpsLimit !== raidSize) {
    throw new Error("Tanks + healers + DPS must equal the raid size (1–40) / La somme des rôles doit correspondre à la taille du raid.");
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
