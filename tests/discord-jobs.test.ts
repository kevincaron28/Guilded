import { describe, expect, it } from "vitest";
import { deliverDiscordJob, enqueueDiscordJob, retryDelay } from "../src/services/discord-jobs.js";

function store() {
  let row: Record<string, unknown> = { id: "job", guildId: "guild", key: "board", kind: "DUNGEON_BOARD", payload: {}, status: "PENDING", revision: 1, attempts: 0, nextAttemptAt: new Date(0), lockedUntil: null, leaseToken: null };
  const db = { discordJob: {
    upsert: async ({ update }: { update: Record<string, unknown> }) => { row = { ...row, ...update, revision: Number(row["revision"]) + 1, attempts: 0 }; return row; },
    findUnique: async () => ({ ...row }),
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      for (const key of ["id", "leaseToken", "revision", "status"]) if (key in where && row[key] !== where[key]) return { count: 0 };
      if (where["OR"] && row["lockedUntil"] && (row["lockedUntil"] as Date).getTime() > Date.now()) return { count: 0 };
      row = { ...row, ...data, ...(typeof data["attempts"] === "object" ? { attempts: Number(row["attempts"]) + 1 } : {}) };
      return { count: 1 };
    }
  } };
  return { db: db as never, row: () => row };
}

describe("durable Discord delivery", () => {
  it("keeps failures pending and releases the lease so a restarted worker can retry", async () => {
    const s = store();
    await deliverDiscordJob(s.db, "job", async () => { throw Object.assign(new Error("private request detail"), { code: 50013 }); });
    expect(s.row()["status"]).toBe("PENDING");
    expect(s.row()["lastError"]).toBe("50013");
    expect(s.row()["leaseToken"]).toBeNull();
    await deliverDiscordJob(s.db, "job", async () => {} , new Date(Date.now() + 3600000));
    expect(s.row()["status"]).toBe("DONE");
    expect(s.row()["lastError"]).toBeNull();
  });
  it("does not lose a newer refresh while the older one is being delivered", async () => {
    const s = store();
    await deliverDiscordJob(s.db, "job", async () => { await enqueueDiscordJob(s.db, "guild", "board", "DUNGEON_BOARD"); });
    expect(s.row()["status"]).toBe("PENDING");
    expect(s.row()["revision"]).toBe(2);
    await deliverDiscordJob(s.db, "job", async () => {});
    expect(s.row()["status"]).toBe("DONE");
  });
  it("does not let another worker take a live lease", async () => {
    const s = store();
    let second = true;
    await deliverDiscordJob(s.db, "job", async () => { second = await deliverDiscordJob(s.db, "job", async () => { throw new Error("must not send"); }); });
    expect(second).toBe(false);
  });
  it("caps retry backoff and starts at 30 seconds", () => {
    expect(retryDelay(1)).toBe(30000);
    expect(retryDelay(2)).toBe(60000);
    expect(retryDelay(100)).toBe(3600000);
  });
});
