-- Automatic guild Message of the Day. Off by default. An officer's client (the addon, the
-- right to edit the MOTD, the switch turned on) keeps the in-game MOTD up to date from either
-- a rotation of officer-written lines or the next raid the Discord bot published.
--
--  * One writer: the lowest-named online officer who can edit the MOTD (elected through
--    ns.comm hello messages), so two officers never flip-flop.
--  * The game does not let an addon set the MOTD (GuildSetMOTD is Blizzard-UI only, and chat box
--    text an addon fills in is tainted). So Guilded is a reminder plus a copy box: the officer
--    copies the ready text, pastes it into Guild > Info > message of the day, and Guilded
--    confirms by reading the MOTD back. Nothing here touches the chat box or any MOTD function.
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
  -- Earlier builds recorded texts they never managed to set; start clean.
  if cfg.schema ~= 3 then cfg.schema, cfg.paused, cfg.confirmed, cfg.intended, cfg.lastWriteAt, cfg.beforeWrite = 3, false, nil, nil, nil, nil end
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
      cfg.confirmed, cfg.lastWriteAt = written, clock()
      cfg.index, cfg.changedAt = tonumber(index), tonumber(at)
    end
  elseif kind == "P" then
    cfg.paused = true
  elseif kind == "R" then
    cfg.paused, cfg.confirmed = false, nil
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
  if not cfg.confirmed or cfg.paused then return false end
  local text = current()
  if not text then return false end
  if motd.clean(text) == motd.clean(cfg.confirmed) then return false end
  -- Right after our own write the roster can still show what was there before.
  if cfg.lastWriteAt and clock() - cfg.lastWriteAt < GRACE and motd.clean(text) == motd.clean(cfg.beforeWrite or "") then return false end
  cfg.paused = true
  send("P")
  return true
end

-- Nothing here sets the MOTD: tick() works out what it should be and, for the elected officer,
-- shows a small "Update guild message" button (and one chat line). The click (motd.apply) opens a
-- copy box with the ready text; the officer pastes it into the guild info frame. A later tick or
-- GUILD_MOTD event reads the MOTD back (motd.confirm) and only then counts it as written.
local prompt
local function hidePrompt()
  if prompt then prompt:Hide() end
end

local function preview(text)
  return cut(text, 60) .. (#text > 60 and "..." or "")
end

local function showPrompt(text)
  if motd.dismissed == text then return end
  if not prompt then
    prompt = CreateFrame("Frame", "GuildedMotdPrompt", UIParent)
    prompt:SetSize(470, 30)
    prompt:SetPoint("TOP", UIParent, "TOP", 0, -140)
    prompt:SetFrameStrata("DIALOG")
    prompt.button = CreateFrame("Button", nil, prompt, "UIPanelButtonTemplate")
    prompt.button:SetSize(436, 26)
    prompt.button:SetPoint("LEFT", prompt, "LEFT", 0, 0)
    prompt.button:SetScript("OnClick", function() motd.apply() end)
    prompt.close = CreateFrame("Button", nil, prompt, "UIPanelButtonTemplate")
    prompt.close:SetSize(26, 26)
    prompt.close:SetPoint("LEFT", prompt.button, "RIGHT", 4, 0)
    prompt.close:SetText("x")
    prompt.close:SetScript("OnClick", function() motd.dismissed = motd.pending and motd.pending.text; prompt:Hide() end)
  end
  prompt.button:SetText(string.format(L("Update guild message: %s"), preview(text)))
  prompt:Show()
  if motd.announced ~= text then
    motd.announced = text
    if ns.message then ns.message(string.format(L("Guild message ready: click the Update guild message button to copy it (%s)."), preview(text))) end
  end
end

local function status(code)
  motd.status = code
  if code ~= "due" then motd.pending = nil; hidePrompt() end
  return code
end

local popup
local function hidePopup()
  if popup then popup:Hide() end
end

-- A small window with the ready text in a read-only box, highlighted and focused for Ctrl+C.
local function showPopup(text)
  if not popup then
    popup = CreateFrame("Frame", "GuildedMotdCopy", UIParent, BackdropTemplateMixin and "BackdropTemplate" or nil)
    popup:SetSize(480, 190)
    popup:SetPoint("CENTER", UIParent, "CENTER", 0, 120)
    popup:SetFrameStrata("DIALOG")
    if UISpecialFrames then table.insert(UISpecialFrames, "GuildedMotdCopy") end
    popup:SetMovable(true)
    popup:EnableMouse(true)
    popup:RegisterForDrag("LeftButton")
    popup:SetScript("OnDragStart", popup.StartMoving)
    popup:SetScript("OnDragStop", popup.StopMovingOrSizing)
    if popup.SetBackdrop then
      popup:SetBackdrop({ bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background", edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border",
        tile = true, tileSize = 32, edgeSize = 32, insets = { left = 8, right = 8, top = 8, bottom = 8 } })
    end
    local title = popup:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
    title:SetPoint("TOPLEFT", popup, "TOPLEFT", 20, -18)
    title:SetText(L("Guild message ready to copy"))
    popup.hint = popup:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    popup.hint:SetPoint("TOPLEFT", popup, "TOPLEFT", 20, -46)
    popup.hint:SetWidth(440)
    popup.hint:SetJustifyH("LEFT")
    popup.hint:SetText(L("Ctrl+C to copy, then open Guild (J) > Info, click the message of the day, paste it (Ctrl+V) and Accept. Or type /gmotd and paste. WoW does not let addons set the message of the day."))
    popup.box = CreateFrame("EditBox", nil, popup, BackdropTemplateMixin and "BackdropTemplate" or nil)
    popup.box:SetSize(440, 56)
    popup.box:SetPoint("TOPLEFT", popup, "TOPLEFT", 20, -92)
    popup.box:SetMultiLine(true)
    popup.box:SetAutoFocus(false)
    popup.box:SetFontObject(ChatFontNormal or GameFontHighlight)
    popup.box:SetTextInsets(6, 6, 4, 4)
    if popup.box.SetBackdrop then
      popup.box:SetBackdrop({ bgFile = "Interface\\Tooltips\\UI-Tooltip-Background", edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border",
        tile = true, tileSize = 16, edgeSize = 12, insets = { left = 3, right = 3, top = 3, bottom = 3 } })
      popup.box:SetBackdropColor(0, 0, 0, 0.6)
    end
    -- Read-only: whatever is typed or pasted, the ready text comes back.
    popup.box:SetScript("OnTextChanged", function(self)
      if popup.text and self:GetText() ~= popup.text then self:SetText(popup.text); self:HighlightText() end
    end)
    popup.box:SetScript("OnEscapePressed", function() popup:Hide() end)
    local close = CreateFrame("Button", nil, popup, "UIPanelButtonTemplate")
    close:SetSize(90, 22)
    close:SetPoint("BOTTOMRIGHT", popup, "BOTTOMRIGHT", -20, 16)
    close:SetText(L("Close"))
    close:SetScript("OnClick", function() popup:Hide() end)
  end
  popup.text = text
  popup.box:SetText(text)
  popup:Show()
  popup.box:SetFocus()
  popup.box:HighlightText()
end

-- The MOTD read back equals what the officer was asked to apply: now (and only now) it is written.
function motd.confirm(cfg)
  local intended = cfg.intended
  if not intended then return false end
  local text = current()
  if not text or motd.clean(text) ~= motd.clean(intended.text) then return false end
  local at = now()
  cfg.confirmed, cfg.lastWriteAt, cfg.intended = intended.text, clock(), nil
  cfg.paused = false
  if intended.index then
    if intended.index ~= cfg.index or not cfg.changedAt then cfg.changedAt = at end
    cfg.index = intended.index
  end
  motd.dismissed = nil
  hidePopup(); hidePrompt()
  send(string.format("W|%d|%d|%s", cfg.index or 0, cfg.changedAt or at, intended.text))
  return true
end

-- Returns a status code: off, noguild, notofficer, noapi, cannot, paused, waiting, notwriter,
-- empty, same, due, written. Never writes.
function motd.tick()
  local cfg = config()
  if not cfg or not cfg.enabled then return status("off") end
  if IsInGuild and not IsInGuild() then return status("noguild") end
  if not (ns.isOfficer and ns.isOfficer()) then return status("notofficer") end
  local can = canEdit()
  if can == nil then return status("noapi") end
  if not can then return status("cannot") end
  if motd.confirm(cfg) then return status("written") end
  motd.checkManualEdit(cfg)
  if cfg.paused then return status("paused") end
  -- Say hello first and give the other officers a moment to answer, so two officers who log in
  -- together do not both prompt.
  if not motd.helloAt then hello(); motd.helloAt = clock() end
  if clock() - motd.helloAt < HELLO_SETTLE then return status("waiting") end
  if not motd.isWriter(can) then return status("notwriter") end
  local text = motd.wanted(cfg, now())
  if not text or text == "" then return status("empty") end
  if text == cfg.confirmed then return status("same") end
  if cfg.intended and cfg.intended.text == text then motd.pending = { text = text }; motd.status = "ready"; return "ready" end
  motd.pending = { text = text }
  showPrompt(text)
  return status("due")
end

-- Opens the copy box with the ready text (call it from a click). Returns "ready".
function motd.apply()
  local cfg = config()
  if not cfg then return "off" end
  local can = canEdit()
  if can == nil then return status("noapi") end
  if not can then return status("cannot") end
  local text, index = motd.wanted(cfg, now())
  if not text or text == "" then return status("empty") end
  cfg.intended = { text = text, index = index }
  showPopup(text)
  motd.pending = { text = text }
  motd.status = "ready"
  return "ready"
end

local STATUS_TEXT = {
  off = "Automatic guild message is off.",
  noguild = "You are not in a guild.",
  notofficer = "Only officers can use the automatic guild message.",
  noapi = "This game client does not say whether you can edit the guild message, so nothing is offered.",
  cannot = "Your guild rank cannot edit the guild message.",
  paused = "Paused: someone edited the guild message by hand. Press Resume to take over again.",
  waiting = "On. Checking for other officers online...",
  notwriter = "On. Another officer's game offers the update (the lowest name online).",
  due = "A new guild message is ready. Click the Update guild message button to copy it (WoW does not let addons set the message of the day).",
  ready = "Ready: copy the text, then paste it in Guild (J) > Info > message of the day.",
  empty = "On, but there is nothing to write yet (add lines, or wait for a raid).",
  same = "On. The guild message is up to date.",
  written = "On. The guild message was updated (confirmed).",
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
  cfg.paused, cfg.confirmed = false, nil
  send("R")
  return true
end

-- ---------------------------------------------------------------------
-- Command: /guilded motd ...
-- ---------------------------------------------------------------------

local HELP = "/guilded motd [on|off | mode rotate|event | hours N | add <line> | clear | suffix <text> | resume | config]"
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
  local intro = at(newLabel(parent, "A reminder plus a copy box for the guild message of the day: WoW does not let addons set it, so you paste the ready text yourself and Guilded confirms it. Off by default; a manual edit pauses it.", "GameFontHighlightSmall"), parent, 0, 0)
  intro:SetWidth(width)
  parent.toggle = at(newButton(parent, "Turn on", 130, function()
    local cfg = config(); if cfg then motd.set("enabled", not cfg.enabled); motd.tick(); parent.refresh() end
  end), parent, 0, -44)
  parent.mode = at(newButton(parent, "Mode: rotation", 170, function()
    local cfg = config(); if cfg then motd.set("mode", cfg.mode == "event" and "rotate" or "event"); motd.tick(); parent.refresh() end
  end), parent, 138, -44)
  at(newButton(parent, "Save", 80, function()
    local cfg = config(); if not cfg then return end
    motd.set("hours", parent.hours:GetText())
    motd.setLines(parent.lines:GetText())
    motd.set("suffix", parent.suffix:GetText())
    parent.lines:ClearFocus()
    motd.tick(); parent.refresh()
  end), parent, 0, -74)
  -- A click opens the copy box with the ready text.
  at(newButton(parent, "Update now", 110, function() motd.apply(); parent.refresh() end), parent, 88, -74)
  at(newButton(parent, "Resume", 90, function() motd.resume(); motd.tick(); parent.refresh() end), parent, 206, -74)
  parent.status = at(newLabel(parent, "", "GameFontHighlightSmall"), parent, 0, -106)
  parent.status:SetWidth(width)
  at(newLabel(parent, "Change every (hours)", "GameFontNormalSmall"), parent, 0, -140)
  parent.hours = at(newEdit(parent, 50, true), parent, 150, -136)
  parent.hours:SetMaxLetters(3)
  at(newLabel(parent, "One line per message (rotation, 128 characters each, up to 12):", "GameFontNormalSmall"), parent, 0, -166)
  local lines = CreateFrame("EditBox", nil, parent, BackdropTemplateMixin and "BackdropTemplate" or nil)
  lines:SetSize(width - 10, 80)
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
  at(lines, parent, 0, -184)
  parent.lines = lines
  local suffixLabel = at(newLabel(parent, "Added at the end of every message (optional, e.g. Link your character: Guilded Companion)", "GameFontNormalSmall"), parent, 0, -272)
  suffixLabel:SetWidth(width)
  parent.suffix = at(newEdit(parent, width - 20), parent, 6, -302)
  parent.suffix:SetMaxLetters(60)
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
    if cfg and cfg.enabled then motd.confirm(cfg); motd.checkManualEdit(cfg) end
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
