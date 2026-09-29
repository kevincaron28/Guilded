-- Guild map: guildmates who run Guilded show as class-coloured dots on the world map and the
-- minimap, with their name, level and zone on hover.
--
--   /guilded map                  who is where (and your settings)
--   /guilded map share on|off     send your position to the guild (default on)
--   /guilded map show on|off      show guildmates' dots (default on)
--
-- Each client sends its own map position to the guild channel (prefix GuildedMap) every few
-- seconds while it moves, and every 30 s while it stands still. Nothing is sent inside an
-- instance or in combat (the game hides positions there and limits addon messages); a "gone"
-- message then clears your dot for everyone. Dots fade after 90 s without news.
--
-- All map APIs are optional: a client without one of them just shows fewer dots.
local addonName, ns = ...
ns = ns or {}

local PREFIX = "GuildedMap"
local SEND_MOVING_SECONDS = 5
local SEND_IDLE_SECONDS = 30
local EXPIRE_SECONDS = 90
-- Moving less than this share of the map is "standing still".
local MOVE_THRESHOLD = 0.002
local TICK_SECONDS = 1
local MINIMAP_REFRESH_SECONDS = 0.2
-- Minimap diameter in yards per zoom level (0 = most zoomed out), outdoors and indoors.
local MINIMAP_OUTDOOR = { [0] = 466 + 2 / 3, 400, 333 + 1 / 3, 266 + 2 / 3, 200, 133 + 1 / 3 }
local MINIMAP_INDOOR = { [0] = 300, 240, 180, 120, 80, 50 }
local PIN_TEXTURE = "Interface\\WorldMap\\WorldMapPartyIcon"

local map = { members = {}, worldPins = {}, minimapPins = {} }
ns.guildMap = map

local function active() return not ns.moduleActive or ns.moduleActive("guildmap") end
local function secret(value) return ns.isSecret and ns.isSecret(value) end
local function clock()
  local ok, value = pcall(GetTime)
  if ok and type(value) == "number" then return value end
  return time()
end
local function L(text) return ns.L and ns.L(text) or text end

local function settings()
  local s = ns.getSettings and ns.getSettings()
  if not s then return nil end
  if s.mapShare == nil then s.mapShare = true end
  if s.mapShow == nil then s.mapShow = true end
  return s
end

-- ---------------------------------------------------------------------
-- Positions
-- ---------------------------------------------------------------------

-- Your map and position (0..1), or nil where the game does not give one (instances, some
-- clients, secret values).
function map.myPosition()
  if IsInInstance then
    local ok, inside = pcall(IsInInstance)
    if ok and inside then return nil end
  end
  if not (C_Map and C_Map.GetBestMapForUnit and C_Map.GetPlayerMapPosition) then return nil end
  local ok, mapId = pcall(C_Map.GetBestMapForUnit, "player")
  if not ok or type(mapId) ~= "number" or secret(mapId) then return nil end
  local okPos, position = pcall(C_Map.GetPlayerMapPosition, mapId, "player")
  if not okPos or not position then return nil end
  local okXY, x, y = pcall(function() return position:GetXY() end)
  if not okXY or type(x) ~= "number" or type(y) ~= "number" or secret(x) or secret(y) then return nil end
  if x <= 0 and y <= 0 then return nil end
  return mapId, x, y
end

-- A point on one map as a point on another (a zone on its continent map, say), or nil when the
-- viewed map does not contain it.
function map.translate(fromMap, x, y, toMap)
  if fromMap == toMap then return x, y end
  if not (C_Map and C_Map.GetWorldPosFromMapPos and C_Map.GetMapPosFromWorldPos and CreateVector2D) then return nil end
  local ok, continent, world = pcall(C_Map.GetWorldPosFromMapPos, fromMap, CreateVector2D(x, y))
  if not ok or not continent or not world then return nil end
  local okMap, uiMap, position = pcall(C_Map.GetMapPosFromWorldPos, continent, world, toMap)
  if not okMap or not position or (uiMap and uiMap ~= toMap) then return nil end
  local okXY, tx, ty = pcall(function() return position:GetXY() end)
  if not okXY or type(tx) ~= "number" or type(ty) ~= "number" then return nil end
  if tx < 0 or tx > 1 or ty < 0 or ty > 1 then return nil end
  return tx, ty
end

-- Where a guildmate is on the minimap, as a share of its radius (east, north; 1 = the edge), or
-- nil when off the minimap or not on your map.
function map.minimapOffset(mine, other, facing, zoom, indoors)
  local ox, oy = map.translate(other.mapId, other.x, other.y, mine.mapId)
  if not ox then return nil end
  if not C_Map then return nil end
  local east, north
  if C_Map.GetMapWorldSize then
    local ok, width, height = pcall(C_Map.GetMapWorldSize, mine.mapId)
    if not ok or type(width) ~= "number" or type(height) ~= "number" or width <= 0 or height <= 0 then return nil end
    east = (ox - mine.x) * width
    north = -(oy - mine.y) * height
  elseif C_Map.GetWorldPosFromMapPos and CreateVector2D then
    local function worldPosition(x, y)
      local ok, continent, position = pcall(C_Map.GetWorldPosFromMapPos, mine.mapId, CreateVector2D(x, y))
      if not ok or not continent or not position then return nil end
      local okXY, worldX, worldY = pcall(function() return position:GetXY() end)
      if not okXY or type(worldX) ~= "number" or type(worldY) ~= "number" then return nil end
      return continent, worldX, worldY
    end
    local mineContinent, mineX, mineY = worldPosition(mine.x, mine.y)
    local otherContinent, otherX, otherY = worldPosition(ox, oy)
    if not mineContinent or mineContinent ~= otherContinent then return nil end
    east = otherX - mineX
    north = -(otherY - mineY)
  else
    return nil
  end
  if facing then
    -- Rotating minimap: the way you face is up.
    local c, s = math.cos(facing), math.sin(facing)
    east, north = east * c + north * s, -east * s + north * c
  end
  local radius = ((indoors and MINIMAP_INDOOR or MINIMAP_OUTDOOR)[zoom or 0] or MINIMAP_OUTDOOR[0]) / 2
  east, north = east / radius, north / radius
  if east * east + north * north > 1 then return nil end
  return east, north
end

-- ---------------------------------------------------------------------
-- Messages: P|mapId|x|y|class|level (x and y in 1/10000) and G (gone)
-- ---------------------------------------------------------------------

local lastSent = { at = -1000 }

local function send(text)
  if not (IsInGuild and IsInGuild()) then return end
  ns.comm.send(PREFIX, text, "GUILD")
end

local function sayGone()
  if lastSent.mapId then send("G") end
  lastSent = { at = clock() }
end

-- Called every second: send when you moved (at most every 5 s) or every 30 s.
function map.tick()
  if not active() then return end
  local s = settings()
  if not s or not s.mapShare or (ns.compat and ns.compat.inCombat()) then return end
  local mapId, x, y = map.myPosition()
  if not mapId then sayGone(); return end
  local now = clock()
  local moved = lastSent.mapId ~= mapId or math.abs(x - (lastSent.x or 0)) > MOVE_THRESHOLD or math.abs(y - (lastSent.y or 0)) > MOVE_THRESHOLD
  local wait = moved and SEND_MOVING_SECONDS or SEND_IDLE_SECONDS
  if now - lastSent.at < wait then return end
  local class
  if UnitClass then class = select(2, UnitClass("player")) end
  local level = UnitLevel and UnitLevel("player") or 0
  send(string.format("P|%d|%d|%d|%s|%d", mapId, math.floor(x * 10000 + 0.5), math.floor(y * 10000 + 0.5), tostring(class or ""), tonumber(level) or 0))
  lastSent = { at = now, mapId = mapId, x = x, y = y }
end

function map.receive(text, sender)
  if not active() then return end
  local name = ns.normalizeName and ns.normalizeName(sender)
  if not name or name == (ns.playerName and ns.playerName()) then return end
  if text == "G" then map.members[name] = nil; map.refresh(); return end
  local mapId, x, y, class, level = string.match(text, "^P|(%d+)|(%d+)|(%d+)|(%u*)|(%d+)")
  if not mapId then return end
  x, y = tonumber(x) / 10000, tonumber(y) / 10000
  if x > 1 or y > 1 then return end
  map.members[name] = { mapId = tonumber(mapId), x = x, y = y, class = class ~= "" and class or nil, level = tonumber(level), at = clock() }
end

local function forgetOld()
  local now = clock()
  for name, member in pairs(map.members) do
    if now - member.at > EXPIRE_SECONDS then map.members[name] = nil end
  end
end

-- ---------------------------------------------------------------------
-- Dots
-- ---------------------------------------------------------------------

local function zoneName(mapId)
  if C_Map and C_Map.GetMapInfo then
    local ok, info = pcall(C_Map.GetMapInfo, mapId)
    if ok and info and type(info.name) == "string" and not secret(info.name) then return info.name end
  end
  return "?"
end

local function classColor(class)
  local colors = (CUSTOM_CLASS_COLORS or RAID_CLASS_COLORS)
  local c = class and colors and colors[class]
  if c then return c.r, c.g, c.b end
  return 0.2, 1, 0.2
end

local function newPin(parent, pool, index)
  local pin = pool[index]
  if pin then return pin end
  pin = CreateFrame("Frame", nil, parent)
  pin:SetWidth(14)
  pin:SetHeight(14)
  pin.icon = pin:CreateTexture(nil, "OVERLAY")
  pin.icon:SetAllPoints(pin)
  pin.icon:SetTexture(PIN_TEXTURE)
  if pin.EnableMouse then pin:EnableMouse(true) end
  pin:SetScript("OnEnter", function(self)
    if not (GameTooltip and self.name) then return end
    GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
    local member = map.members[self.name]
    GameTooltip:AddLine(self.name, classColor(member and member.class))
    if member then
      GameTooltip:AddLine(string.format(L("Level %d, %s"), member.level or 0, zoneName(member.mapId)), 1, 1, 1)
    end
    GameTooltip:Show()
  end)
  pin:SetScript("OnLeave", function() if GameTooltip then GameTooltip:Hide() end end)
  pool[index] = pin
  return pin
end

local function hideFrom(pool, index)
  for i = index, #pool do pool[i]:Hide() end
end

local function sortedNames()
  local names = {}
  for name in pairs(map.members) do table.insert(names, name) end
  table.sort(names)
  return names
end

local function showDots()
  local s = settings()
  return active() and s and s.mapShow
end

-- World map: a dot for everyone on the map being viewed (a zone, or its continent).
function map.refreshWorldMap()
  local frame = WorldMapFrame
  local canvas = frame and frame.ScrollContainer and frame.ScrollContainer.Child
  if not (canvas and frame.IsShown and frame:IsShown() and frame.GetMapID) then return end
  local used = 0
  if showDots() then
    local okId, viewed = pcall(frame.GetMapID, frame)
    local width, height = canvas:GetWidth(), canvas:GetHeight()
    local okScale, scale = pcall(function() return frame.ScrollContainer:GetCanvasScale() end)
    scale = (okScale and type(scale) == "number" and scale > 0) and scale or 1
    for _, name in ipairs(okId and viewed and sortedNames() or {}) do
      local member = map.members[name]
      local x, y = map.translate(member.mapId, member.x, member.y, viewed)
      if x then
        used = used + 1
        local pin = newPin(canvas, map.worldPins, used)
        pin.name = name
        pin:SetScale(1 / scale)
        pin.icon:SetVertexColor(classColor(member.class))
        pin:ClearAllPoints()
        pin:SetPoint("CENTER", canvas, "TOPLEFT", x * width * scale, -y * height * scale)
        if pin.SetFrameStrata then pin:SetFrameStrata("HIGH") end
        pin:Show()
      end
    end
  end
  hideFrom(map.worldPins, used + 1)
end

-- Minimap: a dot for everyone close enough to fit on it.
function map.refreshMinimap()
  if not Minimap then return end
  local used = 0
  if showDots() and next(map.members) then
    local mapId, x, y = map.myPosition()
    if mapId then
      local facing
      if GetCVar and GetCVar("rotateMinimap") == "1" and GetPlayerFacing then
        local ok, value = pcall(GetPlayerFacing)
        if ok and type(value) == "number" and not secret(value) then facing = value end
      end
      local zoom = Minimap.GetZoom and Minimap:GetZoom() or 0
      local indoors = IsIndoors and IsIndoors() or false
      local halfWidth, halfHeight = Minimap:GetWidth() / 2, Minimap:GetHeight() / 2
      for _, name in ipairs(sortedNames()) do
        local east, north = map.minimapOffset({ mapId = mapId, x = x, y = y }, map.members[name], facing, zoom, indoors)
        if east then
          used = used + 1
          local pin = newPin(Minimap, map.minimapPins, used)
          pin.name = name
          pin.icon:SetVertexColor(classColor(map.members[name].class))
          pin:ClearAllPoints()
          pin:SetPoint("CENTER", Minimap, "CENTER", east * halfWidth, north * halfHeight)
          pin:Show()
        end
      end
    end
  end
  hideFrom(map.minimapPins, used + 1)
end

function map.refresh()
  pcall(map.refreshWorldMap)
  pcall(map.refreshMinimap)
end

-- ---------------------------------------------------------------------
-- Commands
-- ---------------------------------------------------------------------

function map.listText()
  forgetOld()
  local lines = {}
  for _, name in ipairs(sortedNames()) do
    local member = map.members[name]
    table.insert(lines, string.format("%s (%d): %s", name, member.level or 0, zoneName(member.mapId)))
  end
  return #lines > 0 and table.concat(lines, "\n") or L("No guildmate is sharing a position right now.")
end

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["map"] = function(args)
  local s = settings()
  if not s then return end
  local what, value = string.lower(args[1] or ""), string.lower(args[2] or "")
  if (what == "share" or what == "show") and (value == "on" or value == "off") then
    if what == "share" then
      s.mapShare = value == "on"
      if not s.mapShare then sayGone() end
      ns.message(s.mapShare and L("Your position is shared with the guild.") or L("Your position is no longer shared."))
    else
      s.mapShow = value == "on"
      map.refresh()
      ns.message(s.mapShow and L("Guildmates show on your maps.") or L("Guildmates are hidden from your maps."))
    end
    return
  end
  ns.message(string.format(L("Guild map: sharing %s, dots %s. /guilded map share on|off, /guilded map show on|off"),
    s.mapShare and L("on") or L("off"), s.mapShow and L("on") or L("off")))
  for line in string.gmatch(map.listText(), "[^\n]+") do ns.message("  " .. line) end
end
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded map - guildmates on your world map and minimap (share on|off, show on|off)")

-- ---------------------------------------------------------------------
-- Events and timers
-- ---------------------------------------------------------------------

local frame = CreateFrame("Frame")
local function register(event)
  if ns.compat and ns.compat.registerEvent then ns.compat.registerEvent(frame, event)
  else pcall(frame.RegisterEvent, frame, event) end
end
register("PLAYER_LOGIN")
register("CHAT_MSG_ADDON")
register("PLAYER_ENTERING_WORLD")

local sinceTick, sinceMinimap = 0, 0
local function onUpdate(_, elapsed)
  sinceTick = sinceTick + (elapsed or 0)
  sinceMinimap = sinceMinimap + (elapsed or 0)
  if sinceTick >= TICK_SECONDS then
    sinceTick = 0
    local ok, err = pcall(function()
      map.tick()
      forgetOld()
      map.refreshWorldMap()
    end)
    if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "guild map: " .. tostring(err)) end
  end
  if sinceMinimap >= MINIMAP_REFRESH_SECONDS then
    sinceMinimap = 0
    pcall(map.refreshMinimap)
  end
end

frame:SetScript("OnEvent", function(_, event, ...)
  local args = { ... }
  local ok, err = pcall(function()
    if event == "PLAYER_LOGIN" then
      ns.comm.register(PREFIX)
      if not active() then return end
      frame:SetScript("OnUpdate", onUpdate)
      if WorldMapFrame and hooksecurefunc and WorldMapFrame.OnMapChanged then
        hooksecurefunc(WorldMapFrame, "OnMapChanged", function() pcall(map.refreshWorldMap) end)
      end
      if WorldMapFrame and WorldMapFrame.HookScript then
        WorldMapFrame:HookScript("OnShow", function() pcall(map.refreshWorldMap) end)
      end
    elseif event == "PLAYER_ENTERING_WORLD" then
      -- Zoning in or out of an instance: send (or clear) the position soon.
      lastSent.at = -1000
    elseif event == "CHAT_MSG_ADDON" then
      local prefix, text, channel, sender = args[1], args[2], args[3], args[4]
      if secret(prefix) or secret(text) or secret(sender) or prefix ~= PREFIX or channel ~= "GUILD" then return end
      map.receive(text, sender)
    end
  end)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "guild map: " .. tostring(err)) end
end)
