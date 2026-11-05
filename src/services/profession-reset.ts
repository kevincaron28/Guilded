// Rules for scripts/reset-professions.ts (an owner-run cleanup), kept here so tests can import them.
export interface SkillRow { id: string; profession: string; updatedAt: Date; character: string; realm: string }

/** Which rows a reset would remove: stored before `before`, and on `realm` when one is named. */
export function selectSkillsToRemove(rows: SkillRow[], before: Date, realm?: string): SkillRow[] {
  const wanted = realm?.trim().toLowerCase();
  return rows.filter((row) => row.updatedAt < before && (wanted === undefined || row.realm.trim().toLowerCase() === wanted));
}

export function parseResetArgs(argv: string[], now = Date.now()): { guild: string; before: Date; realm?: string; apply: boolean } {
  const value = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const guild = value("--guild");
  const beforeText = value("--before");
  if (!guild || !beforeText) throw new Error("Usage: --guild <discord server id> --before <ISO time> [--realm <name>] [--apply]");
  const before = new Date(beforeText);
  if (Number.isNaN(before.getTime())) throw new Error(`--before is not a date: ${beforeText}`);
  if (before.getTime() > now) throw new Error("--before must not be in the future.");
  const realm = value("--realm");
  return { guild, before, ...(realm ? { realm } : {}), apply: argv.includes("--apply") };
}
