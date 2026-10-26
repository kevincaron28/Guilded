-- Pug gear check: when players from outside the guild join your group, Guilded inspects them
-- (one at a time, out of combat, in range) and tells you their item level, missing enchants and
-- empty slots. Only you see the result. Off until you turn it on.
--
--   /guilded pugcheck on | off      check new non-guild group members by themselves
--   /guilded pugcheck now           check everyone in the group who is not in the guild
--   /guilded pugcheck last          the results again
--
-- Uses the same slots and enchant rules as your own gear check. It waits while you have the
-- inspect window open, never inspects in combat, and gives up on a player after a few tries.
local addonName, ns = ...
ns = ns or {}

local INSPECT_TIMEOUT = 5
local SPACING = 1.5
local RECHECK_AFTER = 30 * 60
local MAX_TRIES = 3

local pug = {}
ns.pugCheck = pug

local queue, results, checkedAt, tries = {}, {}, {}, {}
local current = nil

local function L(text) return ns.L and ns.L(text) or text end
local function clock() return GetTime and GetTime() or 0 end
local function settings() local db = ns.getDb and ns.getDb(); return db and db.settings end
local function after(seconds, fn) if C_Timer and C_Timer.After then C_Timer.After(seconds, fn) else fn() end end

local function groupUnits()
  local units = {}
  if IsInRaid and IsInRaid() then
    for i = 1, (GetNumGroupMembers and GetNumGroupMembers() or 0) do table.insert(units, "raid" .. i) end
  else
    for i = 1, 4 do table.insert(units, "party" .. i) end
  end
  return units
end

local function nameOf(unit)
  local name = UnitName and UnitName(unit)
  if not name or (ns.isSecret and ns.isSecret(name)) then return nil end
  return ns.normalizeName and ns.normalizeName(name) or name
end

-- The facts from one inspected unit (also used by the tests with mocked links).
function pug.read(unit)
  local slots, enchantable = ns.gearSlots or {}, ns.enchantableSlots or {}
  local levels, empty, unenchanted = {}, {}, {}
  for _, slot in ipairs(slots) do
    local link = GetInventoryItemLink and GetInventoryItemLink(unit, slot[1])
    if link then
      local level
      if C_Item and C_Item.GetDetailedItemLevelInfo then level = C_Item.GetDetailedItemLevelInfo(link)
      elseif GetDetailedItemLevelInfo then level = GetDetailedItemLevelInfo(link)
      elseif GetItemInfo then level = select(4, GetItemInfo(link)) end
      if tonumber(level) then table.insert(levels, tonumber(level)) end
      local enchant = tonumber(string.match(link, "item:%d+:(%d+)"))
      if enchantable[slot[2]] and not (enchant and enchant > 0) then table.insert(unenchanted, slot[2]) end
    elseif slot[2] ~= "OffHand" then
      table.insert(empty, slot[2])
    end
  end
  local itemLevel
  if C_PaperDollInfo and C_PaperDollInfo.GetInspectItemLevel then itemLevel = tonumber(C_PaperDollInfo.GetInspectItemLevel(unit)) end
  if (not itemLevel or itemLevel <= 0) and #levels > 0 then
    local total = 0
    for _, level in ipairs(levels) do total = total + level end
    itemLevel = math.floor(total / #levels + 0.5)
  end
  -- select(): "UnitClass and UnitClass(unit)" would keep only the first value.
  local class = UnitClass and select(2, UnitClass(unit)) or nil
  return { itemLevel = itemLevel, unenchanted = unenchanted, empty = empty, level = UnitLevel and UnitLevel(unit), class = class, read = #levels }
end

function pug.describe(name, r)
  local parts = { string.format("%s (%s %s)", name, r.class or "?", tostring(r.level or "?")) }
  table.insert(parts, r.itemLevel and (L("item level") .. " " .. r.itemLevel) or L("item level unknown"))
  if #r.unenchanted > 0 then table.insert(parts, L("missing enchants") .. ": " .. table.concat(r.unenchanted, ", ")) end
  if #r.empty > 0 then table.insert(parts, string.format(L("%d empty slot(s)"), #r.empty)) end
  return L("Pug check") .. ": " .. table.concat(parts, "; ")
end

local function busy()
  if InCombatLockdown and InCombatLockdown() then return true end
  return InspectFrame and InspectFrame.IsShown and InspectFrame:IsShown() or false
end

local pump
local function finish(name)
  current = nil
  if ClearInspectPlayer then pcall(ClearInspectPlayer) end
  after(SPACING, pump)
  return name
end

pump = function()
  if current or #queue == 0 then return end
  if busy() then after(5, pump) return end
  local name = table.remove(queue, 1)
  local unit
  for _, u in ipairs(groupUnits()) do if UnitExists and UnitExists(u) and nameOf(u) == name then unit = u break end end
  if not unit then return pump() end
  if not (CanInspect and CanInspect(unit)) or not NotifyInspect then
    tries[name] = (tries[name] or 0) + 1
    if tries[name] < MAX_TRIES then after(10, function() table.insert(queue, name); pump() end) end
    return after(SPACING, pump)
  end
  current = { name = name, unit = unit, guid = UnitGUID and UnitGUID(unit), at = clock() }
  pcall(NotifyInspect, unit)
  local asked = current
  after(INSPECT_TIMEOUT, function()
    if current == asked then
      tries[name] = (tries[name] or 0) + 1
      if tries[name] < MAX_TRIES then table.insert(queue, name) end
      finish(name)
    end
  end)
end

function pug.onInspectReady(guid)
  if not current or (current.guid and guid and current.guid ~= guid) then return end
  local name, unit = current.name, current.unit
  local r = pug.read(unit)
  results[name], checkedAt[name] = r, clock()
  ns.message(pug.describe(name, r))
  finish(name)
end

-- Queues group members from outside the guild who were not checked recently.
function pug.queueGroup(force)
  local added = 0
  for _, unit in ipairs(groupUnits()) do
    local name = UnitExists and UnitExists(unit) and nameOf(unit)
    if name and not (ns.isGuildMember and ns.isGuildMember(name)) and (force or not checkedAt[name] or clock() - checkedAt[name] > RECHECK_AFTER) then
      local queued = false
      for _, q in ipairs(queue) do if q == name then queued = true end end
      if not queued and not (current and current.name == name) then table.insert(queue, name); added = added + 1 end
    end
  end
  pump()
  return added
end

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["pugcheck"] = function(args)
  if ns.moduleActive and not ns.moduleActive("pugcheck") then return end
  local s = settings()
  if not s then return end
  local action = string.lower(args[1] or "")
  if action == "on" or action == "off" then
    s.pugCheck = action == "on"
    ns.message(s.pugCheck and L("Pug check on: players from outside the guild are checked when they join your group.") or L("Pug check off."))
  elseif action == "now" then
    local added = pug.queueGroup(true)
    ns.message(added > 0 and string.format(L("Checking %d player(s) from outside the guild..."), added) or L("Nobody from outside the guild in your group."))
  else
    local any = false
    for name, r in pairs(results) do ns.message(pug.describe(name, r)); any = true end
    if not any then ns.message(string.format(L("Pug check is %s. /guilded pugcheck on | off | now"), s.pugCheck and L("on") or L("off"))) end
  end
end
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded pugcheck on | off | now | last - item level and missing enchants of non-guild group members")

local frame = CreateFrame("Frame")
frame:RegisterEvent("GROUP_ROSTER_UPDATE")
frame:RegisterEvent("INSPECT_READY")
frame:SetScript("OnEvent", function(_, event, guid)
  local ok, err = pcall(function()
    if ns.moduleActive and not ns.moduleActive("pugcheck") then return end
    if event == "INSPECT_READY" then pug.onInspectReady(guid)
    elseif event == "GROUP_ROSTER_UPDATE" then
      local s = settings()
      if s and s.pugCheck then after(3, function() pug.queueGroup(false) end) end
    end
  end)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "pugcheck: " .. tostring(err)) end
end)
