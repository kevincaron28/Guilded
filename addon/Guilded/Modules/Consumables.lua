-- Consumable scan: who has a flask/elixir and food up, before the pull.
--
--   /guilded consumes          scan everyone in your group and print who is missing what
--   /guilded consumes me       show your own active consumables
--
-- Reads buffs only (never uses or changes anything). A buff is recognised by its spell id
-- (flask, augment rune, vantus rune, raid buffs: Modules/ConsumableData.lua) or its icon
-- (Well Fed, eating), which work in every game language. Only when a buff has neither is
-- its name matched against the plain-text patterns below, so an unusual flask still shows
-- up as long as it is called "Flask of ...", "Elixir of ...", "Well Fed", and so on.
--
-- Three answers, never two: something is present, absent, or UNKNOWN. A player who is out of
-- range, offline, phased, or whose buffs the game hides (Midnight "secret" values) is
-- unknown, not "missing a flask". `complete` says the whole buff list was read.
--
-- Each player's own addon also reports its own state (encode/decode below); that is what the
-- Ready page falls back to when it cannot read someone else's buffs. Weapon enchants and
-- durability can only be read for yourself, so they travel that way too.
--
-- The last group scan is saved in GuildedDB.consumeScan and rides along
-- in the next export, so the Discord bot can show it next to gear readiness.
local addonName, ns = ...
ns = ns or {}

-- Category -> lowercase name fragments (plain matches, no patterns).
local PATTERNS = {
  flask = { "flask of", "flask:", "phial of" },
  elixir = { "elixir of", "elixir:", "greater arcane elixir", "major troll's blood", "mageblood", "spirit of zanza", "juju " },
  food = { "well fed", "well-fed", "hearty well fed", "nightfin soup", "tender wolf steak", "smoked desert dumplings", "grilled squid", "sagefish delight" }
}

local MAX_AURAS = 100
-- Remaining time known to the second; "no expiry shown" is sent as this large number.
local NO_EXPIRY = 99999
local module = {}
ns.consumables = module

local function isSecret(value)
  return ns.isSecret and ns.isSecret(value)
end

local function data()
  return ns.consumableData
end

local function number(value)
  if type(value) == "number" and not isSecret(value) then return value end
  return nil
end

local function readable(value)
  if isSecret(value) then return nil end
  return value
end

-- ---------------------------------------------------------------------
-- Reading buffs
-- ---------------------------------------------------------------------

-- A yes/no game function; a missing function counts as "yes" (this client cannot tell us).
local function allowed(fn, unit)
  if type(fn) ~= "function" then return true end
  local ok, value = pcall(fn, unit)
  if not ok or isSecret(value) then return false end
  return value ~= false
end

-- Offline, out of range, or in another phase: the buff list would come back empty and
-- that says nothing about the player.
local function canQueryUnit(unit)
  if unit == "player" then return true end
  if not allowed(UnitIsConnected, unit) then return false end
  if not allowed(UnitIsVisible, unit) then return false end
  if type(UnitPhaseReason) == "function" then
    local ok, reason = pcall(UnitPhaseReason, unit)
    if not ok or isSecret(reason) or reason ~= nil then return false end
  end
  return true
end

-- The game hides other players' buffs during some encounters and in some places.
local function aurasHidden()
  if C_Secrets and type(C_Secrets.ShouldAurasBeSecret) == "function" then
    local ok, hidden = pcall(C_Secrets.ShouldAurasBeSecret)
    if ok and (isSecret(hidden) or hidden == true) then return true end
  end
  return false
end

-- One buff of `unit`: returns "aura", { fields } | "end" | "hidden" | "fail".
local function readAura(unit, index)
  if C_UnitAuras and C_UnitAuras.GetAuraDataByIndex then
    local ok, aura = pcall(C_UnitAuras.GetAuraDataByIndex, unit, index, "HELPFUL")
    if not ok then return "fail" end
    if aura == nil then return "end" end
    if isSecret(aura) then return "hidden" end
    if type(aura) ~= "table" then return "fail" end
    return "aura", {
      name = readable(aura.name), spellId = number(aura.spellId), icon = number(aura.icon),
      expirationTime = number(aura.expirationTime), duration = number(aura.duration)
    }
  end
  if UnitBuff then
    local ok, name, icon, _, _, duration, expirationTime, _, _, _, spellId = pcall(UnitBuff, unit, index)
    if not ok then return "fail" end
    if name == nil then return "end" end
    if isSecret(name) then return "hidden" end
    return "aura", {
      name = type(name) == "string" and name or nil, spellId = number(spellId), icon = number(icon),
      expirationTime = number(expirationTime), duration = number(duration)
    }
  end
  return "fail"
end

local function classify(name)
  local lower = string.lower(name)
  for category, fragments in pairs(PATTERNS) do
    for _, fragment in ipairs(fragments) do
      if string.find(lower, fragment, 1, true) then return category end
    end
  end
  return nil
end
module.classify = classify

-- Seconds left on a buff, or nil when it does not say.
local function remainingOf(aura)
  if aura.expirationTime and aura.expirationTime > 0 and GetTime then
    local ok, now = pcall(GetTime)
    if ok and type(now) == "number" then return math.max(0, math.floor(aura.expirationTime - now)) end
  end
  return nil
end

-- What kind of consumable a buff is: "flask", "elixir", "food", "eating", "augment", "vantus",
-- or "buff:<raid buff key>". Ids and icons first, names last.
local function categoryOf(aura)
  local d = data()
  if d then
    local id = aura.spellId
    if id then
      if d.FLASK[id] then return "flask" end
      if d.AUGMENT[id] then return "augment" end
      if d.VANTUS[id] then return "vantus" end
      if d.RAID_BUFF_BY_SPELL[id] then return "buff:" .. d.RAID_BUFF_BY_SPELL[id] end
    end
    if aura.icon then
      if d.WELL_FED_ICONS[aura.icon] then return "food" end
      if d.EATING_ICONS[aura.icon] then return "eating" end
    end
  end
  if aura.name then return classify(aura.name) end
  return nil
end

-- What consumables `unit` has active. Returns
-- { flask=, flaskLeft=, elixirs={}, food=, foodLeft=, eating=, augment=, vantus=, buffs={key=true},
--   weapon=, readable=, complete= }.
--   readable: something could be read; complete: the whole list was, so absent means absent.
function module.scanUnit(unit)
  local result = { elixirs = {}, buffs = {}, readable = false, complete = false }
  if canQueryUnit(unit) and not (unit ~= "player" and aurasHidden()) then
    local hiddenAuras, seen = false, 0
    for index = 1, MAX_AURAS do
      local status, aura = readAura(unit, index)
      if status == "end" then
        result.complete = not hiddenAuras
        break
      elseif status == "fail" then
        break
      elseif status == "hidden" then
        hiddenAuras = true
      else
        seen = seen + 1
        if not aura.spellId and not aura.name then hiddenAuras = true end
        local category = categoryOf(aura)
        local label = aura.name or ("Spell " .. tostring(aura.spellId))
        if category == "flask" then
          if not result.flask then result.flask, result.flaskLeft = label, remainingOf(aura) end
        elseif category == "elixir" then table.insert(result.elixirs, label)
        elseif category == "food" then
          if not result.food then result.food, result.foodLeft = label, remainingOf(aura) end
        elseif category == "eating" then result.eating = true
        elseif category == "augment" then result.augment = true
        elseif category == "vantus" then result.vantus = true
        elseif category and string.sub(category, 1, 5) == "buff:" then result.buffs[string.sub(category, 6)] = true end
      end
    end
    if unit == "player" then result.readable = result.complete or seen > 0
    else result.readable = seen > 0 end
  end
  if unit == "player" and GetWeaponEnchantInfo then
    local ok, hasMain = pcall(GetWeaponEnchantInfo)
    if ok and hasMain then result.weapon = "Weapon enchant" end
  end
  return result
end

-- A flask covers both elixir slots; otherwise an elixir counts.
local function hasElixirOrFlask(result)
  return result.flask ~= nil or #result.elixirs > 0
end
module.hasElixirOrFlask = hasElixirOrFlask

-- ---------------------------------------------------------------------
-- What only you can read about yourself
-- ---------------------------------------------------------------------

-- Temporary weapon enchant (oil, stone, poison, imbue): seconds left, 0 = none although a
-- weapon is held, nil = cannot tell or no weapon.
local function weaponState()
  if not GetWeaponEnchantInfo then return nil end
  local ok, hasMain, mainMs = pcall(GetWeaponEnchantInfo)
  if not ok or isSecret(hasMain) then return nil end
  local mainHand = GetInventoryItemID and GetInventoryItemID("player", 16)
  if hasMain then
    local ms = number(mainMs)
    return ms and ms > 0 and math.floor(ms / 1000) or NO_EXPIRY
  end
  if mainHand then return 0 end
  return nil
end
module.weaponState = weaponState

local function lowestDurability()
  if not GetInventoryItemDurability then return nil end
  local lowest
  for slot = 1, 18 do
    local ok, current, maximum = pcall(GetInventoryItemDurability, slot)
    if ok and number(current) and number(maximum) and maximum > 0 then
      local percent = math.floor(current / maximum * 100)
      if not lowest or percent < lowest then lowest = percent end
    end
  end
  return lowest
end
module.lowestDurability = lowestDurability

-- ---------------------------------------------------------------------
-- Facts: one shape for "what do we know about this player"
-- ---------------------------------------------------------------------
-- Every field is true, false or nil (nil = unknown). *Left = seconds remaining when known.
--   flask, food, weapon, augment, vantus, buffs (table of keys or nil), durability

-- From a buff scan (yours or someone else's).
function module.factsFromScan(scan)
  local facts = {}
  if not scan or not scan.readable then return facts end
  -- A partly hidden list can only prove what is there, never what is missing.
  local complete = scan.complete ~= false
  local function known(present)
    if present then return true end
    if complete then return false end
    return nil
  end
  facts.flask = known(hasElixirOrFlask(scan))
  facts.flaskLeft = scan.flaskLeft
  facts.food = known(scan.food ~= nil or scan.eating == true)
  facts.foodLeft = scan.foodLeft
  facts.eating = scan.eating == true and scan.food == nil or nil
  facts.augment = known(scan.augment == true)
  facts.vantus = known(scan.vantus == true)
  if complete and scan.buffs then facts.buffs = scan.buffs
  elseif scan.buffs and next(scan.buffs) then facts.buffsSeen = scan.buffs end
  return facts
end

-- What your own addon sends: the scan plus the things only you can read.
function module.ownFacts()
  local scan = module.scanUnit("player")
  local facts = module.factsFromScan(scan)
  local weapon = weaponState()
  if weapon ~= nil then
    facts.weapon = weapon > 0
    facts.weaponLeft = weapon > 0 and weapon or nil
  end
  facts.durability = lowestDurability()
  return facts, scan
end

-- ---------------------------------------------------------------------
-- The report: "CONSUME|<name>|F=<sec>|D=<sec>|E=1|W=<sec>|R=1|V=1|B=a,b|U=<pct>"
-- ---------------------------------------------------------------------
-- A number field is seconds left (NO_EXPIRY when the buff shows none), 0 = absent; a missing
-- field is unknown. Kept short: one message covers a whole raid member.

local function seconds(present, left)
  if present == nil then return nil end
  if not present then return 0 end
  return left or NO_EXPIRY
end

function module.encode(name, facts)
  local parts = { "CONSUME", name }
  local function put(key, value) if value ~= nil then table.insert(parts, key .. "=" .. tostring(value)) end end
  put("F", seconds(facts.flask, facts.flaskLeft))
  put("D", seconds(facts.food, facts.foodLeft))
  if facts.eating then put("E", 1) end
  put("W", seconds(facts.weapon, facts.weaponLeft))
  if facts.augment ~= nil then put("R", facts.augment and 1 or 0) end
  if facts.vantus ~= nil then put("V", facts.vantus and 1 or 0) end
  if facts.buffs then
    local keys = {}
    for key in pairs(facts.buffs) do table.insert(keys, key) end
    table.sort(keys)
    put("B", table.concat(keys, ","))
  end
  put("U", facts.durability)
  return table.concat(parts, "|")
end

-- Back into facts, or nil when it is not a report. Ignores fields it does not know.
function module.decode(text)
  local parts = {}
  for part in string.gmatch(text or "", "[^|]+") do table.insert(parts, part) end
  if parts[1] ~= "CONSUME" or not parts[2] then return nil end
  local fields = {}
  for index = 3, #parts do
    local key, value = string.match(parts[index], "^(%a+)=(.*)$")
    if key then fields[key] = value end
  end
  local facts = { name = parts[2] }
  local function timed(key, presentKey, leftKey)
    local value = tonumber(fields[key])
    if not value then return end
    facts[presentKey] = value > 0
    if value > 0 and value < NO_EXPIRY then facts[leftKey] = value end
  end
  timed("F", "flask", "flaskLeft")
  timed("D", "food", "foodLeft")
  timed("W", "weapon", "weaponLeft")
  if fields.E == "1" then facts.eating = true end
  if fields.R then facts.augment = fields.R == "1" end
  if fields.V then facts.vantus = fields.V == "1" end
  if fields.B then
    facts.buffs = {}
    for key in string.gmatch(fields.B, "[^,]+") do facts.buffs[key] = true end
  end
  facts.durability = tonumber(fields.U)
  return facts
end

-- Rows for your own readiness snapshot (the addon's existing export format).
function module.ownRows()
  local result = module.scanUnit("player")
  local rows = {}
  if result.flask then table.insert(rows, { name = result.flask, quantity = 1, category = "FLASK" }) end
  for _, name in ipairs(result.elixirs) do table.insert(rows, { name = name, quantity = 1, category = "ELIXIR" }) end
  if result.food then table.insert(rows, { name = result.food, quantity = 1, category = "FOOD" }) end
  if result.weapon then table.insert(rows, { name = result.weapon, quantity = 1, category = "WEAPON" }) end
  return rows, result
end

-- ---------------------------------------------------------------------
-- /guilded consumes
-- ---------------------------------------------------------------------

local function unitList()
  local units = { "player" }
  if IsInRaid and IsInRaid() then
    local count = GetNumGroupMembers and GetNumGroupMembers() or 0
    for i = 1, count do table.insert(units, "raid" .. i) end
  else
    for i = 1, 4 do table.insert(units, "party" .. i) end
  end
  return units
end

local function unitLabel(unit)
  local name, realm = ((ns.util and not ns.util.isForever() and UnitFullName) or UnitName)(unit)
  if not name or isSecret(name) then return nil end
  if unit ~= "player" and UnitIsUnit and UnitIsUnit(unit, "player") then return nil end
  if not realm or realm == "" or (ns.util and ns.util.isForever()) then
    realm = ns.compat and ns.compat.identity and ns.compat.identity().realm or (GetRealmName and GetRealmName()) or ""
  end
  return name, realm
end

local function listOrNone(names)
  if #names == 0 then return "none" end
  table.sort(names)
  return table.concat(names, ", ")
end

local function groupScan()
  local players, noFlask, noFood, hidden = {}, {}, {}, {}
  local seen = {}
  for _, unit in ipairs(unitList()) do
    if unit == "player" or (UnitExists and UnitExists(unit)) then
      local name, realm = unitLabel(unit)
      if name and not seen[name] then
        seen[name] = true
        local result = module.scanUnit(unit)
        if unit ~= "player" and UnitIsConnected and not UnitIsConnected(unit) then
          -- Offline members can't be read; skip them without blaming them.
        elseif not result.readable then
          table.insert(hidden, name)
        else
          local facts = module.factsFromScan(result)
          table.insert(players, {
            character = name, realm = realm,
            flask = result.flask, elixirs = result.elixirs, food = result.food, weapon = result.weapon,
            covered = hasElixirOrFlask(result)
          })
          -- Only a complete look proves something is missing.
          if facts.flask == false then table.insert(noFlask, name) end
          if facts.food == false then table.insert(noFood, name) end
        end
      end
    end
  end
  return players, noFlask, noFood, hidden
end

local function report()
  local players, noFlask, noFood, hidden = groupScan()
  local db = ns.getDb and ns.getDb()
  if db then
    local raid = ns.getActiveRaid and ns.getActiveRaid()
    db.consumeScan = { at = ns.now(), by = ns.playerName(), raid = raid and raid.title or nil, players = players }
  end
  ns.message(string.format("Consumable scan: %d player(s) checked.", #players))
  ns.message("No flask or elixir: " .. listOrNone(noFlask))
  ns.message("No food buff: " .. listOrNone(noFood))
  if #hidden > 0 then ns.message("Could not read buffs (out of range or hidden by the game): " .. listOrNone(hidden)) end
  if #players == 0 then ns.message("Nobody could be read. Try again out of combat and in range.") end
end

local function mine()
  local rows, result = module.ownRows()
  if not result.readable then ns.message("Could not read your buffs right now.") return end
  local parts = {}
  for _, row in ipairs(rows) do table.insert(parts, string.lower(row.category) .. ": " .. row.name) end
  ns.message("Your consumables: " .. (#parts > 0 and table.concat(parts, ", ") or "none active"))
end

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["consumes"] = function(args)
  if ns.moduleActive and not ns.moduleActive("consumables") then return end
  local action = string.lower(args[1] or "")
  if action == "me" then mine()
  elseif action == "" or action == "scan" then
    if ns.isOfficer and not ns.isOfficer() then
      ns.message("Only officers can scan the group. Use /guilded consumes me for your own.")
      return
    end
    report()
  else ns.message("/guilded consumes [scan] | me") end
end
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, { officer = true, text = "/guilded consumes - who in your group is missing a flask/elixir or food (also /guilded consumes me)" })
