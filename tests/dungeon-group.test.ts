import { describe, expect, it } from "vitest";
import { createDungeonGroupService, shouldDeleteVoice, shouldExpireOpenGroup } from "../src/services/dungeon-group.js";

type Row = { id: string; groupId: string; memberId: string; role: string; status: string; joinedAt: Date; member: { discordUserId: string; displayName: string } };

function fake(status = "OPEN") {
  const rows: Row[] = [];
  let clock = 0;
  const ok = (r: Row, where: Record<string, unknown>) => Object.entries(where).every(([k, v]) => {
    const actual = (r as never as Record<string, unknown>)[k];
    return v && typeof v === "object" && "not" in (v as object) ? actual !== (v as { not: unknown }).not : actual === v;
  });
  const database = {
    dungeonGroup: {
      findFirst: async () => ({ id: "g1", guildId: "guild", status, kind: "DUNGEON", maxSize: 5 }),
      findUnique: async () => ({ id: "g1", kind: "DUNGEON", maxSize: 5 })
    },
    dungeonGroupSignup: {
      count: async ({ where }: { where: Record<string, unknown> }) => rows.filter((r) => ok(r, where)).length,
      findUnique: async ({ where }: { where: { groupId_memberId: { memberId: string } } }) => rows.find((r) => r.memberId === where.groupId_memberId.memberId) ?? null,
      findMany: async ({ where, take }: { where: Record<string, unknown>; take?: number }) =>
        rows.filter((r) => ok(r, where)).sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime()).slice(0, take ?? 99),
      update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => Object.assign(rows.find((r) => r.id === where.id)!, data),
      delete: async ({ where }: { where: { id: string } }) => { rows.splice(rows.findIndex((r) => r.id === where.id), 1); },
      upsert: async ({ create, update, where }: { create: Partial<Row>; update: Partial<Row>; where: { groupId_memberId: { memberId: string } } }) => {
        const existing = rows.find((r) => r.memberId === where.groupId_memberId.memberId);
        if (existing) return Object.assign(existing, update, { joinedAt: new Date(2026, 0, 1, 0, 0, ++clock) });
        const row = { id: `s${rows.length + 1}`, joinedAt: new Date(2026, 0, 1, 0, 0, ++clock), member: { discordUserId: `d-${create.memberId}`, displayName: String(create.memberId) }, ...create } as Row;
        rows.push(row);
        return row;
      }
    }
  };
  return { rows, service: createDungeonGroupService(database as never) };
}

describe("dungeon group signup", () => {
  it("fills 1 tank, 1 healer, 3 dps and waitlists the rest", async () => {
    const { rows, service } = fake();
    await service.join("g1", "guild", "t", "TANK");
    await service.join("g1", "guild", "h", "HEALER");
    for (const id of ["d1", "d2", "d3"]) await service.join("g1", "guild", id, "DPS");
    expect(await service.isFull("g1")).toBe(true);
    const extraTank = await service.join("g1", "guild", "t2", "TANK");
    expect(extraTank.signup.status).toBe("WAITLISTED");
    expect(rows.filter((r) => r.status === "SIGNED_UP")).toHaveLength(5);
  });

  it("promotes the first waiting player when someone leaves", async () => {
    const { service } = fake();
    await service.join("g1", "guild", "t", "TANK");
    await service.join("g1", "guild", "t2", "TANK");
    await service.join("g1", "guild", "t3", "TANK");
    const { promoted } = await service.leave("g1", "guild", "t");
    expect(promoted.map((p) => p.memberId)).toEqual(["t2"]);
  });

  it("changing role frees the old slot for the waitlist", async () => {
    const { service } = fake();
    await service.join("g1", "guild", "t", "TANK");
    await service.join("g1", "guild", "t2", "TANK");
    const moved = await service.join("g1", "guild", "t", "DPS");
    expect(moved.promoted.map((p) => p.memberId)).toEqual(["t2"]);
  });

  it("refuses to change a closed group and unknown leavers", async () => {
    await expect(fake("CLOSED").service.join("g1", "guild", "x", "DPS")).rejects.toThrow(/closed/);
    await expect(fake().service.leave("g1", "guild", "nobody")).rejects.toThrow(/not in this group/);
  });
});

describe("dungeon group timers", () => {
  it("deletes the voice channel only after it has been empty long enough", () => {
    const now = new Date("2026-10-01T20:10:00Z");
    expect(shouldDeleteVoice(null, now)).toBe(false);
    expect(shouldDeleteVoice(new Date("2026-10-01T20:07:00Z"), now)).toBe(false);
    expect(shouldDeleteVoice(new Date("2026-10-01T20:04:00Z"), now)).toBe(true);
  });

  it("expires groups that were never finished after a day", () => {
    const now = new Date("2026-10-02T20:00:00Z");
    expect(shouldExpireOpenGroup(new Date("2026-10-02T02:00:00Z"), now)).toBe(false);
    expect(shouldExpireOpenGroup(new Date("2026-10-01T19:00:00Z"), now)).toBe(true);
  });
});
