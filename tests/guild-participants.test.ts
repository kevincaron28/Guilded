import { beforeEach, describe, expect, it } from "vitest";
import { clearGuildMembershipCache, guildMembership, MEMBERSHIP_CACHE_MS, splitStrangerRuns } from "../src/services/guild-participants.js";

// Guild-only Discord (14 November 2026): who counts as a participant of a guild, and what happens to a run with none.
const now = new Date("2026-11-14T12:00:00Z");
const day = 86_400_000;
const run = (id: string, names: string[]) => ({ id, players: names.map((character) => ({ character, realm: "Forever" })) });
const db = (roster: { nameKey: string; inGuild?: boolean; observedAt?: Date; updatedAt?: Date }[], linked: string[] = []) => ({
  guildRosterEntry: { findMany: async () => roster.map((row) => ({ inGuild: true, observedAt: new Date(now.getTime() - day), updatedAt: new Date(now.getTime() - day), ...row })) },
  character: { findMany: async () => linked.map((name) => ({ name })) }
});

describe("guildMembership", () => {
  beforeEach(() => clearGuildMembershipCache());

  it("counts the current roster, linked characters and the uploader's own", async () => {
    const m = await guildMembership(db([{ nameKey: "amy jones" }], ["Bob Smith"]), "g1", now, ["Kev Alpha"]);
    expect(m.gate).toBe(true);
    expect([...m.names].sort()).toEqual(["amy jones", "bob smith", "kev alpha"]);
  });

  it("turns the gate off for an empty roster, one not read for over 7 days, a missing table or a failing read", async () => {
    expect((await guildMembership(db([]), "g1", now)).skipped).toBe("roster empty");
    expect((await guildMembership(db([{ nameKey: "a b", observedAt: new Date(now.getTime() - 8 * day) }]), "g-old", now)).skipped).toBe("roster stale");
    expect((await guildMembership({}, "g-none", now)).gate).toBe(false);
    const failing = { guildRosterEntry: { findMany: async () => { throw new Error("down"); } } };
    expect((await guildMembership(failing, "g-fail", now)).skipped).toBe("read failed");
  });

  it("keeps a recent leaver for 14 days and a renamed character under the new name, and forgets older ones", async () => {
    const m = await guildMembership(db([
      { nameKey: "left yesterday", inGuild: false, updatedAt: new Date(now.getTime() - day) },
      { nameKey: "new name" },
      { nameKey: "left last month", inGuild: false, updatedAt: new Date(now.getTime() - 30 * day) }
    ]), "g1", now);
    expect(m.names).toContain("left yesterday");
    expect(m.names).toContain("new name");
    expect(m.names).not.toContain("left last month");
  });
});

describe("the membership cache", () => {
  beforeEach(() => clearGuildMembershipCache());
  const counting = () => {
    let reads = 0;
    const base = db([{ nameKey: "amy jones" }], ["Bob Smith"]);
    return { reads: () => reads, db: { guildRosterEntry: { findMany: async (args: unknown) => { reads++; return base.guildRosterEntry.findMany(); void args; } }, character: base.character } };
  };

  it("reads a guild once a minute, adds each upload's own characters on top, and reads again after a minute", async () => {
    const c = counting();
    const first = await guildMembership(c.db, "g1", now, ["Kev Alpha"]);
    const second = await guildMembership(c.db, "g1", new Date(now.getTime() + 30_000), ["Other Own"]);
    expect(c.reads()).toBe(1);
    expect(first.names).toContain("kev alpha");
    expect(second.names).toContain("other own");
    expect(second.names).not.toContain("kev alpha");
    await guildMembership(c.db, "g1", new Date(now.getTime() + MEMBERSHIP_CACHE_MS + 1));
    expect(c.reads()).toBe(2);
  });

  it("is per guild, and a roster or link change clears it at once", async () => {
    const c = counting();
    await guildMembership(c.db, "g1", now);
    await guildMembership(c.db, "g2", now);
    expect(c.reads()).toBe(2);
    clearGuildMembershipCache("g1");
    await guildMembership(c.db, "g1", now);
    await guildMembership(c.db, "g2", now);
    expect(c.reads()).toBe(3);
  });
});

describe("splitStrangerRuns", () => {
  it("treats the same full name under two realm labels as the same character", () => {
    const { guild, strangers } = splitStrangerRuns([
      { id: "r1", players: [{ character: "Amy Jones", realm: "Forever" }, { character: "Zed Nobody", realm: "Forever" }] },
      { id: "r2", players: [{ character: "Amy Jones", realm: "CAMWOWUS2Realm8PvP" }, { character: "Zed Nobody", realm: "CAMWOWUS2Realm8PvP" }] }
    ], { gate: true, names: ["amy jones"] });
    expect(guild).toHaveLength(2);
    expect(strangers).toEqual([]);
  });

  const known = { gate: true, names: ["amy jones"] };

  it("keeps a run with one participant (strangers are only the others) and marks a strangers-only run for the public lane", () => {
    const { guild, strangers } = splitStrangerRuns([run("a", ["Amy Jones", "Zed Nobody"]), run("b", ["Zed Nobody", "Liz Nobody"])], known);
    expect(guild.map((entry) => (entry as { id: string }).id)).toEqual(["a"]);
    expect(strangers).toEqual([{ ...run("b", ["Zed Nobody", "Liz Nobody"]), viaGroup: true }]);
  });

  it("matches a first name against a full name like every other lane, and leaves simulations and unreadable runs alone", () => {
    const { guild, strangers } = splitStrangerRuns([run("c", ["Amy"]), run("SIM-1", ["Zed Nobody"]), "broken", { id: "no-players" }], known);
    expect(strangers).toEqual([]);
    expect(guild).toHaveLength(4);
  });

  it("judges nobody a stranger when membership is unknown", () => {
    const { guild, strangers } = splitStrangerRuns([run("d", ["Zed Nobody"])], { gate: false, names: [] });
    expect(guild).toHaveLength(1);
    expect(strangers).toEqual([]);
  });
});
