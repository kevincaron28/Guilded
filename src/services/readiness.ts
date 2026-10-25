import { ReadinessFindingSeverity, ReadinessStatus } from "../generated/prisma/client.js";
import { currentEdition } from "./edition-context.js";

export const RAID_LEVEL = 60;
export function raidLevel(edition = currentEdition()): number {
  return edition === "retail" || edition === "classic-mists" ? 90 : edition === "classic-tbc" ? 70 : RAID_LEVEL;
}
export const RAID_CHECK_MAX_AGE_MS = 24 * 60 * 60_000;
export type RaidReadinessStatus = "READY" | "PARTIAL" | "NOT_READY" | "LEVELLING" | "UNKNOWN";
export interface RaidReadinessSnapshot {
  status: string;
  inspectedAt: Date;
  character: { level: number | null; gameEdition?: string };
  findings: Array<{ severity: string; message: string }>;
}

// Addon READY describes a gear check at the character's current level. It is
// not raid eligibility; old/missing evidence must never certify a raider.
export function assessRaidReadiness(snapshot: RaidReadinessSnapshot, now = new Date()): { status: RaidReadinessStatus; reason?: string } {
  const level = snapshot.character.level;
  const required = raidLevel(snapshot.character.gameEdition as Parameters<typeof raidLevel>[0]);
  if (!level || !Number.isInteger(level) || level < 1) return { status: "UNKNOWN", reason: `Character level missing; sync the addon to verify level ${required} eligibility.` };
  if (level < required) return { status: "LEVELLING", reason: `Level ${level}/${required} — ${required - level} levels to go.` };
  const age = now.getTime() - snapshot.inspectedAt.getTime();
  if (!Number.isFinite(age) || age < -5 * 60_000 || age > RAID_CHECK_MAX_AGE_MS) {
    return { status: "UNKNOWN", reason: "Gear check needs refreshing (checks expire after 24 hours)." };
  }
  if (snapshot.status === "NOT_READY" || snapshot.findings.some(f => f.severity === "ERROR")) return { status: "NOT_READY" };
  if (snapshot.status === "PARTIAL" || snapshot.findings.some(f => f.severity === "WARNING")) return { status: "PARTIAL" };
  return snapshot.status === "READY" ? { status: "READY" } : { status: "UNKNOWN", reason: "No complete gear check; sync the addon." };
}

export interface ReadinessFindingInput {
  code: string;
  severity: ReadinessFindingSeverity;
  message: string;
}

export function deriveReadinessStatus(findings: ReadinessFindingInput[]): ReadinessStatus {
  if (findings.some((finding) => finding.severity === ReadinessFindingSeverity.ERROR)) {
    return ReadinessStatus.NOT_READY;
  }
  if (findings.some((finding) => finding.severity === ReadinessFindingSeverity.WARNING)) {
    return ReadinessStatus.PARTIAL;
  }
  return ReadinessStatus.READY;
}
