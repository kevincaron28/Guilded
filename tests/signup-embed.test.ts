import { describe, expect, it } from "vitest";
import { buildSignupEmbed, openSpots } from "../src/services/signup-embed.js";
import { CLASH_WINDOW_MS, createRaidService } from "../src/services/raid.js";
import { coreRosterEmbed } from "../src/services/raid-core.js";

const raid = {
  id: "r1", title: "Molten Core", description: null, status: "PLANNED" as const, scheduledAt: new Date("2026-10-01T00:00:00Z"),
  tankLimit: 2, healerLimit: 3, dpsLimit: null
};
const signup = (memberId: string, displayName: string, role: "TANK" | "HEALER" | "DPS", status = "SIGNED_UP") => ({ memberId, displayName, role, status });
const fields = (embed: ReturnType<typeof buildSignupEmbed>) => Object.fromEntries((embed.toJSON().fields ?? []).map((f) => [f.name, f.value]));

describe("signup post", () => {
  it("lists the players in each role with count, limit and FULL", () => {
    const embed = buildSignupEmbed({
      lang: "en", raid,
      signups: [signup("a", "Amy", "TANK"), signup("b", "Bob", "TANK"), signup("c", "Cy", "HEALER"), signup("d", "Dee", "DPS"), signup("e", "Eve", "TANK", "WAITLISTED")]
    });
    const f = fields(embed);
    expect(f["🛡️ Tank 2/2 · FULL"]).toBe("Amy\nBob");
    expect(f["💚 Healer 1/3"]).toBe("Cy");
    expect(f["⚔️ DPS 1"]).toBe("Dee");
    expect(f["Waitlist (in order)"]).toContain("Eve (Tank)");
    expect(f["Total signed up"]).toBe("4");
  });

  it("marks core mains and the bench, and lists core members who have not answered", () => {
    const embed = buildSignupEmbed({
      lang: "en", raid,
      signups: [signup("a", "Amy", "TANK"), signup("x", "Pug", "DPS"), signup("s", "Sub", "HEALER")],
      core: {
        name: "Tuesday MC", members: [
          { memberId: "a", displayName: "Amy", role: "TANK", bench: false },
          { memberId: "m", displayName: "Missing", role: "HEALER", bench: false },
          { memberId: "s", displayName: "Sub", role: "HEALER", bench: true },
          { memberId: "z", displayName: "Spare", role: "DPS", bench: true }
        ]
      }
    });
    const f = fields(embed);
    expect(f["🛡️ Tank 1/2"]).toBe("⭐ Amy");
    expect(f["💚 Healer 1/3"]).toBe("🪑 Sub");
    expect(f["⚔️ DPS 1"]).toBe("Pug");
    expect(f["Core members not signed up yet (1)"]).toBe("Missing (Healer)");
    expect(f["Bench available (1)"]).toBe("🪑 Spare (DPS)");
  });

  it("stays inside Discord's field limit with a big roster", () => {
    const many = Array.from({ length: 80 }, (_, i) => signup(`m${i}`, `Player-with-a-long-name-${i}`, "DPS"));
    const value = fields(buildSignupEmbed({ lang: "en", raid, signups: many }))["⚔️ DPS 80"] ?? "";
    expect(value.length).toBeLessThanOrEqual(1024);
    expect(value).toContain("…");
  });
});

describe("core roster with a bench", () => {
  it("shows bench players apart from the main roster", () => {
    const embed = coreRosterEmbed({
      name: "T", description: null, members: [
        { role: "TANK", bench: false, member: { displayName: "Bob" } }, { role: "HEALER", bench: true, member: { displayName: "Sub" } }
      ]
    }).toJSON();
    expect(embed.fields?.find((f) => f.name.startsWith("🪑"))?.value).toBe("Sub (Healer)");
    expect(embed.fields?.find((f) => f.name.startsWith("💚"))?.value).toBe("—");
    expect(embed.footer?.text).toContain("1 core member + 1 on the bench");
  });
});

describe("filling a core raid night", () => {
  it("shows the open spots on a core raid so anyone in the guild can fill them", () => {
    const embed = buildSignupEmbed({
      lang: "en", raid,
      signups: [signup("a", "Amy · Thrall", "TANK"), signup("c", "Cy", "HEALER"), signup("w", "Wait", "HEALER", "WAITLISTED")],
      core: { name: "Tuesday MC", members: [{ memberId: "a", displayName: "Amy · Thrall", role: "TANK", bench: false }] }
    });
    const f = fields(embed);
    expect(f["Open spots: anyone in the guild can sign up to fill"]).toBe("🛡️ 1 Tank · 💚 2 Healer");
    expect(f["🛡️ Tank 1/2"]).toBe("⭐ Amy · Thrall");
  });

  it("shows no open spots once full, closed, or without a core", () => {
    const full = buildSignupEmbed({ lang: "en", raid: { ...raid, tankLimit: 1, healerLimit: 0 }, signups: [signup("a", "Amy", "TANK")], core: { name: "C", members: [] } });
    expect(fields(full)["Open spots: anyone in the guild can sign up to fill"]).toBeUndefined();
    const closed = buildSignupEmbed({ lang: "en", raid: { ...raid, status: "ACTIVE" }, signups: [], core: { name: "C", members: [] } });
    expect(fields(closed)["Open spots: anyone in the guild can sign up to fill"]).toBeUndefined();
    expect(fields(buildSignupEmbed({ lang: "en", raid, signups: [] }))["Open spots: anyone in the guild can sign up to fill"]).toBeUndefined();
  });

  it("counts only signed-up players against the caps, and leaves uncapped roles out", () => {
    expect(openSpots({ TANK: 2, HEALER: null, DPS: 5 }, [
      { role: "TANK", status: "SIGNED_UP" }, { role: "DPS", status: "MAYBE" }, { role: "DPS", status: "SIGNED_UP" }
    ])).toEqual([{ role: "TANK", open: 1 }, { role: "DPS", open: 4 }]);
  });
});

describe("two raids at the same time (a player in two cores)", () => {
  it("looks for the player's other signups within 4 hours of this raid", async () => {
    const scheduledAt = new Date("2026-10-02T00:00:00Z");
    let query: { where: Record<string, unknown> } | undefined;
    const database = {
      raid: { findFirst: async () => ({ id: "r1", guildId: "g", scheduledAt }) },
      raidSignup: { findMany: async (args: { where: Record<string, unknown> }) => { query = args; return []; } }
    };
    await createRaidService(database as never).clashingSignups("r1", "g", "m1");
    expect(CLASH_WINDOW_MS).toBe(4 * 3_600_000);
    expect(query?.where).toMatchObject({
      memberId: "m1", raidId: { not: "r1" }, status: { in: ["SIGNED_UP", "WAITLISTED", "MAYBE"] },
      raid: { guildId: "g", status: { in: ["PLANNED", "ACTIVE"] }, scheduledAt: { gt: new Date("2026-10-01T20:00:00Z"), lt: new Date("2026-10-02T04:00:00Z") } }
    });
  });
});
