local _, ns = ...
GuildedGames = ns
local L = ns.L
local session, lastMatch, lastResult, queue = nil, nil, nil, {}
local function db()
  GuildedGamesDB = GuildedGamesDB or {}
  GuildedGamesDB.history = GuildedGamesDB.history or {}
  return GuildedGamesDB
end
local function secret(v) return issecretvalue and issecretvalue(v) end
local function clean(v)
  if type(v) ~= "string" or secret(v) then return nil end
  return v:match("^%s*(.-)%s*$")
end
local function channel()
  if IsInGroup and LE_PARTY_CATEGORY_INSTANCE and IsInGroup(LE_PARTY_CATEGORY_INSTANCE) then return "INSTANCE_CHAT" end
  if IsInRaid and IsInRaid() then return "RAID" end
  if IsInGroup and IsInGroup() then return "PARTY" end
end
local function fullName(unit)
  local name, realm
  if UnitFullName then name, realm = UnitFullName(unit) else name, realm = UnitName(unit) end
  if secret(name) or secret(realm) or not name then return nil end
  realm = realm and realm ~= "" and realm or (GetRealmName and GetRealmName())
  return realm and (name .. "-" .. realm:gsub("%s", "")) or name
end
-- Resolve only group members; ambiguous short names never select a player.
function ns.resolve(raw)
  raw = clean(raw)
  if not raw or raw == "" then return nil end
  local names = {}
  local function add(unit)
    if unit == "player" or (UnitExists and UnitExists(unit)) then
      local name = fullName(unit)
      if name then names[name] = true end
    end
  end
  add("player")
  if IsInRaid and IsInRaid() then
    for i = 1, (GetNumGroupMembers and GetNumGroupMembers() or 0) do add("raid" .. i) end
  else for i = 1, 4 do add("party" .. i) end end
  local found
  for name in pairs(names) do
    if name:lower() == raw:lower() then return name end
    if not raw:find("-", 1, true) and name:match("^[^-]+"):lower() == raw:lower() then
      if found then return nil end
      found = name
    end
  end
  return found
end
local function names(set)
  local out = {}; for name in pairs(set or {}) do out[#out + 1] = name end
  table.sort(out); return out
end
local function count(set) return #names(set) end
function ns.tell(text)
  if DEFAULT_CHAT_FRAME then DEFAULT_CHAT_FRAME:AddMessage("|cffffce64Guilded Games:|r " .. text) end
end
local function changed() if ns.refresh then ns.refresh() end end
local function announce(text)
  ns.tell(text)
  if session then
    -- A session owns its queue. Cancel/group changes discard stale instructions.
    if #queue < 64 then queue[#queue + 1] = { text = text, channel = session.channel } end
  end
end
local function announceNames(prefix, list)
  local line = prefix
  for _, name in ipairs(list) do
    if #line + #name + 2 > 220 then announce(line); line = prefix end
    line = line .. (line == prefix and "" or ", ") .. name
  end
  if line ~= prefix then announce(line) end
end
local elapsed = 0
local frame = CreateFrame("Frame")
frame:SetScript("OnUpdate", function(_, dt)
  elapsed = elapsed + dt
  if elapsed < 1.5 or #queue == 0 then return end
  elapsed = 0
  local row = table.remove(queue, 1)
  if row.channel ~= channel() then return end
  local send = C_ChatInfo and C_ChatInfo.SendChatMessage or SendChatMessage
  if send then pcall(send, "[Guilded Games] " .. row.text:sub(1, 230), row.channel) end
end)
local function scoreText(s)
  local scores, lines = {}, {}
  for name, p in pairs(s.players) do
    local key = s.teams and p.team or name
    scores[key] = (scores[key] or 0) + p.score
  end
  for _, key in ipairs(names(scores)) do lines[#lines + 1] = key .. ": " .. scores[key] end
  return table.concat(lines, " | ")
end
local function finish(winners)
  local s = session
  lastResult = string.format(L("Winner: %s"), table.concat(winners, ", ")) .. "\n" .. scoreText(s)
  announce(string.format(L("Winner: %s"), table.concat(winners, ", ")))
  local history = db().history
  history[#history + 1] = { at = time(), game = s.game, winners = table.concat(winners, ", "), scores = scoreText(s) }
  while #history > 50 do table.remove(history, 1) end
  lastMatch = { game = s.game, teams = s.teams, players = names(s.players), rounds = s.rounds, opponent = s.opponent }
  session = nil; changed()
end
local function finishScore()
  local scores, best, winners = {}, -1, {}
  for name, p in pairs(session.players) do
    local key = session.teams and p.team or name
    scores[key] = (scores[key] or 0) + p.score
  end
  for _, key in ipairs(names(scores)) do
    if scores[key] > best then best, winners = scores[key], { key }
    elseif scores[key] == best then winners[#winners + 1] = key end
  end
  finish(winners)
end
local function nextRound()
  local s = session
  s.phase, s.rolls, s.eligible = "READY", {}, nil
  announce(L("Round complete. Host: Next round when ready.")); changed()
end
function ns.start(game, teams, rounds, opponent)
  if session then ns.tell(L("Finish or cancel the current game first.")); return false end
  if GuildedLootRollActive and GuildedLootRollActive() then ns.tell(L("Finish Guilded's loot roll before hosting a game.")); return false end
  if not channel() then ns.tell(L("Join a party or raid first.")); return false end
  if not ({ high = true, death = true, duel = true, target = true, trivia = true })[game] then return false end
  local me = fullName("player")
  if game == "duel" then
    opponent = ns.resolve(opponent)
    if not opponent or opponent == me then ns.tell(L("Choose another player in your group.")); return false end
  end
  queue, lastResult = {}, nil
  session = { game = game, teams = teams == true and game == "trivia", players = {}, rolls = {}, round = 0,
    rounds = math.max(1, math.min(10, math.floor(tonumber(rounds) or 5))), phase = "JOINING", max = 100,
    channel = channel(), opponent = opponent, pack = ns.questions[ns.language()], used = {} }
  announce(L(game == "duel" and "Duel: host and chosen opponent alternate rolls. First to roll 1 loses. No gold."
    or "Type 1 to join, out to leave. Only the host needs the addon. No gold."))
  if game == "duel" then
    session.players[me] = { score = 0 }; session.players[opponent] = { score = 0 }
    session.turn = me
  end
  changed(); return true
end
function ns.join(raw)
  local s, name = session, ns.resolve(raw)
  if not s or s.game == "duel" or s.phase ~= "JOINING" or not name or s.players[name] or count(s.players) >= 40 then return false end
  s.players[name] = { score = 0, team = count(s.players) % 2 == 0 and "A" or "B" }
  changed(); return true
end
local function resolveRolls()
  local s = session
  local eligible = s.eligible or s.players
  for name in pairs(eligible) do if not s.rolls[name] then return end end
  local best, tied
  for _, name in ipairs(names(eligible)) do
    local value = s.rolls[name]
    if s.game == "target" then value = math.abs(value - s.target) end
    local better = best == nil or (s.game == "high" and value > best) or (s.game ~= "high" and value < best)
    if better then best, tied = value, { name } elseif value == best then tied[#tied + 1] = name end
  end
  if not tied then return end
  if s.game == "high" or s.game == "death" then
    if #tied > 1 then
      s.eligible, s.rolls = {}, {}
      for _, name in ipairs(tied) do s.eligible[name] = true end
      s.eliminationMax = s.eliminationMax or (s.game == "death" and best or nil)
      announce(L("Tie: only tied players roll again. See host for names."))
      announceNames("/roll " .. s.max .. ": ", tied)
    elseif s.game == "high" then finish(tied)
    else
      s.players[tied[1]].out = true
      announce(string.format(L("Eliminated: %s"), tied[1]))
      local left = {}; for name, p in pairs(s.players) do if not p.out then left[#left + 1] = name end end
      if #left <= 1 then finish(left); return end
      s.max = math.max(2, s.eliminationMax or best); s.eliminationMax = nil; nextRound()
    end
  else
    for _, name in ipairs(tied) do s.players[name].score = s.players[name].score + 1 end
    announce(string.format(L("Point: %s"), table.concat(tied, ", ")))
    if s.round >= s.rounds then finishScore() else nextRound() end
  end
  changed()
end
function ns.nextRound()
  local s = session
  if not s or (s.phase ~= "JOINING" and s.phase ~= "READY") then return end
  if count(s.players) < 2 then ns.tell(L("At least two players must join.")); return end
  s.phase, s.round, s.rolls = "ROLLING", s.round + 1, {}
  s.eligible = {}; for name, p in pairs(s.players) do if not p.out then s.eligible[name] = true end end
  if s.game == "trivia" then
    if s.teams and s.round == 1 then
      for i, name in ipairs(names(s.players)) do s.players[name].team = i % 2 == 1 and "A" or "B" end
      for _, team in ipairs({ "A", "B" }) do
        local members = {}; for _, name in ipairs(names(s.players)) do if s.players[name].team == team then members[#members + 1] = name end end
        announceNames(L("Team") .. " " .. team .. ": ", members)
      end
    end
    local available = {}; for i in ipairs(s.pack) do if not s.used[i] then available[#available + 1] = i end end
    if #available == 0 then finishScore(); return end
    local index = available[math.random(#available)]; s.used[index] = true; s.question = s.pack[index]
    s.phase, s.answered = "ANSWERING", {}
    announce(string.format(L("Round %d: %s"), s.round, s.question.q))
    announce(L("One answer each in group chat. First correct answer scores. Host can skip."))
  elseif s.game == "duel" then announce(string.format(L("%s: /roll %d"), s.turn, s.max))
  elseif s.game == "target" then
    s.target = math.random(1, 100)
    announce(string.format(L("Round %d: target %d. Everyone /roll 100. Closest scores; ties share a point."), s.round, s.target))
  else announce(string.format(L("Round %d: everyone /roll %d. %s"), s.round, s.max, L(s.game == "high" and "Highest wins." or "Lowest is eliminated."))) end
  changed()
end
function ns.roll(raw, value, minimum, maximum)
  local s, name = session, ns.resolve(raw)
  if not s or s.phase ~= "ROLLING" or not name or not s.players[name] or s.players[name].out then return end
  if minimum ~= 1 or maximum ~= s.max or type(value) ~= "number" or value < 1 or value > maximum or value ~= math.floor(value) then return end
  if s.game == "duel" then
    if name ~= s.turn then return end
    local other = name == s.opponent and fullName("player") or s.opponent
    if value == 1 then finish({ other }); return end
    s.turn, s.max = other, value; announce(string.format(L("%s: /roll %d"), other, value)); changed(); return
  end
  if not s.eligible[name] or s.rolls[name] then return end
  s.rolls[name] = value; resolveRolls(); changed()
end
function ns.remove(raw)
  local s, name = session, ns.resolve(raw) or clean(raw)
  if not s or not name or not s.players[name] then return end
  if s.phase == "JOINING" then s.players[name] = nil; changed(); return end
  -- Never silently award a win for an AFK player: removal abandons the round.
  s.players[name].out = true
  announce(string.format(L("Removed: %s. Current round abandoned; no point awarded."), name))
  if s.game == "duel" then ns.cancel(); return end
  s.players[name] = nil
  local active = 0; for _, p in pairs(s.players) do if not p.out then active = active + 1 end end
  if active < 2 then ns.cancel(); return end
  s.round = math.max(0, s.round - 1); nextRound()
end
function ns.chat(raw, text)
  local s, name = session, ns.resolve(raw)
  text = clean(text)
  if not s or not name or not text then return end
  text = text:lower()
  if text == "out" or text == "leave" then ns.remove(name); return end
  if s.phase == "JOINING" then if text == "1" or text == "join" then ns.join(name) end; return end
  if s.phase ~= "ANSWERING" or not s.players[name] or s.answered[name] then return end
  s.answered[name] = true
  for _, answer in ipairs(s.question.a) do
    if text == answer then
      s.players[name].score = s.players[name].score + 1
      announce(string.format(L("Correct: %s. Answer: %s"), name, s.question.a[1]))
      if s.round >= s.rounds then finishScore() else nextRound() end
      return
    end
  end
  changed()
end
function ns.skip()
  if not session or session.game ~= "trivia" or session.phase ~= "ANSWERING" then return end
  announce(string.format(L("Answer: %s. No point this round."), session.question.a[1]))
  if session.round >= session.rounds then finishScore() else nextRound() end
end
function ns.cancel()
  if not session then return end
  queue = {}; announce(L("Game cancelled. No result saved.")); session = nil; changed()
end
function ns.rematch()
  if not lastMatch then return end
  local old = lastMatch
  if ns.start(old.game, old.teams, old.rounds, old.opponent) then for _, name in ipairs(old.players) do ns.join(name) end end
end
function ns.state() return session end
function ns.status()
  if not session then return (lastResult and lastResult .. "\n\n" or "") .. L("Choose a game or rematch. Only the host needs this addon.") end
  local s, lines = session, {}
  lines[#lines + 1] = L(s.game) .. " - " .. L(s.phase) .. " - " .. s.round .. "/" .. s.rounds
  if s.question and s.phase == "ANSWERING" then lines[#lines + 1] = s.question.q end
  if s.turn then lines[#lines + 1] = string.format(L("%s: /roll %d"), s.turn, s.max) end
  for _, name in ipairs(names(s.players)) do
    local p = s.players[name]
    local state = p.out and L("out") or s.rolls[name] and tostring(s.rolls[name]) or s.phase == "ROLLING" and L("waiting") or ""
    lines[#lines + 1] = name .. (s.teams and " [" .. p.team .. "]" or "") .. "  " .. p.score .. "  " .. state
  end
  return table.concat(lines, "\n")
end
function ns.history()
  local lines, history = {}, db().history
  for i = #history, math.max(1, #history - 9), -1 do
    local row = history[i]
    lines[#lines + 1] = date("%m-%d %H:%M", row.at) .. "  " .. L(row.game) .. "  " .. row.winners .. "\n" .. row.scores
  end
  return #lines > 0 and table.concat(lines, "\n\n") or L("No completed matches yet.")
end
-- Convert the client's localized system format; positional tokens remain in capture order.
function ns.parseRoll(text)
  if secret(text) or type(text) ~= "string" then return end
  local format = RANDOM_ROLL_RESULT or "%s rolls %d (%d-%d)"
  local order, pattern, pos, implicit = {}, "^", 1, 0
  while pos <= #format do
    local a, b, index, kind = format:find("%%(%d+)%$([sd])", pos)
    local c, d, simple = format:find("%%([sd])", pos)
    if c and (not a or c < a) then a, b, kind, index = c, d, simple, nil end
    local literal = format:sub(pos, a and a - 1 or #format)
    pattern = pattern .. literal:gsub("([%(%)%.%%%+%-%*%?%[%]%^%$])", "%%%1")
    if not a then break end
    implicit = implicit + 1; order[#order + 1] = tonumber(index) or implicit
    pattern = pattern .. (kind == "s" and "(.+)" or "(%d+)"); pos = b + 1
  end
  local captures = { text:match(pattern .. "$") }; local values = {}
  for i, v in ipairs(captures) do values[order[i]] = v end
  if values[1] then return values[1], tonumber(values[2]), tonumber(values[3]), tonumber(values[4]) end
end
for _, event in ipairs({ "CHAT_MSG_SYSTEM", "CHAT_MSG_PARTY", "CHAT_MSG_PARTY_LEADER", "CHAT_MSG_RAID", "CHAT_MSG_RAID_LEADER", "CHAT_MSG_INSTANCE_CHAT", "CHAT_MSG_INSTANCE_CHAT_LEADER", "GROUP_ROSTER_UPDATE", "PLAYER_LOGIN" }) do pcall(frame.RegisterEvent, frame, event) end
frame:SetScript("OnEvent", function(_, event, text, sender)
  local ok, err = pcall(function()
    if event == "PLAYER_LOGIN" then db(); return end
    if not session then return end
    if event == "GROUP_ROSTER_UPDATE" then
      if channel() ~= session.channel then ns.cancel(); queue = {}; return end
      for _, name in ipairs(names(session.players)) do if session and not ns.resolve(name) then ns.remove(name) end end
    elseif event == "CHAT_MSG_SYSTEM" then ns.roll(ns.parseRoll(text))
    else
      local expected = event:find("INSTANCE", 1, true) and "INSTANCE_CHAT" or event:find("RAID", 1, true) and "RAID" or "PARTY"
      if expected == session.channel then ns.chat(sender, text) end
    end
  end)
  if not ok then ns.tell(L("Game error; cancel and restart.") .. " " .. tostring(err)) end
end)
SLASH_GUILDEDGAMES1 = "/ggames"
SlashCmdList.GUILDEDGAMES = function(text)
  local action, arg = (text or ""):match("^(%S*)%s*(.-)%s*$")
  if action == "cancel" then ns.cancel()
  elseif action == "next" then ns.nextRound()
  elseif action == "join" then ns.join(fullName("player"))
  elseif action == "remove" then ns.remove(arg)
  elseif action == "lang" and (arg == "en" or arg == "fr") then db().language = arg; changed()
  elseif ns.open then ns.open() end
end
