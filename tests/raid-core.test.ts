import { describe, expect, it } from "vitest";
import { createRaidService } from "../src/services/raid.js";
import { coreRosterEmbed } from "../src/services/raid-core.js";

type Signup = { id: string; raidId: string; memberId: string; role: string; status: string; signedUpAt: Date; member: { discordUserId: string; displayName: string } };

// A tiny in-memory stand-in for the raid tables.
function fakeDatabase(raid: Record<string, unknown>, coreMembers: string[]) {
  const signups: Signup[] = [];
  let clock = 0;
  const matches = (s: Signup, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => {
      const actual = (s as never as Record<string, unknown>)[key];
      if (value && typeof value === "object" && "not" in (value as object)) return actual !== (value as { not: unknown }).not;
      if (value && typeof value === "object" && "in" in (value as object)) return (value as { in: unknown[] }).in.includes(actual);
      return actual === value;
    });
  return {
    signups,
    raid: { findFirst: async () => raid, findUnique: async () => raid },
    raidCoreMember: { findMany: async () => coreMembers.map((memberId) => ({ memberId })) },
    raidSignup: {
      count: async ({ where }: { where: Record<string, unknown> }) => signups.filter((s) => matches(s, where)).length,
      findMany: async ({ where, orderBy }: { where: Record<string, unknown>; orderBy?: { signedUpAt: "asc" | "desc" } }) => {
        const rows = signups.filter((s) => matches(s, where));
        rows.sort((a, b) => (orderBy?.signedUpAt === "desc" ? -1 : 1) * (a.signedUpAt.getTime() - b.signedUpAt.getTime()));
        return rows;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Signup> }) => Object.assign(signups.find((s) => s.id === where.id)!, data),
      upsert: async ({ create, update, where }: { create: Partial<Signup>; update: Partial<Signup>; where: { raidId_memberId: { memberId: string } } }) => {
        const existing = signups.find((s) => s.memberId === where.raidId_memberId.memberId);
        if (existing) return Object.assign(existing, update);
        const row = { id: `s${signups.length + 1}`, signedUpAt: new Date(2026, 0, 1, 0, 0, ++clock), member: { discordUserId: `d-${create.memberId}`, displayName: String(create.memberId) }, ...create } as Signup;
        signups.push(row);
        return row;
      }
    }
  };
}

const raid = { id: "r1", guildId: "g", status: "PLANNED", coreId: "c1", tankLimit: null, healerLimit: null, dpsLimit: 2 };

describe("raid core signup priority", () => {
  it("a core member takes the slot of the latest non-core signup when the role is full", async () => {
    const database = fakeDatabase(raid, ["core1", "core2"]);
    const service = createRaidService(database as never);
    await service.signup("r1", "g", "pug1", "DPS");
    await service.signup("r1", "g", "pug2", "DPS");
    const result = await service.signup("r1", "g", "core1", "DPS");
    expect(result.status).toBe("SIGNED_UP");
    expect(result.bumped?.memberId).toBe("pug2");
    expect(database.signups.find((s) => s.memberId === "pug2")?.status).toBe("WAITLISTED");
    expect(database.signups.find((s) => s.memberId === "pug1")?.status).toBe("SIGNED_UP");
  });

  it("never bumps another core member, and a non-core player just waitlists", async () => {
    const database = fakeDatabase(raid, ["core1", "core2", "core3"]);
    const service = createRaidService(database as never);
    await service.signup("r1", "g", "core1", "DPS");
    await service.signup("r1", "g", "core2", "DPS");
    const third = await service.signup("r1", "g", "core3", "DPS");
    expect(third.status).toBe("WAITLISTED");
    expect(third.bumped).toBeNull();
    const pug = await service.signup("r1", "g", "pug", "DPS");
    expect(pug.status).toBe("WAITLISTED");
  });

  it("does nothing special for a raid without a core", async () => {
    const database = fakeDatabase({ ...raid, coreId: null }, ["core1"]);
    const service = createRaidService(database as never);
    await service.signup("r1", "g", "pug1", "DPS");
    await service.signup("r1", "g", "pug2", "DPS");
    const late = await service.signup("r1", "g", "core1", "DPS");
    expect(late.status).toBe("WAITLISTED");
    expect(late.bumped).toBeNull();
  });
});

describe("core roster embed", () => {
  it("groups members by role and counts them", () => {
    const embed = coreRosterEmbed({
      name: "Tuesday MC", description: "8pm", members: [
        { role: "TANK", bench: false, member: { displayName: "Bob" } }, { role: "DPS", bench: false, member: { displayName: "Zed" } }, { role: "DPS", bench: false, member: { displayName: "Amy" } }
      ]
    }).toJSON();
    expect(embed.title).toContain("Tuesday MC");
    expect(embed.fields?.map((f) => f.name)).toEqual(["🎲 Loot", "🛡️ Tanks (1)", "💚 Healers (0)", "⚔️ DPS (2)"]);
    expect(embed.fields?.find((f) => f.name.startsWith("⚔️"))?.value).toBe("Amy\nZed");
    expect(embed.footer?.text).toContain("3 core members");
  });
});
