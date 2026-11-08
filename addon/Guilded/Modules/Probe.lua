-- Client probe (read-only): finds out which achievement APIs this WoW client has, so Guilded can
-- mirror WoW Forever's own achievements (docs/plans/FOREVER_ACHIEVEMENTS.md). Chat /run is blocked
-- on Forever, so the probe lives in the addon.
--
--   /guilded probe achievements    print what the client offers and save a summary
--
-- Everything is wrapped in pcall, nothing protected is called, no frame is shown, nothing is sent
-- to the guild or the companion. The summary is kept in db.probes.achievements (SavedVariables).
local addonName, ns = ...
ns = ns or {}
local probe = {}
ns.probe = probe

local MAX_CATEGORIES = 300
local MAX_SHOWN = 5
local MAX_NAMES = 20

local function L(text) return ns.L and ns.L(text) or text end
local function say(text) if ns.message then ns.message(text) end end
local function visible(value) return not (ns.isSecret and ns.isSecret(value)) end
-- pcall a client function; nil when absent, throwing, protected or returning a hidden value.
local function call(fn, ...)
  if type(fn) ~= "function" then return nil end
  local results = { pcall(fn, ...) }
  if not results[1] then return nil end
  for i = 2, #results do if not visible(results[i]) then return nil end end
  return results[2], results[3], results[4]
end
local function epoch()
  local value = call(GetServerTime)
  if type(value) == "number" then return value end
  return time and time() or 0
end

-- Functions looked for in the global table, in the order they are printed.
local FUNCTIONS = { "GetCategoryList", "GetCategoryInfo", "GetCategoryNumAchievements", "GetAchievementInfo",
  "GetAchievementCriteriaInfo", "GetNumCompletedAchievements", "GetTotalAchievementPoints", "GetStatistic" }
local EVENTS = { "ACHIEVEMENT_EARNED", "CRITERIA_UPDATE" }

local function sortedKeys(source, filter)
  local names = {}
  if type(source) ~= "table" then return names end
  local ok = pcall(function()
    for key, value in pairs(source) do
      if type(key) == "string" and filter(key, value) then names[#names + 1] = key end
      if #names >= MAX_NAMES * 3 then break end
    end
  end)
  if not ok then return names end
  table.sort(names)
  while #names > MAX_NAMES do table.remove(names) end
  return names
end

-- Whether a frame can listen for an event on this client (an unknown event name errors).
local function eventRegisters(name)
  if type(CreateFrame) ~= "function" then return false end
  local okFrame, frame = pcall(CreateFrame, "Frame")
  if not okFrame or type(frame) ~= "table" or type(frame.RegisterEvent) ~= "function" then return false end
  local okRegister = pcall(frame.RegisterEvent, frame, name)
  if okRegister and type(frame.UnregisterEvent) == "function" then pcall(frame.UnregisterEvent, frame, name) end
  return okRegister == true
end

function probe.achievements()
  local result = { at = epoch(), apis = {}, events = {}, categories = 0, shown = {}, total = 0, completed = 0 }
  local edition = ns.util and ns.util.gameEdition and ns.util.gameEdition() or "unknown"
  result.edition = edition
  local version, build = call(GetBuildInfo)
  result.client = (type(version) == "string" and version or "?") .. (type(build) == "string" and (" (" .. build .. ")") or "")

  local missing = {}
  for _, name in ipairs(FUNCTIONS) do
    local present = type(_G[name]) == "function"
    result.apis[name] = present
    if not present then missing[#missing + 1] = name end
  end
  local info = _G.C_AchievementInfo
  result.apis["C_AchievementInfo"] = type(info) == "table"
  result.infoFunctions = sortedKeys(info, function(_, value) return type(value) == "function" end)
  -- Names only: any global that looks like a Legacy system (Forever's own take on achievements).
  result.legacyNames = sortedKeys(_G, function(key) return string.find(string.lower(key), "legacy", 1, true) ~= nil end)
  for _, name in ipairs(EVENTS) do result.events[name] = eventRegisters(name) end

  local list = call(GetCategoryList)
  if type(list) == "table" then
    local count = 0
    for index = 1, math.min(#list, MAX_CATEGORIES) do
      local id = list[index]
      if type(id) == "number" and visible(id) then
        count = count + 1
        local total, done = call(GetCategoryNumAchievements, id)
        if type(total) == "number" then result.total = result.total + total end
        if type(done) == "number" then result.completed = result.completed + done end
        if #result.shown < MAX_SHOWN then
          local title = call(GetCategoryInfo, id)
          result.shown[#result.shown + 1] = { id = id, name = type(title) == "string" and title or "?", count = type(total) == "number" and total or 0 }
        end
      end
    end
    result.categories = count
    local first = result.shown[1]
    if first and first.count > 0 then
      local id, name = call(GetAchievementInfo, first.id, 1)
      if type(id) == "number" then result.sample = { id = id, name = type(name) == "string" and name or "?" } end
    end
  end

  local d = ns.getDb and ns.getDb()
  if d then
    d.probes = type(d.probes) == "table" and d.probes or {}
    d.probes.achievements = result
  end

  say(string.format(L("Achievement probe: client %s, edition %s."), result.client, tostring(edition)))
  if #missing == 0 then say(L("Achievement APIs: all of them exist."))
  else say(string.format(L("Achievement APIs missing: %s."), table.concat(missing, ", "))) end
  say(string.format(L("C_AchievementInfo: %s%s."), result.apis["C_AchievementInfo"] and L("present") or L("absent"),
    #result.infoFunctions > 0 and (" (" .. table.concat(result.infoFunctions, ", ") .. ")") or ""))
  say(string.format(L("Legacy-looking globals: %s."), #result.legacyNames > 0 and table.concat(result.legacyNames, ", ") or L("none")))
  for _, name in ipairs(EVENTS) do
    say(string.format(L("Event %s: %s."), name, result.events[name] and L("registers") or L("does not register")))
  end
  say(string.format(L("Categories: %d, achievements visible: %d, completed: %d."), result.categories, result.total, result.completed))
  for _, row in ipairs(result.shown) do say(string.format("  %d %s (%d)", row.id, row.name, row.count)) end
  if result.sample then say(string.format(L("First achievement: %d %s."), result.sample.id, result.sample.name)) end
  say(L("Saved in SavedVariables (db.probes.achievements). Nothing was sent."))
  return result
end

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["probe"] = function(args)
  local what = string.lower(args and args[1] or "")
  if what == "achievements" or what == "achievement" then probe.achievements()
  else say(L("/guilded probe achievements - check which achievement APIs this client has")) end
end
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded probe achievements - check which achievement APIs this client has (read-only)")
