import { expect, it } from "vitest";
import { battlegroundCreateModal, battlegroundFormInput, battlegroundJoinModal, battlegroundPanel } from "../src/commands/battleground.js";
import { entityGuildScope } from "../src/services/guild-scope.js";

it("offers four compact EN/FR actions and valid five-field forms", () => {
  for (const fr of [false, true]) {
    const buttons = battlegroundPanel(fr, "guild").toJSON().components;
    expect(buttons).toHaveLength(4);
    expect(new Set(buttons.map(b => "custom_id" in b ? b.custom_id : "" )).size).toBe(4);
    for (const modal of [battlegroundCreateModal("blitz", "Alliance", fr, "guild"), battlegroundJoinModal(fr, "guild")]) {
      const json = modal.toJSON();
      expect(json.components).toHaveLength(5);
      expect(json.title.length).toBeLessThanOrEqual(45);
    }
  }
});

it("binds an open panel to its original guild and refuses a foreign Discord server", async () => {
  const db = { guild: { findFirst: async ({ where }: { where: { id: string; discordId: string } }) =>
    where.id === "original" && where.discordId === "server" ? { id: "original", discordId: "server", scopeKey: "default" } : null } };
  expect((await entityGuildScope(db as never, "server", "bgui:original:create"))?.guild.id).toBe("original");
  await expect(entityGuildScope(db as never, "foreign", "bgui:original:create")).rejects.toThrow(/not available/);
});

it("normalizes join declarations without treating Hardcore or missing consent as normal", () => {
  const values: Record<string, string> = { session: "session", character: "Player-Realm", role: "healer", faction: "horde", normal: "hardcore" };
  const input = battlegroundFormInput({ customId: "bgui:guild:join-form", channelId: "channel", fields: { getTextInputValue: (key: string) => values[key]! } as never });
  expect(input.strings).toEqual({ session: "session", character: "Player-Realm", role: "HEALER", faction: "Horde" });
  expect(input.booleans?.["normal-realm"]).toBe(false);
});

it("keeps modal role/bracket fields explicit and rejects malformed or forged formats", () => {
  const values: Record<string, string> = { name: "Duo", map: "Random", start: "2026-11-05T20:00:00-05:00", levels: "90-90", roles: "0/1/1" };
  const form = { customId: "bgui:guild:create-form:blitz:Alliance", channelId: "private", fields: { getTextInputValue: (key: string) => values[key]! } as never };
  expect(battlegroundFormInput(form)).toMatchObject({ channelId: "private", integers: { "min-level": 90, "max-level": 90, tanks: 0, healers: 1, dps: 1 } });
  values["roles"] = "raid of eight";
  expect(() => battlegroundFormInput(form)).toThrow();
  expect(() => battlegroundFormInput({ ...form, customId: "bgui:guild:create-form:arena:Alliance" })).toThrow();
});
