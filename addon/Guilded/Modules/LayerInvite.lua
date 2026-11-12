-- Layer invite (9.2): helps a member who wants to get onto a guildmate's layer. It replaces levelling partners.
--
--   /guilded layer                 ask for a layer invite (also the Layer invite page in the Guild tab)
--   /guilded layer list            open requests from guildmates, with the line to invite them
--   /guilded layer cancel          close my own request
--   /guilded layer helper on|off   whether guildmates' requests show a small window to me
--
-- The addon cannot read which layer anyone is on. A request goes out ONCE on the guild addon channel (prefix
-- GuildedLayer) with the asker's continent; only guildmates who run the addon AND are on the same continent are
-- candidates, and each of them is shown a request only once (a repeat of the same request is ignored).
-- A helper's small window (a plain frame: no secure template, never takes the keyboard) offers Invite: the invite
-- API is refused to addon code on WoW Forever, so Invite shows "/invite First Last" in the copy box
-- (ns.util.inviteButton) and the helper pastes it. The first helper who accepts sends CLAIM, which closes the
-- request for everyone else; the asker sends DONE once they joined the group. Nothing is shown in combat beyond one
-- chat line, and every addon message goes through ns.comm (the global budget; GuildedLayer is a low-value lane).
-- Saved data: db.layer = { helper = true|false|nil, lastAskAt = seconds }. Levelling partners kept no data.
local addonName, ns = ...
ns = ns or {}

local PREFIX = "GuildedLayer"
local REQUEST_SECONDS = 300      -- a request is open this long
local CLAIM_SECONDS = 60         -- a helper has this long to get the asker into the group
local ASK_EVERY_SECONDS = 120    -- one request per asker per two minutes
local TOAST_SECONDS = 30
local MAX_ROWS = 5

local module = {}
ns.layerInvite = module

local function L(text) return ns.L and ns.L(text) or text end
local function say(text) if ns.message then ns.message(text) end end
local function secret(value) return ns.isSecret and ns.isSecret(value) end
local function bare(name) return ns.util and ns.util.bareName and ns.util.bareName(name) or name end
local function display(name) return ns.displayName and ns.displayName(name) or name end
local function combat() return ns.util and ns.util.inCombat and ns.util.inCombat() or false end
local function nowSeconds() return ns.util and ns.util.serverTime and ns.util.serverTime() or time() end
local function myName() return bare(ns.playerName and ns.playerName() or (UnitName and UnitName("player")) or "?") end
local function same(a, b) return a ~= nil and b ~= nil and bare(a) == bare(b) end

local function data()
  local db = ns.getDb and ns.getDb()
  if not db then return { } end
  db.layer = type(db.layer) == "table" and db.layer or {}
  return db.layer
end

-- The continent id of the map the player stands in (nil when the client cannot say).
function module.continent()
  if not (C_Map and C_Map.GetBestMapForUnit and C_Map.GetMapInfo) then return nil end
  local ok, id = pcall(C_Map.GetBestMapForUnit, "player")
  if not ok or type(id) ~= "number" or secret(id) then return nil end
  for _ = 1, 12 do
    local okInfo, info = pcall(C_Map.GetMapInfo, id)
    if not okInfo or type(info) ~= "table" then return nil end
    if info.mapType == 2 then return id end
    if type(info.parentMapID) ~= "number" or info.parentMapID <= 0 then return nil end
    id = info.parentMapID
  end
  return nil
end

local function zoneName()
  local zone = GetRealZoneText and GetRealZoneText() or (GetZoneText and GetZoneText()) or ""
  if secret(zone) or type(zone) ~= "string" then return "" end
  return (zone:gsub("[|%c]", ""))
end

local function inInstance()
  local ok, inside = pcall(function() return IsInInstance and IsInInstance() end)
  return ok and inside and true or false
end

local function inGroup() return IsInGroup and IsInGroup() and true or false end

-- A helper who is in a raid, a full party or an instance gets no window.
local function canHelp()
  if inInstance() then return false end
  if IsInRaid and IsInRaid() then return false end
  local size = GetNumGroupMembers and GetNumGroupMembers() or 0
  return not (type(size) == "number" and size >= 5)
end

-- ---------------------------------------------------------------------
-- State
-- ---------------------------------------------------------------------

local mine                -- my own open request: { id, at, claimedBy, claimedAt }
local requests = {}       -- guildmates' requests: [key] = { key, id, name, zone, at, state = "open"|"claimed"|"closed" }
local seen = {}           -- request keys already received: a helper is asked once per request
local order = {}          -- keys in arrival order
local counter = 0
local toast, current, waiting = nil, nil, {}
local rows = {}

local function send(text)
  if not (IsInGuild and IsInGuild()) then return false end
  return ns.comm.send(PREFIX, text, "GUILD", nil, function() return not combat() end) and true or false
end

local function keyOf(sender, id) return bare(sender) .. ":" .. id end

local function openRequests()
  local list = {}
  for _, key in ipairs(order) do
    local r = requests[key]
    if r and r.state == "open" then list[#list + 1] = r end
  end
  return list
end

-- ---------------------------------------------------------------------
-- The helper's window
-- ---------------------------------------------------------------------

local function closeToast()
  if toast then toast:Hide(); toast.isOpen = false end
  current = nil
end

local presentNext

local function ensureToast()
  if toast then return toast end
  toast = CreateFrame("Frame", "GuildedLayerToast", UIParent, BackdropTemplateMixin and "BackdropTemplate" or nil)
  toast:SetWidth(290)
  toast:SetHeight(84)
  toast:SetPoint("TOPRIGHT", UIParent, "TOPRIGHT", -24, -220)
  if toast.SetFrameStrata then toast:SetFrameStrata("MEDIUM") end
  if toast.SetClampedToScreen then toast:SetClampedToScreen(true) end
  if toast.SetBackdrop then
    pcall(toast.SetBackdrop, toast, { bgFile = "Interface\\Tooltips\\UI-Tooltip-Background", edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border",
      tile = true, tileSize = 16, edgeSize = 12, insets = { left = 3, right = 3, top = 3, bottom = 3 } })
    if toast.SetBackdropColor then pcall(toast.SetBackdropColor, toast, 0.05, 0.05, 0.07, 0.95) end
  end
  toast.isOpen = false
  toast.title = toast:CreateFontString(nil, "OVERLAY", "GameFontNormal")
  toast.title:SetPoint("TOPLEFT", toast, "TOPLEFT", 10, -10)
  toast.title:SetWidth(240)
  toast.detail = toast:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  toast.detail:SetPoint("TOPLEFT", toast.title, "BOTTOMLEFT", 0, -4)
  toast.detail:SetWidth(270)
  local function button(label, width, onClick)
    local b = CreateFrame("Button", nil, toast, "UIPanelButtonTemplate")
    b:SetWidth(width); b:SetHeight(22)
    if b.SetText then b:SetText(label) end
    b:SetScript("OnClick", onClick)
    return b
  end
  toast.invite = ns.util.inviteButton(toast, "party", L("Invite"), 80, 22, function() if current then module.claim(current) end end)
  toast.invite:SetPoint("BOTTOMLEFT", toast, "BOTTOMLEFT", 10, 8)
  toast.later = button(L("Not now"), 80, function() local r = current; closeToast(); if r then r.shown = true end; presentNext() end)
  toast.later:SetPoint("LEFT", toast.invite, "RIGHT", 4, 0)
  toast.yes = button(L("Yes"), 60, function()
    data().helper = true
    local r = current
    closeToast()
    if r then module.show(r) end
  end)
  toast.yes:SetPoint("BOTTOMLEFT", toast, "BOTTOMLEFT", 10, 8)
  toast.no = button(L("No"), 60, function() data().helper = false; closeToast(); waiting = {} end)
  toast.no:SetPoint("LEFT", toast.yes, "RIGHT", 4, 0)
  local x = CreateFrame("Button", nil, toast, "UIPanelCloseButton")
  x:SetPoint("TOPRIGHT", toast, "TOPRIGHT", 2, 2)
  x:SetScript("OnClick", function() closeToast(); presentNext() end)
  toast:Hide()
  return toast
end

-- Shows one request (the first time a guildmate asks, it asks the helper once whether to help at all).
function module.show(request)
  ensureToast()
  current = request
  toast.shownAt = nowSeconds()
  toast.isOpen = true
  local helper = data().helper
  toast.mode = helper == nil and "ask" or "request"
  if helper == nil then
    toast.title:SetText(L("Help guildmates change layer?"))
    toast.detail:SetText(string.format(L("%s wants another layer"), display(request.name)))
    toast.yes:Show(); toast.no:Show(); toast.invite:Hide(); toast.later:Hide()
  else
    toast.title:SetText(string.format(L("%s wants another layer"), display(request.name)))
    toast.detail:SetText(request.zone ~= "" and request.zone or " ")
    toast.invite.setInvite(request.name)
    toast.invite:Show(); toast.later:Show(); toast.yes:Hide(); toast.no:Hide()
  end
  toast:Show()
end

presentNext = function()
  if current or combat() then return end
  while #waiting > 0 do
    local request = table.remove(waiting, 1)
    if request.state == "open" and not request.shown then module.show(request); return end
  end
end

-- ---------------------------------------------------------------------
-- Asking, answering
-- ---------------------------------------------------------------------

-- The asker's side. Returns true when a request went out.
function module.ask()
  if not (IsInGuild and IsInGuild()) then say(L("Join a guild to ask for a layer invite.")); return false end
  if combat() or inGroup() or inInstance() then
    say(L("You can ask for a layer invite only outside combat, instances and groups."))
    return false
  end
  local t = nowSeconds()
  local last = tonumber(data().lastAskAt) or 0
  if t - last < ASK_EVERY_SECONDS then
    say(string.format(L("You can ask again in %d seconds."), ASK_EVERY_SECONDS - (t - last)))
    return false
  end
  local continent = module.continent()
  if not continent then say(L("Guilded could not read your continent.")); return false end
  counter = counter + 1
  local id = string.format("%d%d", t % 100000, counter % 10)
  if not send(string.format("REQ|%s|%d|%s", id, continent, zoneName())) then return false end
  data().lastAskAt = t
  mine = { id = id, at = t }
  say(L("Asked guildmates on your continent. You will be told when someone offers to invite you."))
  return true
end

function module.cancel()
  if not mine then return false end
  send("DONE|" .. mine.id)
  mine = nil
  return true
end

-- The helper's click on Invite: the line was already shown; tell everyone else the request is taken.
function module.claim(request)
  if not request or request.state ~= "open" then return false end
  request.state = "claimed"
  send(string.format("CLAIM|%s|%s", bare(request.name), request.id))
  closeToast()
  presentNext()
  return true
end

local function chatLine(request)
  say(string.format(L("%s wants another layer (%s). Open Guilded, Guild, Layer invite after combat."), display(request.name), request.zone))
end

local function receiveRequest(sender, parts)
  local id, continent, zone = parts[2], tonumber(parts[3]), parts[4] or ""
  if not id or id == "" or #id > 12 or not continent then return end
  if same(sender, myName()) then return end                  -- my own message coming back
  local key = keyOf(sender, id)
  if seen[key] then return end                                -- asked once, never again
  seen[key] = true
  local here = module.continent()
  if not here or here ~= continent then return end            -- not a candidate: another continent
  local request = { key = key, id = id, name = bare(sender), zone = zone:gsub("[|%c]", ""), at = nowSeconds(), state = "open" }
  requests[key] = request
  order[#order + 1] = key
  while #order > 20 do requests[table.remove(order, 1)] = nil end
  if data().helper == false or not canHelp() then return end
  if combat() then chatLine(request); return end
  if current then waiting[#waiting + 1] = request else module.show(request) end
end

local function receiveClaim(sender, parts)
  local requester, id = parts[2], parts[3]
  if not requester or not id then return end
  local request = requests[keyOf(requester, id)]
  if request then
    request.state = "claimed"
    if current == request then closeToast(); presentNext() end
  end
  if mine and mine.id == id and same(requester, myName()) and not mine.claimedBy then
    mine.claimedBy, mine.claimedAt = bare(sender), nowSeconds()
    say(string.format(L("%s will invite you. Accept the invite, then type /leave once the zone has reloaded."), display(sender)))
  end
end

local function receiveDone(sender, parts)
  local request = requests[keyOf(sender, parts[2] or "")]
  if request then
    request.state = "closed"
    if current == request then closeToast(); presentNext() end
  end
end

function module.receive(text, sender)
  if type(text) ~= "string" or type(sender) ~= "string" then return end
  local parts = {}
  for field in string.gmatch(text .. "|", "([^|]*)|") do parts[#parts + 1] = field end
  local kind = parts[1]
  if kind == "REQ" then receiveRequest(sender, parts)
  elseif kind == "CLAIM" then receiveClaim(sender, parts)
  elseif kind == "DONE" then receiveDone(sender, parts) end
end

-- Seconds tick: requests and claims run out; the asker is told when they are in the helper's group.
local function tick()
  local t = nowSeconds()
  if mine then
    if mine.claimedBy and inGroup() then
      say(string.format(L("You are in %s's group. When the zone has reloaded, type /leave."), display(mine.claimedBy)))
      send("DONE|" .. mine.id)
      mine = nil
    elseif mine.claimedBy and t - mine.claimedAt > CLAIM_SECONDS then
      say(string.format(L("%s did not invite you in time. You can ask again."), display(mine.claimedBy)))
      send("DONE|" .. mine.id)
      mine = nil
    elseif t - mine.at > REQUEST_SECONDS then
      say(L("Your layer request expired."))
      send("DONE|" .. mine.id)
      mine = nil
    end
  end
  for _, key in ipairs(order) do
    local r = requests[key]
    if r and r.state == "open" and t - r.at > REQUEST_SECONDS then
      r.state = "closed"
      if current == r then closeToast(); presentNext() end
    end
  end
  if toast and toast.isOpen and toast.shownAt and t - toast.shownAt > TOAST_SECONDS then closeToast(); presentNext() end
end
module.tick = tick

-- ---------------------------------------------------------------------
-- The Layer invite page (Guild tab) and the commands
-- ---------------------------------------------------------------------

function module.openRequests() return openRequests() end
function module.myRequest() return mine end

function module.buildPage(page, helpers)
  local newLabel, newButton, at = helpers.newLabel, helpers.newButton, helpers.at
  local width = helpers.width or 560
  local intro = at(newLabel(page, "Ask guildmates on your continent to invite you into their group. Accepting a party invite from someone on another layer moves you to that layer; then leave the group.", "GameFontHighlightSmall"), page, 0, 0)
  intro:SetWidth(width - 8)
  at(newButton(page, "Change layer", 150, function() module.ask(); module.refreshPage() end), page, 0, -50)
  local status = at(newLabel(page, "", "GameFontHighlightSmall"), page, 160, -54)
  status:SetWidth(width - 168)
  at(newLabel(page, "Open requests", "GameFontNormal"), page, 0, -92)
  local empty = at(newLabel(page, "No open requests.", "GameFontHighlightSmall"), page, 0, -118)
  for i = 1, MAX_ROWS do
    local row = {}
    row.label = at(newLabel(page, "", "GameFontHighlight"), page, 0, -116 - (i - 1) * 28)
    row.label:SetWidth(width - 110)
    row.invite = ns.util.inviteButton(page, "party", L("Invite"), 80, 22, function() if row.request then module.claim(row.request); module.refreshPage() end end)
    row.invite:SetPoint("TOPLEFT", page, "TOPLEFT", width - 96, -112 - (i - 1) * 28)
    rows[i] = row
  end
  function module.refreshPage()
    if mine then
      status:SetText(mine.claimedBy and string.format(L("%s will invite you."), display(mine.claimedBy)) or L("Waiting for a guildmate to offer..."))
    else
      status:SetText("")
    end
    local list = openRequests()
    for i = 1, MAX_ROWS do
      local row, request = rows[i], list[i]
      row.request = request
      if request then
        row.label:SetText(string.format("%s %s", display(request.name), request.zone ~= "" and ("(" .. request.zone .. ")") or ""))
        row.invite.setInvite(request.name)
        row.label:Show(); row.invite:Show()
      else
        row.label:Hide(); row.invite:Hide()
      end
    end
    if #list == 0 then empty:Show() else empty:Hide() end
  end
  local elapsed = 0
  page:SetScript("OnShow", function() module.refreshPage() end)
  page:SetScript("OnUpdate", function(_, dt)
    elapsed = elapsed + (dt or 0)
    if elapsed >= 2 then elapsed = 0; if page:IsShown() then module.refreshPage() end end
  end)
  module.refreshPage()
end

function module.refreshPage() end

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["layer"] = function(args)
  local what = string.lower(args and args[2] or "")
  if what == "list" then
    local list = openRequests()
    if #list == 0 then say(L("No open requests.")) return end
    for _, request in ipairs(list) do say(string.format("%s (%s): /invite %s", display(request.name), request.zone, request.name)) end
  elseif what == "cancel" then
    if not module.cancel() then say(L("You have no open layer request.")) end
  elseif what == "helper" then
    local value = string.lower(args[3] or "")
    if value == "on" or value == "off" then
      data().helper = value == "on"
      say(value == "on" and L("You will see guildmates' layer requests.") or L("You will not see guildmates' layer requests."))
    else
      say(L("/guilded layer helper on|off"))
    end
  else
    module.ask()
  end
end
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded layer [list | cancel | helper on|off] - ask guildmates on your continent for a layer invite")

-- ---------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------

local frame = CreateFrame("Frame")
local function register(event)
  if ns.compat and ns.compat.registerEvent then ns.compat.registerEvent(frame, event, true)
  else pcall(frame.RegisterEvent, frame, event) end
end
register("PLAYER_LOGIN")
register("CHAT_MSG_ADDON")
register("GROUP_ROSTER_UPDATE")
register("PLAYER_REGEN_ENABLED")
local since = 0
frame:SetScript("OnEvent", function(_, event, ...)
  local args = { ... }
  local ok, err = pcall(function()
    if event == "PLAYER_LOGIN" then
      ns.comm.register(PREFIX)
      frame:SetScript("OnUpdate", function(_, dt)
        since = since + (dt or 0)
        if since >= 1 then since = 0; tick() end
      end)
    elseif event == "CHAT_MSG_ADDON" then
      local prefix, text, channel, sender = args[1], args[2], args[3], args[4]
      if secret(prefix) or prefix ~= PREFIX then return end
      local authorize = function(name) return ns.isGuildMember and ns.isGuildMember(name) == true end
      if not ns.comm.accept(prefix, text, channel, sender, PREFIX, authorize) then return end
      module.receive(text, sender)
    elseif event == "PLAYER_REGEN_ENABLED" then
      presentNext()
    elseif event == "GROUP_ROSTER_UPDATE" then
      if mine and mine.claimedBy then tick() end
    end
  end)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "layer invite: " .. tostring(err)) end
end)
