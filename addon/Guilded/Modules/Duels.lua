-- Guild duel leaderboard (8.4.5) and the end-of-duel card (9.2.x): who beat whom between guildmates, with wins,
-- losses, win rate, streak and points, and a small card after each of MY duels.
--
-- A duel is recorded from the game's own system line ("X has defeated Y in a duel", or the retreat line), read
-- from the client's global strings so every language works, and only when BOTH players are in the guild.
-- A participant shares the result with the guild (addon channel, not chat); every client keeps one copy per
-- duel: the same pair within DEDUPE seconds is the same duel, whoever reports it. A shared result counts only
-- if the sender is the winner or the loser. The paired companion uploads the results to the Discord /bg duels board and the site.
--
-- What the client really tells us about a duel (no protected call anywhere):
--   * the winner and the loser, and whether the loser fled (the system line);
--   * both players' level and class, from the guild roster (both are guild members by rule);
--   * the duration (my own clock: the countdown ends -> the result line) and the zone, only on MY side;
--   * my own health left at the end (a plain read at the result line), and the opponent's when it is my target.
-- Not available: damage, healing or crowd control (that needs the combat log, which WoW Forever restricts: no addon
-- file may register it, see scripts/validate-combat-log.mjs), the opponent's own numbers, and starting a rematch
-- (a protected action, so the card only says it in words).
--
--   /guilded duels            the top of the board in chat
--   /guilded duels me         my record
--   /guilded duels card on|off|test   the end-of-duel card (on by default)
local addonName, ns = ...
local duels = {}
ns.duels = duels

local PREFIX = "GuildedDuel"
local DEDUPE = 120
local KEEP = 500
local MAX_AGE = 30 * 86400
local DAY = 86400
local WEEK = 7 * DAY
-- The rating (docs/DUEL_RATING_ADDON_SPEC.md, the same rules as src/services/duel-rating.ts; tests/fixtures/duel-rating-vectors.json
-- holds shared cases). Ladders start on 13 November 2026 00:00 UTC; the first season runs to 1 January 2027 00:00 UTC, then months.
local RATING_START_AT = 1794528000
local FIRST_SEASON_END = 1798761600
local RESET_ANCHOR = 486000 -- a Tuesday 15:00 UTC: the weekly reset the pair weights count within
local RATING = { start = 1000, handicapPerLevel = 20, handicapMaxLevels = 5, maxLevelGap = 10, shrinkGames = 10 }
local ZERO_LINK = "0000000000000000"
local CARD_SECONDS = 15
local SESSION_MAX = 1800

local function L(text) return ns.L and ns.L(text) or text end
local function active() return not ns.moduleActive or ns.moduleActive("duels") end
local function epoch() local ok, v = pcall(GetServerTime); return ok and tonumber(v) or time() end
local function clock() local ok, v = pcall(GetTime); return ok and tonumber(v) or 0 end
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
local function settings() return ns.getSettings and ns.getSettings() or nil end
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
local function inCombat()
  return (InCombatLockdown and InCombatLockdown()) or (UnitAffectingCombat and UnitAffectingCombat("player")) or false
end
local function displayName(name) return ns.displayName and ns.displayName(name) or name end

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

-- ----- level and class from the guild roster ----------------------------

local rosterMap, rosterAt
local function rosterInfo(name)
  if type(name) ~= "string" then return nil end
  local t = clock()
  if not rosterMap or t - (rosterAt or 0) > 20 or t < (rosterAt or 0) then
    rosterMap, rosterAt = {}, t
    if type(GetNumGuildMembers) == "function" and type(GetGuildRosterInfo) == "function" then
      local okCount, count = pcall(GetNumGuildMembers)
      for i = 1, math.min(okCount and tonumber(count) or 0, 1000) do
        local ok, raw, _, _, level, _, _, _, _, _, _, classFile = pcall(GetGuildRosterInfo, i)
        local full = ok and bare(raw)
        if full then
          local entry = { level = tonumber(level), class = type(classFile) == "string" and classFile:match("^%u+$") or nil }
          rosterMap[full:lower()] = entry
          local first = full:match("^(%S+)")
          if first and not rosterMap[first:lower()] then rosterMap[first:lower()] = entry end
        end
      end
    end
  end
  local found = rosterMap[name:lower()] or rosterMap[(name:match("^(%S+)") or name):lower()]
  -- An empty roster (just after login) is not remembered: the next duel asks the game again.
  if next(rosterMap) == nil then rosterMap = nil end
  return found
end
function duels.rosterRefresh() rosterMap = nil end

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
duels.same = same
local function prune(d)
  local list = {}
  for id, r in pairs(d.results) do list[#list + 1] = { id = id, at = type(r) == "table" and r.at or 0 } end
  if #list <= KEEP then return end
  table.sort(list, function(x, y) return x.at < y.at end)
  for i = 1, #list - KEEP do d.results[list[i].id] = nil end
end

local function round(value) return math.floor(value + 0.5) end
duels.round = round
-- "+12", "-12" or "0".
function duels.changeText(change)
  local r = round(tonumber(change) or 0)
  if r > 0 then return "+" .. r elseif r < 0 then return tostring(r) end
  return "0"
end

local function ratingStart()
  local d = store()
  local v = d and tonumber(d.ratingStartsAt)
  return v and v > 0 and v or RATING_START_AT
end
duels.ratingStart = ratingStart

-- Days since 1970-01-01 to year and month (UTC), and a month's first second.
local function civil(days)
  local z = days + 719468
  local era = math.floor(z / 146097)
  local doe = z - era * 146097
  local yoe = math.floor((doe - math.floor(doe / 1460) + math.floor(doe / 36524) - math.floor(doe / 146096)) / 365)
  local y = yoe + era * 400
  local doy = doe - (365 * yoe + math.floor(yoe / 4) - math.floor(yoe / 100))
  local mp = math.floor((5 * doy + 2) / 153)
  local m = mp < 10 and mp + 3 or mp - 9
  if m <= 2 then y = y + 1 end
  return y, m
end
local function monthStart(y, m)
  if m <= 2 then y = y - 1 end
  local era = math.floor(y / 400)
  local yoe = y - era * 400
  local mp = m > 2 and m - 3 or m + 9
  local doy = math.floor((153 * mp + 2) / 5)
  local doe = yoe * 365 + math.floor(yoe / 4) - math.floor(yoe / 100) + doy
  return (era * 146097 + doe - 719468) * DAY
end
-- The season a time falls in: id "YYYY-MM", first and (exclusive) last second; nil before the ladders start.
function duels.seasonOf(at, startsAt)
  startsAt = startsAt or ratingStart()
  at = tonumber(at)
  if not at or at < startsAt then return nil end
  if startsAt < FIRST_SEASON_END and at < FIRST_SEASON_END then
    local y, m = civil(math.floor(startsAt / DAY))
    return string.format("%04d-%02d", y, m), startsAt, FIRST_SEASON_END
  end
  local y, m = civil(math.floor(at / DAY))
  local from = monthStart(y, m)
  local ny, nm = y, m + 1
  if nm > 12 then ny, nm = y + 1, 1 end
  return string.format("%04d-%02d", y, m), from < startsAt and startsAt or from, monthStart(ny, nm)
end
function duels.currentSeason() return (duels.seasonOf(epoch())) end
-- Season ids from the current one back to the first, newest first.
function duels.seasons()
  local out, startsAt, at = {}, ratingStart(), epoch()
  for _ = 1, 60 do
    local id, from = duels.seasonOf(at, startsAt)
    if not id then break end
    out[#out + 1] = id
    at = from - 1
  end
  return out
end

local function kFor(rated) if rated < 10 then return 40 elseif rated < 30 then return 24 end return 16 end
local function weekStartOf(at) return RESET_ANCHOR + math.floor((at - RESET_ANCHOR) / WEEK) * WEEK end
local function clampLevels(v) return math.max(-RATING.handicapMaxLevels, math.min(RATING.handicapMaxLevels, v)) end

-- The repeat-duel fractions are the server's (the bot hands them over; nothing is published here): the n-th duel of a pair in a weekly
-- window uses entry n and later ones count for nothing. Without a table every duel counts in full.
function duels.setPairWeights(weights)
  local d = store()
  if not d then return false end
  if weights == nil then d.pairWeights = nil; return true end
  if type(weights) ~= "table" or #weights == 0 or #weights > 50 then return false end
  local clean = {}
  for i, v in ipairs(weights) do
    if type(v) ~= "number" or v < 0 or v > 1 then return false end
    clean[i] = v
  end
  d.pairWeights = clean
  return true
end
local function storedWeights()
  local d = store()
  return d and type(d.pairWeights) == "table" and #d.pairWeights > 0 and d.pairWeights or nil
end

-- Rates ONE season's counted duels, each { winner, loser, wlv, llv, at }. Pure: the arrival order does not matter (end time, then
-- lower-cased winner, then loser). Returns players by lower-cased name and `changes` (parallel to `ordered`) with each side's shown
-- score before and after; a duel that moved nothing has rated = false.
function duels.rate(list, weights)
  weights = weights or storedWeights()
  local ordered = {}
  for i, r in ipairs(list or {}) do ordered[i] = r end
  table.sort(ordered, function(x, y)
    if x.at ~= y.at then return x.at < y.at end
    local xw, yw = x.winner:lower(), y.winner:lower()
    if xw ~= yw then return xw < yw end
    return x.loser:lower() < y.loser:lower()
  end)
  local players, changes, pairs_ = {}, {}, {}
  local function entry(name, level, at)
    local key = name:lower()
    local row = players[key]
    if not row then
      row = { name = name, rating = RATING.start, score = RATING.start, games = 0, rated = 0, wins = 0, losses = 0, run = 0, best = 0, seen = {}, opponents = 0, lastAt = at }
      players[key] = row
    end
    row.name, row.lastAt = name, at
    if tonumber(level) and level > 0 then row.level = level end
    return row
  end
  for _, r in ipairs(ordered) do
    local w, l = entry(r.winner, r.wlv, r.at), entry(r.loser, r.llv, r.at)
    w.games = w.games + 1; l.games = l.games + 1; w.wins = w.wins + 1; l.losses = l.losses + 1
    w.run = w.run > 0 and w.run + 1 or 1; if w.run > w.best then w.best = w.run end
    l.run = l.run < 0 and l.run - 1 or -1
    local a, b = r.winner:lower(), r.loser:lower()
    local pair = (a < b and a .. "|" .. b or b .. "|" .. a) .. "|" .. weekStartOf(r.at)
    local nth = pairs_[pair] or 0
    pairs_[pair] = nth + 1
    local wl, ll = tonumber(r.wlv) or 0, tonumber(r.llv) or 0
    local tooFar = wl > 0 and ll > 0 and math.abs(wl - ll) > RATING.maxLevelGap
    local weight = tooFar and 0 or (weights and (weights[nth + 1] or 0) or 1)
    local change = { src = r, winner = r.winner, loser = r.loser, rated = false, winnerDelta = 0, loserDelta = 0, winnerScore = w.score, loserScore = l.score }
    if weight > 0 then
      local beforeW, beforeL = w.score, l.score
      local handicap = (wl > 0 and ll > 0) and RATING.handicapPerLevel * clampLevels(ll - wl) or 0
      local expected = 1 / (1 + 10 ^ ((l.rating + handicap - w.rating) / 400))
      local gain = 1 - expected
      local kw, kl = kFor(w.rated), kFor(l.rated)
      w.rating = w.rating + kw * weight * gain
      l.rating = l.rating - kl * weight * gain
      w.rated = w.rated + 1; l.rated = l.rated + 1
      if not w.seen[b] then w.seen[b] = true; w.opponents = w.opponents + 1 end
      if not l.seen[a] then l.seen[a] = true; l.opponents = l.opponents + 1 end
      w.score = RATING.start + (w.rating - RATING.start) * w.rated / (w.rated + RATING.shrinkGames)
      l.score = RATING.start + (l.rating - RATING.start) * l.rated / (l.rated + RATING.shrinkGames)
      change.rated, change.winnerDelta, change.loserDelta = true, w.score - beforeW, l.score - beforeL
      change.winnerScore, change.loserScore = w.score, l.score
    end
    changes[#changes + 1] = change
  end
  for _, row in pairs(players) do row.streak = row.run; row.ranked = row.games >= 1 end
  return { players = players, ordered = ordered, changes = changes }
end

local SHA_K = {
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
}
local SHA_H = { 0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19 }

-- The first 16 hex characters of SHA-256 of a text (the hash chain of docs/DUEL_RATING_ADDON_SPEC.md); nil when the client has no bit library.
function duels.sha16(msg)
  if type(bit) ~= "table" then return nil end
  local band, bor, bxor, bnot, lshift, rshift = bit.band, bit.bor, bit.bxor, bit.bnot, bit.lshift, bit.rshift
  if not (band and bor and bxor and bnot and lshift and rshift) then return nil end
  local function rrot(x, n) return bor(rshift(x, n), lshift(x, 32 - n)) end
  local function add(...)
    local total = 0
    for i = 1, select("#", ...) do total = total + select(i, ...) end
    return band(total, 0xffffffff)
  end
  msg = tostring(msg)
  local length = #msg
  local bytes = { msg:byte(1, -1) }
  if length == 0 then bytes = {} end
  bytes[#bytes + 1] = 0x80
  while #bytes % 64 ~= 56 do bytes[#bytes + 1] = 0 end
  local bits = length * 8
  for shift = 7, 0, -1 do
    bytes[#bytes + 1] = shift >= 4 and 0 or (math.floor(bits / (256 ^ shift)) % 256)
  end
  local hh = { SHA_H[1], SHA_H[2], SHA_H[3], SHA_H[4], SHA_H[5], SHA_H[6], SHA_H[7], SHA_H[8] }
  for chunk = 0, #bytes / 64 - 1 do
    local w = {}
    for i = 1, 16 do
      local at = chunk * 64 + (i - 1) * 4
      w[i] = bor(bor(lshift(bytes[at + 1], 24), lshift(bytes[at + 2], 16)), bor(lshift(bytes[at + 3], 8), bytes[at + 4]))
    end
    for i = 17, 64 do
      local s0 = bxor(bxor(rrot(w[i - 15], 7), rrot(w[i - 15], 18)), rshift(w[i - 15], 3))
      local s1 = bxor(bxor(rrot(w[i - 2], 17), rrot(w[i - 2], 19)), rshift(w[i - 2], 10))
      w[i] = add(w[i - 16], s0, w[i - 7], s1)
    end
    local a, b, c, d, e, f, g, h = hh[1], hh[2], hh[3], hh[4], hh[5], hh[6], hh[7], hh[8]
    for i = 1, 64 do
      local big1 = bxor(bxor(rrot(e, 6), rrot(e, 11)), rrot(e, 25))
      local ch = bxor(band(e, f), band(bnot(e), g))
      local t1 = add(h, big1, ch, SHA_K[i], w[i])
      local big0 = bxor(bxor(rrot(a, 2), rrot(a, 13)), rrot(a, 22))
      local maj = bxor(bxor(band(a, b), band(a, c)), band(b, c))
      local t2 = add(big0, maj)
      h, g, f, e, d, c, b, a = g, f, e, add(d, t1), c, b, a, add(t1, t2)
    end
    hh[1], hh[2], hh[3], hh[4] = add(hh[1], a), add(hh[2], b), add(hh[3], c), add(hh[4], d)
    hh[5], hh[6], hh[7], hh[8] = add(hh[5], e), add(hh[6], f), add(hh[7], g), add(hh[8], h)
  end
  local digits, out = "0123456789abcdef", {}
  for word = 1, 2 do
    for nibble = 7, 0, -1 do
      local v = band(rshift(hh[word], nibble * 4), 15)
      out[#out + 1] = digits:sub(v + 1, v + 1)
    end
  end
  return table.concat(out)
end

-- My own level and class when the roster does not say (the roster may not be loaded yet).
local function selfInfo()
  local level, class
  if UnitLevel then local ok, v = pcall(UnitLevel, "player"); if ok and tonumber(v) then level = tonumber(v) end end
  if UnitClass then local ok, _, file = pcall(UnitClass, "player"); if ok and type(file) == "string" then class = file end end
  return { level = level, class = class }
end
local function infoFor(name)
  local info = rosterInfo(name)
  local mine = me()
  if (not info or not info.level or not info.class) and mine and same(mine, name) then
    local own = selfInfo()
    info = { level = info and info.level or own.level, class = info and info.class or own.class }
  end
  return info or {}
end


-- ----- duels against players outside the guild: recorded for upload, never on the guild ladder ----------------------------------

local EXTERNAL_KEEP = 200
local function realmName()
  local ok, value = pcall(function() return (GetNormalizedRealmName and GetNormalizedRealmName()) or (GetRealmName and GetRealmName()) end)
  return ok and type(value) == "string" and #value <= 60 and not value:find("[|%c]") and value or ""
end
local function ownGuild()
  if not GetGuildInfo then return nil end
  local ok, name = pcall(GetGuildInfo, "player")
  if ok and type(name) == "string" and name ~= "" and #name <= 80 and not (ns.isSecret and ns.isSecret(name)) and not name:find("[|%c]") then return name end
  return nil
end
local function englishClass(file)
  if type(file) ~= "string" or not file:match("^%u+$") then return nil end
  return file:sub(1, 1) .. file:sub(2):lower()
end
local function levelOf(value)
  value = tonumber(value)
  return value and value >= 1 and value <= 60 and math.floor(value) or nil
end
-- The newest challenge handed to this install (whatever delivers it calls this): every record made afterwards carries it.
function duels.setChallenge(nonce)
  local d = store()
  if not d then return false end
  if type(nonce) == "string" and #nonce >= 8 and #nonce <= 64 and nonce:match("^%x+$") then d.challenge = nonce:lower(); return true end
  return false
end

-- One of MY duels with a player outside the guild, kept for the upload (`externalDuels`). `ext` carries what only this client saw:
-- the opponent's class, level and guild text from my target, the duration and zone, and the times of the countdown and the start.
-- Returns true when a record was added.
function duels.recordExternal(winner, loser, at, reason, ext)
  local d = store()
  local mine = me()
  if not d or not mine then return false end
  ext = type(ext) == "table" and ext or {}
  winner, loser = bare(winner), bare(loser)
  at = math.floor(tonumber(at) or 0)
  if not winner or not loser or same(winner, loser) or at < ratingStart() or at > epoch() + 300 then return false end
  local iWon = same(mine, winner)
  if not (iWon or same(mine, loser)) then return false end
  local list = d.external
  if type(list) ~= "table" then list = {}; d.external = list end
  for _, r in pairs(list) do
    if type(r) == "table" and same(r.winner, winner) and same(r.loser, loser) and math.abs((r.at or 0) - at) <= DEDUPE then return false end
  end
  local realm, mineInfo, oppInfo = realmName(), selfInfo(), type(ext.oppInfo) == "table" and ext.oppInfo or {}
  local row = { winner = winner, loser = loser, winnerRealm = realm, loserRealm = realm, at = at, reason = reason == "retreat" and "retreat" or "knockout",
    side = iWon and "winner" or "loser" }
  local mineClass, oppClass = englishClass(mineInfo.class), englishClass(oppInfo.class)
  local mineLevel, oppLevel = levelOf(mineInfo.level), levelOf(oppInfo.level)
  local mineGuild, oppGuild = ownGuild(), type(oppInfo.guild) == "string" and oppInfo.guild ~= "" and #oppInfo.guild <= 80 and not oppInfo.guild:find("[|%c]") and oppInfo.guild or nil
  if iWon then
    row.winnerClass, row.loserClass, row.winnerLevel, row.loserLevel, row.winnerGuild, row.loserGuild = mineClass, oppClass, mineLevel, oppLevel, mineGuild, oppGuild
  else
    row.winnerClass, row.loserClass, row.winnerLevel, row.loserLevel, row.winnerGuild, row.loserGuild = oppClass, mineClass, oppLevel, mineLevel, oppGuild, mineGuild
  end
  if type(ext.zone) == "string" and ext.zone ~= "" and #ext.zone <= 80 then row.zone = ext.zone end
  local duration = tonumber(ext.duration)
  if duration and duration >= 3 and duration <= SESSION_MAX then row.durationSec = math.floor(duration) end
  row.evidence = { endAt = at, countdownAt = tonumber(ext.countdownAt) and math.floor(ext.countdownAt) or nil,
    startAt = tonumber(ext.startAt) and math.floor(ext.startAt) or nil, zoneWinner = row.zone, zoneLoser = row.zone }
  -- The running number and the hash chain tie the record to the challenge it was made under and to the record before it.
  d.extSeq = (tonumber(d.extSeq) or 0) + 1
  row.seq = d.extSeq
  local nonce = type(d.challenge) == "string" and #d.challenge >= 8 and #d.challenge <= 64 and d.challenge:match("^%x+$") and d.challenge or nil
  if nonce then
    row.nonce = nonce
    local prev = type(d.extChain) == "string" and #d.extChain == 16 and d.extChain:match("^%x+$") and d.extChain or ZERO_LINK
    local chain = duels.sha16(table.concat({ prev, nonce, row.seq, winner, row.winnerRealm, loser, row.loserRealm, at, row.reason }, "|"))
    if chain then row.prev, row.chain = prev, chain; d.extChain = chain end
  end
  list[winner .. "|" .. loser .. "|" .. at] = row
  local keep = {}
  for key, r in pairs(list) do keep[#keep + 1] = { key = key, at = type(r) == "table" and r.at or 0 } end
  if #keep > EXTERNAL_KEEP then
    table.sort(keep, function(x, y) return x.at < y.at end)
    for i = 1, #keep - EXTERNAL_KEEP do list[keep[i].key] = nil end
  end
  if ns.syncNow and ns.syncNow.mark then pcall(ns.syncNow.mark) end
  return true
end

-- The stored duel of this pair within DEDUPE seconds of `at`, if any.
local function findRecent(winner, loser, at)
  local d = store()
  for _, r in pairs(d and d.results or {}) do
    if type(r) == "table" and same(r.winner, winner) and same(r.loser, loser) and math.abs((r.at or 0) - at) <= DEDUPE then return r end
  end
end

-- Stores one duel unless the same pair already has one within DEDUPE seconds. Returns true when it is new (and
-- the stored key). `extra` may carry dur (seconds) and zone from MY side of the duel.
function duels.record(winner, loser, at, reason, extra)
  local d = store()
  if not d or not winner or not loser or same(winner, loser) then return false end
  at = math.floor(tonumber(at) or 0)
  if at <= 0 or at > epoch() + 300 or at < epoch() - MAX_AGE then return false end
  for _, r in pairs(d.results) do
    if type(r) == "table" and same(r.winner, winner) and same(r.loser, loser) and math.abs((r.at or 0) - at) <= DEDUPE then return false end
  end
  local key = winner .. "|" .. loser .. "|" .. at
  local row = { winner = winner, loser = loser, at = at, reason = reason == "retreat" and "retreat" or "knockout" }
  -- Level and class of both at the time: they decide the points and colour the board.
  local w, l = infoFor(winner), infoFor(loser)
  row.wlv, row.llv, row.wcl, row.lcl = w.level, l.level, w.class, l.class
  if type(extra) == "table" then
    if tonumber(extra.dur) and extra.dur >= 0 and extra.dur < SESSION_MAX then row.dur = math.floor(extra.dur) end
    if type(extra.zone) == "string" and extra.zone ~= "" and #extra.zone <= 80 then row.zone = extra.zone end
  end
  d.results[key] = row
  prune(d)
  if ns.syncNow and ns.syncNow.mark then pcall(ns.syncNow.mark) end
  if ns.onDuelsChange then pcall(ns.onDuelsChange) end
  return true, key
end

-- The duels that count, oldest first: those since the ladders started.
local function counted()
  local d = store()
  local startsAt = ratingStart()
  local list = {}
  for _, r in pairs(d and d.results or {}) do
    if type(r) == "table" and r.winner and r.loser and r.at and r.at >= startsAt then list[#list + 1] = r end
  end
  table.sort(list, function(x, y) return x.at < y.at end)
  return list
end
local function isCounted(row)
  for _, r in ipairs(counted()) do if r == row then return true end end
  return false
end

-- What one stored duel did to the two shown scores (nil when it does not count): the season is re-rated from its counted duels,
-- never patched, so a duel that arrived late is placed where it belongs.
function duels.changeFor(row)
  if type(row) ~= "table" or not row.at then return nil end
  local id = duels.seasonOf(row.at)
  if not id then return nil end
  local list = {}
  for _, r in ipairs(counted()) do if duels.seasonOf(r.at) == id then list[#list + 1] = r end end
  for _, change in ipairs(duels.rate(list).changes) do if change.src == row then return change end end
  return nil
end

-- Wins, losses, win rate, streaks, rating and last duel per player, best first (shown score, then wins). opts: season (an id; default
-- the current one), before (epoch seconds: only duels up to then), class (a class file: only those players, ranked among themselves).
-- Everyone with a counted duel is ranked; each row carries its rank.
function duels.standings(opts)
  opts = opts or {}
  local season = opts.season or duels.currentSeason()
  local list = {}
  if season then
    for _, r in ipairs(counted()) do
      if duels.seasonOf(r.at) == season and (not opts.before or r.at <= opts.before) then list[#list + 1] = r end
    end
  end
  local result = duels.rate(list)
  for _, r in ipairs(result.ordered) do
    local w, l = result.players[r.winner:lower()], result.players[r.loser:lower()]
    if r.wcl then w.class = r.wcl end
    if r.lcl then l.class = r.lcl end
  end
  local rows = {}
  for _, row in pairs(result.players) do
    row.rate = row.games > 0 and row.wins / row.games or 0
    rows[#rows + 1] = row
  end
  table.sort(rows, function(x, y)
    if x.score ~= y.score then return x.score > y.score end
    if x.wins ~= y.wins then return x.wins > y.wins end
    return x.name:lower() < y.name:lower()
  end)
  for i, row in ipairs(rows) do row.rank = i end
  if opts.class then
    local kept = {}
    for _, row in ipairs(rows) do
      local info = rosterInfo(row.name)
      if (info and info.class or row.class) == opts.class then kept[#kept + 1] = row; row.rank = #kept end
    end
    rows = kept
  end
  return rows
end
function duels.rowFor(rows, name)
  for _, row in ipairs(rows or {}) do if same(row.name, name) then return row end end
end
function duels.myWins()
  local mine, wins = me(), 0
  if not mine then return 0 end
  for _, r in ipairs(counted()) do if same(r.winner, mine) then wins = wins + 1 end end
  return wins
end

-- My record against one player: wins, losses, the last duel (time and whether I won).
function duels.headToHead(a, b, opts)
  opts = opts or {}
  local out = { wins = 0, losses = 0, lastAt = nil, lastWon = nil }
  for _, r in ipairs(counted()) do
    if not opts.season or duels.seasonOf(r.at) == opts.season then
      if same(r.winner, a) and same(r.loser, b) then out.wins = out.wins + 1; out.lastAt, out.lastWon = r.at, true
      elseif same(r.winner, b) and same(r.loser, a) then out.losses = out.losses + 1; out.lastAt, out.lastWon = r.at, false end
    end
  end
  return out
end

local function streakText(streak) return streak > 1 and ("W" .. streak) or streak < -1 and ("L" .. -streak) or "-" end
local function percent(rate) return math.floor(rate * 100 + 0.5) end
local function clockText(seconds)
  seconds = math.max(0, math.floor(seconds or 0))
  return string.format("%d:%02d", math.floor(seconds / 60), seconds % 60)
end
local function agoText(at)
  if not at or at <= 0 then return "-" end
  local diff = math.max(0, epoch() - at)
  if diff < 60 then return L("just now") end
  if diff < 3600 then return string.format(L("%d min ago"), math.floor(diff / 60)) end
  if diff < DAY then return string.format(L("%d h ago"), math.floor(diff / 3600)) end
  return string.format(L("%d d ago"), math.floor(diff / DAY))
end
local function classHex(classFile)
  local c = RAID_CLASS_COLORS and classFile and RAID_CLASS_COLORS[classFile]
  if c and c.r then return string.format("|cff%02x%02x%02x", math.floor(c.r * 255 + 0.5), math.floor(c.g * 255 + 0.5), math.floor(c.b * 255 + 0.5)) end
  return "|cffffffff"
end
local function className(classFile)
  if not classFile then return nil end
  local names = LOCALIZED_CLASS_NAMES_MALE
  return type(names) == "table" and names[classFile] or classFile:sub(1, 1) .. classFile:sub(2):lower()
end

-- ----- the duel in progress (my own side) --------------------------------

-- DUEL_REQUESTED (someone asked me) gives the opponent; DUEL_COUNTDOWN starts the fight clock. Nothing else is read
-- during the duel: no combat log, no unit scan.
local session

function duels.sessionStop() session = nil end

local targetInfo -- defined below (class and level of my target)
local function startFight(seconds)
  local zone
  if GetZoneText then local ok, v = pcall(GetZoneText); if ok and type(v) == "string" and v ~= "" and not (ns.isSecret and ns.isSecret(v)) then zone = v end end
  local opponent = session and session.opponent
  local wait = tonumber(seconds) or 0
  session = { startedAt = clock() + wait, opponent = opponent, zone = zone, oppInfo = targetInfo(opponent), countdownAt = epoch(), startAt = epoch() + wait }
end

-- Health left, in percent, of a unit; nil when the client does not say.
local function healthPercent(unit)
  if not (UnitHealth and UnitHealthMax) then return nil end
  -- Optional card data: a failure anywhere in the read or the arithmetic gives nil, never an error.
  local ok, value = pcall(function()
    local cur, max = UnitHealth(unit), UnitHealthMax(unit)
    if type(cur) ~= "number" or type(max) ~= "number" or max <= 0 then return nil end
    return math.max(0, math.min(100, math.floor(cur / max * 100 + 0.5)))
  end)
  return ok and value or nil
end
-- Class and level of my target when it is the duel opponent (a non-guildmate has no roster row). Optional card data: pcall.
function targetInfo(opponent)
  if not (UnitExists and UnitName) then return nil end
  local ok, info = pcall(function()
    if not UnitExists("target") then return nil end
    local name = UnitName("target")
    if type(name) ~= "string" or (ns.isSecret and ns.isSecret(name)) then return nil end
    if opponent and not same(name, opponent) then return nil end
    local level = UnitLevel and tonumber(UnitLevel("target"))
    local _, file
    if UnitClass then _, file = UnitClass("target") end
    local guild
    if GetGuildInfo then
      local okGuild, text = pcall(GetGuildInfo, "target")
      if okGuild and type(text) == "string" and text ~= "" and not (ns.isSecret and ns.isSecret(text)) then guild = text end
    end
    return { name = name, level = level and level > 0 and level or nil, class = type(file) == "string" and file:match("^%u+$") or nil, guild = guild }
  end)
  return ok and info or nil
end
-- The opponent's class and level: my target now when it is the opponent, else what the target was when the duel started.
local function opponentInfo(s, oppName)
  local live = targetInfo(oppName)
  if live then return live end
  local early = s and s.oppInfo
  if early and early.name and same(early.name, oppName) then return early end
  return nil
end
-- True while the guild roster has not loaded (right after login): "not in the guild" cannot be said yet.
local function rosterPending()
  if not (IsInGuild and IsInGuild()) then return false end
  if type(GetNumGuildMembers) ~= "function" then return false end
  local ok, count = pcall(GetNumGuildMembers)
  return ok and (tonumber(count) or 0) == 0
end
-- My health left, and the opponent's when my target is the duel opponent.
local function healthLeft(opponent)
  local out = { me = healthPercent("player") }
  if UnitExists and UnitName then
    local ok, there = pcall(UnitExists, "target")
    if ok and there then
      local okName, name = pcall(UnitName, "target")
      if okName and type(name) == "string" and not (ns.isSecret and ns.isSecret(name)) and opponent and same(name, opponent) then out.opponent = healthPercent("target") end
    end
  end
  return out
end

-- ----- the end-of-duel card -----------------------------------------------

function duels.cardEnabled()
  local st = settings()
  return not (st and st.duelCard == false)
end
function duels.setCardEnabled(on)
  local st = settings()
  if not st then return end
  st.duelCard = on and true or false
  if not on then duels.hideCard() end
end

-- What the card says, from what is really known. Pure: the card and the tests read this.
function duels.cardData(winner, loser, at, reason, ctx)
  ctx = ctx or {}
  local mine = ctx.me or me()
  local won = mine and same(mine, winner) or false
  local myName, oppName = won and winner or loser, won and loser or winner
  local myInfo, oppInfo = infoFor(myName), infoFor(oppName)
  if ctx.oppInfo then oppInfo = { level = oppInfo.level or ctx.oppInfo.level, class = oppInfo.class or ctx.oppInfo.class } end
  if ctx.row then
    local mineRow = won and { level = ctx.row.wlv, class = ctx.row.wcl } or { level = ctx.row.llv, class = ctx.row.lcl }
    local oppRow = won and { level = ctx.row.llv, class = ctx.row.lcl } or { level = ctx.row.wlv, class = ctx.row.wcl }
    myInfo = { level = myInfo.level or mineRow.level, class = myInfo.class or mineRow.class }
    oppInfo = { level = oppInfo.level or oppRow.level, class = oppInfo.class or oppRow.class }
  end
  local data = {
    won = won, reason = reason == "retreat" and "retreat" or "knockout", at = at,
    me = myName, opponent = oppName, myClass = myInfo.class, oppClass = oppInfo.class, myLevel = myInfo.level, oppLevel = oppInfo.level,
    duration = ctx.duration, zone = ctx.zone, counted = ctx.counted ~= false, health = ctx.health, recorded = ctx.recorded ~= false,
  }
  if ctx.outsider then
    -- The opponent is not in the guild: the result is shown, never recorded, no points, record or rank.
    data.outsider, data.recorded, data.counted = not ctx.rosterPending, false, false
    data.rosterPending = ctx.rosterPending or nil
    return data
  end
  if ctx.recorded == false then
    -- A rematch within DEDUPE seconds of the last duel of this pair is not added to the board: no points, record or rank.
    data.recorded, data.counted = false, false
    return data
  end
  local rows = duels.standings()
  local row = duels.rowFor(rows, myName)
  if row then
    data.wins, data.losses, data.streak, data.rank, data.best = row.wins, row.losses, row.streak, row.rank, row.best
    data.score = row.score
    data.rate = percent(row.rate)
  end
  -- What this duel did to the two shown scores (the season is re-rated from its duels; a card already shown is never edited).
  local change = ctx.row and duels.changeFor(ctx.row) or nil
  if change then
    data.change = won and change.winnerDelta or change.loserDelta
    data.score = won and change.winnerScore or change.loserScore
    data.oppChange = won and change.loserDelta or change.winnerDelta
    data.oppScore = won and change.loserScore or change.winnerScore
  end
  if ctx.before and row then
    data.rankBefore = ctx.before.rank
    if ctx.before.rank then data.rankChange = ctx.before.rank - row.rank end
    data.newBest = row.best > (ctx.before.best or 0) and row.best >= 2 and won or false
  end
  return data
end

-- The card's lines (already translated, class-coloured), top to bottom.
function duels.cardLines(data)
  local lines = {}
  local function person(name, class, level)
    local text = classHex(class) .. displayName(name) .. "|r"
    local detail = {}
    if class then detail[#detail + 1] = className(class) end
    if level then detail[#detail + 1] = string.format(L("level %d"), level) end
    if #detail > 0 then text = text .. "  |cffb0b8c4" .. table.concat(detail, " ") .. "|r" end
    return text
  end
  lines[#lines + 1] = person(data.me, data.myClass, data.myLevel)
  lines[#lines + 1] = "|cffb0b8c4" .. L("against") .. "|r  " .. person(data.opponent, data.oppClass, data.oppLevel)
  local facts = {}
  if data.duration then facts[#facts + 1] = L("Duration") .. " " .. clockText(data.duration) end
  if data.zone then facts[#facts + 1] = data.zone end
  if data.reason == "retreat" then facts[#facts + 1] = data.won and L("the opponent fled") or L("you fled") end
  if #facts > 0 then lines[#lines + 1] = "|cffffffff" .. table.concat(facts, "  -  ") .. "|r" end
  local h = data.health
  if h and (h.me or h.opponent) then
    local parts = {}
    if h.me then parts[#parts + 1] = string.format(L("your health left %d%%"), h.me) end
    if h.opponent then parts[#parts + 1] = string.format(L("opponent's health left %d%%"), h.opponent) end
    lines[#lines + 1] = "|cffffd36a" .. table.concat(parts, "  -  ") .. "|r"
  end
  if data.rosterPending then
    lines[#lines + 1] = "|cffe0a050" .. L("Not counted yet: the guild roster has not loaded.") .. "|r"
  elseif data.outsider then
    lines[#lines + 1] = "|cffe0a050" .. string.format(L("Not counted on the guild ladder: %s is not in your guild."), displayName(data.opponent)) .. "|r"
  elseif data.recorded == false then
    lines[#lines + 1] = "|cffe0a050" .. L("Not recorded: you duelled this player a moment ago, so this result is not added.") .. "|r"
  elseif not data.counted then
    lines[#lines + 1] = "|cffe0a050" .. L("Not counted on the ladder.") .. "|r"
  elseif data.wins then
    local record = string.format(L("Record %d-%d (%d%%)"), data.wins, data.losses, data.rate)
    if data.streak and math.abs(data.streak) > 1 then record = record .. "  " .. L("Streak") .. " " .. streakText(data.streak) end
    lines[#lines + 1] = record
    local extra = {}
    if data.score then
      local text = L("Rating") .. " "
      if data.change ~= nil then text = text .. duels.changeText(data.change) .. " -> " end
      extra[#extra + 1] = text .. round(data.score)
    end
    if data.rank then
      local rank = "#" .. data.rank
      if data.rankChange and data.rankChange > 0 then rank = rank .. " (+" .. data.rankChange .. ")"
      elseif data.rankChange and data.rankChange < 0 then rank = rank .. " (" .. data.rankChange .. ")" end
      extra[#extra + 1] = L("Rank") .. " " .. rank
    end
    if data.newBest then extra[#extra + 1] = "|cff66e08a" .. L("New best streak!") .. "|r" end
    if #extra > 0 then lines[#lines + 1] = table.concat(extra, "  -  ") end
  end
  lines[#lines + 1] = "|cff8c96a3" .. string.format(L("Rematch? Target %s and choose Duel."), displayName(data.opponent)) .. "|r"
  return lines
end

local card, pendingCard
-- The painting behind the card (Media\\DuelCard.blp, made by scripts/build-duel-texture.mjs). Members who turned "Card art" off
-- (settings.cardArt, the Run tab button) get the plain card.
duels.CARD_ART = "Interface\\AddOns\\" .. tostring(addonName or "Guilded") .. "\\Media\\DuelCard"

local function savePosition(self)
  local st = settings()
  if not (st and self.GetPoint) then return end
  local ok, point, _, relPoint, x, y = pcall(self.GetPoint, self)
  if ok and type(point) == "string" and tonumber(x) and tonumber(y) then st.duelCardPos = { point = point, relPoint = relPoint or point, x = x, y = y } end
end
local function restorePosition(self)
  local st = settings()
  local pos = st and st.duelCardPos
  self:ClearAllPoints()
  if type(pos) == "table" and type(pos.point) == "string" and tonumber(pos.x) and tonumber(pos.y) then
    self:SetPoint(pos.point, UIParent, type(pos.relPoint) == "string" and pos.relPoint or pos.point, pos.x, pos.y)
  else
    self:SetPoint("BOTTOMRIGHT", UIParent, "BOTTOMRIGHT", -24, 330)
  end
end

function duels.hideCard()
  pendingCard = nil
  if card then card:Hide() end
end
local function closeCard() duels.hideCard() end

-- Layout (9.3): one big result word, the two names in class colours, a row of compact stats with small labels at fixed
-- columns, duration and zone in small print, the rematch hint last. A stat the data does not have is not drawn.
local CARD_W, CARD_H, COLUMNS_W = 360, 196, 328
local STAT_MAX = 4

-- A name cut to fit its line (the card never grows or clips): "Averyveryverylongname" -> "Averyveryverylo...".
local function fit(name, max)
  name = tostring(name or "")
  if #name <= max then return name end
  -- Cut on a character boundary: step back over UTF-8 continuation bytes (0x80-0xBF) so an accent is never split.
  local cut = max - 3
  while cut > 0 do
    local byte = name:byte(cut + 1)
    if byte and byte >= 128 and byte < 192 then cut = cut - 1 else break end
  end
  return name:sub(1, cut) .. "..."
end
duels.fitName = fit

local function artOn()
  local st = settings()
  return not (st and st.cardArt == false) and type(duels.CARD_ART) == "string" and duels.CARD_ART ~= ""
end

local function buildCard()
  card = CreateFrame("Frame", "GuildedDuelCard", UIParent, BackdropTemplateMixin and "BackdropTemplate" or nil)
  card:SetSize(CARD_W, CARD_H)
  card:SetClampedToScreen(true)
  card:SetFrameStrata("DIALOG")
  card:SetMovable(true); card:EnableMouse(true); card:RegisterForDrag("LeftButton")
  -- No keyboard: the card never takes keys from the game.
  card:SetScript("OnDragStart", function(self) self:StartMoving() end)
  card:SetScript("OnDragStop", function(self) self:StopMovingOrSizing(); savePosition(self) end)
  card:SetScript("OnMouseUp", function(_, button) if button == "RightButton" then closeCard() end end)
  if card.SetBackdrop then
    card:SetBackdrop({ bgFile = "Interface\\Tooltips\\UI-Tooltip-Background", edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border", edgeSize = 12 })
    card:SetBackdropColor(0.035, 0.045, 0.065, 0.97)
    card:SetBackdropBorderColor(0.72, 0.54, 0.2, 1)
  end
  -- The painting, then a dark scrim over it so the text keeps its contrast (both hidden when the art is off).
  card.art = card:CreateTexture(nil, "BACKGROUND")
  card.art:SetPoint("TOPLEFT", 3, -3); card.art:SetPoint("BOTTOMRIGHT", -3, 3)
  card.art:Hide()
  card.scrim = card:CreateTexture(nil, "BACKGROUND", nil, 1)
  card.scrim:SetPoint("TOPLEFT", 3, -3); card.scrim:SetPoint("BOTTOMRIGHT", -3, 3)
  if card.scrim.SetColorTexture then card.scrim:SetColorTexture(0.02, 0.025, 0.04, 0.42) end
  card.scrim:Hide()
  local function text(font, x, y, width, justify)
    local fs = card:CreateFontString(nil, "OVERLAY", font)
    fs:SetPoint("TOPLEFT", x, y); fs:SetWidth(width or COLUMNS_W); fs:SetJustifyH(justify or "LEFT")
    if fs.SetWordWrap then fs:SetWordWrap(false) end
    return fs
  end
  card.title = text("GameFontNormalHuge", 16, -12, 240)
  card.me = text("GameFontHighlight", 16, -44)
  card.vs = text("GameFontHighlight", 16, -62)
  card.stats = {}
  for i = 1, STAT_MAX do
    card.stats[i] = { label = text("GameFontDisableSmall", 16, -88, 80), value = text("GameFontNormalLarge", 16, -101, 80), sub = text("GameFontHighlightSmall", 16, -121, 80) }
  end
  card.note = text("GameFontHighlightSmall", 16, -90)
  if card.note.SetWordWrap then card.note:SetWordWrap(true) end
  card.facts = text("GameFontHighlightSmall", 16, -144)
  card.health = text("GameFontHighlightSmall", 16, -158)
  card.hint = text("GameFontDisableSmall", 16, -176)
  card.close = CreateFrame("Button", nil, card, "UIPanelCloseButton")
  card.close:SetPoint("TOPRIGHT", 0, 0)
  card.close:SetScript("OnClick", closeCard)
  card:SetScript("OnUpdate", function(self, elapsed)
    if inCombat() then pendingCard = self.data; self:Hide(); return end
    local hovered = self.IsMouseOver and self:IsMouseOver() == true
    if hovered then self:SetAlpha(1); return end
    self.age = (self.age or 0) + elapsed
    self:SetAlpha(math.max(0, math.min(1, (CARD_SECONDS - self.age) / 2)))
    if self.age >= CARD_SECONDS then closeCard() end
  end)
end

local function colored(hex, text) return "|cff" .. hex .. text .. "|r" end
local function personLine(name, class, level, rating)
  local text = classHex(class) .. fit(displayName(name), 20) .. "|r"
  local detail = {}
  if class then detail[#detail + 1] = className(class) end
  if level then detail[#detail + 1] = string.format(L("level %d"), level) end
  if #detail > 0 then text = text .. "  |cffb0b8c4" .. table.concat(detail, " ") .. "|r" end
  if rating then text = text .. "  |cffffd36a" .. rating .. "|r" end
  return text
end
-- The opponent's rating as the card writes it: "990 (-12)".
function duels.opponentRating(data)
  if not data or data.oppScore == nil then return nil end
  if data.oppChange ~= nil then return round(data.oppScore) .. " (" .. duels.changeText(data.oppChange) .. ")" end
  return tostring(round(data.oppScore))
end

-- The stat columns for a card's data: { label, value, sub } in order. Pure, so the tests can read it.
function duels.cardStats(data)
  local out = {}
  if data.outsider or data.rosterPending or data.recorded == false or not data.counted or not data.wins then return out end
  out[#out + 1] = { label = L("Record"), value = string.format("%d-%d", data.wins, data.losses), sub = string.format("%d%%", data.rate or 0) }
  if data.score then
    if data.change ~= nil then
      out[#out + 1] = { label = L("Rating"), value = duels.changeText(data.change), sub = "-> " .. round(data.score) }
    else
      out[#out + 1] = { label = L("Rating"), value = tostring(round(data.score)), sub = "" }
    end
  end
  if data.rank then
    local sub = ""
    if data.rankChange and data.rankChange > 0 then sub = colored("66e08a", string.format(L("up %d (was #%d)"), data.rankChange, data.rankBefore or data.rank + data.rankChange))
    elseif data.rankChange and data.rankChange < 0 then sub = colored("e07066", string.format(L("down %d (was #%d)"), -data.rankChange, data.rankBefore or data.rank + data.rankChange)) end
    out[#out + 1] = { label = L("Guild rank"), value = "#" .. data.rank, sub = sub }
  end
  if data.streak and math.abs(data.streak) >= 2 then
    out[#out + 1] = { label = L("Streak"), value = streakText(data.streak), sub = data.newBest and colored("66e08a", L("New best streak!")) or "" }
  end
  return out
end

local function drawCard(data)
  if not (UIParent and CreateFrame) then return end
  if not card then buildCard() end
  card.data = data
  restorePosition(card)
  local won = data.won
  if won then
    card.title:SetText(L("VICTORY")); card.title:SetTextColor(0.4, 0.85, 0.6)
  else
    card.title:SetText(L("DEFEAT")); card.title:SetTextColor(0.9, 0.45, 0.4)
  end
  -- The painting, tinted: green-gold for a win, muted red for a defeat. Off: the plain card.
  if card.art and artOn() then
    card.art:SetTexture(duels.CARD_ART)
    if card.art.SetVertexColor then if won then card.art:SetVertexColor(0.85, 1, 0.72) else card.art:SetVertexColor(1, 0.55, 0.5) end end
    card.art:Show(); card.scrim:Show()
  else
    if card.art then card.art:Hide() end
    if card.scrim then card.scrim:Hide() end
  end
  card.me:SetText(personLine(data.me, data.myClass, data.myLevel))
  card.vs:SetText("|cffb0b8c4" .. L("against") .. "|r  " .. personLine(data.opponent, data.oppClass, data.oppLevel, duels.opponentRating(data)))
  local stats = duels.cardStats(data)
  local colW = math.floor(COLUMNS_W / math.max(#stats, 1))
  for i = 1, STAT_MAX do
    local cell, col = card.stats[i], stats[i]
    if col then
      local x = 16 + (i - 1) * colW
      for _, key in ipairs({ "label", "value", "sub" }) do
        local fs = cell[key]
        fs:ClearAllPoints(); fs:SetPoint("TOPLEFT", x, key == "label" and -88 or key == "value" and -101 or -121); fs:SetWidth(colW - 6); fs:Show()
      end
      cell.label:SetText(col.label); cell.value:SetText(col.value); cell.sub:SetText(col.sub)
    else
      cell.label:SetText(""); cell.value:SetText(""); cell.sub:SetText("")
      cell.label:Hide(); cell.value:Hide(); cell.sub:Hide()
    end
  end
  -- No stats (not counted, a rematch, or a non-guild opponent): one plain sentence in their place.
  local note = ""
  if data.rosterPending then note = L("Not counted yet: the guild roster has not loaded.")
  elseif data.outsider then note = string.format(L("Not counted on the guild ladder: %s is not in your guild."), displayName(data.opponent))
  elseif data.recorded == false then note = L("Not recorded: you duelled this player a moment ago, so this result is not added.")
  elseif not data.counted then note = L("Not counted on the ladder.") end
  card.note:SetText(note ~= "" and colored("e0a050", note) or "")
  local facts = {}
  if data.duration then facts[#facts + 1] = L("Duration") .. " " .. clockText(data.duration) end
  if data.zone then facts[#facts + 1] = fit(data.zone, 40) end
  if data.reason == "retreat" then facts[#facts + 1] = won and L("the opponent fled") or L("you fled") end
  card.facts:SetText(#facts > 0 and ("|cffc4ccd8" .. table.concat(facts, "  -  ") .. "|r") or "")
  local h, parts = data.health, {}
  if h and h.me then parts[#parts + 1] = string.format(L("your health left %d%%"), h.me) end
  if h and h.opponent then parts[#parts + 1] = string.format(L("opponent's health left %d%%"), h.opponent) end
  card.health:SetText(#parts > 0 and ("|cffffd36a" .. table.concat(parts, "  -  ") .. "|r") or "")
  card.hint:SetText(string.format(L("Rematch? Target %s and choose Duel."), fit(displayName(data.opponent), 20)))
  card:SetHeight(CARD_H)
  card.age = 0
  card:SetAlpha(1)
  -- Stacked above the dungeon result card when both are on screen.
  if ns.util and ns.util.keepApart then ns.util.keepApart(card, _G.GuildedRunResults) end
  card:Show()
end

-- Shows the card now, or after combat. `force` is the test command: it ignores the setting.
function duels.showCard(data, force)
  if type(data) ~= "table" or not active() then return false end
  if not force and not duels.cardEnabled() then return false end
  duels.lastCard = data
  if inCombat() then pendingCard = data; return true end
  pendingCard = nil
  drawCard(data)
  return true
end
local function tryPending()
  if pendingCard and not inCombat() and duels.cardEnabled() then
    local data = pendingCard
    pendingCard = nil
    drawCard(data)
  elseif pendingCard and not duels.cardEnabled() then pendingCard = nil end
end

-- A sample card for /guilded duels card test.
function duels.sampleCard()
  local mine = me() or "You"
  return duels.cardData(mine, "Rival Example", epoch(), "knockout", { me = mine, duration = 84, zone = L("Test zone"), counted = true,
    health = { me = 38, opponent = 0 }, before = { rank = 3, best = 1 } })
end

-- ----- events ----------------------------------------------------------

local function share(winner, loser, at, reason)
  if IsInGuild and IsInGuild() then ns.comm.send(PREFIX, string.format("D|%s|%s|%d|%s", winner, loser, at, reason), "GUILD") end
end

function duels.onSystem(text)
  local winner, loser, reason = duels.parse(text)
  if not winner then return false end
  local at = epoch()
  local mine = me()
  local involved = mine and (same(mine, winner) or same(mine, loser)) or false
  -- Both players must be in the guild for a duel to count (an outsider's never does: not recorded, not shared with the guild or
  -- the bot). My own duel with an outsider still gets the card, saying so, with what my client knows of the opponent.
  if not (guildMember(winner) and guildMember(loser)) then
    if involved then
      local ext = {}
      pcall(function()
        local ctx = { me = mine, outsider = true, rosterPending = rosterPending() }
        local s = session
        if s and s.startedAt and clock() - s.startedAt >= 0 and clock() - s.startedAt < SESSION_MAX then
          ctx.duration, ctx.zone = clock() - s.startedAt, s.zone
          ctx.health = healthLeft(s.opponent)
        end
        local oppName = same(mine, winner) and loser or winner
        ctx.oppInfo = opponentInfo(s, oppName)
        ext = { oppInfo = ctx.oppInfo, duration = ctx.duration, zone = ctx.zone, countdownAt = s and s.countdownAt, startAt = s and s.startAt, rosterPending = ctx.rosterPending }
        local data = duels.cardData(winner, loser, at, reason, ctx)
        duels.lastCard = data
        duels.showCard(data)
      end)
      -- Recorded for the upload (not on the guild ladder), unless the guild roster has not loaded and "outside the guild" cannot be said yet.
      if not (ext.rosterPending or rosterPending()) then pcall(duels.recordExternal, winner, loser, at, reason, ext) end
      session = nil
    end
    return false
  end
  -- My side of the duel: duration, zone and health left. This is optional card data: a failure here must never stop the record.
  local ctx
  if involved then
    ctx = { me = mine }
    local okCtx = pcall(function()
      local s = session
      ctx.oppInfo = targetInfo(same(mine, winner) and loser or winner)
      if s and s.startedAt and clock() - s.startedAt >= 0 and clock() - s.startedAt < SESSION_MAX then
        ctx.duration = clock() - s.startedAt
        ctx.zone = s.zone
        ctx.health = healthLeft(s.opponent)
      end
      ctx.before = duels.rowFor(duels.standings(), mine) or { best = 0 }
    end)
    if not okCtx then ctx.before = nil end
    session = nil
  end
  local isNew, key = duels.record(winner, loser, at, reason, ctx)
  if isNew and involved then share(winner, loser, at, reason) end
  if isNew and mine and same(mine, winner) and ns.milestones then pcall(ns.milestones.checkDuelWins, duels.myWins()) end
  if involved then
    pcall(function()
      local row = key and store().results[key]
      ctx.recorded = isNew
      if not isNew then
        ctx.before = nil
        -- The other player's message may have recorded THIS duel first (it started after my countdown): it is the same
        -- duel, so fill in what only my side knows. Anything older is a rematch inside the dedupe window: not recorded.
        local near = findRecent(winner, loser, at)
        if near and ctx.duration and near.at >= at - ctx.duration - 1 then
          row, ctx.recorded = near, true
          if not near.dur and ctx.duration < SESSION_MAX then near.dur = math.floor(ctx.duration) end
          if not near.zone and ctx.zone and #ctx.zone <= 80 then near.zone = ctx.zone end
        end
      end
      ctx.row, ctx.counted = row, ctx.recorded and (row == nil or isCounted(row)) or false
      local data = duels.cardData(winner, loser, at, reason, ctx)
      duels.lastCard = data
      duels.showCard(data)
    end)
  end
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

-- ----- chat command ----------------------------------------------------

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["duels"] = function(args)
  args = type(args) == "table" and args or {}
  local first = string.lower(args[1] or "")
  if first == "card" then
    local arg = string.lower(args[2] or "")
    if arg == "on" or arg == "off" then
      duels.setCardEnabled(arg == "on")
      ns.message(L(arg == "on" and "Duel card: on." or "Duel card: off."))
    elseif arg == "test" then
      duels.showCard(duels.sampleCard(), true)
    else
      ns.message(string.format(L("Duel card: %s. /guilded duels card on | off | test"), L(duels.cardEnabled() and "on" or "off")))
    end
    return
  end
  local season = first:match("^%d%d%d%d%-%d%d$")
  local rows = duels.standings({ season = season })
  if first == "me" then
    local mine = me()
    for _, row in ipairs(rows) do
      if same(row.name, mine) then
        ns.message(string.format(L("Duels: %d wins, %d losses (%d%%), streak %s, rating %d."), row.wins, row.losses, percent(row.rate), streakText(row.streak), round(row.score)))
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
    ns.message(string.format("%d. %s - %d (%dW %dL) %s", i, row.name, round(row.score), row.wins, row.losses, streakText(row.streak)))
  end
end
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded duels [me | YYYY-MM] - guild duel ladder by rating (wins, losses, streak)")
table.insert(ns.commandHelp, "/guilded duels card on | off | test - the card shown after each of your duels")

-- ----- the Duels page --------------------------------------------------

local ROWS = 12
local COLUMNS = { -- x, width, justify
  rank = { 0, 26, "RIGHT" }, change = { 30, 34, "LEFT" }, name = { 66, 190, "LEFT" }, wins = { 262, 40, "RIGHT" }, losses = { 308, 40, "RIGHT" },
  rate = { 354, 50, "RIGHT" }, streak = { 410, 50, "RIGHT" }, score = { 466, 52, "RIGHT" }, last = { 526, 62, "LEFT" },
}
local pageState = { season = 1, myClass = false, selected = nil }

-- The rows the page shows for the current filters, plus my own row (pinned when it is not among them) and the
-- 24 h rank change per player. Pure data, so the tests can read it without a window.
function duels.view(state)
  state = state or pageState
  local seasons = duels.seasons()
  local season = seasons[math.max(1, math.min(tonumber(state.season) or 1, math.max(#seasons, 1)))]
  local mine = me()
  local opts = { season = season or "none" }
  local all = duels.standings(opts)
  if state.myClass and mine then
    opts.class = infoFor(mine).class
    opts.class = opts.class or (duels.rowFor(all, mine) or {}).class
  end
  local rows = opts.class and duels.standings(opts) or all
  local yesterday = duels.standings({ season = opts.season, before = epoch() - DAY, class = opts.class })
  local before = {}
  for _, row in ipairs(yesterday) do before[row.name:lower()] = row.rank end
  for _, row in ipairs(rows) do
    local old = before[row.name:lower()]
    row.change = old and (old - row.rank) or nil
  end
  local view = { rows = {}, total = #rows, season = season, seasons = #seasons, mine = mine and duels.rowFor(rows, mine) or nil, pinned = false }
  for i = 1, math.min(ROWS, #rows) do view.rows[i] = rows[i] end
  if view.mine and view.mine.rank > ROWS then view.pinned = true end
  if state.selected then view.versus = duels.headToHead(mine, state.selected, { season = opts.season }) end
  return view
end

function duels.buildPage(page, ui)
  ui = ui or {}
  local newLabel, at = ui.newLabel, ui.at
  local pageWidth = ui.width or 582
  local function label(text, font, x, y, width, justify)
    local fs = at(newLabel(page, text, font), page, x, y)
    if width and fs.SetWidth then fs:SetWidth(width) end
    if justify and fs.SetJustifyH then fs:SetJustifyH(justify) end
    if fs.SetWordWrap then fs:SetWordWrap(false) end
    return fs
  end
  local function button(text, width, onClick)
    local b = CreateFrame("Button", nil, page, "UIPanelButtonTemplate")
    b:SetSize(width, 22); b:SetText(text); b:SetScript("OnClick", onClick)
    return b
  end
  local function fit(b, minWidth)
    local fs = b.GetFontString and b:GetFontString()
    local needed = fs and fs.GetStringWidth and fs:GetStringWidth()
    b:SetWidth(type(needed) == "number" and math.max(minWidth, needed + 24) or minWidth)
  end
  at(newLabel(page, "Guild duels: a rating that starts at 1000 each season. Everyone is ranked from the first duel.", "GameFontHighlightSmall"), page, 0, 0)
  -- Filters.
  local periodButton = button("", 120, function() pageState.season = pageState.season % math.max(#duels.seasons(), 1) + 1; duels.refreshPage() end)
  at(periodButton, page, 0, -22)
  local classButton = button("", 150, function() pageState.myClass = not pageState.myClass; duels.refreshPage() end)
  at(classButton, page, 126, -22)
  -- Header and rows.
  local heads = {}
  local function headText(key, text) heads[key] = label(text, "GameFontNormalSmall", COLUMNS[key][1], -54, COLUMNS[key][2], COLUMNS[key][3]) end
  headText("rank", "#"); headText("name", "Player"); headText("wins", "W"); headText("losses", "L"); headText("rate", "Win %")
  headText("streak", "Streak"); headText("score", "Rating"); headText("last", "Last")
  local rows = {}
  for i = 1, ROWS + 1 do
    local y = -72 - (i - 1) * 20 - (i > ROWS and 6 or 0)
    local row = CreateFrame("Button", nil, page)
    row:SetSize(pageWidth, 18)
    at(row, page, 0, y)
    if row.SetHighlightTexture then row:SetHighlightTexture("Interface\\QuestFrame\\UI-QuestTitleHighlight") end
    row.cells = {}
    for key, col in pairs(COLUMNS) do
      local fs = row:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
      fs:SetPoint("TOPLEFT", row, "TOPLEFT", col[1], -3); fs:SetWidth(col[2]); fs:SetJustifyH(col[3])
      if fs.SetWordWrap then fs:SetWordWrap(false) end
      row.cells[key] = fs
    end
    row:SetScript("OnClick", function(self) if self.player then pageState.selected = self.player; duels.refreshPage() end end)
    rows[i] = row
  end
  local versus = label("", "GameFontHighlight", 0, -72 - (ROWS + 1) * 20 - 14, pageWidth, "LEFT")
  if versus.SetWordWrap then versus:SetWordWrap(true) end
  local empty = label("", "GameFontDisableSmall", 0, -76, pageWidth, "LEFT")
  local cardBox = CreateFrame("CheckButton", nil, page, "UICheckButtonTemplate")
  at(cardBox, page, 0, -72 - (ROWS + 1) * 20 - 52)
  local cardText = cardBox:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  cardText:SetPoint("LEFT", cardBox, "RIGHT", 2, 0)
  cardText:SetText(L("Show a card after each of my duels"))
  cardBox:SetScript("OnClick", function(self) duels.setCardEnabled(self:GetChecked() and true or false) end)

  local function fill(rowFrame, row, shownRank)
    local c = rowFrame.cells
    rowFrame.player = row.name
    local info = rosterInfo(row.name)
    local class = info and info.class or row.class
    c.rank:SetText(tostring(shownRank or row.rank))
    local change = ""
    if row.change and row.change > 0 then change = "|cff66e08a+" .. row.change .. "|r" elseif row.change and row.change < 0 then change = "|cffe06655" .. row.change .. "|r" end
    c.change:SetText(change)
    c.name:SetText(classHex(class) .. displayName(row.name) .. "|r")
    c.wins:SetText(tostring(row.wins)); c.losses:SetText(tostring(row.losses))
    c.rate:SetText(percent(row.rate) .. "%")
    c.streak:SetText(streakText(row.streak))
    c.score:SetText(tostring(round(row.score)))
    c.last:SetText(agoText(row.lastAt))
    rowFrame:Show()
  end

  function duels.refreshPage()
    local view = duels.view(pageState)
    local periodLabel = string.format(L("Season %s"), view.season or "-")
    periodButton:SetText(periodLabel); fit(periodButton, 120)
    classButton:SetText(pageState.myClass and L("My class only") or L("All classes")); fit(classButton, 150)
    cardBox:SetChecked(duels.cardEnabled())
    for i = 1, ROWS do
      local row = view.rows[i]
      if row then fill(rows[i], row) else rows[i].player = nil; rows[i]:Hide() end
    end
    if view.pinned then fill(rows[ROWS + 1], view.mine) else rows[ROWS + 1].player = nil; rows[ROWS + 1]:Hide() end
    for _, head in pairs(heads) do if view.total > 0 then head:Show() else head:Hide() end end
    empty:SetText(view.total == 0 and L("No guild duel recorded yet. Duel a guildmate!") or "")
    local mine = view.mine
    local text = ""
    if pageState.selected and view.versus and not same(pageState.selected, me() or "") then
      local v = view.versus
      text = string.format(L("You against %s: %d wins, %d losses"), displayName(pageState.selected), v.wins, v.losses)
      if v.lastAt then text = text .. "  -  " .. string.format(L("last duel: %s, %s"), L(v.lastWon and "won" or "lost"), agoText(v.lastAt)) end
      if v.wins + v.losses == 0 then text = string.format(L("You have not duelled %s in this season."), displayName(pageState.selected)) end
    elseif mine then
      text = string.format(L("Your record: %d wins, %d losses (%d%%), streak %s, rating %d. Click a player to see your record against them."), mine.wins, mine.losses, percent(mine.rate), streakText(mine.streak), round(mine.score))
    elseif view.total > 0 then
      text = L("Click a player to see your record against them.")
    end
    versus:SetText(text)
  end
  page:SetScript("OnShow", duels.refreshPage)
  ns.onDuelsChange = function() if page.IsShown and page:IsShown() then duels.refreshPage() end end
  duels.refreshPage()
end

local frame = CreateFrame("Frame")
for _, event in ipairs({ "PLAYER_LOGIN", "CHAT_MSG_SYSTEM", "CHAT_MSG_ADDON", "DUEL_REQUESTED", "DUEL_COUNTDOWN", "PLAYER_REGEN_ENABLED", "PLAYER_ENTERING_WORLD" }) do
  pcall(frame.RegisterEvent, frame, event)
end
local pollTime = 0
frame:SetScript("OnUpdate", function(_, elapsed)
  pollTime = pollTime + elapsed
  if pollTime < 0.5 then return end
  pollTime = 0
  if pendingCard then tryPending() end
end)
frame:SetScript("OnEvent", function(_, event, a, b, c, d)
  local ok, err = pcall(function()
    if not active() then return end
    if event == "PLAYER_LOGIN" then ns.comm.register(PREFIX)
    elseif event == "CHAT_MSG_SYSTEM" then duels.onSystem(a)
    elseif event == "DUEL_REQUESTED" then
      session = { opponent = type(a) == "string" and not (ns.isSecret and ns.isSecret(a)) and bare(a) or nil }
    elseif event == "DUEL_COUNTDOWN" then startFight(a)
    elseif event == "PLAYER_REGEN_ENABLED" then tryPending()
    elseif event == "PLAYER_ENTERING_WORLD" then duels.sessionStop()
    elseif event == "CHAT_MSG_ADDON" and ns.comm.accept(a, b, c, d, PREFIX, function(sender) return guildMember(sender) end) and c == "GUILD" then
      duels.onAddonMessage(b, d)
    end
  end)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "duels: " .. tostring(err)) end
end)
