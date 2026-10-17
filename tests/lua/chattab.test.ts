import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

function withChatTab(hasWindowApi = true): LuaSession {
  session = newLuaSession();
  session.run(String.raw`
    LINES = { main = {}, tab = {} }
    DEFAULT_CHAT_FRAME = { AddMessage = function(_, text) LINES.main[#LINES.main + 1] = text end }
    NUM_CHAT_WINDOWS = 3
    ChatFrame1 = DEFAULT_CHAT_FRAME
    ChatFrame3 = { AddMessage = function(_, text) LINES.tab[#LINES.tab + 1] = text end }
    WINDOW_NAMES = { "General", "Log", nil }
    GetChatWindowInfo = function(i) return WINDOW_NAMES[i] end
    ${hasWindowApi ? `FCF_OpenNewWindow = function(name) WINDOW_NAMES[3] = name; return ChatFrame3 end` : ""}
    SETTINGS = {}
    NS = { getSettings = function() return SETTINGS end, commandHandlers = {}, commandHelp = {} }
  `);
  session.load("Modules/ChatTab.lua");
  return session;
}

const chat = (s: LuaSession, arg: string) => s.run(`NS.commandHandlers["chat"]({ ${JSON.stringify(arg)} })`);

describe("ChatTab.lua", () => {
  it("does nothing until turned on: the main chat stays in use", () => {
    const s = withChatTab();
    expect(s.run(`return tostring(NS.chatFrame())`)).toBe("nil");
  });

  it("/guilded chat tab opens the tab and routes lines to it; off goes back", () => {
    const s = withChatTab();
    chat(s, "tab");
    expect(s.run(`return tostring(SETTINGS.chatTab)`)).toBe("true");
    expect(s.run(`return WINDOW_NAMES[3]`)).toBe("Guilded");
    expect(s.run(`return tostring(NS.chatFrame() == ChatFrame3)`)).toBe("true");
    expect(s.run(`return LINES.main[1]`)).toContain("Guilded chat tab");   // the confirmation shows in the main chat
    expect(s.run(`return LINES.tab[1]`)).toContain("This tab shows Guilded");
    chat(s, "off");
    expect(s.run(`return tostring(NS.chatFrame())`)).toBe("nil");
    expect(s.run(`return tostring(SETTINGS.chatTab)`)).toBe("false");
  });

  it("/guilded chat off closes the Guilded tab instead of leaving it empty", () => {
    const s = withChatTab();
    s.run(`CLOSED = nil; FCF_Close = function(frame) CLOSED = frame; WINDOW_NAMES[3] = nil end`);
    chat(s, "tab");
    chat(s, "off");
    expect(s.run(`return tostring(CLOSED == ChatFrame3)`)).toBe("true");
    expect(s.run(`return tostring(WINDOW_NAMES[3])`)).toBe("nil");
  });

  it("/guilded chat off never closes the main chat window", () => {
    const s = withChatTab();
    s.run(`CLOSED = nil; FCF_Close = function(frame) CLOSED = frame end; WINDOW_NAMES[1] = "Guilded"`);
    chat(s, "off");
    expect(s.run(`return tostring(CLOSED)`)).toBe("nil");
  });

  it("reopens the tab after off: a closed window keeps its name but is not used", () => {
    const s = withChatTab();
    // As in the game: closing hides the frame and its tab; the name stays.
    s.run(String.raw`
      SHOWN = {}
      ChatFrame3.IsShown = function() return SHOWN.frame == true end
      ChatFrame3Tab = { IsShown = function() return SHOWN.tab == true end }
      ChatFrame4 = { AddMessage = function() end, IsShown = function() return false end }
      ChatFrame4Tab = { IsShown = function() return SHOWN.tab4 == true end }
      NUM_CHAT_WINDOWS = 4
      FCF_OpenNewWindow = function(name)
        if WINDOW_NAMES[3] == nil then WINDOW_NAMES[3] = name; SHOWN.tab = true; return ChatFrame3 end
        WINDOW_NAMES[4] = name; SHOWN.tab4 = true; return ChatFrame4
      end
      FCF_Close = function() SHOWN.tab = false end
    `);
    chat(s, "tab");
    chat(s, "off");
    expect(s.run(`return WINDOW_NAMES[3]`)).toBe("Guilded");          // name kept, window closed
    expect(s.run(`return tostring(NS.chatFrame())`)).toBe("nil");
    chat(s, "tab");
    expect(s.run(`return tostring(SHOWN.tab4)`)).toBe("true");        // a window really opened
    s.run(`SETTINGS.chatTab = true`);
    expect(s.run(`return tostring(NS.chatFrame() == ChatFrame4)`)).toBe("true");
  });

  it("uses an existing tab named Guilded instead of opening another", () => {
    const s = withChatTab();
    s.run(`WINDOW_NAMES[3] = "Guilded"; OPENED = 0; FCF_OpenNewWindow = function() OPENED = OPENED + 1 end`);
    chat(s, "tab");
    expect(s.run(`return OPENED`)).toBe("0");
    expect(s.run(`return tostring(NS.chatFrame() == ChatFrame3)`)).toBe("true");
  });

  it("explains itself when the client cannot open a window", () => {
    const s = withChatTab(false);
    chat(s, "tab");
    expect(s.run(`return tostring(SETTINGS.chatTab)`)).toBe("nil");
    expect(s.run(`return LINES.main[1]`)).toContain("cannot open a chat tab");
  });

  it("falls back to the main chat when the tab was closed", () => {
    const s = withChatTab();
    chat(s, "tab");
    s.run(`WINDOW_NAMES[3] = nil`);
    expect(s.run(`return tostring(NS.chatFrame())`)).toBe("nil");
  });
});
