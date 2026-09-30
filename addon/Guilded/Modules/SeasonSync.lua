-- Official season snapshots can reach addon-only members through an officer.
local addonName, ns = ...
local PREFIX = "GuildedSeason"
local lastShare, incoming = 0, nil
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
local function share()
  local board = current()
  if not board or not ns.isOfficer() or time() - lastShare < 60 then return end
  local lines = {}
  local seasons = { board }
  for _, past in ipairs(board.history or {}) do seasons[#seasons + 1] = past end
  for index = 1, math.min(11, #seasons) do
    local season = seasons[index]
    lines[#lines + 1] = "S;" .. encode(season.season) .. ";" .. (season.status == "ENDED" and "ENDED" or "ACTIVE")
    for rank = 1, math.min(index == 1 and 50 or 10, #(season.rows or {})) do
      local row = season.rows[rank]
      lines[#lines + 1] = "R;" .. encode(row.name) .. ";" .. math.floor(row.points or 0)
    end
  end
  local payload = table.concat(lines, "\n")
  local total = math.ceil(#payload / 190)
  if total < 1 or total > 96 then return end
  lastShare = time()
  for part = 1, total do
    ns.comm.send(PREFIX, string.format("BOARD|%s|%d|%d|%s", board.updatedAt, part, total, string.sub(payload, (part - 1) * 190 + 1, part * 190)), "GUILD")
  end
end
local function receive(text, sender)
  if not ns.isOfficerName(sender) then return end
  local stamp, part, total, payload = string.match(text, "^BOARD|([^|]+)|(%d+)|(%d+)|(.*)$")
  part, total = tonumber(part), tonumber(total)
  if not stamp or #stamp > 40 or not part or not total or total < 1 or total > 96 or part < 1 or part > total or #payload > 190 then return end
  if ns.util.tooFarAhead(stamp) then return end
  local board = current()
  if board and board.updatedAt and board.updatedAt >= stamp then return end
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
  accepted.updatedAt, accepted.from, accepted.history = stamp, sender, {}
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
    if d and type(file) == "table" and type(file.updatedAt) == "string" and (not saved or not saved.updatedAt or file.updatedAt > saved.updatedAt) then d.dungeonBoard = file end
    if current() then GuildedDungeonBoard = current() end
    if C_Timer then C_Timer.After(25, function()
      share()
      ns.comm.send(PREFIX, "REQUEST|" .. ((current() and current().updatedAt) or "0"), "GUILD")
    end) end
  elseif prefix == PREFIX and channel == "GUILD" and not ns.isSecret(text) and not ns.isSecret(sender) then
    sender = ns.normalizeName(sender)
    if not sender or sender == ns.playerName() or not ns.isGuildMember(sender) then return end
    if string.sub(text, 1, 8) == "REQUEST|" then
      local theirs = string.sub(text, 9)
      if current() and current().updatedAt > theirs then share() end
    else receive(text, sender) end
  end
end)
