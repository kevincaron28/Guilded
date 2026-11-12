-- Call for help: one button when guildmates are being ganked in the open world.
--
--   /guilded sos            show the options and ask "Call for help now?" (also /gsos)
--   /guilded sos now        call for help at once (the button, the key binding and the quick menu do too)
--   /guilded sos clear      all clear
--   /guilded sos defender on|off   get the loud alert when a guildmate in your zone calls (default: on)
--   /guilded sos chat on|off       also post one short line in guild chat (default on)
--
--   /guilded sos alert toast|chat|off   how a guildmate's call reaches me (default: a small window)
--   /guilded sos sound on|off | quiet on|off | mute | unmute | show | reset
--
-- (/guilded help is Core's command list, so the call uses /guilded sos.)
--
-- The Call for help button appears for 20 s when an enemy player damages you outside an
-- instance. Nothing is ever sent by itself: the player presses the button (or the key, or the
-- command). The call goes to the guild on the addon prefix GuildedSOS; guildmates in the same
-- zone who are Defenders get a small toast (top right, movable, closable, click-through, hides by
-- itself; only a chat line and an SOS icon in combat), a soft sound, distance and direction, and On my
-- way / Can't buttons. Everyone else gets one line in Guilded's chat tab. No protected action is used, so
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
-- A duel request nobody accepts (declined, out of range, timed out) may never fire DUEL_FINISHED: it stops
-- counting as a duel after this long, so a real attack right after it still offers the button.
local DUEL_REQUEST_SECONDS = 60
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
local duelAskedAt        -- a duel was asked for (by me or of me) at this time; counts for DUEL_REQUEST_SECONDS unless it starts
local duelStarted = false -- the countdown ran or I walked back in: a duel is in progress until DUEL_FINISHED
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

-- How a guildmate's call reaches me: "toast" (a small window, the default), "chat" (one chat line) or "off".
function module.alertMode()
  local mode = settings().helpAlert
  if mode == "off" or mode == "chat" then return mode end
  return "toast"
end

function module.sound()
  return settings().helpSound ~= false
end

-- Quiet in combat (default on): no window and no sound while I fight, only a chat line and a small SOS icon.
function module.quiet()
  return settings().helpQuiet ~= false
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

-- A duel: started (countdown) until it finishes, or just asked for and not yet older than DUEL_REQUEST_SECONDS.
local function isDueling()
  if duelStarted then return true end
  return duelAskedAt ~= nil and now() - duelAskedAt <= DUEL_REQUEST_SECONDS
end
local function duelAsked() duelAskedAt, hits = now(), {} end
local function duelBegan() duelStarted, duelAskedAt, hits = true, nil, {} end
local function duelEnded() duelStarted, duelAskedAt, hits = false, nil, {} end

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

local offerFrame, banner, anchor, icon
local describe, whereText   -- defined in the receiver section, used by the toast
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

-- Invite buttons show "/invite First Last" in the copy box (util.inviteButton, which also says to copy and paste it):
-- the party invite API is refused to addon code on WoW Forever. This runs after the click.
function module.invited(name)
  if not name or name == "" then return false end
  return true
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


-- ---------------------------------------------------------------------
-- Frames (created lazily; plain non-secure frames, no protected actions).
--
-- Small and never in the way: a compact window (TOAST_W wide) near the top right, medium strata (under
-- dialogs and the game menu), clicks pass straight through it except on its own buttons and its title strip, it
-- never takes the keyboard, it closes with the X or a right-click on the title strip, it hides by itself, and
-- it can be dragged (the position is saved). One window carries every waiting call. Nothing here is protected,
-- so all of it works in combat.
-- ---------------------------------------------------------------------

local TOAST_W = 300
local TOAST_H = 104
local FOOTPRINT_H = 170       -- the toast with the caller's offer under it: the box that must stay on screen
local ICON_W = 64
local DEFAULT_POS = { "TOPRIGHT", "TOPRIGHT", -20, -220 }
local queue = {}          -- calls waiting for the toast: { call, name, sender, key, at }
local muteUntil           -- this session only
local presentNext         -- forward declaration

local function makeButton(parent, label, width, onClick)
  local b = CreateFrame("Button", nil, parent, "UIPanelButtonTemplate")
  b:SetWidth(width)
  b:SetHeight(22)
  if b.SetText then b:SetText(label) end
  b:SetScript("OnClick", onClick)
  return b
end

-- Where the windows sit: a saved { point, relativePoint, x, y } or the default top right.
local function savedPos()
  local p = settings().helpPos
  if type(p) == "table" and type(p[1]) == "string" and type(p[2]) == "string" and type(p[3]) == "number" and type(p[4]) == "number" then return p end
  return DEFAULT_POS
end

-- The screen in UIParent units (already counts the UI scale), or nil when the game does not say.
local function screenSize()
  if not UIParent then return nil end
  local okW, w = pcall(UIParent.GetWidth, UIParent)
  local okH, h = pcall(UIParent.GetHeight, UIParent)
  if okW and okH and type(w) == "number" and type(h) == "number" and w > TOAST_W and h > FOOTPRINT_H then return w, h end
  return nil
end

local function finite(n) return type(n) == "number" and n == n and n > -100000 and n < 100000 end

-- A position as { left, top } (top counted up from the bottom edge) of the whole footprint, kept inside the screen
-- (the toast and the offer under it, not just the anchor point). nil when the numbers make no sense.
local function onScreen(point, relPoint, x, y, w, h)
  if type(point) ~= "string" or type(relPoint) ~= "string" or not finite(x) or not finite(y) then return nil end
  local function has(text, part) return string.find(text, part, 1, true) ~= nil end
  local baseX = has(relPoint, "LEFT") and 0 or has(relPoint, "RIGHT") and w or w / 2
  local baseY = has(relPoint, "TOP") and h or has(relPoint, "BOTTOM") and 0 or h / 2
  local dx = has(point, "LEFT") and 0 or has(point, "RIGHT") and TOAST_W or TOAST_W / 2
  local dy = has(point, "TOP") and 0 or has(point, "BOTTOM") and FOOTPRINT_H or FOOTPRINT_H / 2
  local left, top = baseX + x - dx, baseY + y + dy
  left = math.max(0, math.min(w - TOAST_W, left))
  top = math.max(FOOTPRINT_H, math.min(h, top))
  return left, top
end

local function placeAnchor()
  if not anchor then return end
  local p = savedPos()
  local w, h = screenSize()
  if w then
    local left, top = onScreen(p[1], p[2], p[3], p[4], w, h)
    if not left then left, top = onScreen(DEFAULT_POS[1], DEFAULT_POS[2], DEFAULT_POS[3], DEFAULT_POS[4], w, h) end
    p = { "TOPLEFT", "BOTTOMLEFT", left, top }
  end
  anchor:ClearAllPoints()
  anchor:SetPoint(p[1], UIParent, p[2], p[3], p[4])
end

-- Saves a position (a dragged or restored one). With a known screen it is stored as the top-left corner, kept on screen.
function module.setPosition(point, relPoint, x, y)
  if type(point) ~= "string" or type(relPoint) ~= "string" or type(x) ~= "number" or type(y) ~= "number" then return false end
  local s = ns.getSettings and ns.getSettings()
  if not s then return false end
  local w, h = screenSize()
  if w then
    local left, top = onScreen(point, relPoint, x, y, w, h)
    if not left then return false end
    s.helpPos = { "TOPLEFT", "BOTTOMLEFT", math.floor(left + 0.5), math.floor(top + 0.5) }
  else
    s.helpPos = { point, relPoint, math.floor(x + 0.5), math.floor(y + 0.5) }
  end
  return true
end

function module.resetPosition()
  local s = ns.getSettings and ns.getSettings()
  if s then s.helpPos = nil end
  placeAnchor()
end

-- One invisible, click-through frame holds the position; the toast, the offer and the icon hang from it.
local function ensureAnchor()
  if anchor then return anchor end
  anchor = CreateFrame("Frame", nil, UIParent)
  anchor:SetWidth(TOAST_W)
  anchor:SetHeight(FOOTPRINT_H)
  anchor:SetMovable(true)
  anchor:SetClampedToScreen(true)
  anchor:EnableMouse(false)
  placeAnchor()
  return anchor
end

-- The box the toast and its offer fill, for other toasts (Layer invite) that stack below it. Read only.
function module.footprint() return ensureAnchor() end

local function layout()
  if not anchor then return end
  if banner then banner:ClearAllPoints(); banner:SetPoint("TOPLEFT", anchor, "TOPLEFT", 0, 0) end
  if icon then icon:ClearAllPoints(); icon:SetPoint("TOPLEFT", anchor, "TOPLEFT", 0, 0) end
  if offerFrame then
    local below = (banner and banner.isOpen and (TOAST_H + 4)) or (icon and icon.isOpen and 30) or 0
    offerFrame:ClearAllPoints()
    offerFrame:SetPoint("TOPLEFT", anchor, "TOPLEFT", 0, -below)
  end
end

-- The title strip (drag to move, right-click to close) and the X: the only parts of a window that take the mouse.
local function addChrome(f, onClose)
  local grip = CreateFrame("Button", nil, f)
  grip:SetPoint("TOPLEFT", f, "TOPLEFT", 4, -4)
  grip:SetPoint("TOPRIGHT", f, "TOPRIGHT", -26, -4)
  grip:SetHeight(18)
  grip:RegisterForDrag("LeftButton")
  grip:RegisterForClicks("RightButtonUp")
  grip:SetScript("OnDragStart", function() if anchor then anchor:StartMoving() end end)
  grip:SetScript("OnDragStop", function()
    if not anchor then return end
    anchor:StopMovingOrSizing()
    -- Where the footprint's top-left corner is now (counted up from the bottom edge): saved, kept on screen.
    local left, top = anchor:GetLeft(), anchor:GetTop()
    if type(left) == "number" and type(top) == "number" and module.setPosition("TOPLEFT", "BOTTOMLEFT", left, top) then placeAnchor() end
  end)
  grip:SetScript("OnClick", function(_, button) if button == "RightButton" then onClose() end end)
  f.grip = grip
  local x = CreateFrame("Button", nil, f, "UIPanelCloseButton")
  x:SetWidth(22)
  x:SetHeight(22)
  x:SetPoint("TOPRIGHT", f, "TOPRIGHT", -2, -2)
  x:SetScript("OnClick", onClose)
  f.close = x
end

local function makeToast(height, onClose)
  ensureAnchor()
  local f = CreateFrame("Frame", nil, UIParent, BackdropTemplateMixin and "BackdropTemplate" or nil)
  f:SetWidth(TOAST_W)
  f:SetHeight(height)
  if f.SetFrameStrata then f:SetFrameStrata("MEDIUM") end
  f:EnableMouse(false) -- clicks pass through; never EnableKeyboard
  if f.SetClampedToScreen then f:SetClampedToScreen(true) end -- the window itself stays on screen, whatever was saved
  f.isOpen = false
  if f.SetBackdrop then
    pcall(f.SetBackdrop, f, { bgFile = "Interface\\Tooltips\\UI-Tooltip-Background", edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border",
      tile = true, tileSize = 16, edgeSize = 12, insets = { left = 3, right = 3, top = 3, bottom = 3 } })
    if f.SetBackdropColor then pcall(f.SetBackdropColor, f, 0.05, 0.05, 0.07, 0.88) end
  end
  f.text = f:CreateFontString(nil, "OVERLAY", "GameFontNormal")
  f.text:SetPoint("TOPLEFT", f, "TOPLEFT", 10, -8)
  f.text:SetWidth(TOAST_W - 40)
  if f.text.SetJustifyH then f.text:SetJustifyH("LEFT") end
  addChrome(f, onClose)
  if f.Hide then f:Hide() end
  return f
end

-- ----- The caller's offer: Call for help, then All clear. Small, closable, hides by itself. -----

local OFFER_H = 62
local OFFER_ROW = 24
local OFFER_OPEN_SECONDS = 60   -- after calling, the window closes by itself; the call stays open (/guilded sos clear)

local function closeOffer()
  if offerFrame then offerFrame:Hide(); offerFrame.isOpen = false end
  offerUntil = nil
  layout()
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
    offerFrame.expanded = false
  end
  offerFrame.text:SetText(text)
  module.refreshMates()
end

-- The caller's list of online guildmates in the same zone, each with an Invite button (folded away until asked for).
local function refreshMatesNow()
  if not offerFrame then return 0 end
  local mates = mine and module.zoneMates() or {}
  local open = offerFrame.expanded == true
  for i = 1, MAX_MATES do
    local row = mateRows[i]
    local mate = mates[i]
    if mate and not row then
      row = {}
      row.label = offerFrame:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
      row.label:SetPoint("TOPLEFT", offerFrame, "TOPLEFT", 12, -30 - (i - 1) * OFFER_ROW)
      row.button = ns.util.inviteButton(offerFrame, "party", L("Invite"), 70, 22, function(name) module.invited(name) end)
      row.button:SetPoint("TOPRIGHT", offerFrame, "TOPRIGHT", -10, -26 - (i - 1) * OFFER_ROW)
      mateRows[i] = row
    end
    if row then
      if mate then
        row.name = mate.name
        row.label:SetText(display(mate.name) .. (mate.level and mate.level > 0 and (" (" .. mate.level .. ")") or ""))
        row.button.setInvite(mate.name)
        if open then row.label:Show(); row.button:Show() else row.label:Hide(); row.button:Hide() end
      else
        row.name = nil
        row.label:Hide(); row.button:Hide(); row.button.setInvite(nil)
      end
    end
  end
  if #mates > 0 then
    offerFrame.nearby:SetText(string.format(L("Nearby (%d)"), #mates))
    offerFrame.nearby:Show()
  else
    offerFrame.nearby:Hide()
    offerFrame.expanded = false
  end
  offerFrame:SetHeight(OFFER_H + ((open and #mates > 0) and (#mates * OFFER_ROW + 4) or 0))
  return #mates
end

-- The Invite buttons are plain buttons now, but the list only changes out of combat anyway (nothing to do in a fight).
function module.refreshMates()
  if not offerFrame then return 0 end
  if ns.util.inCombat() then
    ns.util.afterCombat("callForHelp.mates", refreshMatesNow, true)
    return #(mine and module.zoneMates() or {})
  end
  return refreshMatesNow()
end

local function ensureOffer()
  if offerFrame then return offerFrame end
  offerFrame = makeToast(OFFER_H, function() closeOffer() end)
  offerFrame.expanded = false
  offerFrame.call = makeButton(offerFrame, L("Call for help"), 140, function() module.open() end)
  offerFrame.call:SetPoint("BOTTOMLEFT", offerFrame, "BOTTOMLEFT", 10, 8)
  offerFrame.clear = makeButton(offerFrame, L("All clear"), 140, function() module.allClear() end)
  offerFrame.clear:SetPoint("BOTTOMLEFT", offerFrame, "BOTTOMLEFT", 10, 8)
  offerFrame.nearby = makeButton(offerFrame, L("Nearby"), 110, function()
    offerFrame.expanded = not offerFrame.expanded
    refreshMatesNow()
  end)
  offerFrame.nearby:SetPoint("BOTTOMRIGHT", offerFrame, "BOTTOMRIGHT", -10, 8)
  offerFrame.nearby:Hide()
  return offerFrame
end

local function showOffer()
  ensureOffer()
  refreshOffer()
  offerFrame.isOpen = true
  offerFrame.shownAt = now()
  offerFrame:Show()
  layout()
end
module.showOffer = function()
  if not (mine or offerUntil) then offerUntil = now() + OFFER_SECONDS end
  showOffer()
end

-- ----- The toast for a guildmate's call: one window, one call at a time, the others wait their turn. -----

local TOAST_SECONDS = 15          -- on screen out of combat
local TOAST_COMBAT_SECONDS = 6    -- in combat (quiet mode off)
local TOAST_LIVE_SECONDS = 120    -- a waiting call older than this is stale and dropped
local MUTE_SECONDS = 600

local function closeToast()
  if banner then banner:Hide(); banner.isOpen = false; banner.call, banner.sender, banner.callerName = nil, nil, nil end
  layout()
end

local function hideIcon()
  if icon then icon:Hide(); icon.isOpen = false end
  layout()
end

local function showIcon()
  ensureAnchor()
  if not icon then
    icon = CreateFrame("Button", nil, UIParent, BackdropTemplateMixin and "BackdropTemplate" or nil)
    icon:SetWidth(ICON_W)
    icon:SetHeight(26)
    if icon.SetFrameStrata then icon:SetFrameStrata("MEDIUM") end
    if icon.SetClampedToScreen then icon:SetClampedToScreen(true) end
    if icon.SetBackdrop then
      pcall(icon.SetBackdrop, icon, { bgFile = "Interface\\Tooltips\\UI-Tooltip-Background", edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border",
        tile = true, tileSize = 16, edgeSize = 10, insets = { left = 2, right = 2, top = 2, bottom = 2 } })
      if icon.SetBackdropColor then pcall(icon.SetBackdropColor, icon, 0.5, 0.05, 0.05, 0.9) end
    end
    icon.isOpen = false
    icon.text = icon:CreateFontString(nil, "OVERLAY", "GameFontNormal")
    icon.text:SetPoint("CENTER", icon, "CENTER", 0, 0)
    icon:RegisterForClicks("LeftButtonUp", "RightButtonUp")
    icon:SetScript("OnClick", function(_, button)
      if button == "RightButton" then module.dismissAll() else module.expand() end
    end)
    icon:Hide()
  end
  icon.text:SetText("SOS " .. #queue)
  icon.isOpen = true
  icon:Show()
  layout()
end

local function ensureBanner()
  if banner then return banner end
  banner = makeToast(TOAST_H, function() module.dismiss() end)
  banner.detail = banner:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  banner.detail:SetPoint("TOPLEFT", banner.text, "BOTTOMLEFT", 0, -3)
  banner.detail:SetWidth(TOAST_W - 20)
  if banner.detail.SetJustifyH then banner.detail:SetJustifyH("LEFT") end
  banner.coming = makeButton(banner, L("On my way"), 92, function() module.reply(true) end)
  banner.coming:SetPoint("BOTTOMLEFT", banner, "BOTTOMLEFT", 10, 34)
  banner.cant = makeButton(banner, L("Can't"), 60, function() module.reply(false) end)
  banner.cant:SetPoint("LEFT", banner.coming, "RIGHT", 4, 0)
  banner.mute = makeButton(banner, L("Mute 10 min"), 100, function() module.mute() end)
  banner.mute:SetPoint("LEFT", banner.cant, "RIGHT", 4, 0)
  banner.join = makeButton(banner, L("Join"), 92, function() module.join() end)
  banner.join:SetPoint("BOTTOMLEFT", banner, "BOTTOMLEFT", 10, 8)
  banner.inviteCaller = ns.util.inviteButton(banner, "party", L("Invite caller"), 120, 22, function(name) module.invited(name) end)
  banner.inviteCaller:SetPoint("LEFT", banner.join, "RIGHT", 4, 0)
  return banner
end

local function setToastTitle()
  if not (banner and banner.isOpen and banner.callerName) then return end
  local title = string.format(L("CALL FOR HELP: %s"), display(banner.callerName))
  if #queue > 0 then title = title .. " " .. string.format(L("(+%d more)"), #queue) end
  banner.text:SetText(title)
end

local function showEntry(entry)
  ensureBanner()
  local call = entry.call
  banner.call, banner.sender, banner.callerName, banner.shownAt, banner.isOpen = call, entry.sender, entry.name, now(), true
  banner.seconds = ns.util.inCombat() and TOAST_COMBAT_SECONDS or TOAST_SECONDS
  banner.inviteCaller.setInvite(entry.sender)
  setToastTitle()
  local where = whereText(call)
  banner.detail:SetText(describe(call, entry.name) .. (where ~= "" and ("\n" .. where) or ""))
  banner:Show()
  layout()
end

local function playAlert()
  if not module.sound() or not PlaySound then return end
  local sound = (SOUNDKIT and SOUNDKIT.IG_PLAYER_INVITE) or 880
  pcall(PlaySound, sound)
end

-- Waiting calls still worth showing: not too old and not cleared by their caller.
local function purgeQueue()
  local kept = {}
  for _, e in ipairs(queue) do
    local entry = incoming[e.key]
    if now() - e.at <= TOAST_LIVE_SECONDS and entry and entry.id == e.call.id then kept[#kept + 1] = e end
  end
  queue = kept
end

presentNext = function()
  purgeQueue()
  if #queue == 0 then hideIcon(); return false end
  if module.quiet() and ns.util.inCombat() then showIcon(); return false end
  hideIcon()
  if module.muted() or module.alertMode() ~= "toast" then queue = {}; return false end
  showEntry(table.remove(queue, 1))
  return true
end

-- A call to show. Returns "banner" (shown, merged into the open window, or waiting behind the combat icon).
function module.enqueue(call, callerName, sender)
  local key = baseName(sender)
  local entry = { call = call, name = callerName, sender = sender, key = key, at = now() }
  for i = #queue, 1, -1 do if queue[i].key == key then table.remove(queue, i) end end
  if banner and banner.isOpen then
    if banner.sender == sender then showEntry(entry) else queue[#queue + 1] = entry; setToastTitle() end
    return "banner"
  end
  if module.quiet() and ns.util.inCombat() then
    queue[#queue + 1] = entry
    showIcon()
    return "banner"
  end
  showEntry(entry)
  playAlert()
  return "banner"
end

-- The X, a right-click on the title strip or the toast timer: close this call, show the next one if any.
function module.dismiss()
  closeToast()
  presentNext()
end

function module.dismissAll()
  queue = {}
  closeToast()
  hideIcon()
end

-- The combat icon was clicked: show the next waiting call now, even in combat.
function module.expand()
  purgeQueue()
  hideIcon()
  if #queue == 0 then return false end
  showEntry(table.remove(queue, 1))
  return true
end

function module.mute(seconds)
  muteUntil = now() + (tonumber(seconds) or MUTE_SECONDS)
  module.dismissAll()
  say(L("Guilded: calls for help muted for 10 minutes."))
end

function module.unmute()
  muteUntil = nil
  say(L("Guilded: calls for help unmuted."))
end

function module.muted()
  if muteUntil and now() >= muteUntil then muteUntil = nil end
  return muteUntil ~= nil
end

-- ---------------------------------------------------------------------
-- Caller side
-- ---------------------------------------------------------------------

local function guildChatLine(call)
  -- In the caller's own language (their client's Locale), like the all-clear line.
  local place = clean(call.zone ~= "" and call.zone or L("the open world"), 28)
  local line = string.format(L("[Guilded] Help! %s is under attack in %s"), clean(call.name, 24), place)
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
  if ns.worldPvp then pcall(ns.worldPvp.note, "call") end
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
  closeOffer()
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
  if inInstance() or isDueling() then return false end
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

describe = function(call, callerName)
  local line = string.format(L("%s is under attack in %s"), display(callerName), call.zone ~= "" and call.zone or "?")
  if call.subzone ~= "" then line = line .. " (" .. call.subzone .. ")" end
  local summary = module.summary(call.attackers)
  if summary ~= "" then line = line .. ", " .. summary end
  return line
end

-- Distance/direction text, or "" when either position is unknown.
whereText = function(call)
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
    if msg.coming and ns.worldPvp then pcall(ns.worldPvp.note, "answered") end
    say(string.format(msg.coming and L("%s is on the way.") or L("%s can't come."), display(name)))
    refreshOffer()
    return "reply"
  end

  if channel ~= "GUILD" then return "other channel" end

  if msg.kind == "clear" then
    local entry = incoming[name]
    if not entry or entry.id ~= msg.id then return "ignored" end
    incoming[name] = nil
    for i = #queue, 1, -1 do if queue[i].key == name then table.remove(queue, i) end end
    if banner and banner.isOpen and banner.sender == sender then closeToast(); presentNext() else setToastTitle() end
    if icon and icon.isOpen then purgeQueue(); if #queue == 0 then hideIcon() else showIcon() end end
    say(string.format(L("%s: all clear."), display(name)))
    return "clear"
  end

  -- A call. One per caller per two minutes.
  local entry = incoming[name]
  if entry and now() - entry.at < COOLDOWN_SECONDS then return "cooldown" end
  incoming[name] = { at = now(), id = msg.id }
  pinOnMap(name, msg)
  local mode = module.alertMode()
  if mode == "off" then return "off" end
  say(describe(msg, name))
  if mode == "toast" and not module.muted() and module.defender() and sameZone(msg) and not inInstance() then
    return module.enqueue(msg, name, sender)
  end
  return "line"
end

-- On my way (true) or Can't (false): whispered to the caller, then the banner closes.
function module.reply(coming)
  if not (banner and banner.call and banner.sender) then return false end
  local entry = ns.normalizeName and incoming[ns.normalizeName(banner.sender)]
  local id = entry and entry.id or banner.call.id
  ns.comm.send(PREFIX, "R|" .. id .. "|" .. (coming and "Y" or "N"), "WHISPER", banner.sender, nil, "interactive")
  if coming and ns.worldPvp then pcall(ns.worldPvp.note, "responded", banner.call.zone, banner.call.mapId) end
  closeToast()
  presentNext()
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
  say(string.format(L("Call alerts: %s, sound %s, quiet in combat %s."), module.alertMode() == "toast" and L("small window") or module.alertMode() == "chat" and L("chat line only") or L("off"),
    module.sound() and L("on") or L("off"), module.quiet() and L("on") or L("off")))
  say(L("/guilded sos alert toast|chat|off | sound on|off | quiet on|off | mute | unmute | show | reset"))
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
  elseif what == "alert" and (value == "toast" or value == "chat" or value == "off") and s then
    s.helpAlert = value
    if value ~= "toast" then module.dismissAll() end
    options()
  elseif what == "sound" and (value == "on" or value == "off") and s then
    s.helpSound = value == "on"
    options()
  elseif what == "quiet" and (value == "on" or value == "off") and s then
    s.helpQuiet = value == "on"
    options()
  elseif what == "mute" then
    module.mute()
  elseif what == "unmute" then
    module.unmute()
  elseif what == "show" then
    module.showOffer()
  elseif what == "reset" then
    module.resetPosition()
    say(L("The call for help window is back at its default place."))
  elseif what == "status" then
    options()
  else
    options()
    module.confirm()
  end
end
ns.commandHandlers["callforhelp"] = ns.commandHandlers["sos"]
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded sos - options and a confirm to call guildmates for help (now, clear, status, defender on|off, chat on|off, alert toast|chat|off, sound, quiet, mute, unmute, show, reset); /gsos too")

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
-- DUEL_INBOUNDS only fires on walking back inside the duel flag's area, so it cannot mark the
-- start of a duel by itself: a request (either side) and the countdown do. DUEL_FINISHED ends it.
register("DUEL_REQUESTED")
register("DUEL_COUNTDOWN")
register("DUEL_INBOUNDS")
register("DUEL_OUTOFBOUNDS")
register("DUEL_FINISHED")
register("PLAYER_ENTERING_WORLD")
register("PLAYER_REGEN_ENABLED") -- combat over: show the call the SOS icon was holding
-- I asked for the duel: hooksecurefunc only watches StartDuel and taints nothing.
if hooksecurefunc and StartDuel then pcall(hooksecurefunc, "StartDuel", duelAsked) end

local sinceTick = 0
local matesAt = 0
local function onUpdate(_, elapsed)
  sinceTick = sinceTick + (elapsed or 0)
  if sinceTick < 1 then return end
  sinceTick = 0
  local t = now()
  if mine and t - mine.at > EXPIRE_SECONDS then
    mine = nil
    if offerFrame and offerFrame.isOpen then closeOffer() end
    say(L("Your call for help expired."))
  end
  if offerFrame and offerFrame.isOpen then
    if mine then
      if t - (offerFrame.shownAt or t) > OFFER_OPEN_SECONDS then closeOffer() end
    elseif offerUntil and t > offerUntil then closeOffer() end
  end
  if banner and banner.isOpen and banner.shownAt and t - banner.shownAt > (banner.seconds or TOAST_SECONDS) then
    closeToast()
    presentNext()
  end
  if icon and icon.isOpen and not ns.util.inCombat() then presentNext() end
  if mine and offerFrame and offerFrame.isOpen and t - (matesAt or 0) >= MATE_REFRESH_SECONDS then
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
    elseif event == "PLAYER_REGEN_ENABLED" then
      if not (banner and banner.isOpen) then presentNext() end
    elseif event == "UNIT_COMBAT" then
      if args[1] == "player" and args[2] == "WOUND" then module.noteDamage(args[4]) end
    elseif event == "DUEL_REQUESTED" then
      if not duelStarted then duelAsked() end
    elseif event == "DUEL_COUNTDOWN" or event == "DUEL_INBOUNDS" or event == "DUEL_OUTOFBOUNDS" then
      duelBegan()
    elseif event == "DUEL_FINISHED" or event == "PLAYER_ENTERING_WORLD" then
      duelEnded()
    elseif event == "CHAT_MSG_ADDON" then
      local prefix, text, channel, sender = args[1], args[2], args[3], args[4]
      if secret(prefix) or prefix ~= PREFIX then return end
      if not ns.comm.accept(prefix, text, channel, sender, PREFIX) then return end
      module.receive(text, sender, channel)
    end
  end)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "call for help: " .. tostring(err)) end
end)
