-- Automatic guild Message of the Day. Off by default. An officer's client (the addon, the
-- right to edit the MOTD, the switch turned on) keeps the in-game MOTD up to date from either
-- a rotation of officer-written lines or the next raid the Discord bot published.
--
--  * One writer: the lowest-named online officer who can edit the MOTD (elected through
--    ns.comm hello messages), so two officers never flip-flop.
--  * Never fights a manual edit: if the MOTD differs from our last write, the automation
--    pauses (for every officer) until an officer chooses Resume.
--  * Never longer than the 128-character limit; fails quietly (status in settings) when the
--    client has no way to set the MOTD.
local addonName, ns = ...
ns = ns or {}
local motd = { peers = {} }
ns.guildMotd = motd

local PREFIX = "GuildedMotd"
local LIMIT = 128
local HELLO_EVERY, PEER_EXPIRE, TICK_EVERY = 60, 150, 30
local HELLO_SETTLE = 10
local MIN_REWRITE = 300     -- seconds between two automatic writes in event mode
local GRACE = 60            -- seconds after our own write while the roster may still show the old text
local DEFAULT_HOURS, MAX_LINES = 24, 12

local function L(text) return ns.L and ns.L(text) or text end
local function now()
  if ns.now then local v = ns.now(); if type(v) == "number" then return v end end
  return GetServerTime and GetServerTime() or time()
end
local function clock() return GetTime and GetTime() or now() end

-- ---------------------------------------------------------------------
-- Saved settings (per guild database, off until an officer turns it on)
-- ---------------------------------------------------------------------

local function config()
  local db = ns.getDb and ns.getDb()
  if type(db) ~= "table" then return nil end
  if type(db.motd) ~= "table" then
    db.motd = { enabled = false, mode = "rotate", hours = DEFAULT_HOURS, lines = {}, suffix = "", index = 0 }
  end
  local cfg = db.motd
  if cfg.mode ~= "event" then cfg.mode = "rotate" end
  if type(cfg.hours) ~= "number" or cfg.hours < 1 then cfg.hours = DEFAULT_HOURS end
  if cfg.hours > 720 then cfg.hours = 720 end
  if type(cfg.lines) ~= "table" then cfg.lines = {} end
  if type(cfg.suffix) ~= "string" then cfg.suffix = "" end
  if type(cfg.index) ~= "number" then cfg.index = 0 end
  return cfg
end
motd.config = config

-- ---------------------------------------------------------------------
-- Text
-- ---------------------------------------------------------------------

-- Cuts text to at most `limit` bytes without splitting a UTF-8 character.
local function cut(text, limit)
  if #text <= limit then return text end
  local stop = limit
  while stop > 0 do
    local byte = string.byte(text, stop + 1)
    if not byte or byte < 128 or byte >= 192 then break end
    stop = stop - 1
  end
  return string.sub(text, 1, stop)
end

-- One line of plain text: no control characters or "|" escape codes, single spaces.
function motd.clean(text)
  text = tostring(text or ""):gsub("|", "/"):gsub("[%c]", " "):gsub("%s+", " ")
  return (text:gsub("^%s+", ""):gsub("%s+$", ""))
end

-- A line plus the optional suffix, never over the limit. The suffix is kept when at least a
-- few characters of the line still fit; otherwise the line wins.
function motd.fit(line, suffix, limit)
  limit = limit or LIMIT
  line, suffix = motd.clean(line), motd.clean(suffix)
  if line == "" then return cut(suffix, limit) end
  if suffix == "" then return cut(line, limit) end
  local joined = line .. " - " .. suffix
  if #joined <= limit then return joined end
  local room = limit - #suffix - 3
  if room >= 12 then return cut(line, room) .. " - " .. suffix end
  return cut(line, limit)
end

function motd.setLines(text)
  local cfg = config()
  if not cfg then return false end
  local lines = {}
  for raw in tostring(text or ""):gmatch("[^\r\n]+") do
    local line = motd.clean(raw)
    if line ~= "" and #lines < MAX_LINES then lines[#lines + 1] = cut(line, LIMIT) end
  end
  cfg.lines = lines
  cfg.index = 0
  cfg.changedAt = nil
  return true
end

function motd.linesText()
  local cfg = config()
  return cfg and table.concat(cfg.lines, "\n") or ""
end

local FULL_DAYS = { "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday" }

-- "Next raid: Hyjal Wednesday 20:00 - sign up on Discord!" (the bot's published raids, in this
-- computer's time zone). Returns nil when no raid is known.
function motd.eventText(raid)
  if type(raid) ~= "table" or type(raid.at) ~= "number" then return nil end
  local parts = date and date("*t", raid.at)
  if type(parts) ~= "table" then return nil end
  local weekday = L(FULL_DAYS[(parts.wday or 1)] or "Sunday")
  local at = string.format(L("%d:%02d"), parts.hour or 0, parts.min or 0)
  return string.format(L("Next raid: %s %s %s - sign up on Discord!"), motd.clean(raid.title or "Raid"), weekday, at)
end

function motd.nextRaid()
  local calendar = ns.calendar
  if not (calendar and calendar.discordRaids) then return nil end
  local ok, raids = pcall(calendar.discordRaids)
  if not ok or type(raids) ~= "table" then return nil end
  return raids[1]
end

-- The text the automation wants right now, and (rotation) the index it came from.
function motd.wanted(cfg, at)
  at = at or now()
  if cfg.mode == "event" then
    local text = motd.eventText(motd.nextRaid())
    if text then return motd.fit(text, cfg.suffix) end
  end
  local count = #cfg.lines
  if count == 0 then return nil end
  local index = cfg.index
  if index < 1 or index > count then index = 1; cfg.changedAt = nil end
  if cfg.changedAt and at - cfg.changedAt >= cfg.hours * 3600 then index = index % count + 1 end
  return motd.fit(cfg.lines[index], cfg.suffix), index
end

-- ---------------------------------------------------------------------
-- Game API (all optional: a client without them just reports it)
-- ---------------------------------------------------------------------

local function canEdit()
  local fn = CanEditMOTD or (C_GuildInfo and C_GuildInfo.CanEditMOTD)
  if type(fn) ~= "function" then return nil end
  local ok, value = pcall(fn)
  if not ok then return nil end
  return value == true
end

local function setter()
  if type(GuildSetMOTD) == "function" then return GuildSetMOTD end
  if C_GuildInfo and type(C_GuildInfo.SetMOTD) == "function" then return C_GuildInfo.SetMOTD end
end

local function current()
  local fn = GetGuildRosterMOTD or (C_GuildInfo and C_GuildInfo.GetMOTD)
  if type(fn) ~= "function" then return nil end
  local ok, value = pcall(fn)
  if ok and type(value) == "string" then return value end
end

local function inCombat() return InCombatLockdown and InCombatLockdown() and true or false end
local function myName() return ns.playerName and ns.playerName() or "?" end

-- ---------------------------------------------------------------------
-- Messages and the election of one writer
-- ---------------------------------------------------------------------

local function send(text)
  if ns.comm then return ns.comm.send(PREFIX, text, "GUILD") end
end

-- Officers that said hello recently and can edit the MOTD, plus this client.
function motd.writer(canWrite)
  local me, best = myName(), nil
  if canWrite then best = me end
  local t = clock()
  for name, peer in pairs(motd.peers) do
    if t - peer.at >= PEER_EXPIRE or t < peer.at then motd.peers[name] = nil
    elseif peer.can and (not best or name < best) then best = name end
  end
  return best
end

function motd.isWriter(canWrite)
  return canWrite and motd.writer(canWrite) == myName()
end

local function hello()
  local cfg = config()
  if not (cfg and cfg.enabled and ns.isOfficer and ns.isOfficer()) then return end
  send("H|" .. (canEdit() and "1" or "0"))
end

function motd.receive(text, sender)
  local cfg = config()
  if not cfg then return end
  sender = ns.normalizeName and ns.normalizeName(sender) or sender
  if sender == myName() then return end
  if ns.isOfficerName and not ns.isOfficerName(sender) then return end
  local kind, rest = tostring(text):match("^(%a)|?(.*)$")
  if kind == "H" then
    motd.peers[sender] = { at = clock(), can = rest == "1" }
  elseif kind == "W" then
    local index, at, written = rest:match("^(%d+)|(%d+)|(.*)$")
    if written then
      cfg.lastWritten, cfg.lastWriteAt = written, clock()
      cfg.index, cfg.changedAt = tonumber(index), tonumber(at)
    end
  elseif kind == "P" then
    cfg.paused = true
  elseif kind == "R" then
    cfg.paused, cfg.lastWritten = false, nil
  end
end

-- ---------------------------------------------------------------------
-- The tick
-- ---------------------------------------------------------------------

local function status(code)
  motd.status = code
  return code
end

-- A manual edit pauses the automation (for everyone) instead of being overwritten.
function motd.checkManualEdit(cfg)
  if not cfg.lastWritten or cfg.paused then return false end
  local text = current()
  if not text then return false end
  if motd.clean(text) == motd.clean(cfg.lastWritten) then return false end
  -- Right after our own write the roster can still show what was there before.
  if cfg.lastWriteAt and clock() - cfg.lastWriteAt < GRACE and motd.clean(text) == motd.clean(cfg.beforeWrite or "") then return false end
  cfg.paused = true
  send("P")
  return true
end

-- Returns a status code: off, noguild, notofficer, noapi, cannot, paused, notwriter, empty,
-- combat, same, written.
function motd.tick(force)
  local cfg = config()
  if not cfg or not cfg.enabled then return status("off") end
  if IsInGuild and not IsInGuild() then return status("noguild") end
  if not (ns.isOfficer and ns.isOfficer()) then return status("notofficer") end
  local set = setter()
  local can = canEdit()
  if not set or can == nil then return status("noapi") end
  if not can then return status("cannot") end
  motd.checkManualEdit(cfg)
  if cfg.paused then return status("paused") end
  -- Say hello first and give the other officers a moment to answer, so two officers who log in
  -- together do not both write.
  if not motd.helloAt then hello(); motd.helloAt = clock() end
  if not force and clock() - motd.helloAt < HELLO_SETTLE then return status("notwriter") end
  if not motd.isWriter(can) then return status("notwriter") end
  local at = now()
  local text, index = motd.wanted(cfg, at)
  if not text or text == "" then return status("empty") end
  if text == cfg.lastWritten and not force then
    return status("same")
  end
  if inCombat() then return status("combat") end
  if not force and cfg.mode == "event" and cfg.lastWriteAt and clock() - cfg.lastWriteAt < MIN_REWRITE then return status("same") end
  local before = current()
  local ok = pcall(set, text)
  if not ok then return status("noapi") end
  cfg.beforeWrite, cfg.lastWritten, cfg.lastWriteAt = before, text, clock()
  if index then
    if index ~= cfg.index or not cfg.changedAt then cfg.changedAt = at end
    cfg.index = index
  end
  send(string.format("W|%d|%d|%s", cfg.index or 0, cfg.changedAt or at, text))
  return status("written")
end

local STATUS_TEXT = {
  off = "Automatic guild message is off.",
  noguild = "You are not in a guild.",
  notofficer = "Only officers can use the automatic guild message.",
  noapi = "This game client cannot change the guild message from an addon, so nothing is written.",
  cannot = "Your guild rank cannot edit the guild message.",
  paused = "Paused: someone edited the guild message by hand. Press Resume to take over again.",
  notwriter = "On. Another officer's game writes the message (the lowest name online).",
  empty = "On, but there is nothing to write yet (add lines, or wait for a raid).",
  combat = "On. Waiting until you leave combat.",
  same = "On. The guild message is up to date.",
  written = "On. The guild message was just updated.",
}
function motd.statusText()
  local code = motd.status or motd.tick()
  return L(STATUS_TEXT[code] or STATUS_TEXT.off)
end

function motd.set(key, value)
  local cfg = config()
  if not cfg then return false end
  if key == "enabled" then
    cfg.enabled = value and true or false
    if cfg.enabled then cfg.paused = false; hello() end
  elseif key == "mode" then
    cfg.mode = value == "event" and "event" or "rotate"
  elseif key == "hours" then
    local hours = tonumber(value)
    if not hours or hours < 1 then return false end
    cfg.hours = math.min(720, math.floor(hours))
  elseif key == "suffix" then
    cfg.suffix = cut(motd.clean(value), 60)
  else return false end
  return true
end

function motd.resume()
  local cfg = config()
  if not cfg then return false end
  cfg.paused, cfg.lastWritten = false, nil
  send("R")
  return true
end

-- ---------------------------------------------------------------------
-- Command: /guilded motd ...
-- ---------------------------------------------------------------------

local HELP = "/guilded motd [on|off | mode rotate|event | hours N | add <line> | clear | suffix <text> | resume | now | config]"
ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers.motd = function(args)
  if not (ns.isOfficer and ns.isOfficer()) then ns.message(L(STATUS_TEXT.notofficer)); return end
  local cfg = config()
  if not cfg then return end
  local action = args[1] and string.lower(args[1])
  if action == "config" or action == "settings" then motd.openSettings(); return end
  if action == "on" or action == "off" then motd.set("enabled", action == "on")
  elseif action == "mode" then motd.set("mode", args[2])
  elseif action == "hours" then
    if not motd.set("hours", args[2]) then ns.message(HELP); return end
  elseif action == "add" then
    local line = motd.clean(table.concat(args, " ", 2))
    if line == "" then ns.message(HELP); return end
    if #cfg.lines >= MAX_LINES then ns.message(L("Too many lines.")); return end
    cfg.lines[#cfg.lines + 1] = cut(line, LIMIT)
  elseif action == "clear" then cfg.lines, cfg.index, cfg.changedAt = {}, 0, nil
  elseif action == "suffix" then motd.set("suffix", table.concat(args, " ", 2))
  elseif action == "resume" then motd.resume()
  elseif action == "now" then motd.tick(true)
  elseif action then ns.message(HELP); return end
  local tick = motd.tick()
  ns.message(string.format(L("Guild message: %s, %s, every %d h, %d line(s)."),
    cfg.enabled and L("on") or L("off"), L(cfg.mode == "event" and "next raid" or "rotation"), cfg.hours, #cfg.lines) .. " " .. L(STATUS_TEXT[tick] or STATUS_TEXT.off))
end

-- ---------------------------------------------------------------------
-- Settings page: a tab of the Guilded window ("Guild message", officers), built by Minimap.lua
-- with its widget helpers. /guilded motd config and Settings > Guild message open that tab.
-- ---------------------------------------------------------------------

local page
function motd.buildPage(parent, ui)
  page = parent
  local at, newLabel, newButton, newEdit = ui.at, ui.newLabel, ui.newButton, ui.newEdit
  local width = ui.width or 520
  local intro = at(newLabel(parent, "Keeps the in-game guild message of the day current from an officer's game. Off by default; a manual edit pauses it.", "GameFontHighlightSmall"), parent, 0, 0)
  intro:SetWidth(width)
  parent.toggle = at(newButton(parent, "Turn on", 150, function()
    local cfg = config(); if cfg then motd.set("enabled", not cfg.enabled); motd.tick(); parent.refresh() end
  end), parent, 0, -44)
  parent.mode = at(newButton(parent, "Mode: rotation", 200, function()
    local cfg = config(); if cfg then motd.set("mode", cfg.mode == "event" and "rotate" or "event"); motd.tick(); parent.refresh() end
  end), parent, 160, -44)
  at(newLabel(parent, "Change every (hours)", "GameFontNormalSmall"), parent, 0, -84)
  parent.hours = at(newEdit(parent, 50, true), parent, 150, -80)
  parent.hours:SetMaxLetters(3)
  at(newLabel(parent, "One line per message (rotation, 128 characters each, up to 12):", "GameFontNormalSmall"), parent, 0, -112)
  local lines = CreateFrame("EditBox", nil, parent, BackdropTemplateMixin and "BackdropTemplate" or nil)
  lines:SetSize(width - 10, 110)
  lines:SetMultiLine(true)
  lines:SetAutoFocus(false)
  lines:SetFontObject(ChatFontNormal or GameFontHighlight)
  lines:SetTextInsets(6, 6, 4, 4)
  if lines.SetBackdrop then
    lines:SetBackdrop({ bgFile = "Interface\\Tooltips\\UI-Tooltip-Background", edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border",
      tile = true, tileSize = 16, edgeSize = 12, insets = { left = 3, right = 3, top = 3, bottom = 3 } })
    lines:SetBackdropColor(0, 0, 0, 0.6)
  end
  lines:SetScript("OnEscapePressed", function(self) self:ClearFocus() end)
  at(lines, parent, 0, -132)
  parent.lines = lines
  local suffixLabel = at(newLabel(parent, "Added at the end of every message (optional, e.g. Link your character: Guilded Companion)", "GameFontNormalSmall"), parent, 0, -254)
  suffixLabel:SetWidth(width)
  parent.suffix = at(newEdit(parent, width - 20), parent, 6, -286)
  parent.suffix:SetMaxLetters(60)
  parent.status = at(newLabel(parent, "", "GameFontHighlightSmall"), parent, 0, -318)
  parent.status:SetWidth(width)
  at(newButton(parent, "Save", 90, function()
    local cfg = config(); if not cfg then return end
    motd.set("hours", parent.hours:GetText())
    motd.setLines(parent.lines:GetText())
    motd.set("suffix", parent.suffix:GetText())
    parent.lines:ClearFocus()
    motd.tick(); parent.refresh()
  end), parent, 0, -362)
  at(newButton(parent, "Update now", 110, function() motd.tick(true); parent.refresh() end), parent, 100, -362)
  at(newButton(parent, "Resume", 90, function() motd.resume(); motd.tick(); parent.refresh() end), parent, 220, -362)
  parent.refresh = function()
    local cfg = config(); if not cfg then return end
    parent.toggle:SetText(L(cfg.enabled and "Turn off" or "Turn on"))
    parent.mode:SetText(L(cfg.mode == "event" and "Mode: next raid" or "Mode: rotation"))
    parent.status:SetText(motd.statusText())
  end
  parent:HookScript("OnShow", function()
    local cfg = config(); if not cfg then return end
    parent.hours:SetText(tostring(cfg.hours))
    parent.lines:SetText(motd.linesText())
    parent.suffix:SetText(cfg.suffix)
    parent.refresh()
  end)
end

function motd.openSettings()
  if not (ns.isOfficer and ns.isOfficer()) then ns.message(L(STATUS_TEXT.notofficer)); return end
  if ns.openToolsPage then ns.openToolsPage("Guild message") end
end

-- ---------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------

local frame = CreateFrame("Frame")
for _, event in ipairs({ "PLAYER_LOGIN", "CHAT_MSG_ADDON", "GUILD_MOTD" }) do
  if ns.compat and ns.compat.registerEvent then ns.compat.registerEvent(frame, event) else pcall(frame.RegisterEvent, frame, event) end
end
frame:SetScript("OnEvent", function(_, event, prefix, text, channel, sender)
  if event == "PLAYER_LOGIN" then
    if ns.comm then ns.comm.register(PREFIX) end
  elseif event == "CHAT_MSG_ADDON" then
    if ns.comm and ns.comm.accept(prefix, text, channel, sender, PREFIX) then motd.receive(text, sender) end
  elseif event == "GUILD_MOTD" then
    local cfg = config()
    if cfg and cfg.enabled then motd.checkManualEdit(cfg) end
  end
end)
local tickElapsed, helloElapsed = 0, 0
frame:SetScript("OnUpdate", function(_, delta)
  tickElapsed, helloElapsed = tickElapsed + delta, helloElapsed + delta
  if tickElapsed < TICK_EVERY then return end
  local cfg = config()
  if not (cfg and cfg.enabled) then tickElapsed = 0; return end
  if helloElapsed >= HELLO_EVERY then helloElapsed = 0; hello() end
  tickElapsed = 0
  pcall(motd.tick)
end)
