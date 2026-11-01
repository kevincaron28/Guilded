import { describe, expect, it, vi } from "vitest";
import { MessageFlags } from "discord.js";
import { coreRosterLayout, syncCoreRoster } from "../src/services/raid-core.js";
import { SIGNUP_TEXT_LIMIT } from "../src/services/signup-layout.js";
import type { DisplayCharacter } from "../src/services/character-display.js";

interface Node { type: number; content?: string; custom_id?: string; components?: Node[]; accessory?: Node }
function texts(payload: { components: { toJSON(): unknown }[] }) {
  const nodes: Node[] = [];
  const walk = (node: Node) => { nodes.push(node); node.components?.forEach(walk); if (node.accessory) walk(node.accessory); };
  walk(payload.components[0]!.toJSON() as Node);
  return { nodes, text: nodes.filter(node => node.type === 10).map(node => node.content!).join("\n") };
}
const spot = (name: string, role: "TANK" | "HEALER" | "DPS", character: DisplayCharacter | null, extra: { bench?: boolean; trial?: boolean } = {}) =>
  ({ role, bench: extra.bench ?? false, trial: extra.trial ?? false, member: { displayName: name }, character: character ? { name, ...character } : null });

describe("core roster card (Components V2)", () => {
  const core = {
    id: "core1", name: "Tuesday MC", description: "Molten Core every Tuesday.", schedule: "Tue 8-11pm", raidSize: 20, tankLimit: 2, healerLimit: 4, dpsLimit: 14,
    lootMode: "PRIORITY", separatePool: true,
    members: [
      spot("Tankie", "TANK", { className: "Warrior", spec: "Protection" }),
      spot("Heals", "HEALER", { className: "Priest", spec: "Holy" }),
      spot("Stabby", "DPS", { className: "Rogue", spec: "Combat" }),
      spot("Boomy", "DPS", { className: "Druid", spec: "Balance" }),
      spot("Newbie", "DPS", { className: "Mage" }, { trial: true }),
      spot("Spare", "HEALER", null, { bench: true })
    ]
  };
  it("reads like the signup card: header, summary, role badges, lists, footer and the Apply button", () => {
    const payload = coreRosterLayout(core, { lang: "en", guild: { name: "Quebec Gold" } });
    expect(payload.flags).toBe(MessageFlags.IsComponentsV2);
    const { nodes, text } = texts(payload);
    expect(text).toContain("**Quebec Gold**\n### ⚜️ Tuesday MC\nMolten Core every Tuesday.");
    expect(text).toContain("**📅 Schedule** Tue 8-11pm · **Raid size** 20");
    expect(text).toContain("🛡️ **`Tanks`** `1/2`");
    expect(text).toContain("💚 **`Healers`** `1/4`");
    expect(text).toContain("⚔️ **`DPS`** `2/14`\n-# ⚔️ 1 melee · 1 ranged\n>>> ");
    expect(text).toContain("🧪 **`Trial`** `1`");
    expect(text).toContain("🪑 **`Bench`** `1`");
    expect(text).toContain("-# 4 core members + 1 on trial + 1 on the bench");
    expect(nodes.some(node => node.custom_id?.endsWith("roster:core1"))).toBe(true);
  });
  it("speaks French", () => {
    const { text } = texts(coreRosterLayout(core, { lang: "fr" }));
    expect(text).toContain("💚 **`Soigneurs`** `1/4`");
    expect(text).toContain("-# ⚔️ 1 mêlée · 1 distance");
    expect(text).toContain("🪑 **`Banc`** `1`");
  });
  it("stays within Discord's 4000 characters for a large guild", () => {
    const big = { ...core, members: Array.from({ length: 120 }, (_, index) => spot(`Player${index}`.padEnd(30, "x"), index % 3 ? "DPS" : "HEALER", { className: "Warlock", spec: "Destruction", level: 60 }, { bench: index > 90 })) };
    const { text } = texts(coreRosterLayout(big, { lang: "en" }));
    expect(text.length).toBeLessThanOrEqual(SIGNUP_TEXT_LIMIT);
    expect(text).toMatch(/\+\d+ more/);
    expect(text).toContain("🪑 **`Bench`**");
  });
});

describe("posting the roster", () => {
  function setup(existing: { v2: boolean } | null) {
    const sent = { id: "new-message" };
    const old = existing ? { editable: true, flags: { has: (flag: number) => existing.v2 && flag === MessageFlags.IsComponentsV2 }, edit: vi.fn(), delete: vi.fn(async () => undefined) } : null;
    const channel = { isTextBased: () => true, send: vi.fn(async () => sent), messages: { fetch: vi.fn(async () => old) } };
    const guild = { id: "g", name: "Quebec Gold", iconURL: () => null, channels: { fetch: vi.fn(async () => channel) }, roles: { fetch: vi.fn(async () => null) }, emojis: { fetch: vi.fn(async () => new Map()), cache: new Map() } };
    const database = {
      guildSettings: { findUnique: vi.fn(async () => ({ guildId: "guild", coreChannelId: "roster-channel", lootMode: "PRIORITY", language: "en" })), upsert: vi.fn(async () => ({ guildId: "guild", coreChannelId: "roster-channel", lootMode: "PRIORITY", language: "en" })) },
      guild: { findUnique: vi.fn(async () => ({ gameEdition: "forever" })) },
      raidCore: {
        findFirst: vi.fn(async () => ({ id: "core1", name: "Tuesday MC", description: null, rosterChannelId: null, rosterMessageId: existing ? "old-message" : null, roleId: null, members: [] })),
        findUnique: vi.fn(async () => ({ id: "core1", roleId: null, members: [] })),
        update: vi.fn(async () => ({}))
      }
    };
    return { old, channel, guild, database };
  }
  it("converts an old embed roster in place, preserving its identity", async () => {
    const { old, channel, guild, database } = setup({ v2: false });
    expect(await syncCoreRoster(guild as never, database as never, "guild", "core1")).toBe(true);
    expect(old!.delete).not.toHaveBeenCalled();
    expect(old!.edit).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.IsComponentsV2, content: null, embeds: [], attachments: [] }));
    expect(channel.send).not.toHaveBeenCalled();
    expect(database.raidCore.update).not.toHaveBeenCalled();
  });
  it("edits a roster that already uses the new card in place", async () => {
    const { old, channel, guild, database } = setup({ v2: true });
    expect(await syncCoreRoster(guild as never, database as never, "guild", "core1")).toBe(true);
    expect(old!.edit).toHaveBeenCalledWith(expect.objectContaining({ flags: MessageFlags.IsComponentsV2 }));
    expect(old!.delete).not.toHaveBeenCalled();
    expect(channel.send).not.toHaveBeenCalled();
  });
  it.each([50013, "ETIMEDOUT"])("does not replace a roster after fetch failure %s", async code => {
    const { channel, guild, database } = setup({ v2: false });
    channel.messages.fetch.mockRejectedValueOnce({ code });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try { expect(await syncCoreRoster(guild as never, database as never, "guild", "core1")).toBe(false); }
    finally { log.mockRestore(); }
    expect(channel.send).not.toHaveBeenCalled();
    expect(database.raidCore.update).not.toHaveBeenCalled();
  });
  it("replaces only a confirmed missing message", async () => {
    const { channel, guild, database } = setup({ v2: false });
    channel.messages.fetch.mockRejectedValueOnce({ code: 10008 });
    expect(await syncCoreRoster(guild as never, database as never, "guild", "core1")).toBe(true);
    expect(channel.send).toHaveBeenCalledOnce();
  });
});
