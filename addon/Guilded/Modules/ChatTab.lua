-- An optional "Guilded" chat tab. With it on, the addon's own lines (bidding results, sync
-- status, command answers) go to that tab instead of the main chat, so raid chat stays
-- readable. Messages to the raid, the party or whispers are not affected.
--
--   /guilded chat tab    open the Guilded tab and send the addon's lines there
--   /guilded chat off    back to the main chat window
--   /guilded chat        say which it is
local addonName, ns = ...
ns = ns or {}

local module = {}
ns.chatTab = module

local TAB_NAME = "Guilded"

local function settings()
  return ns.getSettings and ns.getSettings()
end

-- A closed chat window keeps its name, so the name alone does not mean it is open: a docked
-- window shows its tab, an undocked one shows its frame. (GetChatWindowInfo's "shown" is false
-- for docked windows, even General.)
local function isOpen(i, frame)
  if not (frame and frame.IsShown) then return frame ~= nil end
  if frame:IsShown() then return true end
  local tab = _G["ChatFrame" .. i .. "Tab"]
  return tab and tab.IsShown and tab:IsShown() and true or false
end

-- The open chat window named Guilded, or nil.
local function findFrame()
  local count = NUM_CHAT_WINDOWS or 10
  for i = 1, count do
    local name = GetChatWindowInfo and GetChatWindowInfo(i)
    local frame = _G["ChatFrame" .. i]
    if name == TAB_NAME and isOpen(i, frame) then return frame end
  end
  return nil
end

-- Opening or closing a chat window shows/hides Blizzard's chat frames (ChatFrame1:Show,
-- HideBase) and re-docks them. The game refuses that in combat (ADDON_ACTION_BLOCKED) and the
-- failed insecure call can leave the chat frames tainted, so these calls only run out of
-- combat; in combat they wait for PLAYER_REGEN_ENABLED (ns.util.afterCombat).
local function inCombat()
  return ns.util and ns.util.inCombat and ns.util.inCombat() or false
end
local function afterCombat(key, fn)
  if ns.util and ns.util.afterCombat then return ns.util.afterCombat(key, fn) end
  fn()
  return false
end

-- Finds the tab, opening it when asked to.
function module.frame(create)
  local frame = findFrame()
  if frame then return frame end
  if create and FCF_OpenNewWindow then
    if inCombat() then return nil end
    local ok, result = pcall(FCF_OpenNewWindow, TAB_NAME)
    if ok and result and result.AddMessage then return result end
    return findFrame()
  end
  return nil
end

function module.enabled()
  local s = settings()
  return s and s.chatTab == true or false
end

-- Used by Core's message(): the tab when it is on and exists, otherwise nil (main chat).
function ns.chatFrame()
  if not module.enabled() then return nil end
  return module.frame(false)
end

local function say(text)
  -- Confirmations show in the main chat so they are seen whichever way it was switched.
  if DEFAULT_CHAT_FRAME then DEFAULT_CHAT_FRAME:AddMessage("|cffd4af37[Guilded]|r " .. text) end
end

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["chat"] = function(args)
  local s = settings()
  if not s then return end
  local action = string.lower(args[1] or "")
  if (action == "tab" or action == "on" or action == "off") and inCombat() then
    afterCombat("guilded-chat-tab", function() ns.commandHandlers["chat"](args) end)
    return
  end
  if action == "tab" or action == "on" then
    local frame = module.frame(true)
    if not frame then
      say("This game version cannot open a chat tab from here. Right-click a chat tab, Open New Window, name it Guilded, then /guilded chat tab.")
      return
    end
    s.chatTab = true
    say("Guilded's own lines now go to the Guilded chat tab. /guilded chat off to go back.")
    if frame.AddMessage then frame:AddMessage("|cffd4af37[Guilded]|r This tab shows Guilded's messages.") end
  elseif action == "off" then
    s.chatTab = false
    -- Close the tab too, so the player is not left with an empty window. The first two chat
    -- windows (General, Combat Log) cannot be closed and are never named Guilded by us.
    local tab = findFrame()
    if tab and tab ~= DEFAULT_CHAT_FRAME and tab ~= ChatFrame1 and tab ~= ChatFrame2 and FCF_Close then
      pcall(FCF_Close, tab)
    end
    say("Guilded's lines are back in the main chat window.")
  else
    say(module.enabled() and "Guilded's own lines go to the Guilded chat tab. /guilded chat off to go back."
      or "Guilded's own lines go to the main chat. /guilded chat tab puts them in their own tab.")
  end
end

ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded chat tab | off - show Guilded's own messages in a separate chat tab")

-- ---------------------------------------------------------------------
-- Guild events in the tab (8.5.0): join, leave, kick, promote, demote, online, offline.
-- They come from CHAT_MSG_SYSTEM and are recognised with the game's own global strings
-- (ERR_GUILD_JOIN_S ...), so every game language works. They are only copied into the Guilded
-- tab, and only when that tab is on and open; nothing is added to General.
-- ---------------------------------------------------------------------
local EVENTS = {
  { kind = "join", global = "ERR_GUILD_JOIN_S", english = "%s has joined the guild.", who = 1 },
  { kind = "leave", global = "ERR_GUILD_LEAVE_S", english = "%s has left the guild.", who = 1 },
  { kind = "kick", global = "ERR_GUILD_REMOVE_SS", english = "%s has been kicked out of the guild by %s.", who = 1, by = 2 },
  { kind = "promote", global = "ERR_GUILD_PROMOTE_SSS", english = "%s has promoted %s to %s.", who = 2, by = 1, rank = 3 },
  { kind = "demote", global = "ERR_GUILD_DEMOTE_SSS", english = "%s has demoted %s to %s.", who = 2, by = 1, rank = 3 },
  { kind = "online", global = "ERR_FRIEND_ONLINE_SS", english = "|Hplayer:%s|h[%s]|h has come online.", who = 1 },
  { kind = "offline", global = "ERR_FRIEND_OFFLINE_S", english = "%s has gone offline.", who = 1 }
}
module.EVENTS = EVENTS
module.EVENT_KINDS = { "join", "leave", "kick", "promote", "demote", "online", "offline" }

-- A game template ("%s has joined", "%1$s a promu %2$s") as a Lua pattern, plus the template's
-- argument order (so positional French/German templates map to the right captures).
function module.templatePattern(template)
  local out, order, i, n = {}, {}, 1, #template
  local plain = 0
  while i <= n do
    local c = string.sub(template, i, i)
    if c == "%" then
      local position, after = string.match(string.sub(template, i), "^%%(%d+)%$s()")
      if position then
        table.insert(order, tonumber(position)); table.insert(out, "(.-)"); i = i + after - 1
      elseif string.sub(template, i + 1, i + 1) == "s" then
        plain = plain + 1
        table.insert(order, plain); table.insert(out, "(.-)"); i = i + 2
      else
        table.insert(out, "%%"); i = i + 2
      end
    else
      if string.find(c, "[%(%)%.%+%-%*%?%[%]%^%$]") then table.insert(out, "%" .. c) else table.insert(out, c) end
      i = i + 1
    end
  end
  return "^" .. table.concat(out) .. "$", order
end

local compiled
local function patterns()
  if compiled then return compiled end
  compiled = {}
  for _, event in ipairs(EVENTS) do
    local template = _G[event.global]
    if type(template) ~= "string" then template = event.english end
    local pattern, order = module.templatePattern(template)
    table.insert(compiled, { event = event, pattern = pattern, order = order })
  end
  return compiled
end
function module.resetPatterns() compiled = nil end

-- Which event a system line is: { kind, name, by, rank } or nil.
function module.parse(text)
  if type(text) ~= "string" or (ns.isSecret and ns.isSecret(text)) then return nil end
  for _, entry in ipairs(patterns()) do
    local captures = { string.match(text, entry.pattern) }
    if #captures > 0 then
      -- captures[k] holds the template argument entry.order[k]
      local byArgument = {}
      for k, argument in ipairs(entry.order) do byArgument[argument] = captures[k] end
      local event = entry.event
      return { kind = event.kind, name = byArgument[event.who],
        by = event.by and byArgument[event.by] or nil,
        rank = event.rank and byArgument[event.rank] or nil }
    end
  end
  return nil
end

function module.eventEnabled(kind)
  local s = settings()
  local flags = s and s.chatEvents
  return not (type(flags) == "table" and flags[kind] == false)
end
function module.setEventEnabled(kind, on)
  local s = settings()
  if not s then return end
  s.chatEvents = type(s.chatEvents) == "table" and s.chatEvents or {}
  s.chatEvents[kind] = on and true or false
end
function module.officersOnlyPresence()
  local s = settings()
  return s and s.chatEventsOfficersOnly == true or false
end

-- The guild roster row for a name: class token and rank index, or nil when not in the guild.
local function rosterEntry(name)
  if not (name and GetNumGuildMembers and GetGuildRosterInfo) then return nil end
  local wanted = ns.normalizeName and ns.normalizeName(name) or name
  for i = 1, math.min(GetNumGuildMembers() or 0, 1000) do
    local rosterName, _, rankIndex, _, _, _, _, _, _, _, class = GetGuildRosterInfo(i)
    if rosterName and (ns.normalizeName and ns.normalizeName(rosterName) or rosterName) == wanted then
      return { class = class, rank = rankIndex }
    end
  end
  return nil
end

local function coloured(name, class)
  local shown = ns.displayName and ns.displayName(name) or name
  local color = class and RAID_CLASS_COLORS and RAID_CLASS_COLORS[class]
  if color and color.r then
    return string.format("|cff%02x%02x%02x%s|r", math.floor(color.r * 255 + 0.5), math.floor(color.g * 255 + 0.5), math.floor(color.b * 255 + 0.5), shown)
  end
  return shown
end

local function stamp()
  return date and date("%H:%M") or ""
end

-- Words are translated by Locale.lua; the names stay as the game gave them.
local function describe(parsed, who, byText)
  local function T(text) return ns.L and ns.L(text) or text end
  local kind = parsed.kind
  if kind == "join" then return string.format(T("%s joined the guild."), who)
  elseif kind == "leave" then return string.format(T("%s left the guild."), who)
  elseif kind == "kick" then return string.format(T("%s was removed from the guild by %s."), who, byText or "?")
  elseif kind == "promote" then return string.format(T("%s was promoted to %s by %s."), who, parsed.rank or "?", byText or "?")
  elseif kind == "demote" then return string.format(T("%s was demoted to %s by %s."), who, parsed.rank or "?", byText or "?")
  elseif kind == "online" then return string.format(T("%s came online."), who)
  end
  return string.format(T("%s went offline."), who)
end

-- Called for every system line; returns true when a line was added to the tab.
function module.onSystem(text)
  if not module.enabled() then return false end
  local parsed = module.parse(text)
  if not parsed or not parsed.name or not module.eventEnabled(parsed.kind) then return false end
  local frame = module.frame(false)
  if not (frame and frame.AddMessage) then return false end
  local entry = rosterEntry(parsed.name)
  local presence = parsed.kind == "online" or parsed.kind == "offline"
  -- Friends who are not in the guild also trigger "has come online": guild members only.
  if presence and not entry then return false end
  if presence and module.officersOnlyPresence() then
    local s = settings()
    local officerRanks = s and s.officerRanks
    if not (entry and entry.rank ~= nil and officerRanks and officerRanks[entry.rank]) then return false end
  end
  local byEntry = parsed.by and rosterEntry(parsed.by)
  local who = coloured(parsed.name, entry and entry.class)
  local by = parsed.by and coloured(parsed.by, byEntry and byEntry.class) or nil
  frame:AddMessage("|cff9d9d9d" .. stamp() .. "|r |cffd4af37[Guilded]|r " .. describe(parsed, who, by))
  return true
end

-- First login with no saved choice: open the Guilded tab and turn it on. Tried at most three logins
-- (a client that cannot open a window from here is left alone, with the manual steps on /guilded chat tab).
function module.firstRun()
  local s = settings()
  if not s or s.chatTab ~= nil then return false end
  s.chatTabTries = (s.chatTabTries or 0) + 1
  if s.chatTabTries > 3 then s.chatTab = false return false end
  local ok = false
  afterCombat("guilded-chat-tab-first", function()
    local current = settings()
    if not current or current.chatTab ~= nil then return end
    local frame = module.frame(true)
    if not frame then return end
    current.chatTab = true
    ok = true
    if frame.AddMessage then frame:AddMessage("|cffd4af37[Guilded]|r " .. (ns.L and ns.L("This tab shows Guilded's messages and guild events (joins, leaves, online, offline). /guilded chat off turns it off.") or "This tab shows Guilded's messages and guild events (joins, leaves, online, offline). /guilded chat off turns it off.")) end
  end)
  return ok
end

-- A tab that was turned on but closed by the player: reopen it once at login, quietly.
local frame = CreateFrame("Frame")
frame:RegisterEvent("PLAYER_LOGIN")
frame:RegisterEvent("CHAT_MSG_SYSTEM")
frame:SetScript("OnEvent", function(_, event, text)
  if event == "CHAT_MSG_SYSTEM" then
    local ok, err = pcall(module.onSystem, text)
    if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "chat tab events: " .. tostring(err)) end
    return
  end
  if module.enabled() and not findFrame() then
    afterCombat("guilded-chat-tab-login", function()
      if module.enabled() and not findFrame() then pcall(module.frame, true) end
    end)
  end
  -- 8.5: on by default. The first time this character has no saved choice, open the tab once the
  -- chat windows exist; /guilded chat off (or the options page) turns it off for good.
  if C_Timer and C_Timer.After then C_Timer.After(6, function() pcall(module.firstRun) end) end
end)
