-- Copied from addon/Guilded/Modules/Scores.lua by scripts/build-dungeons-addon.mjs. Edit the original, then run npm run dungeons:sync.
-- Legacy local records are retained for compatibility; player-facing scores now
-- come exclusively from authoritative current-season snapshots.
-- Historical implementation notes:
-- Dungeon scores, the way Raider.IO shows a Mythic+ score in retail, built from the runs the
-- Dungeon module records (no Discord bot needed):
--
--   /guilded score [player]   a player's score and best run per dungeon (default: you)
--   /guilded score top        the guild's best scores
--
-- Each dungeon counts once, with the player's best completed run in it:
--   points = dungeon level x 2 (Stratholme 120, Deadmines 52)
--            x speed  (0.75 + 0.25 x guild record / this time: the record itself gets the full points)
--            x deaths (-5% per death of that player in the run, at most -25%)
-- The score is the sum over dungeons. Every client works it out from the runs it knows, and
-- each player also sends their own score to the guild (prefix GuildedScore), so guildmates who
-- were never in a run with them still see it. It shows on player tooltips, on the Scores page
-- and on the Scores page.
local addonName, ns = ...
ns = ns or {}

local PREFIX = "GuildedScore"
local LOGIN_DELAY_SECONDS = 30

local scores = {}
ns.scores = scores

-- Dungeon level ranges by name (English and French fragments, lower case, no accents needed:
-- the fragments avoid accented letters). The highest level of the range sets the points.
local DUNGEONS = {
  { key = "rfc", name = "Ragefire Chasm", max = 18, match = { "ragefire", "ragefeu" } },
  { key = "wc", name = "Wailing Caverns", max = 24, match = { "wailing", "lamentations" } },
  { key = "dm", name = "Deadmines", max = 26, match = { "deadmines", "mortemines" } },
  { key = "sfk", name = "Shadowfang Keep", max = 30, match = { "shadowfang", "ombrecroc" } },
  { key = "bfd", name = "Blackfathom Deeps", max = 32, match = { "blackfathom", "brassenoire" } },
  { key = "stocks", name = "The Stockade", max = 32, match = { "stockade", "prison" } },
  { key = "gnomer", name = "Gnomeregan", max = 38, match = { "gnomeregan" } },
  { key = "rfk", name = "Razorfen Kraul", max = 38, match = { "razorfen kraul", "kraal de tranchebauge" } },
  { key = "sm", name = "Scarlet Monastery", max = 45, match = { "scarlet", "carlate" } },
  { key = "rfd", name = "Razorfen Downs", max = 46, match = { "razorfen downs", "souilles de tranchebauge" } },
  { key = "ulda", name = "Uldaman", max = 51, match = { "uldaman" } },
  { key = "zf", name = "Zul'Farrak", max = 54, match = { "zul'farrak", "zulfarrak" } },
  { key = "mara", name = "Maraudon", max = 55, match = { "maraudon" } },
  { key = "st", name = "Sunken Temple", max = 56, match = { "sunken temple", "atal'hakkar" } },
  { key = "brd", name = "Blackrock Depths", max = 60, match = { "blackrock depths", "profondeurs de rochenoire" } },
  { key = "brs", name = "Blackrock Spire", max = 60, match = { "blackrock spire", "pic de rochenoire" } },
  { key = "dmaul", name = "Dire Maul", max = 60, match = { "dire maul", "tripes" } },
  { key = "scholo", name = "Scholomance", max = 60, match = { "scholomance" } },
  { key = "strat", name = "Stratholme", max = 60, match = { "stratholme" } }
}
local UNKNOWN_LEVEL = 40
scores.DUNGEONS = DUNGEONS

local function active() return not ns.moduleActive or ns.moduleActive("scores") end
local function L(text) return ns.L and ns.L(text) or text end

-- Unlike the general attendance roster, legacy entries without membership
-- evidence must not qualify for a guild leaderboard. Keep their saved history.
function scores.isMember(name)
  name = ns.normalizeName and ns.normalizeName(name)
  if ns.standalone then return name ~= nil and name == ns.playerName() end
  if not name or not (IsInGuild and IsInGuild()) then return false end
  if name == (ns.playerName and ns.playerName()) then return true end
  local db = ns.getDb and ns.getDb()
  return db and db.roster and db.roster[name] and db.roster[name].inGuild == true or false
end

local function store()
  local db = ns.getDb and ns.getDb()
  if not db then return nil end
  db.scores = db.scores or {}
  local s = db.scores
  -- bests[player][dungeonKey] = { sec, deaths, at, name }; board[player] = { score, n, at }
  s.bests = s.bests or {}
  s.board = s.board or {}
  return s
end

-- The dungeon a run was in: its entry above, or a made-up one keyed by the run's own name.
function scores.dungeonFor(name)
  local text = string.lower(tostring(name or ""))
  for _, dungeon in ipairs(DUNGEONS) do
    for _, fragment in ipairs(dungeon.match) do
      if string.find(text, fragment, 1, true) then return dungeon end
    end
  end
  if text == "" then return nil end
  return { key = "x:" .. text, name = name, max = UNKNOWN_LEVEL }
end

local function better(a, b)
  -- A death costs about a minute when comparing two runs of the same dungeon.
  return (a.sec + (a.deaths or 0) * 60) < (b.sec + (b.deaths or 0) * 60)
end

-- Learns from one finished run: every player's best in that dungeon.
function scores.learn(run)
  local s = store()
  if not s or type(run) ~= "table" or run.state ~= "COMPLETED" then return false end
  local sec = tonumber(run.durationSec)
  local dungeon = scores.dungeonFor(run.name)
  if not sec or sec <= 0 or not dungeon then return false end
  local changed = false
  for name, player in pairs(run.players or {}) do
    -- Only people who were really there (a few seconds in the group is not a clear).
    if scores.isMember(name) and ((player.presentSec or 0) >= sec * 0.5 or player.presentSec == nil) then
      s.bests[name] = s.bests[name] or {}
      local entry = { sec = sec, deaths = tonumber(player.deaths) or 0, at = run.endedAt or run.detectedAt, name = dungeon.name }
      local current = s.bests[name][dungeon.key]
      if not current or better(entry, current) then
        s.bests[name][dungeon.key] = entry
        changed = true
      end
    end
  end
  return changed
end

-- The guild record (fastest known time) of each dungeon.
local function records(s)
  local fastest = {}
  for name, dungeons in pairs(s.bests) do
    if scores.isMember(name) then
      for key, entry in pairs(dungeons) do
        if not fastest[key] or entry.sec < fastest[key] then fastest[key] = entry.sec end
      end
    end
  end
  return fastest
end

local function levelOf(key)
  for _, dungeon in ipairs(DUNGEONS) do if dungeon.key == key then return dungeon.max end end
  return UNKNOWN_LEVEL
end

-- Points for one best run (see the top of the file).
function scores.points(key, entry, record)
  local base = levelOf(key) * 2
  local speed = 0.75 + 0.25 * math.min(1, (record or entry.sec) / entry.sec)
  local deaths = 1 - math.min(0.25, 0.05 * (entry.deaths or 0))
  return math.floor(base * speed * deaths + 0.5)
end

-- A player's score from the runs this client knows: total, dungeons counted, and each line.
function scores.compute(name)
  if not scores.isMember(name) then return 0, 0, {} end
  local s = store()
  local mine = s and s.bests[name]
  if not mine then return 0, 0, {} end
  local fastest = records(s)
  local total, count, lines = 0, 0, {}
  for key, entry in pairs(mine) do
    local points = scores.points(key, entry, fastest[key])
    total, count = total + points, count + 1
    table.insert(lines, { key = key, name = entry.name, points = points, sec = entry.sec, deaths = entry.deaths, record = fastest[key] == entry.sec })
  end
  table.sort(lines, function(a, b) return a.points > b.points end)
  return total, count, lines
end

-- All-level seasons (rules version 6) rank each character per level bracket.
-- Older seasons have no brackets; every helper below then returns nil.
function scores.bracketFor(season, level)
  level = tonumber(level)
  for _, b in ipairs(level and season and season.brackets or {}) do
    if level >= b.min and level <= b.max then return b end
  end
  return nil
end
function scores.bracketByKey(season, key)
  for _, b in ipairs(key and season and season.brackets or {}) do if b.key == key then return b end end
  return nil
end
function scores.bracketLabel(b)
  if not b then return "" end
  if b.min == b.max then return string.format(L("Level %d"), b.min) end
  return string.format(L("Levels %d-%d"), b.min, b.max)
end
-- The bracket a player sees first: their current level's, else their best score's, else the first.
function scores.defaultBracket(season, name, level)
  if not season or type(season.brackets) ~= "table" or #season.brackets == 0 then return nil end
  local own = scores.bracketFor(season, level)
  if own then return own.key end
  for _, list in ipairs({ season.profiles or {}, season.rows or {} }) do
    for _, row in ipairs(list) do
      if ns.normalizeName(row.name) == name and scores.bracketByKey(season, row.bracket) then return row.bracket end
    end
  end
  return season.brackets[1].key
end

-- Only the current authoritative season is presented as a player rating. With a
-- level, an all-level season gives that level's bracket; without one, the best.
function scores.scoreOf(name, level)
  if not scores.isMember(name) then return nil end
  local db = ns.getDb and ns.getDb()
  local board = db and db.dungeonBoard
  if not board or board.status ~= "ACTIVE" then return nil end
  local bracket = scores.bracketFor(board, level)
  local key = bracket and bracket.key
  local snapshot = ns.seasonDetails and ns.seasonDetails.get(1, name, key)
  local profile = snapshot and snapshot.available and snapshot.profile
  if profile and (not key or not profile.bracket or profile.bracket == key) then
    return profile.points, #profile.details, profile.bracket
  end
  for _, row in ipairs(board.rows or {}) do
    if ns.normalizeName(row.name) == name and (not key or row.bracket == key) then return row.points, nil, row.bracket end
  end
  return nil
end

-- ---------------------------------------------------------------------
-- Sharing: S|<score>|<dungeons>
-- ---------------------------------------------------------------------

-- Old S messages cannot represent season IDs or fixed-target rules. Keep old
-- stored data, but never publish it as an authoritative seasonal rating.
function scores.share() return false end

function scores.receive(text, sender)
  local s = store()
  local name = ns.normalizeName and ns.normalizeName(sender)
  if not s or not scores.isMember(name) or name == (ns.playerName and ns.playerName()) then return end
  local total, count = string.match(text, "^S|(%d+)|(%d+)$")
  total, count = tonumber(total), tonumber(count)
  -- 19 dungeons at most ~150 points each: anything far above is not a real score.
  if not total or total > 5000 or count > 60 then return end
  s.board[name] = { score = total, n = count, at = ns.util.serverTime() }
end

-- Every player with a score, best first: { name, score, n }. An all-level
-- season ranks one bracket (by key); the other brackets are left out.
function scores.ranking(bracketKey)
  local s = store()
  local seen, rows = {}, {}
  if not s then return rows end
  local db = ns.getDb()
  local board = db and db.dungeonBoard
  if not board or board.status ~= "ACTIVE" then return rows end
  local bracket = scores.bracketByKey(board, bracketKey)
  local function add(name, entry)
    if seen[name] or not scores.isMember(name) then return end
    if bracket and entry.bracket ~= bracket.key then return end
    seen[name] = true
    local total, count = scores.scoreOf(name, bracket and bracket.min)
    if total then table.insert(rows, { name = name, score = total, n = count }) end
  end
  if not board.detailsAvailable then
    for _, row in ipairs(board.rows or {}) do add(ns.normalizeName(row.name), row) end
  end
  for _, profile in ipairs(board and board.profiles or {}) do
    local name = ns.normalizeName(profile.name)
    add(name, profile)
  end
  table.sort(rows, function(a, b) if a.score ~= b.score then return a.score > b.score end return a.name < b.name end)
  return rows
end

local function clockText(seconds)
  seconds = math.floor(seconds or 0)
  return string.format("%d:%02d", math.floor(seconds / 60), seconds % 60)
end

function scores.detailText(name)
  local total, count = scores.scoreOf(name)
  if total == nil then return L("No current season score received yet.") end
  local out = { ns.displayName(name) .. ": " .. L("Your season score") .. " " .. total }
  local snapshot = ns.seasonDetails and ns.seasonDetails.get(1, name)
  for _, line in ipairs(snapshot and snapshot.profile and snapshot.profile.details or {}) do
    out[#out + 1] = string.format("  %s: %d (+%d)  %s", line.name, line.points, line.speedBonus, clockText(line.durationSec))
  end
  if not count then out[#out + 1] = L("Per-dungeon breakdown unavailable in this snapshot.") end
  return table.concat(out, "\n")
end

function scores.topText(limit, bracketKey)
  local db = ns.getDb and ns.getDb()
  local board = db and db.dungeonBoard
  -- All-level season with no bracket asked for: the top five of every bracket.
  if board and type(board.brackets) == "table" and #board.brackets > 0 and not scores.bracketByKey(board, bracketKey) then
    local out = {}
    for _, b in ipairs(board.brackets) do
      out[#out + 1] = scores.bracketLabel(b) .. " (" .. b.key .. "):"
      local text = #scores.ranking(b.key) > 0 and scores.topText(5, b.key) or ("  " .. L("No scores yet."))
      out[#out + 1] = text
    end
    return table.concat(out, "\n")
  end
  local rows = scores.ranking(bracketKey)
  if #rows == 0 then return L("No current season score received yet.") end
  local out = {}
  local rank = 1
  for i = 1, math.min(limit or 10, #rows) do
    if i > 1 and rows[i].score ~= rows[i - 1].score then rank = i end
    table.insert(out, string.format("%2d. %-14s %d", rank, ns.displayName(rows[i].name), rows[i].score))
  end
  return table.concat(out, "\n")
end

-- ---------------------------------------------------------------------
-- Tooltip: "Guilded score: 812 (9 dungeons)" on players
-- ---------------------------------------------------------------------

local GOLD_R, GOLD_G, GOLD_B = 0.83, 0.69, 0.22

local function decorateUnit(tooltip)
  if not active() or not tooltip or not tooltip.GetUnit then return end
  local ok, _, unit = pcall(tooltip.GetUnit, tooltip)
  if not ok or not unit or (ns.isSecret and ns.isSecret(unit)) then return end
  if UnitIsPlayer and not UnitIsPlayer(unit) then return end
  local okName, unitName = pcall(UnitName, unit)
  if not okName or (ns.isSecret and ns.isSecret(unitName)) then return end
  local name = ns.normalizeName and ns.normalizeName(unitName)
  local okLevel, level = pcall(UnitLevel, unit)
  if not okLevel or (ns.isSecret and ns.isSecret(level)) then level = nil end
  local total, _, bracketKey = scores.scoreOf(name, level)
  if not total then return end
  local db = ns.getDb and ns.getDb()
  local bracket = scores.bracketByKey(db and db.dungeonBoard, bracketKey)
  tooltip:AddLine(string.format(L(ns.standalone and "Public season score: %d" or "Guilded season score: %d"), total) .. (bracket and (" (" .. scores.bracketLabel(bracket) .. ")") or ""), GOLD_R, GOLD_G, GOLD_B)
  local snapshot = ns.seasonDetails and ns.seasonDetails.get(1, name, bracketKey)
  for _, role in ipairs(snapshot and snapshot.profile and snapshot.profile.roles or {}) do
    tooltip:AddLine(L(role.role) .. ": " .. role.points, 0.8, 0.85, 1)
  end
  if snapshot and snapshot.profile and snapshot.profile.roles then tooltip:AddLine(L("Role scores are separate; unknown roles are not assigned."), 0.7, 0.7, 0.7) end
  if tooltip.Show then tooltip:Show() end
end
scores.decorateUnit = decorateUnit

local function hookTooltips()
  if TooltipDataProcessor and TooltipDataProcessor.AddTooltipPostCall and Enum and Enum.TooltipDataType and Enum.TooltipDataType.Unit then
    TooltipDataProcessor.AddTooltipPostCall(Enum.TooltipDataType.Unit, function(tooltip) pcall(decorateUnit, tooltip) end)
  elseif GameTooltip and GameTooltip.HookScript then
    pcall(GameTooltip.HookScript, GameTooltip, "OnTooltipSetUnit", function(tooltip) pcall(decorateUnit, tooltip) end)
  end
end

-- ---------------------------------------------------------------------
-- Commands and events
-- ---------------------------------------------------------------------

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["score"] = function(args)
  local what = args[1]
  if what and string.lower(what) == "top" then
    if ns.standalone then ns.message(L("Public rankings: guilded.kcaron.top/leaderboards/. This addon snapshot contains only your character.")); return end
    ns.message(L("Guild dungeon scores:"))
    for line in string.gmatch(scores.topText(15, args[2] and string.lower(args[2])), "[^\n]+") do ns.message(line) end
    return
  end
  local name = (what and ns.normalizeName and ns.normalizeName(what)) or (ns.playerName and ns.playerName())
  for line in string.gmatch(scores.detailText(name), "[^\n]+") do ns.message(line) end
end
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded score [player|top [bracket]] - dungeon scores from the runs Guilded recorded")

-- Every finished run the Dungeon module sees.
ns.onDungeonRunFinished = function(run)
  if not active() then return end
  if scores.learn(run) then scores.share(false) end
end

local frame = CreateFrame("Frame")
local function register(event)
  if ns.compat and ns.compat.registerEvent then ns.compat.registerEvent(frame, event)
  else pcall(frame.RegisterEvent, frame, event) end
end
register("PLAYER_LOGIN")
register("CHAT_MSG_ADDON")
register("GUILD_ROSTER_UPDATE")

frame:SetScript("OnEvent", function(_, event, ...)
  local args = { ... }
  local ok, err = pcall(function()
    if event == "PLAYER_LOGIN" then
      ns.comm.register(PREFIX)
      if not active() then return end
      -- Runs recorded before scores existed count too.
      local db = ns.getDb and ns.getDb()
      for _, run in pairs(db and db.dungeon and db.dungeon.runs or {}) do scores.learn(run) end
      hookTooltips()
      if C_Timer and C_Timer.After then C_Timer.After(LOGIN_DELAY_SECONDS, function() pcall(scores.share, true) end) end
    elseif event == "GUILD_ROSTER_UPDATE" then
      if not active() then return end
      local db = ns.getDb and ns.getDb()
      for _, run in pairs(db and db.dungeon and db.dungeon.runs or {}) do scores.learn(run) end
    elseif event == "CHAT_MSG_ADDON" then
      local prefix, text, channel, sender = args[1], args[2], args[3], args[4]
      if ns.isSecret and (ns.isSecret(prefix) or ns.isSecret(text) or ns.isSecret(sender)) then return end
      if not ns.comm.accept(prefix, text, channel, sender, PREFIX) then return end
      if prefix ~= PREFIX or channel ~= "GUILD" or not active() then return end
      scores.receive(text, sender)
    end
  end)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "scores: " .. tostring(err)) end
end)
