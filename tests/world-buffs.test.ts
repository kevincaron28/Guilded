import { describe, expect, it, vi } from "vitest";
import { createWorldBuffService, worldBuffLine, worldBuffsSupported, WORLD_BUFFS } from "../src/services/world-buffs.js";
import { worldBuffCommand } from "../src/commands/world-buffs.js";

const now = new Date("2026-11-10T18:00:00Z");
const HOUR = 3_600_000;
function db(drops: Record<string, { id: string; createdBy: string }> = {}) {
  return {
    worldBuffDrop: {
      deleteMany: vi.fn<(args: { where: unknown }) => Promise<{ count: number }>>(async () => ({ count: 0 })),
      create: vi.fn(async ({ data }) => ({ id: "d1", ...data })),
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async ({ where }) => drops[where.id] ?? null),
      delete: vi.fn(async () => ({}))
    }
  };
}

describe("world-buff drops", () => {
  it("only Classic Era and Forever guilds get them", () => {
    expect(["forever", "classic-era", "classic-tbc", "classic-mists", "retail"].filter((edition) => worldBuffsSupported(edition as never)))
      .toEqual(["forever", "classic-era"]);
  });

  it("saves what a member announced, pruning old drops, and refuses past, far-off or unknown ones", async () => {
    const database = db();
    const service = createWorldBuffService(database as never);
    await service.add({ guildId: "g", buff: "ONYXIA", dropsAt: new Date(now.getTime() + 2 * HOUR), location: " Stormwind ", note: "", createdBy: "u" }, now);
    expect(database.worldBuffDrop.create.mock.calls[0]![0].data).toMatchObject({ buff: "ONYXIA", location: "Stormwind", note: null, createdBy: "u" });
    expect(database.worldBuffDrop.deleteMany.mock.calls[0]![0].where).toEqual({ guildId: "g", dropsAt: { lt: new Date(now.getTime() - 6 * HOUR) } });
    await expect(service.add({ guildId: "g", buff: "ONYXIA", dropsAt: new Date(now.getTime() - 60_000), createdBy: "u" }, now)).rejects.toThrow(/future/);
    await expect(service.add({ guildId: "g", buff: "ONYXIA", dropsAt: new Date(now.getTime() + 8 * 24 * HOUR), createdBy: "u" }, now)).rejects.toThrow(/7 days/);
    await expect(service.add({ guildId: "g", buff: "SONGFLOWER", dropsAt: new Date(now.getTime() + HOUR), createdBy: "u" }, now)).rejects.toThrow(/Unknown world buff/);
  });

  it("lets the announcer or a raid leader remove a drop, nobody else", async () => {
    const service = createWorldBuffService(db({ d1: { id: "d1", createdBy: "owner" } }) as never);
    await expect(service.remove("g", "d1", "someone", false)).rejects.toThrow(/Only who announced/);
    await expect(service.remove("g", "d1", "owner", false)).resolves.toMatchObject({ id: "d1" });
    await expect(service.remove("g", "d1", "leader", true)).resolves.toMatchObject({ id: "d1" });
    await expect(service.remove("g", "missing", "owner", false)).rejects.toThrow(/not found/);
  });

  it("formats a drop with live Discord timestamps in the guild's language", () => {
    const drop = { id: "d1", buff: "ZANDALAR", dropsAt: new Date(now.getTime() + HOUR), location: "Yojamba Isle", note: null, createdBy: "42" };
    const at = (now.getTime() + HOUR) / 1000;
    expect(worldBuffLine(drop, "en")).toBe(`📯 **Spirit of Zandalar** <t:${at}:t> (<t:${at}:R>) · Yojamba Isle · <@42>`);
    expect(worldBuffLine(drop, "fr")).toContain("Esprit des Zandalar");
  });

  it("offers each buff as a choice with its French name", () => {
    const add = worldBuffCommand.toJSON().options!.find((option) => option.name === "add") as { options: { name: string; choices?: { value: string; name_localizations?: { fr?: string } }[] }[] };
    const choices = add.options.find((option) => option.name === "buff")!.choices!;
    expect(choices.map((choice) => choice.value)).toEqual(Object.keys(WORLD_BUFFS));
    expect(choices.every((choice) => choice.name_localizations?.fr)).toBe(true);
  });
});
