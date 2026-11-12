-- WoW Forever's in-game achievements, recorded for the bot's badges (roadmap item 8; docs/plans/FOREVER_ACHIEVEMENTS.md).
--
-- Reads the achievement API the client already has (GetCategoryList / GetCategoryNumAchievements / GetAchievementInfo, confirmed on a
-- real Forever client by the probe command, removed in 9.2) and records every achievement this character has earned as a milestone of kind
-- "ach" (ref "ach:<id>", with its name, text, category and points), which the companion uploads with the rest of the milestones.
-- Category 15425 ("Do Not Display") is skipped: the game hides it.
--
--   * First run on a character: everything already earned is recorded silently (and dated by the game), never announced.
--   * After that: a scan at login catches what was earned while Guilded was not loaded, and ACHIEVEMENT_EARNED records a new one at once.
--     The newest is announced in guild chat under the same rules as every milestone (ON by default; /guilded announce ach off;
--     an officer's guild-wide switch wins). Older ones found in the same scan are recorded silently.
--
-- Read-only and pcall-wrapped: nothing protected is called, a hidden value is ignored, and a client without the API simply records nothing.
local _, ns = ...
local ga = {}
ns.gameAchievements = ga

local SKIP_CATEGORY = 15425
local SCAN_DELAY = 12
local MAX_SCAN = 2000

local function active() return not ns.moduleActive or ns.moduleActive("milestones") end
local function pack(ok, ...) if not ok then return nil end; return { n = select("#", ...), ... } end
-- Calls a client function; returns its values, or nothing when it is missing, throws or hands back a hidden value.
local function call(fn, ...)
  if type(fn) ~= "function" then return end
  local r = pack(pcall(fn, ...))
  if not r then return end
  for i = 1, r.n do if ns.isSecret and ns.isSecret(r[i]) then return end end
  return (table.unpack or unpack)(r, 1, r.n)
end
local function clean(text, max)
  if type(text) ~= "string" then return nil end
  text = text:gsub("[%c]", " "):gsub("%s+", " "):gsub("^ ", ""):gsub(" $", "")
  if text == "" then return nil end
  return text:sub(1, max)
end

-- The date the game gives (month, day, two- or four-digit year), as a timestamp; nothing when it is not a plausible past date.
local function dateOf(month, day, year)
  month, day, year = tonumber(month), tonumber(day), tonumber(year)
  if not (month and day and year) then return nil end
  if year < 100 then year = year + 2000 end
  if year < 2004 or month < 1 or month > 12 or day < 1 or day > 31 then return nil end
  local ok, at = pcall(time, { year = year, month = month, day = day, hour = 12 })
  if not ok or type(at) ~= "number" then return nil end
  local now = tonumber(call(GetServerTime)) or time()
  if at > now + 86400 then return nil end
  return at
end

local function entry(id, name, points, month, day, year, description, categoryName)
  name = clean(name, 80)
  if type(id) ~= "number" or id ~= id or id < 1 or id > 999999999 or not name then return nil end
  id = math.floor(id)
  return { id = id, label = name, desc = clean(description, 200), category = clean(categoryName, 60),
    points = type(points) == "number" and points >= 0 and points <= 1000 and math.floor(points) or nil, at = dateOf(month, day, year) }
end

local function record(e, silent)
  local ms = ns.milestones
  if not ms or not ms.reach then return false end
  return ms.reach("ach:" .. e.id, "ach:" .. e.id, { kind = "ach", value = 1, label = e.label, desc = e.desc, category = e.category, points = e.points, at = e.at }, silent)
end

-- Every earned achievement the client lists, oldest first.
function ga.earned()
  local out, seen = {}, {}
  local categories = call(GetCategoryList)
  if type(categories) ~= "table" then return out end
  local scanned = 0
  for _, category in ipairs(categories) do
    if type(category) == "number" and category ~= SKIP_CATEGORY then
      local categoryName = call(GetCategoryInfo, category)
      local total, completed = call(GetCategoryNumAchievements, category)
      if type(total) == "number" and total > 0 and not (type(completed) == "number" and completed == 0) then
        for index = 1, math.min(total, 500) do
          scanned = scanned + 1
          if scanned > MAX_SCAN then return out end
          local id, name, points, done, month, day, year, description = call(GetAchievementInfo, category, index)
          if done == true and not seen[id or 0] then
            local e = entry(id, name, points, month, day, year, description, categoryName)
            if e then seen[e.id] = true; out[#out + 1] = e end
          end
        end
      end
    end
  end
  table.sort(out, function(a, b) return (a.at or 0) < (b.at or 0) end)
  return out
end

-- Records what is earned. The first scan of a character (or any scan with announcements off) is silent; otherwise only the newest new one is announced.
function ga.scan()
  if not active() or not ns.milestones or not ns.milestones.state then return 0 end
  local c = ns.milestones.state()
  if not c then return 0 end
  local list = ga.earned()
  local first = not c.achBaselined
  local fresh = {}
  for _, e in ipairs(list) do if not c.done["ach:" .. e.id] then fresh[#fresh + 1] = e end end
  for i, e in ipairs(fresh) do record(e, first or i < #fresh) end
  -- Only a scan that actually read the list counts as the baseline (a client that answered nothing is tried again next login).
  if #list > 0 or type((call(GetCategoryList))) == "table" then c.achBaselined = true end
  return #fresh
end

-- ACHIEVEMENT_EARNED: record it now, dated by the game when it says so, else today.
function ga.onEarned(id, alreadyEarned)
  if not active() or not ns.milestones or not ns.milestones.state then return false end
  id = tonumber(id)
  if not id then return false end
  local category = call(GetAchievementCategory, id)
  if category == SKIP_CATEGORY then return false end
  local rid, name, points, done, month, day, year, description = call(GetAchievementInfo, id)
  if rid ~= id then return false end
  local e = entry(id, name, points, month, day, year, description, category and call(GetCategoryInfo, category) or nil)
  if not e then return false end
  local c = ns.milestones.state()
  if not c or c.done["ach:" .. e.id] then return false end
  -- Just earned: the game's date is today; account-wide repeats (alreadyEarned) are recorded without a line in chat.
  if done ~= true or not e.at then e.at = nil end
  return record(e, alreadyEarned == true or not c.achBaselined)
end

local frame = CreateFrame("Frame")
for _, event in ipairs({ "PLAYER_ENTERING_WORLD", "ACHIEVEMENT_EARNED" }) do pcall(frame.RegisterEvent, frame, event) end
local scheduled = false
frame:SetScript("OnEvent", function(_, event, a, b)
  local ok, err = pcall(function()
    if not active() then return end
    if event == "PLAYER_ENTERING_WORLD" then
      -- Once per session, a little after login so the character's name and the guild are known.
      if scheduled then return end
      scheduled = true
      if C_Timer and C_Timer.After then C_Timer.After(SCAN_DELAY, function() pcall(ga.scan) end) else ga.scan() end
    elseif event == "ACHIEVEMENT_EARNED" then
      ga.onEarned(a, b)
    end
  end)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "gameAchievements: " .. tostring(err)) end
end)
