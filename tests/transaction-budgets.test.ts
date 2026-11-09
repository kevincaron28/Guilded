import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { linkUploaderCharacters } from "../src/services/upload-linking.js";

// 9.0.8 (live journal, 9 November 2026): P2028 "transaction timeout" in the uploader's character link
// and in the dungeon board job, both behind a long upload import that holds the guild's lock.

const character = (name: string) => ({ name, realm: "Forever", class: "WARRIOR", level: 20, professions: [] }) as never;

describe("upload linking under load", () => {
  it("never fails the upload when the link times out, and gives the link its own budget", async () => {
    const timeout = Object.assign(new Error("Transaction already closed"), { code: "P2028" });
    const $transaction = vi.fn().mockRejectedValue(timeout);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const status = await linkUploaderCharacters({ $transaction } as never, "g1", "m1", { character: character("Hulke Hogan"), alts: [character("Hulke Alt")] });
      expect(status).toBe("link-retry");
      expect($transaction).toHaveBeenCalledTimes(2);
      expect($transaction.mock.calls[0]![1]).toEqual({ timeout: 20_000, maxWait: 10_000 });
    } finally { errors.mockRestore(); }
  });
});

describe("the dungeon board job", () => {
  it("reads the active season without the guild lock, and waits for the lock with a real budget only to create one", () => {
    const source = readFileSync("src/services/dungeon-leaderboard.ts", "utf8");
    const read = source.indexOf('prisma.dungeonSeason.findFirst({ where: { guildId: guild.id, status: "ACTIVE" }');
    const locked = source.indexOf("pg_advisory_xact_lock(hashtextextended(${guild.id}, 0))");
    expect(read).toBeGreaterThan(-1);
    expect(read).toBeLessThan(locked);
    expect(source.slice(locked, locked + 300)).toContain("{ timeout: 75_000, maxWait: 15_000 }");
  });
});
