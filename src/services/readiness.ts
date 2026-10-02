import { ReadinessFindingSeverity, ReadinessStatus } from "@prisma/client";

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
