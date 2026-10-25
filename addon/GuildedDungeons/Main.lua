-- Guilded Dungeons: slash command and login. /gdungeons (or /gdg) status | results | start |
-- complete | abandon | check | score | lang. The Guilded companion reads GuildedDungeonsDB and,
-- once paired with a personal code from guilded.kcaron.top/me/, sends finished runs to the public
-- leaderboards.
local _, ns = ...

local DUNGEON_ACTIONS = { status = true, results = true, start = true, complete = true, abandon = true, check = true }

local function words(text)
  local list = {}
  for word in string.gmatch(text or "", "%S+") do list[#list + 1] = word end
  return list
end

function ns.slash(text)
  if ns.guildedPresent() then
    ns.message(ns.L("Guilded is installed, so it records your dungeon runs: use /guilded dungeon. Guilded Dungeons stays quiet."))
    return
  end
  local args = words(text)
  local action = string.lower(args[1] or "status")
  if DUNGEON_ACTIONS[action] then
    ns.commandHandlers["dungeon"]({ action })
  elseif action == "score" and not args[2] and ns.dungeonScorePanel then
    ns.dungeonScorePanel.open("season")
  elseif (action == "score" or action == "lang") and ns.commandHandlers[action] then
    table.remove(args, 1)
    ns.commandHandlers[action](args)
  else
    ns.message("/gdungeons status | results | start | complete | abandon | check | score | lang en|fr|auto")
  end
end

SLASH_GUILDEDDUNGEONS1 = "/gdungeons"
SLASH_GUILDEDDUNGEONS2 = "/gdg"
SlashCmdList = SlashCmdList or {}
SlashCmdList["GUILDEDDUNGEONS"] = function(text) ns.slash(text) end

local frame = CreateFrame("Frame")
frame:RegisterEvent("PLAYER_LOGIN")
frame:SetScript("OnEvent", function()
  local ok, err = pcall(function()
    local db = ns.getDb()
    db.addonVersion = ns.compat.addonVersion()
    if ns.guildedPresent() then return end
    -- Who this SavedVariables file belongs to, for the companion's personal upload.
    local identity = ns.compat.identity()
    local class = UnitClass and select(2, UnitClass("player")) or nil
    db.character = { name = ns.playerName(), displayName = ns.util.unitDisplayName("player"), realm = identity.realm, class = class, level = UnitLevel and UnitLevel("player") or nil, spec = db.character.spec }
    -- One account SavedVariables file can be used by many alts. Never show the
    -- last synced character's public score as the newly logged-in character's.
    local board = GuildedDungeonsPublicScore
    db.dungeonBoard = nil
    if type(board) == "table" and type(board.character) == "string" and type(board.realm) == "string"
      and ns.normalizeName(board.character) == ns.playerName()
      and string.lower(board.realm) == string.lower(identity.realm or "") then db.dungeonBoard = board end
    if ns.dungeonScorePanel then ns.dungeonScorePanel.refreshVisible() end
  end)
  if not ok then ns.logDiagnostic("LUA_ERROR", "login: " .. tostring(err)) end
end)
