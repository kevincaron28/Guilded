export interface RotationCandidate { memberId: string; name: string; role: string; signedUpAt: Date; status: string }
export interface RotationHistory { attendance: { memberId: string; status: string }[] }
// Advice only: absence, missing data, points, performance and trial status never score.
// The officer keeps final selection; ties retain signup order and then stable identity.
export function benchRotation(candidates: RotationCandidate[], history: RotationHistory[], caps: Record<string, number | null>) {
  return ["TANK", "HEALER", "DPS"].map(role => {
    const available = candidates.filter(c => c.role === role && ["SIGNED_UP", "WAITLISTED"].includes(c.status));
    const rows = available.map(c => ({ ...c, benches: history.filter(r => r.attendance.some(a => a.memberId === c.memberId && a.status === "BENCHED")).length,
      recorded: history.filter(r => r.attendance.some(a => a.memberId === c.memberId)).length }))
      .sort((a, b) => b.benches - a.benches || a.signedUpAt.getTime() - b.signedUpAt.getTime() || a.memberId.localeCompare(b.memberId));
    const cap = caps[role] ?? null;
    return { role, cap, rows: rows.map((row, index) => ({ ...row, suggested: cap === null ? null : index < cap })) };
  });
}
