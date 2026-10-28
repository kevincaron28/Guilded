import type { Lang } from "../i18n.js";

export const COMMUNITY_MILESTONES = [100, 300, 500] as const;
export const COMMUNITY_MILESTONE_LABEL = COMMUNITY_MILESTONES.join(" / ");
export const milestoneCode = (threshold: number) => `community-${threshold}`;
export const reachedMilestones = (points: number) => COMMUNITY_MILESTONES.filter(value => points >= value);
export function badgeProgress(points: number) {
  return { reached: reachedMilestones(points), next: COMMUNITY_MILESTONES.find(value => value > points) ?? null };
}
export function badgeLabel(code: string, lang: Lang): string {
  if (code.startsWith("community-")) return `${lang === "fr" ? "Communauté" : "Community"} · ${code.slice(10)}`;
  if (code.startsWith("legacy-")) return `${lang === "fr" ? "Ancien palier" : "Legacy milestone"} · ${code.slice(7)}`;
  const labels: Record<string, [string, string]> = { helper: ["Reviewed helper", "Entraide validée"], attendee: ["Confirmed participant", "Participation confirmée"], organizer: ["Community organizer", "Organisation communautaire"] };
  return labels[code]?.[lang === "fr" ? 1 : 0] ?? code;
}

// Group equal timestamps: the ledger cannot prove an ordering within those groups.
// Only earned standings count; spending/refunds cannot unlock or erase recognition.
export function historicalPeak(rows: { amount: number; kind: string; createdAt: Date }[]): number {
  const groups = new Map<number, number>();
  for (const row of rows) if (["AWARD", "REVERSAL"].includes(row.kind)) groups.set(+row.createdAt, (groups.get(+row.createdAt) ?? 0) + row.amount);
  let total = 0, peak = 0;
  for (const [, amount] of [...groups].sort(([a], [b]) => a - b)) { total += amount; peak = Math.max(peak, total); }
  return peak;
}
