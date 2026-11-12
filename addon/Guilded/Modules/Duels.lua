-- Guild duel leaderboard (8.4.5): who beat whom between guildmates, with wins, losses, win rate and streak.
--
-- A duel is recorded from the game's own system line ("X has defeated Y in a duel", or the retreat line), read
-- from the client's global strings so every language works, and only when BOTH players are in the guild.
-- A participant shares the result with the guild (addon channel, not chat); every client keeps one copy per
-- duel: the same pair within DEDUPE seconds is the same duel, whoever reports it. A shared result counts only
-- if the sender is the winner or the loser. At most PAIR_DAILY duels per pair per day count, so two friends
-- cannot farm the board. The paired companion uploads the results to the Discord /bg duels board and the site.
--
--   /guilded duels            the top of the board in chat
--   /guilded duels me         my record
local _, ns = ...
local duels = {}
ns.duels = duels

local PREFIX = "GuildedDuel"
local DEDUPE = 60
local PAIR_DAILY = 5
local KEEP = 500
local MAX_AGE = 30 * 86400
local DAY = 86400

local function L(text) return ns.L and ns.L(text) or text end
local function active() return not ns.moduleActive or ns.moduleActive("duels") end
local function epoch() local ok, v = pcall(GetServerTime); return ok and tonumber(v) or time() end
local function bare(name)
  if type(name) ~= "string" then return nil end
  name = name:gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", ""):gsub("|H.-|h(.-)|h", "%1"):gsub("[%[%]]", "")
  name = name:match("^%s*(.-)%s*$")
  name = name:match("^([^-]+)") or name
  if name == "" or #name > 60 or name:find("[|%c]") then return nil end
  return name
end
local function store()
  local d = ns.getDb and ns.getDb()
  if not d then return nil end
  d.duels = type(d.duels) == "table" and d.duels or {}
  d.duels.results = type(d.duels.results) == "table" and d.duels.results or {}
  return d.duels
end
-- My own name as the guild knows it: on WoW Forever UnitName gives the first name only (the surname is a second
-- value), so the full "First Last" key comes from ns.util.unitKey when it is there.
local function me()
  if ns.util and ns.util.unitKey then
    local ok, key = pcall(ns.util.unitKey, "player")
    if ok and type(key) == "string" and key ~= "" then return key end
  end
  local ok, name = pcall(UnitName, "player")
  return ok and type(name) == "string" and name or nil
end
local function guildMember(name) return ns.isGuildMember and ns.isGuildMember(name) == true end

-- ----- the client's duel lines -----------------------------------------

local function esc(text) return (text:gsub("[%^%$%(%)%%%.%[%]%*%+%-%?]", "%%%0")) end
-- "%1$s has defeated %2$s in a duel" -> a Lua pattern plus which capture is argument 1 (winner) and 2 (loser).
local function compile(format)
  if type(format) ~= "string" or format == "" then return nil end
  local parts, order, pos = { "^" }, {}, 1
  while true do
    local s, e, n = format:find("%%(%d*)%$?s", pos)
    if not s then parts[#parts + 1] = esc(format:sub(pos)); break end
    parts[#parts + 1] = esc(format:sub(pos, s - 1)); parts[#parts + 1] = "(.-)"
    order[#order + 1] = tonumber(n) or (#order + 1)
    pos = e + 1
  end
  parts[#parts + 1] = "$"
  if #order ~= 2 then return nil end
  return table.concat(parts), order
end
local patterns
local function build()
  patterns = {}
  for _, def in ipairs({ { "DUEL_WINNER_KNOCKOUT", "knockout" }, { "DUEL_WINNER_RETREAT", "retreat" } }) do
    local pattern, order = compile(_G[def[1]])
    if pattern then patterns[#patterns + 1] = { pattern = pattern, order = order, reason = def[2] } end
  end
end
-- Returns winner, loser, reason for a duel system line, or nil.
function duels.parse(text)
  if type(text) ~= "string" or (ns.isSecret and ns.isSecret(text)) then return nil end
  if not patterns then build() end
  for _, p in ipairs(patterns) do
    local a, b = text:match(p.pattern)
    if a and b then
      local args = { [p.order[1]] = a, [p.order[2]] = b }
      local winner, loser = bare(args[1]), bare(args[2])
      if winner and loser and winner ~= loser then return winner, loser, p.reason end
    end
  end
end
function duels.rebuildPatterns() patterns = nil end

-- ----- records ---------------------------------------------------------

-- The same player: equal names, or one side only a first name (a client that gives "Kev" where the duel line says
-- "Kev Caron"). Two full names with different surnames are two players.
local function same(a, b)
  if not (a and b) then return false end
  a, b = a:lower(), b:lower()
  if a == b then return true end
  local aBare, bBare = not a:find(" ", 1, true), not b:find(" ", 1, true)
  if aBare == bBare then return false end
  return aBare and a == b:match("^(%S+)") or bBare and b == a:match("^(%S+)") or false
end
local function prune(d)
  local list = {}
  for id, r in pairs(d.results) do list[#list + 1] = { id = id, at = type(r) == "table" and r.at or 0 } end
  if #list <= KEEP then return end
  table.sort(list, function(x, y) return x.at < y.at end)
  for i = 1, #list - KEEP do d.results[list[i].id] = nil end
end

-- Stores one duel unless the same pair already has one within DEDUPE seconds. Returns true when it is new.
function duels.record(winner, loser, at, reason)
  local d = store()
  if not d or not winner or not loser or same(winner, loser) then return false end
  at = math.floor(tonumber(at) or 0)
  if at <= 0 or at > epoch() + 300 or at < epoch() - MAX_AGE then return false end
  for _, r in pairs(d.results) do
    if type(r) == "table" and same(r.winner, winner) and same(r.loser, loser) and math.abs((r.at or 0) - at) <= DEDUPE then return false end
  end
  d.results[winner .. "|" .. loser .. "|" .. at] = { winner = winner, loser = loser, at = at, reason = reason == "retreat" and "retreat" or "knockout" }
  prune(d)
  if ns.syncNow and ns.syncNow.mark then pcall(ns.syncNow.mark) end
  if ns.onDuelsChange then pcall(ns.onDuelsChange) end
  return true
end

local function counted()
  local d = store()
  local list = {}
  for _, r in pairs(d and d.results or {}) do if type(r) == "table" and r.winner and r.loser and r.at then list[#list + 1] = r end end
  table.sort(list, function(x, y) return x.at < y.at end)
  -- Daily allowance per pair, oldest first.
  local perPair, kept = {}, {}
  for _, r in ipairs(list) do
    local a, b = r.winner:lower(), r.loser:lower()
    local key = (a < b and a .. ":" .. b or b .. ":" .. a) .. ":" .. math.floor(r.at / DAY)
    perPair[key] = (perPair[key] or 0) + 1
    if perPair[key] <= PAIR_DAILY then kept[#kept + 1] = r end
  end
  return kept
end

-- Wins, losses, win rate and current/best streak per player, best first (the same order as the Discord board).
function duels.standings()
  local by, rows = {}, {}
  local function entry(name)
    local key = name:lower()
    if not by[key] then by[key] = { name = name, wins = 0, losses = 0, games = 0, run = 0, best = 0 }; rows[#rows + 1] = by[key] end
    by[key].name = name
    return by[key]
  end
  for _, r in ipairs(counted()) do
    local w, l = entry(r.winner), entry(r.loser)
    w.wins = w.wins + 1; w.games = w.games + 1; w.run = w.run > 0 and w.run + 1 or 1; if w.run > w.best then w.best = w.run end
    l.losses = l.losses + 1; l.games = l.games + 1; l.run = l.run < 0 and l.run - 1 or -1
  end
  for _, row in ipairs(rows) do row.rate = row.games > 0 and row.wins / row.games or 0; row.streak = row.run end
  table.sort(rows, function(x, y)
    if x.wins ~= y.wins then return x.wins > y.wins end
    if x.rate ~= y.rate then return x.rate > y.rate end
    if x.losses ~= y.losses then return x.losses < y.losses end
    return x.name < y.name
  end)
  return rows
end
function duels.myWins()
  local mine, wins = me(), 0
  if not mine then return 0 end
  for _, r in ipairs(counted()) do if same(r.winner, mine) then wins = wins + 1 end end
  return wins
end
local function streakText(streak) return streak > 1 and ("W" .. streak) or streak < -1 and ("L" .. -streak) or "-" end

-- ----- events ----------------------------------------------------------

local function share(winner, loser, at, reason)
  if IsInGuild and IsInGuild() then ns.comm.send(PREFIX, string.format("D|%s|%s|%d|%s", winner, loser, at, reason), "GUILD") end
end

function duels.onSystem(text)
  local winner, loser, reason = duels.parse(text)
  if not winner then return false end
  -- Both players must be in the guild (a duel with an outsider never counts).
  if not (guildMember(winner) and guildMember(loser)) then return false end
  local at = epoch()
  local isNew = duels.record(winner, loser, at, reason)
  local mine = me()
  if isNew and mine and (same(mine, winner) or same(mine, loser)) then share(winner, loser, at, reason) end
  if isNew and mine and same(mine, winner) and ns.milestones then pcall(ns.milestones.checkDuelWins, duels.myWins()) end
  return isNew
end

-- "D|winner|loser|time|reason" from a guildmate. Believed only from one of the two players.
function duels.onAddonMessage(text, sender)
  if type(text) ~= "string" then return false end
  local winner, loser, at, reason = text:match("^D|([^|]+)|([^|]+)|(%d+)|(%a+)$")
  if not winner then return false end
  winner, loser, at = bare(winner), bare(loser), tonumber(at)
  local from = bare(sender)
  if not winner or not loser or not from or not at then return false end
  if not (same(from, winner) or same(from, loser)) then return false end
  if reason ~= "knockout" and reason ~= "retreat" then return false end
  if not (guildMember(winner) and guildMember(loser)) then return false end
  local isNew = duels.record(winner, loser, at, reason)
  local mine = me()
  if isNew and mine and same(mine, winner) and ns.milestones then pcall(ns.milestones.checkDuelWins, duels.myWins()) end
  return isNew
end

-- ----- chat command and page -------------------------------------------

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["duels"] = function(args)
  args = type(args) == "table" and args or {}
  local rows = duels.standings()
  if string.lower(args[1] or "") == "me" then
    local mine = me()
    for _, row in ipairs(rows) do
      if same(row.name, mine) then
        ns.message(string.format(L("Duels: %d wins, %d losses (%d%%), streak %s."), row.wins, row.losses, math.floor(row.rate * 100 + 0.5), streakText(row.streak)))
        return
      end
    end
    ns.message(L("No duel recorded for you yet."))
    return
  end
  if #rows == 0 then ns.message(L("No guild duel recorded yet. Duel a guildmate!")); return end
  ns.message(L("Guild duel leaderboard:"))
  for i = 1, math.min(10, #rows) do
    local row = rows[i]
    ns.message(string.format("%d. %s - %dW %dL (%d%%) %s", i, row.name, row.wins, row.losses, math.floor(row.rate * 100 + 0.5), streakText(row.streak)))
  end
end
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded duels [me] - guild duel leaderboard (wins, losses, win rate, streak)")

local ROWS = 14
-- The Duels page of the tools window (Minimap.lua passes its widget helpers).
function duels.buildPage(page, ui)
  local newLabel, at = ui.newLabel, ui.at
  local function width(label) if ui.width and label.SetWidth then label:SetWidth(ui.width) end return label end
  at(newLabel(page, "Guild duels: only duels between guildmates count, at most 5 per pair of players per day.", "GameFontHighlightSmall"), page, 0, 0)
  local head = at(newLabel(page, "", "GameFontNormal"), page, 0, -34)
  local labels = {}
  for i = 1, ROWS do labels[i] = width(at(newLabel(page, "", "GameFontHighlight"), page, 0, -54 - (i - 1) * 20)) end
  local empty = at(newLabel(page, "", "GameFontDisableSmall"), page, 0, -54)
  local function refresh()
    local rows = duels.standings()
    head:SetText(#rows > 0 and ("#   " .. L("Player") .. " / " .. L("Wins") .. " - " .. L("Losses") .. " (" .. L("Win rate") .. ") " .. L("Streak")) or "")
    for i = 1, ROWS do
      local row = rows[i]
      labels[i]:SetText(row and string.format("%d.  %s   %dW  %dL  (%d%%)   %s", i, row.name, row.wins, row.losses, math.floor(row.rate * 100 + 0.5), streakText(row.streak)) or "")
    end
    empty:SetText(#rows == 0 and L("No guild duel recorded yet. Duel a guildmate!") or "")
  end
  page:SetScript("OnShow", refresh)
  ns.onDuelsChange = function() if page.IsShown and page:IsShown() then refresh() end end
  refresh()
end

local frame = CreateFrame("Frame")
for _, event in ipairs({ "PLAYER_LOGIN", "CHAT_MSG_SYSTEM", "CHAT_MSG_ADDON" }) do pcall(frame.RegisterEvent, frame, event) end
frame:SetScript("OnEvent", function(_, event, a, b, c, d)
  local ok, err = pcall(function()
    if not active() then return end
    if event == "PLAYER_LOGIN" then ns.comm.register(PREFIX)
    elseif event == "CHAT_MSG_SYSTEM" then duels.onSystem(a)
    elseif event == "CHAT_MSG_ADDON" and ns.comm.accept(a, b, c, d, PREFIX, function(sender) return guildMember(sender) end) and c == "GUILD" then
      duels.onAddonMessage(b, d)
    end
  end)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "duels: " .. tostring(err)) end
end)
