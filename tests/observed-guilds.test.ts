import { describe, expect, it } from "vitest";
import { groupObservedGuilds, observedGuildDuels, observedRecord, realmSlugOf, MIN_OBSERVED_MEMBERS, slugBase } from "../src/services/guild-public-stats.js";

const row = (guild: string | null, character: string, realm = "Doomhowl") => ({ guild, realm, character });

describe("observed guilds (guilds seen only in public runs)", () => {
  it("groups by folded name and realm, needs two characters and uses the most common spelling", () => {
    const out = groupObservedGuilds([row("Les Élus", "A"), row("les elus", "B"), row("Les Élus", "C"), row("Solo Guild", "D"), row(null, "E")], new Set());
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe("Les Élus");
    expect(out[0]!.characters.size).toBe(3);
    expect(out[0]!.spellings.sort()).toEqual(["Les Élus", "les elus"]);
    expect(MIN_OBSERVED_MEMBERS).toBe(2);
  });
  it("keeps the same guild name on two realms apart", () => {
    const out = groupObservedGuilds([row("Twins", "A", "One"), row("Twins", "B", "One"), row("Twins", "C", "Two"), row("Twins", "D", "Two")], new Set());
    expect(out.map((g) => g.realm).sort()).toEqual(["One", "Two"]);
  });
  it("leaves out a guild that already has a Guilded page", () => {
    const out = groupObservedGuilds([row("Quebec Gold", "A"), row("Quebec Gold", "B")], new Set([slugBase("⚜Quebec Gold⚜", "x")]));
    expect(out).toEqual([]);
  });
});

describe("observed guild addresses and unknown realms", () => {
  const rowOf = (guild: string, character: string, realm = "Doomhowl") => ({ guild, realm, character });
  it("gives a stable slug that does not depend on other guilds", () => {
    const alone = groupObservedGuilds([rowOf("Twins", "A"), rowOf("Twins", "B")], new Set())[0]!.slug;
    const crowded = groupObservedGuilds([rowOf("Twins!", "C"), rowOf("Twins!", "D"), rowOf("Twins", "A"), rowOf("Twins", "B")], new Set()).find((g) => g.name === "Twins")!.slug;
    expect(crowded).toBe(alone);
    expect(alone).toMatch(/^twins-doomhowl-[0-9a-f]{6}$/);
  });
  it("fills an empty realm from the same character or the guild's only known realm, else keeps it apart", () => {
    const out = groupObservedGuilds([rowOf("Les Elus", "A"), rowOf("Les Elus", "B"), rowOf("Les Elus", "A", ""), rowOf("Les Elus", "Z", ""), rowOf("Nomad", "P", ""), rowOf("Nomad", "Q", ""), rowOf("Nomad", "R", "One"), rowOf("Nomad", "S", "Two"), rowOf("Nomad", "T", "Two")], new Set());
    const elus = out.filter((g) => g.name === "Les Elus");
    expect(elus).toHaveLength(1);
    expect(elus[0]!.characters.size).toBe(3); // the empty-realm rows joined the one realm the name was seen on
    const nomadRealms = out.filter((g) => g.name === "Nomad").map((g) => g.realm).sort();
    expect(nomadRealms).toEqual(["", "Two"]); // two realms known: the unknown one stays its own bucket
  });
});

describe("observed guild address aliases", () => {
  it("keeps the first version's slug and the unknown-realm slug as aliases of the stable one", () => {
    const known = groupObservedGuilds([{ guild: "Twins", realm: "Doomhowl", character: "A" }, { guild: "Twins", realm: "Doomhowl", character: "B" }], new Set())[0]!;
    expect(known.aliases).toContain("twins-doomhowl"); // #999's slug
    const unknown = groupObservedGuilds([{ guild: "Twins", realm: "", character: "A" }, { guild: "Twins", realm: "", character: "B" }], new Set())[0]!;
    expect(known.aliases).toContain(unknown.slug); // the address it had before its realm resolved
  });
});

describe("duels of an observed guild", () => {
  const seen = { key: "k", name: "Les Braves", realm: "Doomhowl", slug: "les-braves-doomhowl-abc123", aliases: [], spellings: ["Les Braves"], characters: new Map<string, string>(), reported: new Map<string, string>(), faction: null };
  const duel = (winnerGuild: string | null, loserGuild: string | null, winnerRealm = "Doomhowl", loserRealm = "Doomhowl") => ({
    winnerKey: "a", loserKey: "b", winner: "Ann", loser: "Bob", winnerRealm, loserRealm, winnerClass: "Mage", loserClass: "Rogue", winnerLevel: 60, loserLevel: 60,
    winnerGuild, loserGuild, endedAt: new Date("2026-11-10T12:00:00Z"), reason: "x", zone: null, durationSec: 30, reporters: ["a"], confirmed: false
  });
  it("counts a duel when either side carries the guild, against anyone, and marks which side is a member", () => {
    const rows = observedGuildDuels(seen, [duel("Les Braves", "les braves"), duel("Les Braves", "Other Guild"), duel("Other Guild", "Les Braves"), duel("Other", "Other"), duel("Les Braves", null), duel("Les Braves", "Les Braves", "Doomhowl", "Elsewhere"), duel("Les Braves", "Les Braves", "", "")]);
    expect(rows).toHaveLength(6); // every duel with a member on its realm (a side with no realm stored counts); "Other vs Other" is not theirs
    expect(rows[0]).toMatchObject({ winnerShown: true, loserShown: true });
    expect(rows[1]).toMatchObject({ winnerShown: true, loserShown: false });
    expect(rows[2]).toMatchObject({ winnerShown: false, loserShown: true });
    expect(observedRecord(rows)).toEqual({ wins: 5, losses: 3 });
  });
  it("gives each realm its own address, hashing only when the base was cut or altered", () => {
    expect(realmSlugOf("Doomhowl")).toBe("doomhowl");
    const long = "A Very Long Realm Name That Goes On And On Forever";
    const a = realmSlugOf(`${long} One`), b = realmSlugOf(`${long} Two`);
    expect(a).not.toBe(b);
    expect(a.length).toBeLessThanOrEqual(36);
  });
});

describe("faction of an observed guild", () => {
  const rows = (factions: (string | null)[]) => factions.map((faction, i) => ({ guild: "Les Braves", realm: "Doomhowl", character: `Player${i}`, faction }));
  it("is the clear majority of the factions the uploaders' clients reported, else unknown", () => {
    expect(groupObservedGuilds(rows(["HORDE", "HORDE", "HORDE"]), new Set())[0]?.faction).toBe("HORDE");
    expect(groupObservedGuilds(rows(["HORDE", "ALLIANCE"]), new Set())[0]?.faction).toBeNull();
    expect(groupObservedGuilds(rows([null, null, null]), new Set())[0]?.faction).toBeNull();
    expect(groupObservedGuilds(rows(["HORDE", null, null]), new Set())[0]?.faction).toBeNull(); // one known player is not a majority
  });
});
