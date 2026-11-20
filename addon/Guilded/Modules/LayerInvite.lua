-- Layer invite (9.2): helps a member who wants to get onto a guildmate's layer. It replaces levelling partners.
--
--   /guilded layer                 ask for a layer invite (also the Layer page in the sidebar)
--   /guilded layer list            open requests from guildmates, with the line to invite them
--   /guilded layer cancel          close my own request
--   /guilded layer helper on|off   alias of "Help guildmates" (9.5, one switch with /guilded sos guildmates on|off): whether
--                                  guildmates' requests and calls for help show the small "Guild calls" window to me
--   /guilded layer auto on|off     (9.4, opt-in, off by default) a request on my continent is invited at once, with no
--                                  click (alone or as party leader, out of combat and instances); a short notice says so
--   /guilded layer direct on|off   (9.4) party Invite buttons invite directly (on by default); off shows the line to paste
--
-- The addon cannot read which layer anyone is on. A request goes out ONCE on the guild addon channel (prefix
-- GuildedLayer) with the asker's continent; only guildmates who run the addon AND are on the same continent are
-- candidates, and each of them is shown a request only once (a repeat of the same request is ignored).
-- A helper's small window (a plain frame: no secure template, never takes the keyboard) offers Invite, which sends the
-- party invite directly (ns.util.partyInvite: a party invite is not a protected call; see Util.lua for the evidence).
-- If the game refuses it, the refusal is remembered for the client build and Invite shows "/invite First Last" in the
-- copy box instead. With auto-invite on, the request is invited when it arrives and a short notice replaces the window.
-- The first helper who invites sends CLAIM, which closes the request for everyone else; the asker sends DONE once they
-- joined the group. Nothing is shown in combat beyond one chat line, and every addon message goes through ns.comm (the
-- global budget; GuildedLayer is a low-value lane).
--
-- (9.5) One window. The helper's request is a section INSIDE CallForHelp's "Guild calls" window (a child frame, no window of
-- its own); only when CallForHelp is missing (tests) does it build its own small frame as before. The first-time "help at
-- all?" question is gone: Help guildmates is on by default.
--
-- (9.5) Join the caller's layer. When a Defender presses On my way, CallForHelp calls module.askJoin: a JOIN request goes
-- out for that call (kind JOIN, below). Joining a group moves the JOINER to the inviter's layer, and only once the joiner is
-- out of combat; the ganked caller is in combat, so the caller must not be the one who moves. So the request is for an
-- invite to the CALLER's group:
--   (a) if the caller is in a group led by another guildmate who runs the addon, that leader's addon invites (the leader is
--       on the caller's layer);
--   (b) otherwise the caller's own addon invites at the first moment it is out of combat (PLAYER_REGEN_ENABLED, and on every
--       new request), alone or as party leader, outside instances, one at a time (JOIN_PACE seconds apart), with no click.
-- This applies to the responders of the caller's OWN open call only (JOIN carries the call id; the caller checks it is its
-- own, a leader checks it heard that call), so no opt-in is needed. CLAIM/DONE close it for others. A full party (5)
-- shows the leader a small "Convert to raid" button (a click, never automatic) and tells the defender once (FULL).
-- After the all clear (CallForHelp) a "Leave group" button does LeaveParty on its click only.
--
-- Messages (prefix GuildedLayer; fields are "|" separated; older addons ignore the kinds they do not know):
--   REQ|id|continent|zone                 a plain layer request (unchanged since 9.2)
--   CLAIM|requester|id|continent          someone invites the requester (unchanged)
--   DONE|id                               the requester is in the group / gave up (unchanged)
--   JOIN|id|continent|callId|target       (9.5) a defender asks for an invite to `target`'s group for call `callId`
--   FULL|requester|id|continent           (9.5) the inviter's party is full (sent once per JOIN)
-- Saved data: db.layer = { helper = true|false|nil, auto = true|nil, lastAskAt = seconds, groupRefused = { leave|convert = build } }.
-- Levelling partners kept no data.
local addonName, ns = ...
ns = ns or {}

local PREFIX = "GuildedLayer"
local REQUEST_SECONDS = 300      -- a request is open this long
local CLAIM_SECONDS = 60         -- a helper has this long to get the asker into the group
local ASK_EVERY_SECONDS = 120    -- one request per asker per two minutes
local TOAST_SECONDS = 30
local NOTICE_SECONDS = 8        -- the "Invited X to your layer" notice
local MAX_ROWS = 5
local MAX_SEEN = 100         -- request keys remembered (oldest out)
local MAX_WAITING = 5        -- requests queued behind the open window (oldest out)
local MAX_SENDERS = 60       -- senders remembered for the per-sender pause
local JOIN_SECONDS = 120     -- a JOIN is open this long
local JOIN_PACE = 10         -- one invite for a call's responders at a time, this many seconds apart
local MAX_JOINS = 5          -- JOINs queued at the caller (oldest out)
local JOIN_NOTICE_SECONDS = 12

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

-- The opt-in: requests from my continent pop up at once (off by default).
function module.autoInvite() return data().auto == true end

local function callHelp() return ns.callForHelp end

-- Help guildmates (9.5) is CallForHelp's one switch (it replaces Defender and Layer helper); alone, db.layer.helper.
function module.helper()
  local c = callHelp()
  if c and c.helpGuildmates then return c.helpGuildmates() end
  return data().helper ~= false
end
function module.setHelper(on)
  local c = callHelp()
  if c and c.setHelpGuildmates and c.setHelpGuildmates(on) then return end
  data().helper = on and true or false
  if not on then data().auto = nil end
end
function module.setAutoInvite(on)
  data().auto = on and true or nil
  if on then module.setHelper(true) end      -- auto-invite means "show me the requests"
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
local seen, seenOrder = {}, {}   -- request keys already received: a helper is asked once per request
local lastFrom = {}          -- sender -> time of their last accepted request (receiver-side pause)
local order = {}          -- keys in arrival order
local counter = 0
local joins, joinList = {}, {}     -- JOINs addressed to me or to my group (key -> join), in arrival order
local joinBusyUntil = 0
local myJoin                    -- the JOIN I sent as a responder: { id, target, callId, continent, at, sent, claimedBy }
local attempt                   -- the last Leave group / Convert to raid click: { what, at }
local toast, current, waiting = nil, nil, {}
local autoBusyUntil = 0     -- one automatic invite at a time: the next waits until the first had time to join and leave
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
  if toast then
    toast:Hide(); toast.isOpen = false
    if toast.hosted and callHelp() and callHelp().refreshWindow then callHelp().refreshWindow() end
  end
  current = nil
end

local presentNext

-- Hangs below the call-for-help toast's footprint (its toast and offer box), so both can be open at once.
function module.placeToast()
  if not toast then return end
  -- Hosted: CallForHelp's window lays its sections out (this one hangs under the call).
  if toast.hosted then
    local c = callHelp()
    if c and c.refreshWindow then c.refreshWindow() end
    return
  end
  toast:ClearAllPoints()
  -- Opted in to auto-invite: top centre, where it cannot be missed (call for help keeps the right side).
  if module.autoInvite() then toast:SetPoint("TOP", UIParent, "TOP", 0, -160) return end
  local cfh = ns.callForHelp
  local anchor = cfh and cfh.footprint and cfh.footprint()
  if anchor then toast:SetPoint("TOPLEFT", anchor, "BOTTOMLEFT", 0, -4)
  else toast:SetPoint("TOPRIGHT", UIParent, "TOPRIGHT", -20, -394) end
end

local function ensureToast()
  if toast then return toast end
  -- One window (9.5): hang inside CallForHelp's "Guild calls" window when it is there (always, in the game).
  local c = callHelp()
  local host = c and c.host and c.attachLayer and c.host() or nil
  toast = CreateFrame("Frame", "GuildedLayerToast", host or UIParent, (not host) and BackdropTemplateMixin and "BackdropTemplate" or nil)
  toast.hosted = host ~= nil
  toast:SetWidth(toast.hosted and 300 or 290)
  toast:SetHeight(toast.hosted and 52 or 84)
  if toast.hosted then
    c.attachLayer(toast)
    toast.onDismiss = function() local r = current; closeToast(); if r then r.shown = true end end
  else
    module.placeToast()
    if toast.SetFrameStrata then toast:SetFrameStrata("MEDIUM") end
    if toast.SetClampedToScreen then toast:SetClampedToScreen(true) end
  end
  if toast.SetBackdrop and not toast.hosted then
    pcall(toast.SetBackdrop, toast, { bgFile = "Interface\\Tooltips\\UI-Tooltip-Background", edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border",
      tile = true, tileSize = 16, edgeSize = 12, insets = { left = 3, right = 3, top = 3, bottom = 3 } })
    if toast.SetBackdropColor then pcall(toast.SetBackdropColor, toast, 0.05, 0.05, 0.07, 0.95) end
  end
  toast.isOpen = false
  toast.title = toast:CreateFontString(nil, "OVERLAY", "GameFontNormal")
  toast.title:SetPoint("TOPLEFT", toast, "TOPLEFT", 10, toast.hosted and -4 or -10)
  toast.title:SetWidth(toast.hosted and 280 or 240)
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
  toast.invite:SetPoint("BOTTOMLEFT", toast, "BOTTOMLEFT", 10, toast.hosted and 4 or 8)
  toast.later = button(L("Not now"), 80, function() local r = current; closeToast(); if r then r.shown = true end; presentNext() end)
  toast.later:SetPoint("LEFT", toast.invite, "RIGHT", 4, 0)
  -- (9.5) The window's own X closes it when hosted; a standalone frame has its own.
  if not toast.hosted then
    local x = CreateFrame("Button", nil, toast, "UIPanelCloseButton")
    x:SetPoint("TOPRIGHT", toast, "TOPRIGHT", 2, 2)
    x:SetScript("OnClick", function() closeToast(); presentNext() end)
  end
  toast:Hide()
  return toast
end

-- Puts the window's section in place and shows it; hosted, CallForHelp's window decides where and whether it is visible.
local function showToast()
  toast:Show()
  if toast.hosted and callHelp() and callHelp().refreshWindow then callHelp().refreshWindow() end
end

-- Shows one request (the first time a guildmate asks, it asks the helper once whether to help at all).
function module.show(request)
  ensureToast()
  module.placeToast()
  current = request
  toast.shownAt = nowSeconds()
  toast.lifetime = false
  toast.isOpen = true
  toast.mode = "request"
  local title = request.join and string.format(L("%s is coming to help you"), display(request.name))
    or string.format(L("%s wants another layer"), display(request.name))
  if toast.hosted then
    -- One line in the shared window: the zone goes in brackets after the name.
    toast.title:SetText(title .. ((request.zone or "") ~= "" and (" (" .. request.zone .. ")") or ""))
    toast.detail:SetText("")
  else
    toast.title:SetText(title)
    toast.detail:SetText((request.zone or "") ~= "" and request.zone or " ")
  end
  toast.invite.setInvite(request.name)
  toast.invite:Show(); toast.later:Show()
  showToast()
  if module.autoInvite() and toast.mode == "request" and PlaySound and not request.join then
    pcall(PlaySound, (SOUNDKIT and SOUNDKIT.READY_CHECK) or 8960, "Master")
  end
end

-- After an automatic invite: a short notice in the same window (no chat line), closed by itself.
function module.showInvited(request)
  ensureToast()
  module.placeToast()
  current = request
  toast.shownAt = nowSeconds()
  toast.lifetime = NOTICE_SECONDS
  toast.isOpen = true
  toast.mode = "invited"
  toast.title:SetText(string.format(L("Invited %s to your layer."), display(request.name)))
  toast.detail:SetText(toast.hosted and "" or (request.zone ~= "" and request.zone or " "))
  toast.invite:Hide(); toast.later:Hide()
  showToast()
end

-- The opt-in's automatic invite, from the request's own event: only alone or as party leader, out of combat and
-- instances (canHelp), one at a time. Returns true when the game took the invite.
local function autoInvite(request)
  local u = ns.util
  if not (module.autoInvite() and u and u.partyInvite and u.canPartyInvite) then return false end
  if combat() or current or nowSeconds() < autoBusyUntil or not u.canPartyInvite() then return false end
  if not u.partyInvite(request.name, "layer auto-invite") then return false end
  autoBusyUntil = nowSeconds() + CLAIM_SECONDS
  send(string.format("CLAIM|%s|%s|%d", bare(request.name), request.id, request.continent or 0))
  request.state = "claimed"
  module.showInvited(request)
  return true
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
  mine = { id = id, at = t, continent = continent }
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
  -- Only a CLAIM that went out closes the request: in combat the send is refused and the request stays open.
  if not send(string.format("CLAIM|%s|%s|%d", bare(request.name), request.id, request.continent or 0)) then return false end
  request.state = "claimed"
  local join = joins[request.key]
  if join then join.state = "claimed"; joinBusyUntil = nowSeconds() + JOIN_PACE end
  closeToast()
  presentNext()
  return true
end

local function chatLine(request)
  say(string.format(L("%s wants another layer (%s). Open Guilded, Layer after combat."), display(request.name), request.zone))
end

local function remember(key)
  seen[key] = true
  seenOrder[#seenOrder + 1] = key
  while #seenOrder > MAX_SEEN do seen[table.remove(seenOrder, 1)] = nil end
end

local function receiveRequest(sender, parts)
  local id, continent, zone = parts[2], tonumber(parts[3]), parts[4] or ""
  if not id or id == "" or #id > 12 or not continent then return end
  if same(sender, myName()) then return end                  -- my own message coming back
  local key = keyOf(sender, id)
  if seen[key] then return end                                -- asked once, never again
  local t = nowSeconds()
  local who = bare(sender)
  if lastFrom[who] and t - lastFrom[who] < ASK_EVERY_SECONDS then return end   -- one request per sender per pause, whatever the id
  local here = module.continent()
  if not here then return end                                 -- unreadable now: not marked, a later request still counts
  remember(key)
  lastFrom[who] = t
  local count = 0
  for name, at in pairs(lastFrom) do
    if t - at >= ASK_EVERY_SECONDS then lastFrom[name] = nil else count = count + 1 end
  end
  if count > MAX_SENDERS then lastFrom = { [who] = t } end
  if here ~= continent then return end                        -- not a candidate: another continent
  local request = { key = key, id = id, name = who, zone = (zone:gsub("[|%c]", "")), at = t, state = "open", continent = continent }
  requests[key] = request
  order[#order + 1] = key
  while #order > 20 do requests[table.remove(order, 1)] = nil end
  if not module.helper() or not canHelp() then return end
  if combat() then chatLine(request); return end
  if autoInvite(request) then return end
  if current then
    waiting[#waiting + 1] = request
    while #waiting > MAX_WAITING do table.remove(waiting, 1) end
  else module.show(request) end
end

local function receiveClaim(sender, parts)
  local requester, id, continent = parts[2], parts[3], tonumber(parts[4])
  if not requester or not id or not continent then return end
  if same(sender, requester) then return end                  -- never a claim from the asker
  local join = joins[keyOf(requester, id)]
  if join and join.state == "open" then join.state = "claimed" end   -- another inviter (caller or leader) took this JOIN
  if same(requester, myName()) then
    -- I am the asker: only the first claim for my own open request, from a guildmate on my continent.
    if mine and mine.id == id and not mine.claimedBy and continent == mine.continent then
      mine.claimedBy, mine.claimedAt = bare(sender), nowSeconds()
      say(string.format(L("%s will invite you. Accept the invite, then type /leave once the zone has reloaded."), display(sender)))
    elseif myJoin and myJoin.id == id and not myJoin.claimedBy and continent == myJoin.continent then
      -- I am a responder (On my way): someone on the caller's side is inviting me.
      myJoin.claimedBy, myJoin.claimedAt = bare(sender), nowSeconds()
      local text = string.format(L("%s is inviting you. Accept the invite."), display(sender))
      local c = callHelp()
      if c and c.notice then c.notice(text, nil, nil, JOIN_NOTICE_SECONDS) else say(text) end
    end
    return
  end
  local request = requests[keyOf(requester, id)]              -- only a request this client holds
  if request and request.state == "open" then
    request.state = "claimed"
    if current == request then closeToast(); presentNext() end
  end
end

local function receiveDone(sender, parts)
  local join = joins[keyOf(sender, parts[2] or "")]
  if join then join.state = "closed" end
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
  elseif kind == "DONE" then receiveDone(sender, parts)
  elseif kind == "JOIN" then module.receiveJoin(sender, parts)
  elseif kind == "FULL" then module.receiveFull(sender, parts) end
end

-- ---------------------------------------------------------------------
-- Join the caller's layer (9.5)
-- ---------------------------------------------------------------------

local function groupSize() return GetNumGroupMembers and GetNumGroupMembers() or 0 end
local function inRaid() return IsInRaid and IsInRaid() and true or false end
local function partyFull()
  local size = groupSize()
  return inGroup() and not inRaid() and type(size) == "number" and size >= 5
end
local function isLeader()
  if not inGroup() then return false end
  local ok, lead = pcall(function() return UnitIsGroupLeader and UnitIsGroupLeader("player") end)
  return ok and lead and true or false
end

local function sendJoin()
  local j = myJoin
  if not j or j.sent then return false end
  if send(string.format("JOIN|%s|%d|%s|%s", j.id, j.continent, j.callId, j.target)) then j.sent = true end
  return j.sent
end

-- The defender's side: On my way. Returns true when a JOIN is on its way (sent now, or as soon as combat ends).
function module.askJoin(target, callId)
  if not (IsInGuild and IsInGuild()) or type(callId) ~= "string" or not callId:match("^%w+$") or #callId > 8 then return false end
  if type(target) ~= "string" or target == "" or same(target, myName()) then return false end
  local continent = module.continent()
  if not continent then return false end
  counter = counter + 1
  local t = nowSeconds()
  myJoin = { id = string.format("%d%d", t % 100000, counter % 10), target = bare(target), callId = callId, continent = continent, at = t, sent = false }
  sendJoin()
  return true
end
function module.myJoin() return myJoin end

-- The caller's (or the caller's party leader's) side: a responder wants an invite to the caller's group.
function module.receiveJoin(sender, parts)
  local id, continent, callId, target = parts[2], tonumber(parts[3]), parts[4], parts[5]
  if not id or id == "" or #id > 12 or not continent or not callId or not callId:match("^%w+$") or #callId > 8 then return end
  if not target or target == "" or #target > 40 then return end
  if same(sender, myName()) then return end
  local key = keyOf(sender, id)
  if seen[key] then return end
  local here = module.continent()
  if not here or here ~= continent then return end
  local c = callHelp()
  local role
  if same(target, myName()) then
    if c and c.myCallId and c.myCallId() == callId then role = "caller" end
  elseif c and c.knownCall and ns.util and ns.util.inMyGroup and ns.util.inMyGroup(target) and c.knownCall(target, callId) and isLeader() then
    role = "leader"
  end
  if not role then return end
  remember(key)
  local join = { key = key, id = id, name = bare(sender), callId = callId, target = bare(target), at = nowSeconds(), state = "open", continent = continent, role = role }
  joins[key] = join
  joinList[#joinList + 1] = join
  while #joinList > MAX_JOINS do joins[table.remove(joinList, 1).key] = nil end
  module.processJoins()
end

-- The defender is told once that the group is full.
function module.receiveFull(sender, parts)
  local requester, id, continent = parts[2], parts[3], tonumber(parts[4])
  if not requester or not id or not continent or same(sender, requester) then return end
  if same(requester, myName()) and myJoin and myJoin.id == id and not myJoin.fullSaid then
    myJoin.fullSaid = true
    say(string.format(L("%s's group is full."), display(sender)))
  end
end

local function offerConvert(join)
  if join.offered then return end
  join.offered = true
  local c = callHelp()
  local text = L("Group full. Convert to raid so more can join.")
  if c and c.notice then c.notice(text, L("Convert to raid"), function() module.convertToRaid() end, JOIN_NOTICE_SECONDS, 0) else say(text) end
end

-- Invites the next responder when it is allowed: out of combat, outside instances, one at a time. Runs on every new JOIN,
-- every second, and when combat ends. A refusal (direct invites off or refused) shows the usual Invite button instead.
function module.processJoins()
  local t = nowSeconds()
  for i = #joinList, 1, -1 do
    local j = joinList[i]
    if j.state ~= "open" or t - j.at > JOIN_SECONDS then joins[j.key] = nil; table.remove(joinList, i) end
  end
  if #joinList == 0 or combat() or inInstance() or t < joinBusyUntil then return false end
  local u = ns.util
  if not (u and u.partyInvite and u.canPartyInvite) then return false end
  for _, j in ipairs(joinList) do
    if j.state == "open" then
      if u.inMyGroup and u.inMyGroup(j.name) then
        j.state = "closed"
      elseif partyFull() then
        if not j.fullSent then
          j.fullSent = true
          send(string.format("FULL|%s|%s|%d", j.name, j.id, j.continent))
        end
        if isLeader() then offerConvert(j) end
        return false
      elseif not u.canPartyInvite(true) then
        return false                                        -- in someone else's group: its leader's addon invites
      elseif u.partyInvite(j.name, "call for help join", true) then
        send(string.format("CLAIM|%s|%s|%d", j.name, j.id, j.continent))
        j.state = "claimed"
        joinBusyUntil = t + JOIN_PACE
        say(string.format(L("Invited %s."), j.name))
        local c = callHelp()
        if j.role == "caller" and c and c.noteInvited then c.noteInvited() end
        return true
      else
        -- Refused or direct invites are off: the usual window row with an Invite button (copy box when needed).
        if not j.shown then
          j.shown = true
          local request = { key = j.key, id = j.id, name = j.name, zone = "", at = j.at, state = "open", continent = j.continent, join = true }
          requests[j.key] = request
          order[#order + 1] = j.key
          while #order > 20 do requests[table.remove(order, 1)] = nil end
          if current then waiting[#waiting + 1] = request else module.show(request) end
        end
        return false
      end
    end
  end
  return false
end

-- After the fight: Leave group / Convert to raid run on a click only. The game may refuse them from an addon (unknown for
-- these two calls: the ADDON_ACTION_BLOCKED that follows is remembered per client build and the button then shows the hint).
local function groupRefused(what)
  local r = data().groupRefused
  local build = ns.util and ns.util.clientBuild and ns.util.clientBuild() or "?"
  return type(r) == "table" and r[what] ~= nil and r[what] == build
end
local function groupCall(what, fn, hint)
  local c = callHelp()
  if combat() or groupRefused(what) or type(fn) ~= "function" then say(hint); return false end
  attempt = { what = what, at = GetTime and GetTime() or 0 }
  ns.guardedCall = { name = what == "leave" and "LeaveParty (leave group button)" or "ConvertToRaid (convert button)" }
  local ok = pcall(fn)
  ns.guardedCall = nil
  if not ok then say(hint); return false end
  if c and c.clearNotice then c.clearNotice() end
  return true
end
function module.leaveGroup()
  return groupCall("leave", (C_PartyInfo and C_PartyInfo.LeaveParty) or LeaveParty, L("Type /leave to leave the group."))
end
function module.convertToRaid()
  return groupCall("convert", (C_PartyInfo and C_PartyInfo.ConvertToRaid) or ConvertToRaid, L("Right-click your portrait and choose Convert to Raid."))
end
-- Core fires ADDON_ACTION_BLOCKED/FORBIDDEN: a refusal right after one of the two clicks is remembered for this build.
function module.noteBlocked(named)
  local a = attempt
  if not a or type(named) ~= "string" then return false end
  local now = GetTime and GetTime() or 0
  if now < a.at or now - a.at > 2 then attempt = nil; return false end
  if not named:find(a.what == "leave" and "LeaveParty" or "ConvertToRaid", 1, true) then return false end
  local r = data().groupRefused
  r = type(r) == "table" and r or {}
  r[a.what] = ns.util and ns.util.clientBuild and ns.util.clientBuild() or "?"
  data().groupRefused = r
  attempt = nil
  say(a.what == "leave" and L("Type /leave to leave the group.") or L("Right-click your portrait and choose Convert to Raid."))
  return true
end

-- Seconds tick: requests and claims run out; the asker is told when they are in the helper's group.
local function tick()
  local t = nowSeconds()
  if myJoin then
    if not myJoin.sent and not combat() then sendJoin() end
    if myJoin.claimedBy and inGroup() then
      send("DONE|" .. myJoin.id)
      myJoin = nil
    elseif t - myJoin.at > JOIN_SECONDS then
      myJoin = nil
    end
  end
  module.processJoins()
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
  if toast and toast.isOpen and toast.shownAt and t - toast.shownAt > (toast.lifetime or TOAST_SECONDS) then closeToast(); presentNext() end
end
module.tick = tick

-- ---------------------------------------------------------------------
-- The Layer invite page (Guild tab) and the commands
-- ---------------------------------------------------------------------

function module.openRequests() return openRequests() end
function module.counts() return #seenOrder, #waiting end
function module.myRequest() return mine end

function module.buildPage(page, helpers)
  local newLabel, newButton, at = helpers.newLabel, helpers.newButton, helpers.at
  local newCheck, tip = helpers.newCheck, helpers.tip
  local width = helpers.width or 560
  local intro = at(newLabel(page, "Ask guildmates on your continent to invite you into their group. Accepting a party invite from someone on another layer moves you to that layer; then leave the group.", "GameFontHighlightSmall"), page, 0, 0)
  intro:SetWidth(width - 8)
  at(newButton(page, "Change layer", 150, function() module.ask(); module.refreshPage() end), page, 0, -50)
  local status = at(newLabel(page, "", "GameFontHighlightSmall"), page, 160, -54)
  status:SetWidth(width - 168)
  -- (9.4) The same two switches as Settings (/guilded layer helper|auto on|off), here where the requests are. They only change a
  -- saved setting (no protected call, no secure frame), so they also work in combat.
  local function switch(text, tooltip, y, command, get)
    local box = at(newCheck(page, text), page, 0, y)
    box:SetScript("OnClick", function(self)
      local handler = ns.commandHandlers and ns.commandHandlers["layer"]
      if handler then handler({ "layer", command, self:GetChecked() and "on" or "off" }) end
      module.refreshPage()
    end)
    if tip then tip(box, tooltip) end
    box.get = get
    return box
  end
  local helperBox = switch("Help guildmates", "On by default. A small window when a guildmate on your continent asks to be invited onto another layer, or calls for help in your zone. The same switch as /guilded sos guildmates on|off.", -78, "helper", module.helper)
  local autoBox = switch("Auto-invite layer requests on my continent", "Off by default. When a guildmate on your continent asks for a layer, Guilded invites them at once (only when you are alone or lead your party, out of combat and outside instances) and shows a short notice. If the game refuses, you get the Invite window instead.", -102, "auto", module.autoInvite)
  module.pageBoxes = { helper = helperBox, auto = autoBox }
  local autoHelp = at(newLabel(page, "Alone or party leader, out of combat and instances.", "GameFontDisableSmall"), page, 28, -124)
  at(newLabel(page, "Open requests", "GameFontNormal"), page, 0, -146)
  local empty = at(newLabel(page, "No open requests.", "GameFontHighlightSmall"), page, 0, -170)
  -- What the empty list means and what to do next, under the line above.
  local emptyHelp = at(newLabel(page, "When a guildmate on another layer asks to be invited, they appear here with an Invite button. Press Change layer to ask for an invite yourself.", "GameFontDisableSmall"), page, 0, -190)
  emptyHelp:SetWidth(width - 8)
  for i = 1, MAX_ROWS do
    local row = {}
    row.label = at(newLabel(page, "", "GameFontHighlight"), page, 0, -170 - (i - 1) * 28)
    row.label:SetWidth(width - 110)
    row.invite = ns.util.inviteButton(page, "party", L("Invite"), 80, 22, function() if row.request then module.claim(row.request); module.refreshPage() end end)
    row.invite:SetPoint("TOPLEFT", page, "TOPLEFT", width - 96, -166 - (i - 1) * 28)
    rows[i] = row
  end
  function module.refreshPage()
    helperBox:SetChecked(module.helper())
    autoBox:SetChecked(module.autoInvite())
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
    if #list == 0 then empty:Show(); emptyHelp:Show() else empty:Hide(); emptyHelp:Hide() end
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
-- The note added to a settings answer when the character has no guild yet (only asking needs a guild).
local function guildless(text)
  if IsInGuild and not IsInGuild() then return text .. " " .. L("(takes effect once you are in a guild)") end
  return text
end

ns.commandHandlers["layer"] = function(args)
  -- Core hands a module the tokens after the action ({ "auto", "on" }); older callers pass { "layer", "auto", "on" }.
  args = args or {}
  if string.lower(args[1] or "") ~= "layer" then table.insert(args, 1, "layer") end
  local what = string.lower(args and args[2] or "")
  if what == "list" then
    local list = openRequests()
    if #list == 0 then say(L("No open requests.")) return end
    for _, request in ipairs(list) do say(string.format("%s (%s): /invite %s", display(request.name), request.zone, request.name)) end
  elseif what == "cancel" then
    if not module.cancel() then say(L("You have no open layer request.")) end
  elseif what == "auto" then
    local value = string.lower(args[3] or "")
    if value == "on" or value == "off" then
      module.setAutoInvite(value == "on")
      say(guildless(value == "on" and L("Guildmates who ask for a layer on your continent are invited at once (when you are alone or lead your party, out of combat).")
        or L("Layer requests are no longer invited by themselves.")))
    else
      say(L("/guilded layer auto on|off"))
    end
  elseif what == "direct" then
    local value = string.lower(args[3] or "")
    local u = ns.util
    if value == "on" or value == "off" then
      if value == "on" and u and u.directInviteRefused and u.directInviteRefused() then
        say(L("This game build refused a direct invite: Invite buttons show the line to paste."))
      elseif u and u.setDirectInvite then
        u.setDirectInvite(value == "on")
        say(guildless(value == "on" and L("Party Invite buttons invite directly.") or L("Party Invite buttons show the /invite line to paste.")))
      end
    else
      say(L("/guilded layer direct on|off"))
    end
  elseif what == "helper" then
    local value = string.lower(args[3] or "")
    if value == "on" or value == "off" then
      module.setHelper(value == "on")
      say(guildless(value == "on" and L("You will see guildmates' layer requests.") or L("You will not see guildmates' layer requests.")))
    else
      say(L("/guilded layer helper on|off"))
    end
  else
    module.ask()
  end
end
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded layer [list | cancel | helper on|off | auto on|off | direct on|off] - ask guildmates on your continent for a layer invite")

-- (9.5) The quick layer swap with no call for help: a key binding (Options > Keybindings > Guilded), next to Call for help.
BINDING_NAME_GUILDED_ASK_LAYER = L("Ask for a layer invite")
function Guilded_AskForLayer() module.ask() end

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
register("PLAYER_REGEN_DISABLED")
register("ADDON_ACTION_BLOCKED")
register("ADDON_ACTION_FORBIDDEN")
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
    elseif event == "PLAYER_REGEN_DISABLED" then
      -- The window goes away for the fight and comes back after it if the request is still open.
      if current then
        local request = current
        closeToast()
        if request.state == "open" then table.insert(waiting, 1, request) end
      end
    elseif event == "PLAYER_REGEN_ENABLED" then
      presentNext()
      if myJoin and not myJoin.sent then sendJoin() end
      module.processJoins()                      -- the caller's first moment out of combat: invite the responders now
    elseif event == "ADDON_ACTION_BLOCKED" or event == "ADDON_ACTION_FORBIDDEN" then
      module.noteBlocked(args[2])
    elseif event == "GROUP_ROSTER_UPDATE" then
      if (mine and mine.claimedBy) or myJoin then tick() end
    end
  end)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "layer invite: " .. tostring(err)) end
end)
