import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Assigning one of Blizzard's own globals from addon code taints it, even when the value does not change
// (`SlashCmdList = SlashCmdList or {}`). On 8 November 2026 that line in GuildedDungeons made every /ginvite
// fail with "GuildedDungeons has been blocked from an action only available to the Blizzard UI".
// Adding our own key (SlashCmdList["GUILDED"] = ...) is fine; replacing the table is not.
const PROTECTED = ["SlashCmdList", "hash_SlashCmdList", "ChatFrame_OpenChat", "ChatEdit_SendText", "ChatEdit_ParseText", "GuildInvite", "StaticPopupDialogs", "UIParent", "GameTooltip"];

function luaFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return luaFiles(path);
    return name.endsWith(".lua") ? [path] : [];
  });
}

describe("addons never replace Blizzard globals (taint)", () => {
  const files = [...luaFiles("addon/Guilded"), ...luaFiles("addon/GuildedDungeons")];
  it("finds the addon sources", () => expect(files.length).toBeGreaterThan(10));
  it.each(PROTECTED)("no file assigns %s itself", (name) => {
    const assignment = new RegExp(`^\\s*(?:_G\\.)?${name}\\s*=(?!=)`, "m");
    const offenders = files.filter((file) => assignment.test(readFileSync(file, "utf8").replace(/--[^\n]*/g, "")));
    expect(offenders).toEqual([]);
  });
});
