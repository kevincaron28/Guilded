import { describe, expect, it } from "vitest";
import { isMemberAnswer } from "../src/services/error-report.js";

// Real entries from the October 2026 bug inbox: answers to members were logged as bot errors.
describe("which failures are reported to the developer", () => {
  it("treats a command's short answer to the member as working, not as a bug", () => {
    for (const message of [
      "Nobody has a character linked yet, so I don't know your realm: add the realm option once (or use /character import).",
      "Choisis au moins un salon / Select at least one channel.",
      "Guilded Test has 5 entries in its own point pool. Deleting it would orphan them, so it can't be deleted while it keeps its own points."
    ]) expect(isMemberAnswer(new Error(message))).toBe(true);
  });

  it("still reports Discord, database, validation and programming errors", () => {
    class DiscordAPIError extends Error {}
    class CombinedError extends Error {}
    class PrismaClientKnownRequestError extends Error {}
    expect(isMemberAnswer(new DiscordAPIError("Unknown interaction"))).toBe(false);
    expect(isMemberAnswer(new CombinedError("Received one or more errors"))).toBe(false);
    expect(isMemberAnswer(new PrismaClientKnownRequestError("Timed out fetching a new connection"))).toBe(false);
    expect(isMemberAnswer(new TypeError("Cannot read properties of undefined"))).toBe(false);
    expect(isMemberAnswer(new Error("x".repeat(250)))).toBe(false);
    expect(isMemberAnswer("a string")).toBe(false);
  });
});
