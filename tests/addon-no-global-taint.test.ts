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

// 9 November 2026: "Guilded tried to call Button:SetPassThroughButtons()" after duels. The world map's own
// pins call it, and the game blocks it in combat once the map's code ran tainted. Addon code must never open
// the world map, hook its methods, add a data provider or parent frames to its canvas
// (Modules/GuildMap.lua draws on its own overlay instead).
describe("addons never run or hook the world map (taint)", () => {
  const files = [...luaFiles("addon/Guilded"), ...luaFiles("addon/GuildedDungeons")];
  const banned: Array<[string, RegExp]> = [
    ["opens the world map", /\b(?:ToggleWorldMap|OpenWorldMap)\s*\(|ShowUIPanel\s*\(\s*WorldMapFrame/],
    ["hooks WorldMapFrame", /hooksecurefunc\s*\(\s*WorldMapFrame|WorldMapFrame\s*:\s*HookScript/],
    ["adds a map data provider", /:\s*AddDataProvider\s*\(/],
    ["parents a frame to the map canvas", /CreateFrame\s*\([^)]*ScrollContainer\.Child/]
  ];
  it.each(banned)("no file %s", (_label, pattern) => {
    const offenders = files.filter((file) => pattern.test(readFileSync(file, "utf8").replace(/--[^\n]*/g, "")));
    expect(offenders).toEqual([]);
  });
});

// 9 November 2026: a plain /reload showed "Guilded has been blocked from an action only available to the Blizzard
// UI" (ADDON_ACTION_FORBIDDEN, "Guilded tried to call UNKNOWN()"). The Guilded chat tab reopened its chat window
// at login with FCF_OpenNewWindow; run from addon code, the chat windows' shared state is left tainted and the
// next slash command typed in the chat box runs tainted, so the (protected) reload was refused.
// Protected and chat-window functions: some are never called from addon code, the rest only from the files listed,
// where a button click (or a command the officer typed) runs them. A new caller must be added here on purpose.
describe("protected calls only where the player's click runs them (taint)", () => {
  const files = [...luaFiles("addon/Guilded"), ...luaFiles("addon/GuildedDungeons")];
  const source = (file: string) => readFileSync(file, "utf8").replace(/--[^\n]*/g, "");
  const rel = (file: string) => file.split("\\").join("/");
  const never: Array<[string, RegExp]> = [
    ["opens, closes or docks chat windows", /\bFCF_(?:OpenNewWindow|Close|DockFrame|UnDockFrame|SelectDockFrame|SetWindowName|ResetChatWindows)\b/],
    ["activates a chat box", /\bChatEdit_(?:ActivateChat|DeactivateChat|SetLastActiveWindow)\b/],
    ["reloads the UI itself (only the secure /reload macro button may)", /\bReloadUI\s*\(|\bC_UI\.Reload\b/],
    ["sets the guild message of the day", /\b(?:GuildSetMOTD|C_GuildInfo\.SetMOTD)\b/],
    ["runs macro text from addon code", /\bRunMacroText\b/],
    // 9 November 2026: the guild invite API is forbidden to addon code on WoW Forever even from a click ("Guilded tried to
    // call UNKNOWN()"). Every Invite button shows "/ginvite First Last" in the copy box (ns.util.inviteButton); the player pastes it in chat.
    ["calls the guild invite API (use ns.util.inviteButton, which shows the /ginvite line in the copy box)", /\b(?:C_GuildInfo\.Invite|GuildInvite)\b/]
  ];
  it.each(never)("no file %s", (_label, pattern) => {
    expect(files.filter((file) => pattern.test(source(file))).map(rel)).toEqual([]);
  });

  const allowed: Array<[string, RegExp, string[]]> = [
    // Party invites: the Invite buttons (call for help, levelling partners) show the /invite line in the copy box (ns.util.inviteButton).
    ["party invites", /\bInviteUnit\b/, [
      "addon/Guilded/Modules/AutoInvite.lua"    // /guilded invite raid, typed by the officer
    ]],
    ["guild rank, kick and note changes", /\b(?:GuildPromote|GuildDemote|GuildUninvite|GuildRosterSetPublicNote|GuildRosterSetOfficerNote|SetGuildMemberRank|SetGuildRankOrder|RemoveFromGuild)\b/, [
      "addon/Guilded/Modules/RosterTools.lua"   // roster admin, confirmed per click; refusals remembered per build
    ]],
    ["opening the chat box", /\bChatFrame_(?:SendTell|OpenChat|ReplyTell)\b/, [
      "addon/Guilded/Modules/LevelPartners.lua" // Whisper button
    ]]
  ];
  it.each(allowed)("%s only from the click-driven files", (_label, pattern, files_) => {
    expect(files.filter((file) => pattern.test(source(file))).map(rel).sort()).toEqual([...files_].sort());
  });

  it("every guild or party Invite button is a plain button from ns.util.inviteButton that shows the line in the copy box", () => {
    const buttons: Array<[string, string]> = [
      ["addon/Guilded/Modules/InviteQueue.lua", '"guild"'],
      ["addon/Guilded/Modules/CallForHelp.lua", '"party"'],
      ["addon/Guilded/Modules/LevelPartners.lua", '"party"']
    ];
    for (const [file, kind] of buttons) {
      expect(source(file), file).toContain("ns.util.inviteButton(");
      expect(source(file), file).toContain(kind);
    }
    // SyncNow.lua legitimately keeps a secure /reload macro button, so the checks are scoped to Util.lua's inviteButton.
    const util = source("addon/Guilded/Util.lua");
    expect(util).toContain('"/ginvite "');
    expect(util).toContain('"/invite "');
    expect(util).not.toContain("openChatLine");
    const start = util.indexOf("function util.inviteButton(");
    expect(start).toBeGreaterThan(-1);
    const end = util.slice(start).search(/\r?\nend\r?\n/);
    expect(end).toBeGreaterThan(-1);
    const invite = util.slice(start, start + end);
    expect(invite).toContain('"UIPanelButtonTemplate"');
    expect(invite).toContain("ns.showCopyText");
    expect(invite).not.toContain("OpenChat");
    expect(invite).not.toContain("SecureActionButtonTemplate");
    expect(invite).not.toContain('SetAttribute("macrotext"');
    expect(invite).not.toContain('SetAttribute("type"');
    expect(util).not.toMatch(/SetAttribute\("macrotext"/);
  });

  it("the auto-invite whisper handler hands out /ginvite instead of inviting", () => {
    const text = source("addon/Guilded/Modules/AutoInvite.lua");
    expect(text).not.toMatch(/\b(?:C_GuildInfo\.Invite|GuildInvite)\b/);
    expect(text).toContain("/ginvite");
  });
});
