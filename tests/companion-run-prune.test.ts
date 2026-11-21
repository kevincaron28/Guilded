import { describe, expect, it } from "vitest";
import { acknowledgements, pruneAcknowledged, runResendDue, RUN_FULL_RESEND_DAYS } from "../companion/delta.mjs";

const run = (id: string, extra: Record<string, unknown> = {}) => ({ id, state: "COMPLETED", endedAt: 1, ...extra });
const ids = (result: { exported: { dungeonRuns?: { id: string }[] } }) => (result.exported.dungeonRuns ?? []).map((entry) => entry.id);
const base = (dungeonRuns: unknown[]) => ({ raids: [], epgpTransactions: [], loot: [], dungeonRuns });
const features = new Set(["ledger-delta", "loot-delta"]);

describe("signed-in uploads leave out dungeon runs the bot holds (9.3.8)", () => {
  const ack = acknowledgements({ personal: { acceptedRunRefs: ["QG-A", "QG-B", "QG-C", "QG-D"], runNotes: { "QG-B": "Not counted: copy of a guildmate's run" } } });

  it("drops held runs, keeps unknown runs, runs with a note and unfinished runs", () => {
    const result = pruneAcknowledged(base([run("QG-A"), run("QG-B"), run("QG-NEW"), run("QG-C", { state: "ACTIVE" }), run("QG-D")]) as never, ack, features);
    expect(ids(result)).toEqual(["QG-B", "QG-NEW", "QG-C"]);
    expect(result.omitted.runs).toBe(2);
  });

  it("sends everything when the bot listed nothing (older bot or standings never read)", () => {
    const runs = [run("QG-A"), run("QG-B")];
    expect(ids(pruneAcknowledged(base(runs) as never, acknowledgements({}), features))).toEqual(["QG-A", "QG-B"]);
    expect(ids(pruneAcknowledged(base(runs) as never, null as never, features))).toEqual(["QG-A", "QG-B"]);
  });

  it("sends every run again on a full resend", () => {
    const result = pruneAcknowledged(base([run("QG-A"), run("QG-D")]) as never, ack, features, Date.now(), { resendRuns: true });
    expect(ids(result)).toEqual(["QG-A", "QG-D"]);
    expect(result.omitted.runs ?? 0).toBe(0);
  });

  it("keeps the same runs array when nothing is left out", () => {
    const exported = base([run("QG-X")]);
    expect(pruneAcknowledged(exported as never, ack, features).exported.dungeonRuns).toBe(exported.dungeonRuns);
  });

  it("a full resend is due when never sent and after the safety interval", () => {
    const now = Date.now();
    expect(runResendDue(null, now)).toBe(true);
    expect(runResendDue(now - 86_400_000, now)).toBe(false);
    expect(runResendDue(now - RUN_FULL_RESEND_DAYS * 86_400_000, now)).toBe(true);
  });
});
