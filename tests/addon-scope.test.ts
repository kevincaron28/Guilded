import { describe, expect, it } from "vitest";
import { assertAddonGuildScope } from "../src/services/addon-scope.js";

describe("configured WoW guild import scope", () => {
  const guild = { wowSpace: { name: "Alpha", realm: "Realm One" } };
  it("accepts the exact configured guild and realm", () => {
    expect(() => assertAddonGuildScope({ wowGuild: "alpha-Realm One" }, guild)).not.toThrow();
  });
  it("rejects absent identity, same-name guilds on other realms, and other guilds", () => {
    for (const snapshot of [{}, { wowGuild: "Alpha-Realm Two" }, { wowGuild: "Beta-Realm One" }]) {
      expect(() => assertAddonGuildScope(snapshot, guild)).toThrow("selected WoW guild");
    }
  });
  it("keeps legacy default scopes without a configured WoW guild compatible", () => {
    expect(() => assertAddonGuildScope({}, { wowSpace: null })).not.toThrow();
  });
});
