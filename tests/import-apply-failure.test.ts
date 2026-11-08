import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { applyAttempts, applyFailureLogLine, applyWithRetry, classifyApplyFailure } from "../src/services/import-apply-failure.js";
import { GameEditionError } from "../src/services/game-edition.js";

// "Addon import not applied" in Québec Gold's officer journal (7 November 2026): every cause is
// named, transient database failures are retried, and the server log line is readable.
const prismaError = (code: string, message = "Transaction API error: Transaction already closed: A commit cannot be executed on an expired transaction. The timeout for this transaction was 60000 ms, however 60412 ms passed since the start of the transaction. Consider increasing the interactive transaction timeout or doing less work in the transaction.") =>
  Object.assign(new Error(message), { name: "PrismaClientKnownRequestError", code });

describe("classifyApplyFailure", () => {
  it("names database load as transient, without showing the raw database message", () => {
    const timeout = classifyApplyFailure(prismaError("P2028"));
    expect(timeout).toEqual({ reason: "transaction-timeout", code: "P2028", transient: true,
      message: "The database was busy with other uploads and the import timed out (P2028)." });
    expect(classifyApplyFailure(prismaError("P2024")).reason).toBe("pool-timeout");
    expect(classifyApplyFailure(prismaError("P2034")).reason).toBe("write-conflict");
    expect(classifyApplyFailure(prismaError("P1001")).transient).toBe(true);
    // An uncoded transaction timeout is recognized too.
    expect(classifyApplyFailure(new Error("Transaction already closed: expired transaction")).reason).toBe("transaction-timeout");
  });

  it("names data and rule causes as final, keeping our own short sentences", () => {
    expect(classifyApplyFailure(prismaError("P2002", "Unique constraint failed")).reason).toBe("database");
    expect(classifyApplyFailure(prismaError("P2002", "x")).transient).toBe(false);
    expect(classifyApplyFailure(new Error("Addon import has already been applied.")).reason).toBe("already-applied");
    expect(classifyApplyFailure(new Error("Addon import not found.")).reason).toBe("not-found");
    expect(classifyApplyFailure(new GameEditionError("This saved data is from WoW Classic Era.")))
      .toMatchObject({ reason: "edition", message: "This saved data is from WoW Classic Era." });
    const scope = classifyApplyFailure(new Error("This saved data does not identify the selected WoW guild and realm. Choose the matching connection and save fresh data in game."));
    expect(scope).toMatchObject({ reason: "guild-scope", transient: false });
    expect(classifyApplyFailure(new ZodError([])).reason).toBe("invalid-payload");
    expect(classifyApplyFailure(new Error("A raid needs a start time."))).toMatchObject({ reason: "rejected", message: "A raid needs a start time." });
    expect(classifyApplyFailure(new TypeError("Cannot read properties of undefined")).reason).toBe("unknown");
  });
});

describe("applyWithRetry", () => {
  const noWait = { delaysMs: [1, 1], sleep: async () => {} };

  it("tries a transient failure again and reports the attempts", async () => {
    let calls = 0;
    const out = await applyWithRetry(async () => { calls++; if (calls < 3) throw prismaError("P2028"); return "ok"; }, noWait);
    expect(out).toEqual({ result: "ok", attempts: 3 });
  });

  it("stops at once on a final failure, and after the last delay on a transient one", async () => {
    let calls = 0;
    const final = await applyWithRetry(async () => { calls++; throw new Error("A raid needs a start time."); }, noWait).catch((e: unknown) => e);
    expect(calls).toBe(1);
    expect(applyAttempts(final)).toBe(1);
    calls = 0;
    const busy = await applyWithRetry(async () => { calls++; throw prismaError("P2028"); }, noWait).catch((e: unknown) => e);
    expect(calls).toBe(3);
    expect(applyAttempts(busy)).toBe(3);
  });
});

describe("the server log line", () => {
  it("holds codes and timings only: a hashed guild, the import's short id, no names or text", () => {
    const line = applyFailureLogLine({ guildId: "guild-123", importId: "cmabcdefgh12345678", failure: classifyApplyFailure(prismaError("P2028")),
      attempts: 3, ms: 61234.4, officer: true, retriedDuplicate: false, payloadBytes: 81234 });
    expect(line).toMatch(/^import-apply-failed guild=[0-9a-f]{8} import=12345678 reason=transaction-timeout code=P2028 transient=1 attempts=3 ms=61234 officer=1 duplicate=0 bytes=81234$/);
    expect(line).not.toContain("guild-123");
  });
});
