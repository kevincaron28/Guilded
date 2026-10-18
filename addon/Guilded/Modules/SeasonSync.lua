-- Official season snapshots (the Discord dungeon board) reach every guild member in game.
--
-- Store and forward (6.3): any guild member who holds the board passes it on to a guildmate
-- whose copy is older, not only officers, so a small guild where people are rarely online at
-- the same time still gets its standings through whoever overlaps. Officers answer first;
-- members wait longer, and anyone who hears a reply for the same or a newer board stays quiet.
-- A relayed copy cannot be verified in game, so an officer's copy replaces a member-relayed
-- copy with the same stamp, and a stamp too far ahead is refused: a tampered copy only lasts
-- until the next real update.
--
-- Season dates (6.3) travel in their own DATES message after the BOARD parts, one
-- "D;<index>;<startsAt>;<endsAt>" line per season (ISO UTC, empty when unknown). Clients
-- before 6.3 refuse any unknown line inside BOARD, so the BOARD payload stays as it was and
-- they simply ignore DATES.
--
-- Level brackets (all-level seasons, rules version 6) travel the same way in a BRACKETS
-- message: "B;<index>;<key>;<min>;<max>;<bestCount>" per bracket and "K;<index>;<rank>;<key>"
-- per ranked row. Older clients ignore it and show the rows without brackets.
local addonName, ns = ...
local PREFIX = "GuildedSeason"
local COOLDOWN, REPLY_JITTER = 60, 4
local MEMBER_DELAY, MEMBER_JITTER = 6, 9
local lastShare, incoming = 0, nil
-- Answers to REQUEST wait a few seconds, so several holders asked at once answer once: each
-- one that hears another BOARD for the same (or a newer) season stays quiet.
local replyScheduled = false
local heardStamp, heardAt = nil, 0
local function current()
  local d = ns.getDb and ns.getDb()
  return d and d.dungeonBoard
end
local function encode(value)
  return (string.gsub(tostring(value or ""), "[%%;\r\n|]", function(c) return string.format("%%%02X", string.byte(c)) end))
end
local function decode(value)
  return (string.gsub(value, "%%(%x%x)", function(hex) return string.char(tonumber(hex, 16)) end))
end
-- "2026-10-01T23:00:00.000Z" -> "2026-10-01T23:00:00Z"; nil for anything else.
local function isoSecond(value)
  local text = type(value) == "string" and string.match(value, "^(%d%d%d%d%-%d%d%-%d%dT%d%d:%d%d:%d%d)")
  return text and (text .. "Z") or nil
end
local function sendParts(kind, stamp, payload)
  local total = math.ceil(#payload / 190)
  for part = 1, total do
    ns.comm.send(PREFIX, string.format("%s|%s|%d|%d|%s", kind, stamp, part, total, string.sub(payload, (part - 1) * 190 + 1, part * 190)), "GUILD")
  end
end
local function share()
  local board = current()
  if not board or time() - lastShare < COOLDOWN then return end
  if heardStamp and board.updatedAt and heardStamp >= board.updatedAt and time() - heardAt < COOLDOWN then return end
  local lines, dates, dated, brackets = {}, {}, false, {}
  local seasons = { board }
  for _, past in ipairs(board.history or {}) do seasons[#seasons + 1] = past end
  for index = 1, math.min(11, #seasons) do
    local season = seasons[index]
    lines[#lines + 1] = "S;" .. encode(season.season) .. ";" .. (season.status == "ENDED" and "ENDED" or "ACTIVE")
    local startsAt, endsAt = isoSecond(season.startsAt), isoSecond(season.endsAt)
    if startsAt or endsAt then dated = true end
    dates[#dates + 1] = "D;" .. index .. ";" .. (startsAt or "") .. ";" .. (endsAt or "")
    for _, b in ipairs(type(season.brackets) == "table" and season.brackets or {}) do
      brackets[#brackets + 1] = table.concat({ "B", index, b.key, b.min, b.max, b.bestCount }, ";")
    end
    for rank = 1, math.min(index == 1 and 50 or 10, #(season.rows or {})) do
      local row = season.rows[rank]
      lines[#lines + 1] = "R;" .. encode(row.name) .. ";" .. math.floor(row.points or 0)
      if season.brackets and row.bracket then brackets[#brackets + 1] = "K;" .. index .. ";" .. rank .. ";" .. row.bracket end
    end
  end
  local payload = table.concat(lines, "\n")
  local total = math.ceil(#payload / 190)
  if total < 1 or total > 96 then return end
  lastShare = time()
  sendParts("BOARD", board.updatedAt, payload)
  if dated then sendParts("DATES", board.updatedAt, table.concat(dates, "\n")) end
  local bracketText = table.concat(brackets, "\n")
  if #brackets > 0 and #bracketText <= 190 * 16 then sendParts("BRACKETS", board.updatedAt, bracketText) end
end
local function scheduleReply()
  if replyScheduled then return end
  replyScheduled = true
  local function reply() replyScheduled = false; share() end
  -- Officers answer within a few seconds; members only if nobody answered before them.
  local delay = ns.isOfficer() and 1 + math.random() * REPLY_JITTER or MEMBER_DELAY + math.random() * MEMBER_JITTER
  if C_Timer and C_Timer.After then C_Timer.After(delay, reply) else reply() end
end
-- Dates only from the guildmate whose board we kept: never onto the companion's own copy.
local datesIncoming = nil
local function receiveDates(text, sender)
  local stamp, part, total, payload = string.match(text, "^DATES|([^|]+)|(%d+)|(%d+)|(.*)$")
  part, total = tonumber(part), tonumber(total)
  if not stamp or #stamp > 40 or not part or not total or total < 1 or total > 4 or part < 1 or part > total or #payload > 190 then return end
  local board = current()
  if not board or board.updatedAt ~= stamp then return end
  if board.from ~= sender then return end
  if not datesIncoming or datesIncoming.stamp ~= stamp or datesIncoming.sender ~= sender or datesIncoming.total ~= total or time() - datesIncoming.started > 60 then
    datesIncoming = { stamp = stamp, sender = sender, total = total, started = time(), parts = {}, received = 0 }
  end
  if not datesIncoming.parts[part] then datesIncoming.parts[part] = payload; datesIncoming.received = datesIncoming.received + 1 end
  if datesIncoming.received ~= total then return end
  local whole = table.concat(datesIncoming.parts)
  datesIncoming = nil
  local seasons = { board }
  for _, past in ipairs(board.history or {}) do seasons[#seasons + 1] = past end
  local found = {}
  for line in string.gmatch(whole .. "\n", "([^\n]*)\n") do
    local index, startsAt, endsAt = string.match(line, "^D;(%d+);([^;]*);([^;]*)$")
    index = tonumber(index)
    if not index or not seasons[index] then return end
    if (startsAt ~= "" and isoSecond(startsAt) ~= startsAt) or (endsAt ~= "" and isoSecond(endsAt) ~= endsAt) then return end
    found[index] = { startsAt ~= "" and startsAt or nil, endsAt ~= "" and endsAt or nil }
  end
  for index, pair in pairs(found) do seasons[index].startsAt, seasons[index].endsAt = pair[1], pair[2] end
  if ns.onDungeonChange then pcall(ns.onDungeonChange) end
end
-- Brackets, like dates, only from the guildmate whose board we kept. All or nothing.
local bracketsIncoming = nil
local function receiveBrackets(text, sender)
  local stamp, part, total, payload = string.match(text, "^BRACKETS|([^|]+)|(%d+)|(%d+)|(.*)$")
  part, total = tonumber(part), tonumber(total)
  if not stamp or #stamp > 40 or not part or not total or total < 1 or total > 16 or part < 1 or part > total or #payload > 190 then return end
  local board = current()
  if not board or board.updatedAt ~= stamp or board.from ~= sender then return end
  if not bracketsIncoming or bracketsIncoming.stamp ~= stamp or bracketsIncoming.sender ~= sender or bracketsIncoming.total ~= total or time() - bracketsIncoming.started > 60 then
    bracketsIncoming = { stamp = stamp, sender = sender, total = total, started = time(), parts = {}, received = 0 }
  end
  if not bracketsIncoming.parts[part] then bracketsIncoming.parts[part] = payload; bracketsIncoming.received = bracketsIncoming.received + 1 end
  if bracketsIncoming.received ~= total then return end
  local whole = table.concat(bracketsIncoming.parts)
  bracketsIncoming = nil
  local seasons = { board }
  for _, past in ipairs(board.history or {}) do seasons[#seasons + 1] = past end
  local lists, keys = {}, {}
  for line in string.gmatch(whole .. "\n", "([^\n]*)\n") do
    local index, key, low, high, best = string.match(line, "^B;(%d+);([a-z0-9][a-z0-9%-]*);(%d+);(%d+);(%d+)$")
    index, low, high, best = tonumber(index), tonumber(low), tonumber(high), tonumber(best)
    if index then
      if not seasons[index] or #key > 20 or low < 1 or high > 100 or low > high or best < 1 or best > 20 then return end
      lists[index] = lists[index] or {}
      if #lists[index] >= 10 then return end
      lists[index][#lists[index] + 1] = { key = key, min = low, max = high, bestCount = best }
    else
      local rowIndex, rank, rowKey = string.match(line, "^K;(%d+);(%d+);([a-z0-9][a-z0-9%-]*)$")
      rowIndex, rank = tonumber(rowIndex), tonumber(rank)
      if not rowIndex or not seasons[rowIndex] or not (seasons[rowIndex].rows or {})[rank] then return end
      keys[#keys + 1] = { rowIndex, rank, rowKey }
    end
  end
  for _, entry in ipairs(keys) do
    local known = false
    for _, b in ipairs(lists[entry[1]] or {}) do if b.key == entry[3] then known = true end end
    if not known then return end
  end
  for index, list in pairs(lists) do seasons[index].brackets = list end
  for _, entry in ipairs(keys) do seasons[entry[1]].rows[entry[2]].bracket = entry[3] end
  if ns.onDungeonChange then pcall(ns.onDungeonChange) end
end
local function receive(text, sender)
  if string.sub(text, 1, 6) == "DATES|" then return receiveDates(text, sender) end
  if string.sub(text, 1, 9) == "BRACKETS|" then return receiveBrackets(text, sender) end
  local stamp, part, total, payload = string.match(text, "^BOARD|([^|]+)|(%d+)|(%d+)|(.*)$")
  part, total = tonumber(part), tonumber(total)
  if not stamp or #stamp > 40 or not part or not total or total < 1 or total > 96 or part < 1 or part > total or #payload > 190 then return end
  if ns.util.tooFarAhead(stamp) then return end
  -- The newest board heard in the last minute (an older one replaces it once it is stale).
  if not heardStamp or stamp >= heardStamp or time() - heardAt >= COOLDOWN then heardStamp, heardAt = stamp, time() end
  local board = current()
  local officer = ns.isOfficerName(sender) and true or false
  -- Newer boards come from anyone in the guild; for the same stamp, only an officer's copy
  -- replaces one a member relayed.
  if board and board.updatedAt and (board.updatedAt > stamp or (board.updatedAt == stamp and (board.fromOfficer ~= false or not officer))) then return end
  if not incoming or incoming.stamp ~= stamp or time() - incoming.started > 60 then
    incoming = { stamp = stamp, sender = sender, total = total, started = time(), parts = {}, received = 0 }
  end
  if incoming.sender ~= sender or incoming.total ~= total then return end
  if not incoming.parts[part] then incoming.parts[part] = payload; incoming.received = incoming.received + 1 end
  if incoming.received ~= total then return end
  local text2 = table.concat(incoming.parts)
  incoming = nil
  local seasons, season = {}, nil
  for line in string.gmatch(text2 .. "\n", "([^\n]*)\n") do
    local kind, name, value = string.match(line, "^([SR]);([^;]*);([^;]*)$")
    if kind == "S" then
      if #seasons >= 11 or (value ~= "ACTIVE" and value ~= "ENDED") then return end
      season = { season = decode(name), status = value, rows = {} }
      seasons[#seasons + 1] = season
    elseif kind == "R" and season then
      local points = tonumber(value)
      if #season.rows >= 50 or not points or points < 0 or points > 1000000000 then return end
      season.rows[#season.rows + 1] = { name = decode(name), points = points }
    else return end
  end
  if not seasons[1] then return end
  local accepted = seasons[1]
  accepted.updatedAt, accepted.from, accepted.fromOfficer, accepted.history = stamp, sender, ns.isOfficerName(sender) and true or false, {}
  for index = 2, #seasons do accepted.history[#accepted.history + 1] = seasons[index] end
  local d = ns.getDb()
  if not d then return end
  d.dungeonBoard = accepted
  GuildedDungeonBoard = accepted
  if ns.onDungeonChange then pcall(ns.onDungeonChange) end
end
local frame = CreateFrame("Frame")
frame:RegisterEvent("PLAYER_ENTERING_WORLD"); frame:RegisterEvent("CHAT_MSG_ADDON")
frame:SetScript("OnEvent", function(_, event, prefix, text, channel, sender)
  if event == "PLAYER_ENTERING_WORLD" then
    ns.comm.register(PREFIX)
    local d, file, saved = ns.getDb(), GuildedDungeonBoard, current()
    -- A board the companion just brought from Discord is shared at once, by any member.
    local fresh = false
    if d and type(file) == "table" and type(file.updatedAt) == "string" and (not saved or not saved.updatedAt or file.updatedAt > saved.updatedAt) then d.dungeonBoard = file; fresh = true end
    if current() then GuildedDungeonBoard = current() end
    if C_Timer then C_Timer.After(25, function()
      if ns.isOfficer() or fresh then share() end
      ns.comm.send(PREFIX, "REQUEST|" .. ((current() and current().updatedAt) or "0"), "GUILD")
    end) end
  elseif prefix == PREFIX and channel == "GUILD" and not ns.isSecret(text) and not ns.isSecret(sender) then
    sender = ns.normalizeName(sender)
    if not sender or sender == ns.playerName() or not ns.isGuildMember(sender) then return end
    if string.sub(text, 1, 8) == "REQUEST|" then
      local theirs = string.sub(text, 9)
      if current() and current().updatedAt and current().updatedAt > theirs then scheduleReply() end
    else receive(text, sender) end
  end
end)
