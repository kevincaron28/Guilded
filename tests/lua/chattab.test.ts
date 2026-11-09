import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

function withChatTab(): LuaSession {
  session = newLuaSession();
  session.run(String.raw`
    LINES = { main = {}, tab = {} }
    DEFAULT_CHAT_FRAME = { AddMessage = function(_, text) LINES.main[#LINES.main + 1] = text end }
    NUM_CHAT_WINDOWS = 3
    ChatFrame1 = DEFAULT_CHAT_FRAME
    ChatFrame3 = { AddMessage = function(_, text) LINES.tab[#LINES.tab + 1] = text end }
    WINDOW_NAMES = { "General", "Log", nil }
    GetChatWindowInfo = function(i) return WINDOW_NAMES[i] end
    SETTINGS = {}
    NS = { getSettings = function() return SETTINGS end, commandHandlers = {}, commandHelp = {} }
  `);
  session.load("Modules/ChatTab.lua");
  return session;
}

const chat = (s: LuaSession, arg: string) => s.run(`NS.commandHandlers["chat"]({ ${JSON.stringify(arg)} })`);

// Every chat-window function Guilded must never call: run from addon code they taint the chat boxes,
// and the next /reload typed there is refused ("Guilded has been blocked", 9 November 2026).
const WINDOW_CALLS = String.raw`
  WINDOW_CALLS = 0
  for _, n in ipairs({ "FCF_OpenNewWindow", "FCF_Close", "FCF_DockFrame", "FCF_UnDockFrame", "FCF_SelectDockFrame", "FCF_SetWindowName", "ChatFrame_OpenChat" }) do
    _G[n] = function() WINDOW_CALLS = WINDOW_CALLS + 1 end
  end
  for _, f in ipairs({ ChatFrame1, ChatFrame3 }) do
    for _, m in ipairs({ "Show", "Hide", "HideBase", "SetPoint", "ClearAllPoints" }) do
      f[m] = function() WINDOW_CALLS = WINDOW_CALLS + 1 end
    end
  end
`;

describe("ChatTab.lua", () => {
  it("does nothing until turned on: the main chat stays in use", () => {
    const s = withChatTab();
    expect(s.run(`return tostring(NS.chatFrame())`)).toBe("nil");
  });

  it("/guilded chat tab uses the window named Guilded; off goes back to the main chat", () => {
    const s = withChatTab();
    s.run(`WINDOW_NAMES[3] = "Guilded"`);
    chat(s, "tab");
    expect(s.run(`return tostring(SETTINGS.chatTab)`)).toBe("true");
    expect(s.run(`return tostring(NS.chatFrame() == ChatFrame3)`)).toBe("true");
    expect(s.run(`return LINES.main[1]`)).toContain("Guilded chat tab");   // the confirmation shows in the main chat
    expect(s.run(`return LINES.tab[1]`)).toContain("This tab shows Guilded");
    chat(s, "off");
    expect(s.run(`return tostring(NS.chatFrame())`)).toBe("nil");
    expect(s.run(`return tostring(SETTINGS.chatTab)`)).toBe("false");
    expect(s.run(`return LINES.main[#LINES.main]`)).toContain("right-click it and close it");
  });

  it("without a Guilded window, /guilded chat tab explains how to make one and opens nothing", () => {
    const s = withChatTab();
    s.run(WINDOW_CALLS);
    chat(s, "tab");
    expect(s.run(`return WINDOW_CALLS`)).toBe("0");
    expect(s.run(`return tostring(SETTINGS.chatTab)`)).toBe("true");
    expect(s.run(`return LINES.main[1]`)).toContain("New Window and name it Guilded");
    expect(s.run(`return tostring(NS.chatFrame())`)).toBe("nil");                    // main chat meanwhile
    // The player makes the window: it is used from then on, no command needed.
    s.run(`WINDOW_NAMES[3] = "Guilded"`);
    expect(s.run(`return tostring(NS.chatFrame() == ChatFrame3)`)).toBe("true");
  });

  it("a closed window keeps its name but is not used", () => {
    const s = withChatTab();
    s.run(String.raw`
      SHOWN = { tab = true }
      WINDOW_NAMES[3] = "Guilded"
      ChatFrame3.IsShown = function() return SHOWN.frame == true end
      ChatFrame3Tab = { IsShown = function() return SHOWN.tab == true end }
    `);
    chat(s, "tab");
    expect(s.run(`return tostring(NS.chatFrame() == ChatFrame3)`)).toBe("true");
    s.run(`SHOWN.tab = false`);                                       // the player closed it
    expect(s.run(`return tostring(NS.chatFrame())`)).toBe("nil");
  });

  it("falls back to the main chat when the tab was closed", () => {
    const s = withChatTab();
    s.run(`WINDOW_NAMES[3] = "Guilded"`);
    chat(s, "tab");
    s.run(`WINDOW_NAMES[3] = nil`);
    expect(s.run(`return tostring(NS.chatFrame())`)).toBe("nil");
  });

  it("never opens, closes or docks a chat window, whatever the path (login, first run, commands)", () => {
    const s = withChatTab();
    s.run(WINDOW_CALLS + `SETTINGS.chatTab = true; C_Timer = { After = function(_, fn) fn() end }`);
    s.run(`fire_event("PLAYER_LOGIN")`);              // saved on, tab missing: no reopen
    chat(s, "tab");
    chat(s, "off");
    chat(s, "tab");
    s.run(`SETTINGS.chatTab = nil; NS.chatTab.firstRun(); fire_event("PLAYER_LOGIN")`);
    s.run(`WINDOW_NAMES[3] = "Guilded"`);
    chat(s, "off");
    expect(s.run("return WINDOW_CALLS")).toBe("0");
  });
});
