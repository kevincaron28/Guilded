import { describe, expect, it } from "vitest";
import { groupObservedGuilds, MIN_OBSERVED_MEMBERS, slugBase } from "../src/services/guild-public-stats.js";

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
