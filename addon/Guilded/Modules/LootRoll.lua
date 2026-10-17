-- Soft-reserve roll-offs stay in Guilded; party games live in GuildedGames.
local _, ns = ...
local roll = {}
ns.lootRoll = roll
GuildedLootRollActive = function() return roll.session ~= nil end
local function L(t) return ns.L and ns.L(t) or t end
local function announce(text)
  ns.message(text)
  local channel = ns.util.groupChannel()
  if channel then
    local send = C_ChatInfo and C_ChatInfo.SendChatMessage or SendChatMessage
    if send then pcall(send, "[Guilded] " .. text:sub(1, 240), channel) end
  end
end
function roll.start(players, bonuses)
  if not (ns.isOfficer and ns.isOfficer()) or not ns.util.groupChannel() or roll.session then return false end
  if GuildedGames and GuildedGames.state and GuildedGames.state() then
    ns.message(L("Finish Guilded Games before starting a loot roll.")); return false
  end
  local eligible = {}; for _, name in ipairs(players) do eligible[name] = true end
  if #players < 2 then return false end
  roll.session = { players = eligible, values = {}, bonus = bonuses or {} }
  announce(L("Soft-reserve roll: eligible players /roll 100. Highest total wins; ties roll again.")); return true
end
function roll.receive(name, value, low, high)
  local s = roll.session
  if not s or not (ns.isOfficer and ns.isOfficer()) or not s.players[name] or s.values[name]
    or low ~= 1 or high ~= 100 or not value or value < 1 or value > 100 then return end
  s.values[name] = value
  for player in pairs(s.players) do if not s.values[player] then return end end
  local best, winners = -1, {}
  for player, v in pairs(s.values) do
    v = v + (s.bonus[player] or 0)
    if v > best then best, winners = v, { player } elseif v == best then winners[#winners + 1] = player end
  end
  table.sort(winners)
  if #winners > 1 then
    s.players, s.values = {}, {}
    for _, player in ipairs(winners) do s.players[player] = true end
    announce(string.format(L("Tie at %d: %s. Only these players /roll 100 again."), best, table.concat(winners, ", ")))
  else
    -- "including SR+" only when somebody in this roll-off has a bonus (seen in game: it was
    -- printed for a plain 20 with no SR+ at all).
    local anyBonus = false
    for _, bonus in pairs(s.bonus) do if (bonus or 0) > 0 then anyBonus = true end end
    if anyBonus then
      announce(string.format(L("Roll winner: %s (%d including SR+). Award the item separately."), winners[1], best))
    else
      announce(string.format(L("Roll winner: %s (%d). Award the item separately."), winners[1], best))
    end
    roll.session = nil
  end
end
ns.commandHandlers.lootroll = function(args)
  if not (ns.isOfficer and ns.isOfficer()) then return end
  if args[1] == "cancel" then roll.session = nil; announce(L("Loot roll cancelled."))
  elseif roll.session then
    local missing = {}; for name in pairs(roll.session.players) do if not roll.session.values[name] then missing[#missing + 1] = name end end
    table.sort(missing); ns.message(L("Waiting for rolls:") .. " " .. table.concat(missing, ", "))
  end
end
ns.commandHandlers.games = function()
  if GuildedGames and GuildedGames.open then GuildedGames.open()
  else ns.message(L("Party games moved to the optional Guilded Games addon. Install it and use /ggames. Loot rolls stay in Guilded.")) end
end
ns.commandHandlers.casino = ns.commandHandlers.games
ns.commandHelp[#ns.commandHelp + 1] = { officer = true, text = "/guilded lootroll [cancel] - pending soft-reserve rolls; awards remain manual" }
local frame = CreateFrame("Frame")
frame:RegisterEvent("CHAT_MSG_SYSTEM")
frame:SetScript("OnEvent", function(_, _, text)
  if not roll.session or ns.isSecret(text) then return end
  local ok, err = pcall(function() roll.receive(ns.parseRoll(text)) end)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", tostring(err)) end
end)
