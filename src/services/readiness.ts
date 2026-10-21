import { ReadinessFindingSeverity, ReadinessStatus } from "../generated/prisma/client.js";

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
