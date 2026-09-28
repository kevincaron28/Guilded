-- Roll games: just for fun, played with the game's own /roll. Nothing is
-- bet, nothing is owed, and it is never you against the guild.
--
--   /guilded games highroll [max]    everyone rolls, the highest roll wins
--   /guilded games deathroll [max]   everyone rolls, the lowest is out, again until one is left
--   /guilded games duel <player> [max]   two players, classic deathroll: roll the last number, first to roll 1 loses
--   /guilded games roll | remind | add <p> | remove <p> | cancel | status
--
-- Anyone can run a game: your client is the referee. It reads the group's
-- /roll results and chat, and posts short lines in party/raid chat. Players
-- join a group game by typing 1 in party/raid chat; they need no addon.
-- Chat volume stays low: lines queued close together are merged into one
-- message and sends are spaced out.
local addonName, ns = ...
ns = ns or {}

local CHAT_MAX = 240
local CHAT_GAP_SECONDS = 1.5
local DEFAULT_MAX = 100
local JOIN_WORDS = { ["1"] = true, ["join"] = true, ["in"] = true }
local LEAVE_WORDS = { ["leave"] = true, ["out"] = true }
local GROUP_CHAT_EVENTS = {
  "CHAT_MSG_PARTY", "CHAT_MSG_PARTY_LEADER", "CHAT_MSG_RAID", "CHAT_MSG_RAID_LEADER",
  "CHAT_MSG_INSTANCE_CHAT", "CHAT_MSG_INSTANCE_CHAT_LEADER"
}
local NAMES = { HIGH = "High Roll", DEATH = "Deathroll" }

local games = { session = nil, duel = nil }
ns.games = games

-- ---------------------------------------------------------------------
-- Chat output: queued, merged and paced
-- ---------------------------------------------------------------------

local function groupChannel()
  return ns.util.groupChannel()
end

local queue, flushScheduled, lastChatAt = {}, false, 0
local function clock() return GetTime and GetTime() or time() end

local function sendChat(text, channel)
  pcall(function()
    if C_ChatInfo and C_ChatInfo.SendChatMessage then C_ChatInfo.SendChatMessage(text, channel)
    elseif SendChatMessage then SendChatMessage(text, channel) end
  end)
end

local scheduleFlush
local function flush()
  flushScheduled = false
  if #queue == 0 then return end
  local line = table.remove(queue, 1)
  while queue[1] and string.len(line) + 3 + string.len(queue[1]) <= CHAT_MAX do
    line = line .. " | " .. table.remove(queue, 1)
  end
  local channel = groupChannel()
  if channel then sendChat("[Guilded] " .. line, channel) end
  lastChatAt = clock()
  if #queue > 0 then scheduleFlush() end
end
scheduleFlush = function()
  if flushScheduled then return end
  flushScheduled = true
  local wait = math.max(0.2, CHAT_GAP_SECONDS - (clock() - lastChatAt))
  if C_Timer and C_Timer.After then C_Timer.After(wait, flush) else flush() end
end

local function announce(text)
  ns.message(text)
  table.insert(queue, string.sub(text, 1, CHAT_MAX))
  scheduleFlush()
end
local function tell(text) ns.message(text) end

local function countKeys(t)
  local n = 0
  for _ in pairs(t) do n = n + 1 end
  return n
end
local function sortedNames(set)
  local names = {}
  for name in pairs(set) do table.insert(names, name) end
  table.sort(names)
  return names
end

local function parseMax(text)
  local value = tonumber(text)
  if not value then return DEFAULT_MAX end
  value = math.floor(value)
  if value < 2 then return 2 end
  if value > 1000000 then return 1000000 end
  return value
end

-- ---------------------------------------------------------------------
-- Group games
-- ---------------------------------------------------------------------

local function startGroup(game, maxText)
  if games.session then tell("A game is already open. Roll, or /guilded games cancel first."); return end
  if not groupChannel() then tell("Form a party or raid first: players must be grouped with you so you can see their rolls."); return end
  local maxRoll = parseMax(maxText)
  games.session = { game = game, host = ns.playerName(), phase = "JOINING", players = {}, rolls = {}, maxRoll = maxRoll, round = 1, eliminated = {} }
  announce(string.format("%s up to %d! Type 1 in chat to join. %s", NAMES[game], maxRoll,
    game == "HIGH" and "Highest roll wins." or "Lowest roll is out each round; last one left wins."))
end

local function waitingOn()
  local session = games.session
  local names = {}
  for _, name in ipairs(sortedNames(session.players)) do
    if not session.rolls[name] then table.insert(names, name) end
  end
  return names
end

local function callRoll(prefix)
  local session = games.session
  session.phase = "ROLLING"
  session.rolls = {}
  announce(string.format("%s/roll %d now: %s", prefix or "", session.maxRoll, table.concat(sortedNames(session.players), ", ")))
end

local function addPlayer(name)
  local session = games.session
  if not session or session.phase ~= "JOINING" or not name or session.players[name] then return end
  session.players[name] = true
  tell(string.format("%s joined (%d player%s).", name, countKeys(session.players), countKeys(session.players) == 1 and "" or "s"))
end

local function removePlayer(name)
  local session = games.session
  if not session or session.phase ~= "JOINING" or not session.players[name] then return end
  session.players[name] = nil
  tell(name .. " left the game.")
end

local function beginRolling()
  local session = games.session
  if not session then tell("No game is open."); return end
  if session.phase ~= "JOINING" then tell("Already rolling. /guilded games remind nudges players."); return end
  if countKeys(session.players) < 2 then tell("Need at least 2 players: they type 1 in chat, or /guilded games add <player>."); return end
  callRoll()
end

-- A bonus added to a player's high roll (soft reserve SR+: +10 per week they reserved the item
-- and did not get it; see Reserve.lua). Only for a High Roll that is still joining.
function games.setBonus(name, amount)
  local session = games.session
  amount = math.floor(tonumber(amount) or 0)
  if not (session and session.game == "HIGH" and name and session.players[name]) then return false end
  session.bonus = session.bonus or {}
  session.bonus[name] = amount > 0 and amount or nil
  return true
end

local function resolveHigh(session)
  local best, winners = nil, {}
  local rolls = {}
  for name, value in pairs(session.rolls) do rolls[name] = value + ((session.bonus and session.bonus[name]) or 0) end
  for name, value in pairs(rolls) do
    if not best or value > best then best, winners = value, { name }
    elseif value == best then table.insert(winners, name) end
  end
  if #winners > 1 then
    table.sort(winners)
    session.players = {}
    for _, name in ipairs(winners) do session.players[name] = true end
    callRoll(string.format("Tie at %d! Roll-off: ", best))
    return
  end
  local bonus = session.bonus and session.bonus[winners[1]]
  announce(string.format("High Roll: %s wins with %d%s!", winners[1], best,
    bonus and string.format(" (%d + %d SR+)", best - bonus, bonus) or ""))
  games.session = nil
end

local function resolveDeath(session)
  local low, lows = nil, {}
  for name, value in pairs(session.rolls) do
    if not low or value < low then low, lows = value, { name }
    elseif value == low then table.insert(lows, name) end
  end
  table.sort(lows)
  local out = lows[math.random(#lows)]
  table.insert(session.eliminated, out)
  session.players[out] = nil
  local tie = #lows > 1 and " (tie, picked at random)" or ""
  if countKeys(session.players) <= 1 then
    announce(string.format("Deathroll: %s is out%s. %s wins!", out, tie, next(session.players)))
    games.session = nil
    return
  end
  session.round = session.round + 1
  session.maxRoll = math.max(low, 2)
  callRoll(string.format("Round %d - %s is out%s. ", session.round, out, tie))
end

local function onGroupRoll(name, value, maxRoll)
  local session = games.session
  if not session or session.phase ~= "ROLLING" or not session.players[name] then return end
  if maxRoll ~= session.maxRoll or session.rolls[name] then return end
  session.rolls[name] = value
  if #waitingOn() > 0 then return end
  if session.game == "HIGH" then resolveHigh(session) else resolveDeath(session) end
end

-- ---------------------------------------------------------------------
-- Duel: two players, classic deathroll
-- ---------------------------------------------------------------------

local function startDuel(opponent, maxText)
  if games.duel then tell("A duel is already running. /guilded games cancel first."); return end
  opponent = ns.normalizeName(opponent)
  if not opponent then tell("Name your opponent: /guilded games duel <player>."); return end
  local me = ns.playerName()
  if opponent == me then tell("You cannot duel yourself."); return end
  if not groupChannel() then tell("Form a party or raid with them first so you can see the rolls."); return end
  local start = parseMax(maxText)
  games.duel = { a = me, b = opponent, turn = me, max = start }
  announce(string.format("Deathroll duel: %s vs %s! %s starts: /roll %d. Then each rolls the last number; whoever rolls 1 loses.", me, opponent, me, start))
end

local function onDuelRoll(name, value, maxRoll)
  local duel = games.duel
  if not duel or name ~= duel.turn or maxRoll ~= duel.max then return end
  if value == 1 then
    local winner = (name == duel.a) and duel.b or duel.a
    announce(string.format("%s rolled 1 and loses! %s wins the duel.", name, winner))
    games.duel = nil
    return
  end
  local nextPlayer = (name == duel.a) and duel.b or duel.a
  duel.max, duel.turn = value, nextPlayer
  announce(string.format("%s rolled %d. %s: /roll %d", name, value, nextPlayer, value))
end

-- ---------------------------------------------------------------------
-- Status and commands
-- ---------------------------------------------------------------------

function games.statusText()
  local lines = {}
  local session = games.session
  if session then
    table.insert(lines, string.format("%s (%s): %d player(s)%s", NAMES[session.game], session.phase == "JOINING" and "joining" or "rolling",
      countKeys(session.players), session.phase == "ROLLING" and (", waiting on " .. (table.concat(waitingOn(), ", ") ~= "" and table.concat(waitingOn(), ", ") or "nobody")) or ""))
  end
  if games.duel then
    table.insert(lines, string.format("Duel %s vs %s: %s to /roll %d", games.duel.a, games.duel.b, games.duel.turn, games.duel.max))
  end
  return #lines > 0 and table.concat(lines, "\n") or "No games running."
end

local function cancelAll()
  if not games.session and not games.duel then tell("Nothing to cancel."); return end
  announce("Game cancelled.")
  games.session, games.duel = nil, nil
end

local function help()
  tell("Roll games (just for fun, no gold): /guilded games highroll [max] | deathroll [max] | duel <player> [max]")
  tell("  then: roll (call the roll) | remind | add <player> | remove <player> | cancel | status. Players type 1 in chat to join.")
end

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["games"] = function(args)
  if ns.moduleActive and not ns.moduleActive("games") then return end
  local action = string.lower(args[1] or "")
  if action == "highroll" or action == "high" then startGroup("HIGH", args[2])
  elseif action == "deathroll" or action == "death" then startGroup("DEATH", args[2])
  elseif action == "duel" then startDuel(args[2], args[3])
  elseif action == "roll" then beginRolling()
  elseif action == "remind" then
    if games.session and games.session.phase == "ROLLING" then
      announce(string.format("Waiting on %s: /roll %d", table.concat(waitingOn(), ", "), games.session.maxRoll))
    else tell("Nobody is being waited on.") end
  elseif action == "add" then addPlayer(ns.normalizeName(args[2]))
  elseif action == "remove" then removePlayer(ns.normalizeName(args[2]))
  elseif action == "cancel" then cancelAll()
  elseif action == "status" then tell(games.statusText())
  else help() end
  if ns.onGamesChange then ns.onGamesChange() end
end
-- The old gold casino was removed: point old habits at the new games.
ns.commandHandlers["casino"] = function()
  ns.message("The casino was removed. Fun roll games with no gold at stake: /guilded games")
end
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded games - fun roll games: highroll, deathroll, duel (no gold, anyone can run one)")

-- ---------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------

local frame = CreateFrame("Frame")
local function register(event)
  if ns.compat and ns.compat.registerEvent then ns.compat.registerEvent(frame, event)
  else pcall(frame.RegisterEvent, frame, event) end
end
register("CHAT_MSG_SYSTEM")
for _, event in ipairs(GROUP_CHAT_EVENTS) do register(event) end

frame:SetScript("OnEvent", function(_, event, ...)
  local args = { ... }
  local ok, err = pcall(function()
    if ns.moduleActive and not ns.moduleActive("games") then return end
    if not games.session and not games.duel then return end
    if event == "CHAT_MSG_SYSTEM" then
      local text = args[1]
      if ns.isSecret(text) then return end
      local roller, value, minValue, maxValue = ns.parseRoll(text)
      if not roller or minValue ~= 1 then return end
      onGroupRoll(roller, value, maxValue)
      onDuelRoll(roller, value, maxValue)
    else
      local text, sender = args[1], args[2]
      if ns.isSecret(text) or ns.isSecret(sender) then return end
      local word = string.lower(string.match(text or "", "^%s*(.-)%s*$") or "")
      local name = ns.normalizeName(sender)
      if not name then return end
      if JOIN_WORDS[word] then addPlayer(name) elseif LEAVE_WORDS[word] then removePlayer(name) end
    end
    if ns.onGamesChange then ns.onGamesChange() end
  end)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "games: " .. tostring(err)) end
end)
