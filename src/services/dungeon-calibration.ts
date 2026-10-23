// Conservative review guardrails, not a claim of statistical representativeness.
export const CALIBRATION_POLICY = { samples: 20, crews: 5, days: 3, minimumParty: 3, crewOverlap: 0.6 } as const;
export interface CalibrationSample { id: string; seconds: number; endedAt: Date; crew: string[]; build: string | null; startTrigger: string | null }
const median = (values: number[]) => {
  const a = [...values].sort((x, y) => x - y);
  return a.length ? Math.round((a[Math.floor((a.length - 1) / 2)]! + a[Math.floor(a.length / 2)]!) / 2) : null;
};

export function calibrationSample(runs: CalibrationSample[]) {
  // Compare one client build and a single timer convention. Legacy metadata is unknown.
  const known = runs.filter(r => r.build && r.startTrigger === "first combat" && new Set(r.crew).size >= CALIBRATION_POLICY.minimumParty);
  const build = [...known].sort((a, b) => b.endedAt.getTime() - a.endedAt.getTime() || a.id.localeCompare(b.id))[0]?.build ?? null;
  const comparable = known.filter(r => r.build === build).sort((a, b) => a.id.localeCompare(b.id));
  // Connected components conservatively group overlapping crews; swapping one member
  // or chaining overlapping groups cannot manufacture independent samples.
  const parent = comparable.map((_, i) => i);
  const root = (i: number): number => parent[i] === i ? i : (parent[i] = root(parent[i]!));
  const crews = comparable.map(r => new Set(r.crew));
  for (let i = 0; i < crews.length; i++) for (let j = 0; j < i; j++) {
    const shared = [...crews[i]!].filter(p => crews[j]!.has(p)).length;
    if (shared / Math.max(crews[i]!.size, crews[j]!.size) >= CALIBRATION_POLICY.crewOverlap) parent[root(i)] = root(j);
  }
  const daily = new Map<string, number[]>();
  const days = new Set<string>();
  comparable.forEach((r, i) => {
    const day = r.endedAt.toISOString().slice(0, 10);
    days.add(day);
    const key = `${root(i)}:${day}`;
    daily.set(key, [...daily.get(key) ?? [], r.seconds]);
  });
  // One median per crew/UTC day. Repeated speed farming gets no extra weight.
  const times = [...daily.values()].map(values => median(values)!).sort((a, b) => a - b);
  const crewCount = new Set(comparable.map((_, i) => root(i))).size;
  const quartile = (fraction: number) => times.length ? times[Math.floor((times.length - 1) * fraction)]! : null;
  const ready = times.length >= CALIBRATION_POLICY.samples && crewCount >= CALIBRATION_POLICY.crews && days.size >= CALIBRATION_POLICY.days;
  return { build, rawRuns: runs.length, comparableRuns: comparable.length, excludedRuns: runs.length - comparable.length,
    crews: crewCount, days: days.size, times, median: median(times), p25: quartile(0.25), p75: quartile(0.75), ready };
}
