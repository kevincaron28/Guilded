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
-- and next to group leaders on the Groups page.
local addonName, ns = ...
ns = ns or {}

local PREFIX = "GuildedScore"
local SHARE_EVERY_SECONDS = 30 * 60
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
    if (player.presentSec or 0) >= sec * 0.5 or player.presentSec == nil then
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
  for _, dungeons in pairs(s.bests) do
    for key, entry in pairs(dungeons) do
      if not fastest[key] or entry.sec < fastest[key] then fastest[key] = entry.sec end
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

-- The score shown for a player: what this client worked out, or what they sent, whichever is
-- higher (they may have runs this client never saw).
function scores.scoreOf(name)
  local s = store()
  if not s or not name then return nil end
  local total, count = scores.compute(name)
  local shared = s.board[name]
  if shared and (shared.score or 0) > total then return shared.score, shared.n or count end
  if total == 0 then return nil end
  return total, count
end

-- ---------------------------------------------------------------------
-- Sharing: S|<score>|<dungeons>
-- ---------------------------------------------------------------------

local lastShared = { at = -100000, score = -1 }
local function clock()
  local ok, value = pcall(GetTime)
  if ok and type(value) == "number" then return value end
  return time()
end

function scores.share(force)
  if not active() or not (IsInGuild and IsInGuild()) then return false end
  local me = ns.playerName and ns.playerName()
  local total, count = scores.compute(me)
  if total == 0 then return false end
  if not force and total == lastShared.score and clock() - lastShared.at < SHARE_EVERY_SECONDS then return false end
  ns.comm.send(PREFIX, string.format("S|%d|%d", total, count), "GUILD")
  lastShared = { at = clock(), score = total }
  return true
end

function scores.receive(text, sender)
  local s = store()
  local name = ns.normalizeName and ns.normalizeName(sender)
  if not s or not name or name == (ns.playerName and ns.playerName()) then return end
  local total, count = string.match(text, "^S|(%d+)|(%d+)")
  total, count = tonumber(total), tonumber(count)
  -- 19 dungeons at most ~150 points each: anything far above is not a real score.
  if not total or total > 5000 or count > 60 then return end
  s.board[name] = { score = total, n = count, at = ns.util.serverTime() }
end

-- Every player with a score, best first: { name, score, n }.
function scores.ranking()
  local s = store()
  local seen, rows = {}, {}
  if not s then return rows end
  local function add(name)
    if seen[name] then return end
    seen[name] = true
    local total, count = scores.scoreOf(name)
    if total then table.insert(rows, { name = name, score = total, n = count }) end
  end
  for name in pairs(s.bests) do add(name) end
  for name in pairs(s.board) do add(name) end
  table.sort(rows, function(a, b) if a.score ~= b.score then return a.score > b.score end return a.name < b.name end)
  return rows
end

local function clockText(seconds)
  seconds = math.floor(seconds or 0)
  return string.format("%d:%02d", math.floor(seconds / 60), seconds % 60)
end

function scores.detailText(name)
  local total, count, lines = scores.compute(name)
  local shown, shownCount = scores.scoreOf(name)
  if not shown then return string.format(L("%s has no dungeon score yet (a completed run recorded by Guilded)."), name) end
  local out = { string.format(L("%s: dungeon score %d (%d dungeons)"), name, shown, shownCount or count) }
  for _, line in ipairs(lines) do
    table.insert(out, string.format("  %s: %d  (%s, %d %s)%s", line.name or line.key, line.points, clockText(line.sec), line.deaths or 0,
      L("deaths"), line.record and ("  " .. L("guild record")) or ""))
  end
  if total < shown then table.insert(out, "  " .. L("(some of their runs were never seen by this client)")) end
  return table.concat(out, "\n")
end

function scores.topText(limit)
  local rows = scores.ranking()
  if #rows == 0 then return L("No dungeon scores yet: complete a dungeon with Guilded running.") end
  local out = {}
  for i = 1, math.min(limit or 10, #rows) do
    table.insert(out, string.format("%2d. %-14s %d  (%d)", i, rows[i].name, rows[i].score, rows[i].n or 0))
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
  local total, count = scores.scoreOf(name)
  if not total then return end
  tooltip:AddLine(string.format(L("Guilded dungeon score: %d (%d dungeons)"), total, count or 0), GOLD_R, GOLD_G, GOLD_B)
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
    ns.message(L("Guild dungeon scores:"))
    for line in string.gmatch(scores.topText(15), "[^\n]+") do ns.message(line) end
    return
  end
  local name = (what and ns.normalizeName and ns.normalizeName(what)) or (ns.playerName and ns.playerName())
  for line in string.gmatch(scores.detailText(name), "[^\n]+") do ns.message(line) end
end
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded score [player|top] - dungeon scores from the runs Guilded recorded")

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
    elseif event == "CHAT_MSG_ADDON" then
      local prefix, text, channel, sender = args[1], args[2], args[3], args[4]
      if ns.isSecret and (ns.isSecret(prefix) or ns.isSecret(text) or ns.isSecret(sender)) then return end
      if prefix ~= PREFIX or channel ~= "GUILD" or not active() then return end
      scores.receive(text, sender)
    end
  end)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "scores: " .. tostring(err)) end
end)
