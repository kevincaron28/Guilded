-- Call for help: one button when guildmates are being ganked in the open world.
--
--   /guilded sos            show the options and ask "Call for help now?" (also /gsos)
--   /guilded sos now        call for help at once (the button, the key binding and the quick menu do too)
--   /guilded sos clear      all clear
--   /guilded sos defender on|off   get the loud alert when a guildmate in your zone calls (default: on)
--   /guilded sos chat on|off       also post one short line in guild chat (default on)
--
-- (/guilded help is Core's command list, so the call uses /guilded sos.)
--
-- The Call for help button appears for 20 s when an enemy player damages you outside an
-- instance. Nothing is ever sent by itself: the player presses the button (or the key, or the
-- command). The call goes to the guild on the addon prefix GuildedSOS; guildmates in the same
-- zone who are Defenders get a banner, a sound, distance and direction, and On my way / Can't
-- buttons. Everyone else gets one line in Guilded's chat tab. No protected action is used, so
-- it works in combat. The combat log is deliberately NOT read (restricted on Retail and
-- Forever); attackers are seen through the target, focus, mouseover and nameplate units.
local addonName, ns = ...
ns = ns or {}

local PREFIX = "GuildedSOS"
local OFFER_SECONDS = 20
local COOLDOWN_SECONDS = 120
local EXPIRE_SECONDS = 300
local SEEN_SECONDS = 60
local BANNER_SECONDS = 20
local MAX_ATTACKERS = 3
local POSITION_MAX_AGE = 600
-- A real attack: an enemy player in combat who targets me, and at least MIN_HITS hits on me within
-- ATTACK_CONFIRM_SECONDS. One stray hit (a mob, a trap, fall damage) never counts.
local MIN_HITS = 2
local ATTACK_CONFIRM_SECONDS = 10
local ATTACK_QUIET_SECONDS = 30     -- hits closer than this belong to the same attack: no second offer
local ATTACK_WINDOW_SECONDS = 60    -- a guild chat line may follow an attack seen this recently
local ZONE_LINE_COOLDOWN = 300      -- at most one guild chat line per zone in this time
local MAX_MATES = 5
local MATE_REFRESH_SECONDS = 5
-- Phone map (Track M): the member's own calls, saved for their companion to upload as map pins.
local SAVED_CALLS_MAX = 10
local SAVED_CALLS_KEEP = 2 * 86400

local module = {}
ns.callForHelp = module

-- Session state only; nothing here is saved.
local seen = {}          -- attackers: name -> { class, level, faction, at }
local mine               -- my call: { id, at, zone, responders = { name = true|false } }
local lastCallAt         -- when I last called (cooldown counts from here)
local offerUntil         -- the Call for help button shows until this time
local incoming = {}      -- callers: name -> { at, id, zone, mapId, x, y, level, attackers }
local lastPosition       -- { mapId, x, y, at }: the last position known before combat
local hits = {}          -- recent hits on me from an enemy player (times)
local lastHitAt          -- the last confirmed hit
local attackedAt         -- the last time an attack by an enemy player was confirmed
local dueling = false    -- a duel is in progress: those hits are friendly
local lineAt             -- when the last guild chat line was posted
local zoneLineAt = {}    -- zone -> when a guild chat line about it was last posted

local function L(text) return ns.L and ns.L(text) or text end
local function secret(value) return ns.isSecret and ns.isSecret(value) end
local function now()
  local ok, value = pcall(GetTime)
  if ok and type(value) == "number" then return value end
  return time()
end
local function serverTime()
  if GetServerTime then return GetServerTime() end
  return time()
end
local function settings()
  local s = ns.getSettings and ns.getSettings()
  return s or {}
end
local function clean(text, limit)
  text = tostring(text or ""):gsub("[|;~%c]", ""):gsub("^%s+", ""):gsub("%s+$", "")
  return string.sub(text, 1, limit or 40)
end
local function say(text)
  if ns.message then ns.message(text) end
end
local function playerName()
  return ns.playerName and ns.playerName() or (UnitName and UnitName("player")) or "?"
end
local function display(name)
  return ns.displayName and ns.displayName(name) or name
end

-- ---------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------

-- Defender: on for every member at any level unless the member turned it off.
function module.defender()
  return settings().helpDefender ~= false
end

function module.guildChat()
  return settings().helpGuildChat ~= false
end

-- ---------------------------------------------------------------------
-- Message: S|id|level|mapId|x|y|zone|subzone|attackers|time   (attackers: name~CLASS~level;...)
--          R|id|Y or N      reply, whispered to the caller
--          C|id             all clear
-- ---------------------------------------------------------------------

function module.encode(call)
  local parts = {}
  for i, a in ipairs(call.attackers or {}) do
    if i > MAX_ATTACKERS then break end
    parts[#parts + 1] = string.format("%s~%s~%d~%s", clean(a.name, 24), clean(a.class, 12), tonumber(a.level) or 0,
      a.faction == "Horde" and "H" or a.faction == "Alliance" and "A" or "")
  end
  return string.format("S|%s|%d|%d|%d|%d|%s|%s|%s|%d", clean(call.id, 8), tonumber(call.level) or 0,
    tonumber(call.mapId) or 0, math.floor((tonumber(call.x) or 0) * 10000 + 0.5), math.floor((tonumber(call.y) or 0) * 10000 + 0.5),
    clean(call.zone, 28), clean(call.subzone, 28), table.concat(parts, ";"), tonumber(call.time) or 0)
end

-- Returns a table with kind = "call" | "reply" | "clear", or nil for anything malformed.
function module.decode(text)
  if type(text) ~= "string" then return nil end
  local id, answer = string.match(text, "^R|([%w]+)|([YN])$")
  if id then return { kind = "reply", id = id, coming = answer == "Y" } end
  id = string.match(text, "^C|([%w]+)$")
  if id then return { kind = "clear", id = id } end
  local f = {}
  for field in string.gmatch(text .. "|", "([^|]*)|") do f[#f + 1] = field end
  if f[1] ~= "S" or #f ~= 10 or not string.match(f[2], "^%w+$") then return nil end
  local level, mapId, x, y, at = tonumber(f[3]), tonumber(f[4]), tonumber(f[5]), tonumber(f[6]), tonumber(f[10])
  if not (level and mapId and x and y and at) or x < 0 or y < 0 or x > 10000 or y > 10000 then return nil end
  local attackers = {}
  for entry in string.gmatch(f[9], "[^;]+") do
    local name, class, lvl, side = string.match(entry, "^([^~]+)~([^~]*)~(%d+)~([HA]?)$")
    if name and #attackers < MAX_ATTACKERS then
      attackers[#attackers + 1] = { name = name, class = class ~= "" and class or nil, level = tonumber(lvl),
        faction = side == "H" and "Horde" or side == "A" and "Alliance" or nil }
    end
  end
  local known = mapId > 0 and not (x == 0 and y == 0)
  return { kind = "call", id = f[2], level = level, mapId = known and mapId or nil, x = known and x / 10000 or nil,
    y = known and y / 10000 or nil, zone = f[7], subzone = f[8], attackers = attackers, time = at }
end

-- ---------------------------------------------------------------------
-- Where, and who
-- ---------------------------------------------------------------------

local function inInstance()
  if not IsInInstance then return false end
  local ok, inside = pcall(IsInInstance)
  return ok and inside == true
end

-- My position now, or the last one known before combat.
local function position()
  if ns.guildMap and ns.guildMap.myPosition then
    local ok, mapId, x, y = pcall(ns.guildMap.myPosition)
    if ok and mapId then
      lastPosition = { mapId = mapId, x = x, y = y, at = now() }
      return mapId, x, y
    end
  end
  if lastPosition and now() - lastPosition.at <= POSITION_MAX_AGE then
    return lastPosition.mapId, lastPosition.x, lastPosition.y
  end
  return nil
end

local function zoneNames()
  local zone = GetRealZoneText and GetRealZoneText() or (GetZoneText and GetZoneText()) or ""
  local sub = GetSubZoneText and GetSubZoneText() or ""
  if secret(zone) then zone = "" end
  if secret(sub) then sub = "" end
  return zone, sub
end

local function unitLabel(unit)
  local name = UnitName and UnitName(unit)
  if type(name) ~= "string" or secret(name) then return nil end
  local class = UnitClass and select(2, UnitClass(unit)) or nil
  local faction = UnitFactionGroup and UnitFactionGroup(unit) or nil
  return name, class, tonumber(UnitLevel and UnitLevel(unit)) or 0, faction
end

-- An enemy player counts as an attacker only when not a guildmate, a party or raid member or a friend,
-- and in combat. (Unavailable checks are skipped, never guessed.)
function module.attackerOk(unit, name)
  if ns.isGuildMember and ns.isGuildMember(name) then return false end
  if UnitInParty and UnitInParty(unit) then return false end
  if UnitInRaid and UnitInRaid(unit) then return false end
  if UnitIsFriend and UnitIsFriend("player", unit) then return false end
  if UnitAffectingCombat and not UnitAffectingCombat(unit) then return false end
  return true
end

-- Looks at the units an addon may read for enemy players who target me. Returns true when one is new or seen.
function module.scan()
  local units = { "target", "focus", "mouseover" }
  for i = 1, 10 do units[#units + 1] = "nameplate" .. i end
  local found = false
  for _, unit in ipairs(units) do
    if UnitExists and UnitExists(unit) and UnitIsPlayer and UnitIsPlayer(unit) and UnitCanAttack and UnitCanAttack("player", unit)
      and UnitIsUnit and UnitIsUnit(unit .. "target", "player") then
      local name, class, level, faction = unitLabel(unit)
      if name and module.attackerOk(unit, name) then
        seen[name] = { class = class, level = level, faction = faction, at = now() }
        found = true
      end
    end
  end
  return found
end

local function recentAttackers()
  local list = {}
  for name, a in pairs(seen) do
    if now() - a.at > SEEN_SECONDS then seen[name] = nil
    else list[#list + 1] = { name = name, class = a.class, level = a.level, faction = a.faction, at = a.at } end
  end
  table.sort(list, function(a, b) return a.at > b.at or (a.at == b.at and a.name < b.name) end)
  return list
end

-- "2 Horde, 58-60" (or "" when nobody was seen).
function module.summary(attackers)
  if not attackers or #attackers == 0 then return "" end
  local low, high, faction
  for _, a in ipairs(attackers) do
    local level = tonumber(a.level) or 0
    if level > 0 then
      low = (not low or level < low) and level or low
      high = (not high or level > high) and level or high
    end
    faction = faction or a.faction
  end
  local parts = { tostring(#attackers) .. (faction and (" " .. faction) or "") }
  if low then parts[#parts + 1] = low == high and tostring(low) or (low .. "-" .. high) end
  return table.concat(parts, ", ")
end

local COMPASS = { "east", "northeast", "north", "northwest", "west", "southwest", "south", "southeast" }
-- Distance in yards (nil without map sizes) and compass direction from (mx, my) to (cx, cy); map y grows southward.
function module.bearing(mx, my, cx, cy, width, height)
  local dx, dy = (cx - mx) * (width or 1), (cy - my) * (height or 1)
  local east, north = dx, -dy
  if east == 0 and north == 0 then return width and 0 or nil, "here" end
  local atan = math.atan2 or math.atan
  local degrees = math.deg(atan(north, east))
  if degrees < 0 then degrees = degrees + 360 end
  local name = COMPASS[(math.floor((degrees + 22.5) / 45) % 8) + 1]
  return width and math.floor(math.sqrt(dx * dx + dy * dy) + 0.5) or nil, name
end

local function mapSize(mapId)
  if C_Map and C_Map.GetMapWorldSize then
    local ok, w, h = pcall(C_Map.GetMapWorldSize, mapId)
    if ok and type(w) == "number" and type(h) == "number" and w > 0 and h > 0 then return w, h end
  end
  return nil
end

-- ---------------------------------------------------------------------
-- Guildmates in my zone (the guild roster gives every online member's zone) and party invites.
-- WoW only lets an invite come from a click, so every invite here is a button.
-- ---------------------------------------------------------------------

local offerFrame, banner
local mateRows = {}   -- the caller's zone list: { label, button, name } per row

local function baseName(name)
  return ns.normalizeName and ns.normalizeName(name) or name
end

-- Online guildmates (not me) whose roster zone is my zone, up to MAX_MATES, nearest-first is not
-- known without positions, so they are listed by name.
function module.zoneMates()
  local list = {}
  if not (GetNumGuildMembers and GetGuildRosterInfo) then return list end
  local zone = zoneNames()
  if zone == "" then return list end
  local okCount, total = pcall(GetNumGuildMembers)
  if not okCount or type(total) ~= "number" then return list end
  local me = playerName()
  for i = 1, total do
    local ok, name, _, _, level, class, rosterZone, _, _, online = pcall(GetGuildRosterInfo, i)
    if ok and name and online and not secret(rosterZone) and rosterZone == zone and baseName(name) ~= me then
      list[#list + 1] = { name = name, level = level, class = class }
    end
  end
  table.sort(list, function(a, b) return a.name < b.name end)
  while #list > MAX_MATES do list[#list] = nil end
  return list
end

local function partyInvite(name)
  if C_PartyInfo and C_PartyInfo.InviteUnit then return pcall(C_PartyInfo.InviteUnit, name) end
  if InviteUnit then return pcall(InviteUnit, name) end
  return false
end

-- Invite button: a party invite to one guildmate.
function module.invite(name)
  if not name or name == "" then return false end
  if partyInvite(name) then say(string.format(L("Invited %s to your party."), display(name))); return true end
  say(string.format(L("Could not invite %s."), display(name)))
  return false
end

-- Join button: ask the caller for a party invite the usual way (a whisper of "inv").
function module.join()
  if not (banner and banner.sender) then return false end
  if SendChatMessage and pcall(SendChatMessage, "inv", "WHISPER", nil, banner.sender) then
    say(string.format(L("Asked %s for a party invite."), display(banner.sender)))
    return true
  end
  return false
end

-- Invite caller button: invite the caller to my party.
function module.inviteCaller()
  if not (banner and banner.sender) then return false end
  return module.invite(banner.sender)
end

-- ---------------------------------------------------------------------
-- Frames (created lazily; plain frames, no protected actions)
-- ---------------------------------------------------------------------


local function makeButton(parent, label, width, onClick)
  local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
  b:SetWidth(width)
  b:SetHeight(24)
  if b.SetText then b:SetText(label) end
  b:SetScript("OnClick", onClick)
  return b
end

local function makeFrame(width, height)
  local f = CreateFrame("Frame", nil, UIParent, BackdropTemplateMixin and "BackdropTemplate" or nil)
  f:SetWidth(width)
  f:SetHeight(height)
  if f.SetFrameStrata then f:SetFrameStrata("DIALOG") end
  if f.SetBackdrop then
    pcall(f.SetBackdrop, f, { bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background",
      edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border", tile = true, tileSize = 16, edgeSize = 16,
      insets = { left = 4, right = 4, top = 4, bottom = 4 } })
  end
  -- A solid back as well: the dialog texture alone left the window see-through on one client.
  if f.CreateTexture then
    local solid = f:CreateTexture(nil, "BACKGROUND")
    solid:SetPoint("TOPLEFT", f, "TOPLEFT", 4, -4)
    solid:SetPoint("BOTTOMRIGHT", f, "BOTTOMRIGHT", -4, 4)
    if solid.SetColorTexture then solid:SetColorTexture(0.04, 0.04, 0.05, 0.96) end
  end
  f.text = f:CreateFontString(nil, "OVERLAY", "GameFontNormal")
  f.text:SetPoint("TOP", f, "TOP", 0, -10)
  f.text:SetWidth(width - 20)
  if f.Hide then f:Hide() end
  return f
end

local function refreshOffer()
  if not offerFrame then return end
  local text
  if mine then
    local names = {}
    for name, coming in pairs(mine.responders) do if coming then names[#names + 1] = display(name) end end
    table.sort(names)
    text = #names > 0 and string.format(L("Help is coming: %s"), table.concat(names, ", ")) or L("Help called. Waiting for answers.")
    offerFrame.call:Hide()
    offerFrame.clear:Show()
  else
    text = L("Under attack?")
    offerFrame.call:Show()
    offerFrame.clear:Hide()
  end
  offerFrame.text:SetText(text)
  module.refreshMates()
end

-- The caller's list of online guildmates in the same zone, each with an Invite button.
function module.refreshMates()
  if not offerFrame then return 0 end
  local mates = mine and module.zoneMates() or {}
  for i = 1, MAX_MATES do
    local row = mateRows[i]
    local mate = mates[i]
    if mate and not row then
      row = {}
      row.label = offerFrame:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
      row.label:SetPoint("TOPLEFT", offerFrame, "TOPLEFT", 16, -30 - (i - 1) * 24)
      row.button = makeButton(offerFrame, L("Invite"), 70, function() module.invite(row.name) end)
      row.button:SetPoint("TOPRIGHT", offerFrame, "TOPRIGHT", -14, -26 - (i - 1) * 24)
      mateRows[i] = row
    end
    if row then
      if mate then
        row.name = mate.name
        row.label:SetText(display(mate.name) .. (mate.level and mate.level > 0 and (" (" .. mate.level .. ")") or ""))
        row.label:Show(); row.button:Show()
      else
        row.name = nil
        row.label:Hide(); row.button:Hide()
      end
    end
  end
  offerFrame:SetHeight(70 + (#mates > 0 and (#mates * 24 + 6) or 0))
  return #mates
end

local function ensureOffer()
  if offerFrame then return offerFrame end
  offerFrame = makeFrame(240, 70)
  offerFrame:SetPoint("TOP", UIParent, "TOP", 0, -180)
  offerFrame.call = makeButton(offerFrame, L("Call for help"), 140, function() module.open() end)
  offerFrame.call:SetPoint("BOTTOM", offerFrame, "BOTTOM", 0, 12)
  offerFrame.clear = makeButton(offerFrame, L("All clear"), 140, function() module.allClear() end)
  offerFrame.clear:SetPoint("BOTTOM", offerFrame, "BOTTOM", 0, 12)
  return offerFrame
end

local function showOffer()
  ensureOffer()
  refreshOffer()
  offerFrame:Show()
end

local function ensureBanner()
  if banner then return banner end
  banner = makeFrame(360, 128)
  banner:SetPoint("TOP", UIParent, "TOP", 0, -90)
  banner.detail = banner:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
  banner.detail:SetPoint("TOP", banner.text, "BOTTOM", 0, -4)
  banner.detail:SetWidth(340)
  banner.coming = makeButton(banner, L("On my way"), 120, function() module.reply(true) end)
  banner.coming:SetPoint("BOTTOMRIGHT", banner, "BOTTOM", -4, 10)
  banner.join = makeButton(banner, L("Join"), 120, function() module.join() end)
  banner.join:SetPoint("BOTTOMRIGHT", banner, "BOTTOM", -4, 40)
  banner.inviteCaller = makeButton(banner, L("Invite caller"), 120, function() module.inviteCaller() end)
  banner.inviteCaller:SetPoint("BOTTOMLEFT", banner, "BOTTOM", 4, 40)
  banner.cant = makeButton(banner, L("Can't"), 120, function() module.reply(false) end)
  banner.cant:SetPoint("BOTTOMLEFT", banner, "BOTTOM", 4, 10)
  return banner
end

-- ---------------------------------------------------------------------
-- Caller side
-- ---------------------------------------------------------------------

local function guildChatLine(call)
  local line = string.format("[Guilded] Help! %s is under attack in %s", clean(call.name, 24), clean(call.zone ~= "" and call.zone or "the open world", 28))
  if call.subzone and call.subzone ~= "" then line = line .. ", " .. clean(call.subzone, 28) end
  if call.x and call.y then line = line .. string.format(" (%d, %d)", math.floor(call.x * 100 + 0.5), math.floor(call.y * 100 + 0.5)) end
  local summary = module.summary(call.attackers)
  if summary ~= "" then line = line .. " (" .. summary .. ")" end
  return line
end
module.guildChatLine = guildChatLine

local function active()
  if mine and now() - mine.at > EXPIRE_SECONDS then mine = nil; offerUntil = nil; refreshOffer() end
  return mine
end

-- Seconds until a new call is allowed (0 = now).
-- Saves my call in db.helpCalls (keyed by its server time) for the phone map; returns the key.
function module.saveCall(call)
  local db = ns.getDb and ns.getDb()
  if type(db) ~= "table" or type(call) ~= "table" then return nil end
  local list = type(db.helpCalls) == "table" and db.helpCalls or {}
  local at = tonumber(call.time) or serverTime()
  local row = { id = tostring(at), n = clean(call.name or playerName(), 80), at = at, z = clean(call.zone, 60), sz = clean(call.subzone, 60), a = {} }
  for i, a in ipairs(call.attackers or {}) do
    if i > MAX_ATTACKERS then break end
    row.a[#row.a + 1] = { n = clean(a.name, 40), c = a.class and clean(a.class, 20) or nil, l = tonumber(a.level) }
  end
  if call.mapId and call.x and call.y then
    row.m, row.x, row.y = call.mapId, math.floor(call.x * 10000 + 0.5) / 10000, math.floor(call.y * 10000 + 0.5) / 10000
    local gm = ns.guildMap
    if gm and gm.continentOf and gm.translate then
      local okC, continent, continentName = pcall(gm.continentOf, call.mapId)
      if okC and continent then
        local okT, cx, cy = pcall(gm.translate, call.mapId, call.x, call.y, continent)
        if okT and cx and cy then row.c, row.cn, row.cx, row.cy = continent, continentName, math.floor(cx * 10000 + 0.5) / 10000, math.floor(cy * 10000 + 0.5) / 10000 end
      end
    end
  end
  list[row.id] = row
  local keys = {}
  for key, saved in pairs(list) do
    if type(saved) ~= "table" or at - (tonumber(saved.at) or 0) > SAVED_CALLS_KEEP then list[key] = nil else keys[#keys + 1] = key end
  end
  table.sort(keys, function(a, b) return (tonumber(list[a].at) or 0) < (tonumber(list[b].at) or 0) end)
  for i = 1, #keys - SAVED_CALLS_MAX do list[keys[i]] = nil end
  db.helpCalls = list
  return row.id
end

function module.cooldownLeft()
  if not lastCallAt then return 0 end
  return math.max(0, math.ceil(COOLDOWN_SECONDS - (now() - lastCallAt)))
end

-- The Call for help action: button, key binding, /guilded sos and the quick menu all come here.
function module.open()
  if not (IsInGuild and IsInGuild()) then say(L("Join a guild to call for help.")); return false end
  if active() then say(L("Your call for help is still open. /guilded sos clear when it is over.")); return false end
  local wait = module.cooldownLeft()
  if wait > 0 then say(string.format(L("You called for help a moment ago. You can call again in %d seconds."), wait)); return false end
  local mapId, x, y = position()
  local zone, sub = zoneNames()
  local attackers = recentAttackers()
  local call = { id = string.format("%d", serverTime() % 100000), level = UnitLevel and UnitLevel("player") or 0,
    mapId = mapId, x = x, y = y, zone = zone, subzone = sub, attackers = attackers, time = serverTime(), name = playerName() }
  local text = module.encode(call)
  if not ns.comm.send(PREFIX, text, "GUILD", nil, nil, "interactive") then
    say(L("Could not send the call for help.")); return false
  end
  mine = { id = clean(call.id, 8), at = now(), zone = zone, responders = {}, posted = false }
  local okSave, savedKey = pcall(module.saveCall, call)
  mine.saved = okSave and savedKey or nil
  lastCallAt = now()
  if module.guildChat() and SendChatMessage then
    local t, key = now(), zone ~= "" and zone or "?"
    if not module.attacked() then
      say(L("No attack was seen, so no line was posted in guild chat."))
    elseif (lineAt and t - lineAt < ATTACK_WINDOW_SECONDS) or (zoneLineAt[key] and t - zoneLineAt[key] < ZONE_LINE_COOLDOWN) then
      say(L("A line about this zone was posted a moment ago, so none was posted now."))
    else
      mine.posted = pcall(SendChatMessage, guildChatLine(call), "GUILD")
      if mine.posted then lineAt, zoneLineAt[key] = t, t end
    end
    mine.name = call.name
  end
  say(L("Call for help sent to the guild."))
  showOffer()
  return true
end

function module.allClear()
  if not mine then return false end
  ns.comm.send(PREFIX, "C|" .. mine.id, "GUILD", nil, nil, "interactive")
  local db = ns.getDb and ns.getDb()
  local saved = mine.saved and type(db) == "table" and type(db.helpCalls) == "table" and db.helpCalls[mine.saved]
  if type(saved) == "table" then saved.clr = serverTime() end
  -- The call put a line in guild chat (and so in Discord): close it there too.
  if mine.posted and SendChatMessage then
    pcall(SendChatMessage, string.format(L("[Guilded] All clear: %s is safe."), clean(mine.name or playerName(), 24)), "GUILD")
  end
  mine = nil
  say(L("All clear sent."))
  refreshOffer()
  if offerFrame then offerFrame:Hide() end
  return true
end

-- True while an attack by an enemy player was confirmed in the last minute.
function module.attacked()
  return attackedAt ~= nil and now() - attackedAt <= ATTACK_WINDOW_SECONDS
end

-- A hit on me. Counts only when an enemy player in combat targets me and it is the second such hit
-- within 10 s (not a duel, not in an instance); then the button shows for 20 s, once per attack
-- (hits less than 30 s apart are the same attack). Never sends.
function module.noteDamage(amount)
  if inInstance() or dueling then return false end
  if type(amount) == "number" and not secret(amount) and amount <= 0 then return false end
  if not module.scan() then return false end
  local t = now()
  local kept = {}
  for _, at in ipairs(hits) do if t - at <= ATTACK_CONFIRM_SECONDS then kept[#kept + 1] = at end end
  kept[#kept + 1] = t
  hits = kept
  if #hits < MIN_HITS then return false end
  local fresh = not lastHitAt or t - lastHitAt > ATTACK_QUIET_SECONDS
  lastHitAt, attackedAt = t, t
  if active() or not fresh then return false end
  offerUntil = t + OFFER_SECONDS
  showOffer()
  return true
end

-- ---------------------------------------------------------------------
-- Receiver
-- ---------------------------------------------------------------------

local function sameZone(call)
  local mapId = position()
  if mapId and call.mapId then return mapId == call.mapId end
  local zone = zoneNames()
  return zone ~= "" and call.zone ~= "" and zone == call.zone
end

local function describe(call, callerName)
  local line = string.format(L("%s is under attack in %s"), display(callerName), call.zone ~= "" and call.zone or "?")
  if call.subzone ~= "" then line = line .. " (" .. call.subzone .. ")" end
  local summary = module.summary(call.attackers)
  if summary ~= "" then line = line .. ", " .. summary end
  return line
end

-- Distance/direction text, or "" when either position is unknown.
local function whereText(call)
  local mapId, x, y = position()
  if not (mapId and call.mapId and mapId == call.mapId and call.x) then return "" end
  local w, h = mapSize(mapId)
  local yards, direction = module.bearing(x, y, call.x, call.y, w, h)
  if yards then return string.format(L("%d yards %s"), yards, L(direction)) end
  return L(direction)
end

local function pinOnMap(callerName, call)
  local map = ns.guildMap
  if not (map and map.members and call.mapId and call.x) then return end
  local existing = map.members[callerName] or {}
  map.members[callerName] = { mapId = call.mapId, x = call.x, y = call.y, class = existing.class, level = call.level, at = now() }
  if map.refresh then pcall(map.refresh) end
end

local function showBanner(call, callerName, sender)
  ensureBanner()
  banner.call, banner.sender, banner.shownAt = call, sender, now()
  banner.text:SetText(string.format(L("CALL FOR HELP: %s"), display(callerName)))
  local where = whereText(call)
  banner.detail:SetText(describe(call, callerName) .. (where ~= "" and ("\n" .. where) or ""))
  banner:Show()
  local sound = (SOUNDKIT and SOUNDKIT.RAID_WARNING) or 8959
  if PlaySound then pcall(PlaySound, sound) end
  if RaidNotice_AddMessage and RaidWarningFrame and ChatTypeInfo then
    pcall(RaidNotice_AddMessage, RaidWarningFrame, string.format(L("CALL FOR HELP: %s"), display(callerName)), ChatTypeInfo["RAID_WARNING"] or { r = 1, g = 0.2, b = 0.2 })
  end
end

-- Handles one message from a guildmate. Returns a short result word (for the tests and /guilded diag).
function module.receive(text, sender, channel)
  local name = ns.normalizeName and ns.normalizeName(sender)
  if not name then return "sender unavailable" end
  if name == playerName() then return "self" end
  if ns.isGuildMember and not ns.isGuildMember(sender) then return "not guild" end
  local msg = module.decode(text)
  if not msg then return "invalid payload" end

  if msg.kind == "reply" then
    -- Replies are whispers to the caller; only my open call counts.
    if channel ~= "WHISPER" or not mine or mine.id ~= msg.id then return "ignored" end
    if mine.responders[name] == msg.coming then return "ignored" end
    mine.responders[name] = msg.coming
    say(string.format(msg.coming and L("%s is on the way.") or L("%s can't come."), display(name)))
    refreshOffer()
    return "reply"
  end

  if channel ~= "GUILD" then return "other channel" end

  if msg.kind == "clear" then
    local entry = incoming[name]
    if not entry or entry.id ~= msg.id then return "ignored" end
    incoming[name] = nil
    if banner and banner.sender == sender and banner:IsShown() then banner:Hide() end
    say(string.format(L("%s: all clear."), display(name)))
    return "clear"
  end

  -- A call. One per caller per two minutes.
  local entry = incoming[name]
  if entry and now() - entry.at < COOLDOWN_SECONDS then return "cooldown" end
  incoming[name] = { at = now(), id = msg.id }
  pinOnMap(name, msg)
  if module.defender() and sameZone(msg) and not inInstance() then
    say(describe(msg, name))
    showBanner(msg, name, sender)
    return "banner"
  end
  say(describe(msg, name))
  return "line"
end

-- On my way (true) or Can't (false): whispered to the caller, then the banner closes.
function module.reply(coming)
  if not (banner and banner.call and banner.sender) then return false end
  local entry = ns.normalizeName and incoming[ns.normalizeName(banner.sender)]
  local id = entry and entry.id or banner.call.id
  ns.comm.send(PREFIX, "R|" .. id .. "|" .. (coming and "Y" or "N"), "WHISPER", banner.sender, nil, "interactive")
  banner:Hide()
  return true
end

-- ---------------------------------------------------------------------
-- Commands, key binding, events
-- ---------------------------------------------------------------------

ns.commandHandlers = ns.commandHandlers or {}
-- Asks before sending: typing the command to see the options must never post in guild chat.
function module.confirm()
  if StaticPopupDialogs and StaticPopup_Show then
    StaticPopupDialogs["GUILDED_CALL_FOR_HELP"] = StaticPopupDialogs["GUILDED_CALL_FOR_HELP"] or {
      text = L("Call for help now?"), button1 = YES or "Yes", button2 = NO or "No",
      OnAccept = function() module.open() end, timeout = 15, whileDead = true, hideOnEscape = true, preferredIndex = 3 }
    StaticPopupDialogs["GUILDED_CALL_FOR_HELP"].text = L("Call for help now?")
    if pcall(StaticPopup_Show, "GUILDED_CALL_FOR_HELP") then return true end
  end
  return false
end

local function options()
  local s = settings()
  say(string.format(L("Call for help: defender %s, guild chat line %s."),
    module.defender() and L("on") or L("off"), module.guildChat() and L("on") or L("off")))
  say(L("/guilded sos now | clear | status | defender on|off | chat on|off"))
  return s
end

ns.commandHandlers["sos"] = function(args)
  local what, value = string.lower(args[1] or ""), string.lower(args[2] or "")
  local s = ns.getSettings and ns.getSettings()
  if what == "now" or what == "send" then
    module.open()
  elseif what == "clear" or what == "allclear" then
    if not module.allClear() then say(L("You have no open call for help.")) end
  elseif what == "defender" and (value == "on" or value == "off") and s then
    s.helpDefender = value == "on"
    say(s.helpDefender and L("You will get a loud alert when a guildmate in your zone calls for help.")
      or L("You will only see a chat line when a guildmate calls for help."))
  elseif what == "chat" and (value == "on" or value == "off") and s then
    s.helpGuildChat = value == "on"
    say(s.helpGuildChat and L("A call for help also posts one line in guild chat.") or L("A call for help stays on Guilded only."))
  elseif what == "status" then
    options()
  else
    options()
    module.confirm()
  end
end
ns.commandHandlers["callforhelp"] = ns.commandHandlers["sos"]
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded sos - options and a confirm to call guildmates for help (now, clear, status, defender on|off, chat on|off); /gsos too")

-- The key binding (Bindings.xml: Options > Keybindings > Guilded).
BINDING_NAME_GUILDED_CALL_FOR_HELP = L("Call for help")
function Guilded_CallForHelp() module.open() end
if SlashCmdList and not SlashCmdList["GUILDEDSOS"] then
  SLASH_GUILDEDSOS1 = "/gsos"
  SlashCmdList["GUILDEDSOS"] = function() ns.commandHandlers["sos"]({}) end
end

local frame = CreateFrame("Frame")
local function register(event)
  if ns.compat and ns.compat.registerEvent then ns.compat.registerEvent(frame, event, true)
  else pcall(frame.RegisterEvent, frame, event) end
end
register("PLAYER_LOGIN")
register("CHAT_MSG_ADDON")
register("UNIT_COMBAT")
register("DUEL_INBOUNDS")
register("DUEL_FINISHED")
register("PLAYER_ENTERING_WORLD")

local sinceTick = 0
local matesAt = 0
local function onUpdate(_, elapsed)
  sinceTick = sinceTick + (elapsed or 0)
  if sinceTick < 1 then return end
  sinceTick = 0
  local t = now()
  if offerFrame and offerFrame:IsShown() then
    if mine then
      if t - mine.at > EXPIRE_SECONDS then mine = nil; offerFrame:Hide(); say(L("Your call for help expired.")) end
    elseif offerUntil and t > offerUntil then offerFrame:Hide(); offerUntil = nil end
  end
  if banner and banner:IsShown() and banner.shownAt and t - banner.shownAt > BANNER_SECONDS then banner:Hide() end
  if mine and offerFrame and offerFrame:IsShown() and t - (matesAt or 0) >= MATE_REFRESH_SECONDS then
    matesAt = t
    module.refreshMates()
  end
  if not mine and not inInstance() then position() end -- remember where I was before combat
end

frame:SetScript("OnEvent", function(_, event, ...)
  local args = { ... }
  local ok, err = pcall(function()
    if event == "PLAYER_LOGIN" then
      ns.comm.register(PREFIX)
      frame:SetScript("OnUpdate", onUpdate)
    elseif event == "UNIT_COMBAT" then
      if args[1] == "player" and args[2] == "WOUND" then module.noteDamage(args[4]) end
    elseif event == "DUEL_INBOUNDS" then
      dueling, hits = true, {}
    elseif event == "DUEL_FINISHED" or event == "PLAYER_ENTERING_WORLD" then
      dueling, hits = false, {}
    elseif event == "CHAT_MSG_ADDON" then
      local prefix, text, channel, sender = args[1], args[2], args[3], args[4]
      if secret(prefix) or prefix ~= PREFIX then return end
      if not ns.comm.accept(prefix, text, channel, sender, PREFIX) then return end
      module.receive(text, sender, channel)
    end
  end)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "call for help: " .. tostring(err)) end
end)
