import { describe, expect, it, vi } from "vitest";
import { registerWowGuild, resolveWowGuild } from "../src/services/wow-guilds.js";

describe("several in-game guilds in one Discord server", () => {
  it("requires a concrete choice instead of selecting the first edition", async () => {
    const db = { wowGuild: { findMany: vi.fn().mockResolvedValue([{ id: "forever" }, { id: "retail" }]) } };
    await expect(resolveWowGuild(db as never, "discord-guild")).rejects.toThrow("Choose the in-game guild");
  });
  it("never resolves a guild ID belonging to another Discord server", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    await expect(resolveWowGuild({ wowGuild: { findFirst } } as never, "mine", "foreign")).rejects.toThrow("not configured in this Discord");
    expect(findFirst).toHaveBeenCalledWith({ where: { id: "foreign", guildId: "mine" } });
  });
  it("accepts one unambiguous choice and reports unconfigured servers", async () => {
    const findMany = vi.fn().mockResolvedValueOnce([{ id: "only" }]).mockResolvedValueOnce([]);
    const db = { wowGuild: { findMany } };
    expect(await resolveWowGuild(db as never, "g")).toEqual({ id: "only" });
    await expect(resolveWowGuild(db as never, "empty")).rejects.toThrow("Configure an in-game guild");
  });
  it("normalizes spelling within an edition while retaining server, realm and edition in the key", async () => {
    const upsert = vi.fn().mockResolvedValue({ id: "w" });
    await registerWowGuild({ wowGuild: { upsert } } as never, "g", { name: " Guild ", realm: " Realm ", gameEdition: "retail" });
    expect(upsert).toHaveBeenCalledWith({
      where: { guildId_gameEdition_realmKey_nameKey: { guildId: "g", gameEdition: "retail", nameKey: "guild", realmKey: "realm" } },
      create: { guildId: "g", gameEdition: "retail", nameKey: "guild", realmKey: "realm", name: "Guild", realm: "Realm" },
      update: { name: "Guild", realm: "Realm" }
    });
  });
  it("does not register unknown editions or empty realm identities", async () => {
    const upsert = vi.fn();
    const db = { wowGuild: { upsert } };
    await expect(registerWowGuild(db as never, "g", { name: "Guild", realm: "R", gameEdition: "unknown" })).rejects.toThrow();
    await expect(registerWowGuild(db as never, "g", { name: "Guild", realm: " ", gameEdition: "retail" })).rejects.toThrow();
    expect(upsert).not.toHaveBeenCalled();
  });
});
