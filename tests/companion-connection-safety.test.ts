import { describe, expect, it } from "vitest";
import { withUploadGate } from "../companion/engine.mjs";
import { removeProfile, savedProfiles, switchProfile } from "../companion/profiles.mjs";
import { serverKnowsWowGuild } from "../src/services/wow-guilds.js";

describe("several connections of one member (9 Nov 2026)", () => {
  it("never runs two uploads of the same saved file at the same instant", async () => {
    let running = 0, peak = 0;
    const job = async () => { running++; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, 15)); running--; };
    await Promise.all([withUploadGate(String.raw`C:\WoW\Guilded.lua`, job), withUploadGate("c:/wow/guilded.lua", job), withUploadGate(String.raw`C:\WoW\Guilded.lua`, job)]);
    expect(peak).toBe(1);
    let other = 0;
    await Promise.all([withUploadGate("a.lua", async () => { other++; await new Promise((r) => setTimeout(r, 10)); expect(other).toBe(2); }), withUploadGate("b.lua", async () => { other++; })]);
  });
  it("keeps going after a failed upload", async () => {
    await expect(withUploadGate("x.lua", async () => { throw new Error("no"); })).rejects.toThrow("no");
    await expect(withUploadGate("x.lua", async () => "fine")).resolves.toBe("fine");
  });
  it("removes one connection locally and moves the selection", () => {
    const config = { activeProfile: "default", uploadUrl: "u1", companionCredential: "c1", guildDiscordId: "g1", profileName: "Québec Gold",
      profiles: { "connection-1": { profileName: "K Caron Projects", uploadUrl: "u1", companionCredential: "c2", guildDiscordId: "g2" } } };
    const wrongOnly = removeProfile(config, "connection-1");
    expect(Object.keys(savedProfiles(wrongOnly))).toEqual(["default"]);
    expect(wrongOnly.activeProfile).toBe("default");
    expect(wrongOnly.companionCredential).toBe("c1");
    const selected = removeProfile(switchProfile(config, "connection-1"), "connection-1");
    expect(selected.activeProfile).toBe("default");
    expect(selected.companionCredential).toBe("c1");
    expect(() => removeProfile(wrongOnly, "default")).toThrow(/only connection/);
    expect(() => removeProfile(config, "nope")).toThrow(/not found/);
  });
  it("tells the companion when the server does not know the character's WoW guild", async () => {
    const db = { wowGuild: { findMany: async () => [{ name: "Québec Gold", realm: "CAMWOW US2 Realm 2 PvP" }] } } as never;
    expect(await serverKnowsWowGuild(db, { id: "g", name: "K Caron Projects" }, undefined)).toBeUndefined();
    expect(await serverKnowsWowGuild(db, { id: "g", name: "K Caron Projects" }, "Another Guild-Other")).toMatchObject({ known: false });
    // (9.3) Accents and decoration do not matter: the unsigned device path already matched this way.
    expect(await serverKnowsWowGuild(db, { id: "g", name: "K Caron Projects" }, "Quebec Gold-Other")).toMatchObject({ known: true });
    expect(await serverKnowsWowGuild(db, { id: "g", name: "K Caron Projects" }, "✤Quebec  Gold✤-CAMWOW US2 Realm 2 PvP")).toMatchObject({ known: true });
    expect(await serverKnowsWowGuild(db, { id: "g", name: "K Caron Projects" }, "---")).toMatchObject({ known: false });
    expect(await serverKnowsWowGuild(db, { id: "g", name: "K Caron Projects" }, "québec gold-CAMWOW US2 Realm 2 PvP")).toMatchObject({ known: true });
    expect(await serverKnowsWowGuild(db, { id: "g", name: "K Caron Projects" }, "K Caron Projects")).toMatchObject({ known: true });
  });
});
