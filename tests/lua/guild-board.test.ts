import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// In-game guild board (Modules/GuildBoard.lua, 9.1): officers' news and open Discord polls on the
// Board page, votes from the game, and the relay for members without the companion.
let s: LuaSession | undefined;
afterEach(() => { s?.close(); s = undefined; });

const FRAMES = String.raw`
  local base = CreateFrame
  function CreateFrame(kind, name, parent, template)
    local f = base(kind)
    f.kind, f.shown, f.text, f.value = kind, true, "", 0
    f.Show = function(self) self.shown = true end
    f.Hide = function(self) self.shown = false end
    f.IsShown = function(self) return self.shown end
    f.SetText = function(self, v) self.text = v or "" end
    f.GetText = function(self) return self.text end
    f.SetValue = function(self, v) self.value = v end
    f.SetMinMaxValues = function(self, a, b) self.min = a; self.max = b end
    f.SetStatusBarColor = function(self, r, g, b) self.color = { r, g, b } end
    f.HookScript = function(self, n, fn) self.scripts[n] = fn end
    f.CreateFontString = function() return CreateFrame("FontString") end
    f.CreateTexture = function() return CreateFrame("Texture") end
    return f
  end
`;

const FILE = String.raw`GuildedBoard = { at = "2026-11-07T12:00:00.000Z", news = {
    { id = "n1", at = 1799990000, by = "Ann Walker", text = "Raid moved to 8 pm" },
  }, polls = {
    { id = "pollaaa1", q = "Raid night?", max = 1, total = 3, at = 1799000000, closes = nil, opts = { "Friday", "Saturday" }, counts = { 1, 2 }, mine = { } },
    { id = "pollmulti", q = "Which dungeons?", max = 2, total = 1, at = 1799000000, closes = nil, opts = { "Scholo", "Strat", "UBRS" }, counts = { 1, 0, 1 }, mine = { 1 } },
  } }`;

function setup(options: { officer?: boolean; lang?: string; file?: boolean } = {}) {
  s = newLuaSession();
  s.run(FRAMES);
  s.run("NS = {}; GuildedDB = nil");
  s.load("Core.lua"); s.load("Compat.lua"); s.load("Locale.lua"); s.load("Modules/GuildBoard.lua");
  s.run(`fire_event("PLAYER_LOGIN")
    NS.isGuildMember = function(name) return name ~= "Stranger" end
    NS.isOfficer = function() return ${options.officer ? "true" : "false"} end
    NS.util.tooFarAhead = function() return false end
    NS.getSettings().language = "${options.lang ?? "en"}"
    MESSAGES = {}; NS.message = function(text) MESSAGES[#MESSAGES + 1] = text end
    SENT = {}`);
  if (options.file !== false) s.run(FILE);
  return s;
}

function buildPage() {
  s!.run(`PAGE = CreateFrame("Frame")
    HELPERS = { width = 582,
      newLabel = function(parent, text) local l = parent:CreateFontString(); l:SetText(text ~= "" and NS.L(text) or ""); return l end,
      newButton = function(parent, text, width, onClick) local b = CreateFrame("Button"); b:SetText(NS.L(text)); b:SetScript("OnClick", onClick); return b end,
      newEdit = function() return CreateFrame("EditBox") end,
      at = function(widget) return widget end }
    VIEW = NS.guildBoard.buildPage(PAGE, HELPERS)
    PAGE.scripts.OnShow(PAGE)`);
}
const sent = (kind: string) => s!.run(`local t = {} for _, m in ipairs(SENT) do if m.prefix == "GuildedBoard" and string.find(m.text, "^${kind}|") then t[#t + 1] = m.text end end return table.concat(t, "\\n")`);
const options = () => s!.run(`local t = {} for i, bar in ipairs(VIEW.optionBars) do if bar.shown then t[#t + 1] = bar.label.text .. "=" .. bar.count.text .. ":" .. VIEW.voteButtons[i].text end end return table.concat(t, ",")`);

describe("the Board page", () => {
  it("shows the news and the open polls from the companion, and votes from the game", () => {
    setup();
    buildPage();
    expect(s!.run("return VIEW.header.text")).toBe("From Discord, through your companion.");
    expect(s!.run("return VIEW.newsRows[1].text")).toContain("Ann Walker|r  Raid moved to 8 pm");
    expect(s!.run("return VIEW.pollCount.text")).toBe("Poll 1 of 2");
    expect(s!.run("return VIEW.question.text")).toBe("Raid night?");
    expect(options()).toBe("1. Friday=1:Vote,2. Saturday=2:Vote");
    // Members never see the officer post box.
    expect(s!.run("return tostring(VIEW.postBox.shown)")).toBe("false");
    s!.run("VIEW.voteButtons[2].scripts.OnClick(VIEW.voteButtons[2])");
    expect(options()).toBe("1. Friday=1:Vote,2. Saturday=2:Your pick");
    expect(s!.run("return table.concat(NS.getDb().board.votes.pollaaa1.picks, ',')")).toBe("2");
    expect(s!.run("return VIEW.note.text")).toContain("next sync");
    expect(sent("VOTE")).toBe("VOTE|pollaaa1|2|1800000000");
    // Changing a single-choice vote replaces it.
    s!.run("VIEW.voteButtons[1].scripts.OnClick(VIEW.voteButtons[1])");
    expect(s!.run("return table.concat(NS.getDb().board.votes.pollaaa1.picks, ',')")).toBe("1");
  });

  it("toggles picks on a several-pick poll up to its limit, starting from the bot's picks", () => {
    setup();
    buildPage();
    s!.run("VIEW.nextButton.scripts.OnClick(VIEW.nextButton)");
    expect(s!.run("return VIEW.question.text")).toBe("Which dungeons?");
    expect(options()).toBe("1. Scholo=1:Remove,2. Strat=0:Vote,3. UBRS=1:Vote");
    expect(s!.run(`return table.concat(NS.guildBoard.vote("pollmulti", 3), ",")`)).toBe("1,3");
    expect(s!.run(`local ok, why = NS.guildBoard.vote("pollmulti", 2); return tostring(ok) .. ":" .. why`)).toContain("up to 2 options");
    expect(s!.run(`return table.concat(NS.guildBoard.vote("pollmulti", 1), ",")`)).toBe("3");
    expect(s!.run(`local ok, why = NS.guildBoard.vote("pollmulti", 9); return why`)).toBe("That option does not exist.");
  });

  it("drops a waiting vote once the bot has it, or once the poll closed", () => {
    setup();
    s!.run(`NS.guildBoard.vote("pollaaa1", 2); NS.guildBoard.prune()`);
    expect(s!.run("return tostring(NS.getDb().board.votes.pollaaa1 ~= nil)")).toBe("true");
    s!.run(`GuildedBoard.polls[1].mine = { 2 }; NS.guildBoard.prune()`);
    expect(s!.run("return tostring(NS.getDb().board.votes.pollaaa1)")).toBe("nil");
    s!.run(`NS.guildBoard.vote("pollmulti", 2)
      GuildedBoard = { at = "2026-11-08T12:00:00.000Z", news = {}, polls = {} }; NS.guildBoard.prune()`);
    expect(s!.run("return tostring(NS.getDb().board.votes.pollmulti)")).toBe("nil");
  });

  it("says when officers turned the board off, and refuses votes", () => {
    setup({ file: false });
    s!.run(`GuildedBoard = { at = "2026-11-07T12:00:00.000Z", off = true }`);
    buildPage();
    expect(s!.run("return VIEW.header.text")).toContain("turned the guild board off");
    expect(options()).toBe("");
    expect(s!.run(`return tostring(NS.guildBoard.vote("pollaaa1", 1))`)).toBe("nil");
  });

  it("lets officers write news for their companion to post, never members", () => {
    setup();
    expect(s!.run(`local ok, why = NS.guildBoard.post("Bring flasks"); return why`)).toBe("Only officers can post guild news.");
    s!.close();
    setup({ officer: true });
    buildPage();
    expect(s!.run("return tostring(VIEW.postBox.shown)")).toBe("true");
    s!.run(`VIEW.postBox:SetText("Bring |cffff0000flasks|r tonight"); VIEW.postButton.scripts.OnClick(VIEW.postButton)`);
    expect(s!.run(`local n, text = 0, nil for _, p in pairs(NS.getDb().board.posts) do n = n + 1; text = p.text end return n .. ":" .. text`)).toBe("1:Bring cffff0000flasksr tonight");
    expect(s!.run("return VIEW.postBox.text")).toBe("");
    // Acknowledged once the board lists its ref.
    s!.run(`local ref = next(NS.getDb().board.posts); GuildedBoard.news[2] = { id = "n2", at = 1, by = "Me", text = "x", ref = ref }; NS.guildBoard.prune()`);
    expect(s!.run("return tostring(next(NS.getDb().board.posts))")).toBe("nil");
  });

  it("prints a news line once per new post at login, unless the member turned alerts off", () => {
    setup();
    expect(s!.run("return tostring(NS.guildBoard.newsAlert())")).toBe("true");
    expect(s!.run("return MESSAGES[1]")).toBe("Guild news from Ann Walker: Raid moved to 8 pm (the Board page of the Guilded window)");
    expect(s!.run("return tostring(NS.guildBoard.newsAlert())")).toBe("false");
    s!.run(`NS.commandHandlers.board({ "alerts", "off" }); GuildedBoard.news[1] = { id = "n9", at = 1, by = "Ann", text = "New" }`);
    expect(s!.run("return tostring(NS.guildBoard.newsAlert())")).toBe("false");
    expect(s!.run("return tostring(NS.guildBoard.alertsOn())")).toBe("false");
  });

  it("is translated in French, German and Spanish", () => {
    for (const [lang, word] of [["fr", "Sondage 1 sur 2"], ["de", "Umfrage 1 von 2"], ["es", "Encuesta 1 de 2"]] as const) {
      setup({ lang });
      buildPage();
      expect(s!.run("return VIEW.pollCount.text")).toBe(word);
      expect(s!.run("return VIEW.voteButtons[1].text")).not.toBe("Vote");
      s!.close(); s = undefined;
    }
  });
});

describe("the relay for members without the companion", () => {
  it("shares the companion's board on GUILD and a guildmate rebuilds it, counts and all", () => {
    setup();
    expect(s!.run("return tostring(NS.guildBoard.share())")).toBe("true");
    const parts = s!.run(`local t = {} for _, m in ipairs(SENT) do if string.find(m.text, "^BOARD|") then t[#t + 1] = m.text end end return table.concat(t, "\\0")`).split("\0");
    expect(parts[0]).toMatch(/^BOARD\|2026-11-07T12:00:00\.000Z\|1\|1\|N;n1;1799990000;Ann Walker;Raid moved to 8 pm\nP;pollaaa1;1;0;3;Raid night\?\nO;1;Friday/);
    // A member without the companion hears it.
    s!.close();
    setup({ file: false });
    for (const part of parts) s!.run(`fire_event("CHAT_MSG_ADDON", "GuildedBoard", ${JSON.stringify(part)}, "GUILD", "Kev Caron")`);
    expect(s!.run("local b = NS.guildBoard.current(); return b.source .. ':' .. b.from .. ':' .. #b.polls .. ':' .. b.polls[2].opts[3] .. ':' .. b.polls[2].counts[3]")).toBe("guild:Kev Caron:2:UBRS:1");
    buildPage();
    expect(s!.run("return VIEW.header.text")).toBe("Shared by Kev Caron (from Discord).");
    // Outsiders and older copies are ignored.
    s!.run(`fire_event("CHAT_MSG_ADDON", "GuildedBoard", "BOARD|2026-11-09T00:00:00Z|1|1|X", "GUILD", "Stranger")
      fire_event("CHAT_MSG_ADDON", "GuildedBoard", "BOARD|2026-11-01T00:00:00Z|1|1|X", "GUILD", "Kev Caron")`);
    expect(s!.run("return tostring(NS.guildBoard.current().off)")).toBe("false");
  });

  it("keeps guildmates' votes, newest per poll and sender, for this PC's companion to carry", () => {
    setup();
    s!.run(`fire_event("CHAT_MSG_ADDON", "GuildedBoard", "VOTE|pollaaa1|2|1799999000", "GUILD", "Ann Walker")
      fire_event("CHAT_MSG_ADDON", "GuildedBoard", "VOTE|pollaaa1|1|1799998000", "GUILD", "Ann Walker")
      fire_event("CHAT_MSG_ADDON", "GuildedBoard", "VOTE|pollaaa1|1|1799999000", "GUILD", "Stranger")
      fire_event("CHAT_MSG_ADDON", "GuildedBoard", "VOTE|pollaaa1|99|1799999000", "GUILD", "Bo Dee")`);
    expect(s!.run(`local t = {} for key, v in pairs(NS.getDb().board.heard) do t[#t + 1] = key .. "=" .. table.concat(v.picks, ",") end return table.concat(t, ";")`))
      .toBe("pollaaa1@Ann Walker=2");
  });

  it("answers a request for an older board after a short wait, from the companion holder first", () => {
    setup();
    s!.run(`TIMERS = {}; C_Timer = { After = function(delay, fn) TIMERS[#TIMERS + 1] = { delay = delay, fn = fn } end }
      fire_event("CHAT_MSG_ADDON", "GuildedBoard", "REQ|0", "GUILD", "Ann Walker")`);
    expect(Number(s!.run("return TIMERS[1].delay"))).toBeLessThanOrEqual(5);
    s!.run("TIMERS[1].fn()");
    expect(sent("BOARD")).toContain("BOARD|2026-11-07T12:00:00.000Z|1|");
    // A copy at least as new is never answered.
    s!.run(`TIMERS = {}; fire_event("CHAT_MSG_ADDON", "GuildedBoard", "REQ|2026-11-07T12:00:00.000Z", "GUILD", "Ann Walker")`);
    expect(s!.run("return tostring(#TIMERS)")).toBe("0");
  });

  it("round-trips its own line format and refuses malformed text", () => {
    setup();
    expect(s!.run(`local b = NS.guildBoard.decode(NS.guildBoard.encode(NS.guildBoard.current())); return b.news[1].text .. "|" .. b.polls[1].q .. "|" .. b.polls[2].max`))
      .toBe("Raid moved to 8 pm|Raid night?|2");
    expect(s!.run(`return tostring(NS.guildBoard.decode("P;x;1;0;0;q\\nO;1;only"))`)).toBe("nil");
    expect(s!.run(`return tostring(NS.guildBoard.decode("Z;bad"))`)).toBe("nil");
    expect(s!.run(`return tostring(NS.guildBoard.decode("X").off)`)).toBe("true");
  });
});
