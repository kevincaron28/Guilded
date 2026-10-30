-- Provisional pilot on every edition whose client has the PvP match APIs: own-character, permitted postmatch data only.
-- No scoreboard enumeration, peer messages, opponent roster or point awards.
local _, ns = ...
local bg = {}
ns.battleground = bg
-- Explicit user-entered grouping hint only; never persisted across sessions.
local nextPremade = {}
local function safe(fn, ...)
  if type(fn) ~= "function" then return nil end
  local ok, value = pcall(fn, ...)
  if not ok or (ns.isSecret and ns.isSecret(value)) then return nil end
  return value
end
local function store()
  local root = ns.getDb and ns.getDb()
  if not root then return nil end
  root.battleground = root.battleground or { consents = {}, reports = {}, active = {}, sequence = 0 }
  local d = root.battleground
  d.consents = d.consents or {}; d.reports = d.reports or {}; d.active = d.active or {}
  return d
end
local function identity()
  local name = safe(UnitName, "player")
  local realm = safe(GetRealmName)
  if type(name) ~= "string" or type(realm) ~= "string" or name == "" or realm == "" then return nil end
  return name .. "-" .. realm, name, realm
end
-- Hardcore realms exist on these clients only; elsewhere the check does not apply.
local HARDCORE_EDITIONS = { forever = true, ["classic-era"] = true }
local EDITIONS = { forever = true, ["classic-era"] = true, ["classic-tbc"] = true, ["classic-mists"] = true, retail = true }
local function edition()
  local value = ns.util and ns.util.gameEdition()
  return EDITIONS[value] and value or nil
end
local function supported()
  local current = edition()
  if not current then return false end
  local hardcore = safe(C_GameRules and C_GameRules.IsHardcoreActive)
  -- Missing/secret Hardcore information is unknown, never assumed normal, where Hardcore exists.
  if hardcore == true or (HARDCORE_EDITIONS[current] and hardcore ~= false) then return false end
  return C_PvP and type(C_PvP.IsMatchComplete) == "function"
    and type(C_PvP.IsMatchActive) == "function"
    and type(C_PvP.GetActiveMatchBracket) == "function"
    and type(C_PvP.GetActiveMatchDuration) == "function"
    and type(C_PvP.IsRatedMap) == "function"
    and type(C_PvP.IsRatedSoloRBG) == "function"
    and type(C_PvP.IsBrawlSoloRBG) == "function"
end
local function enabled(d, key)
  return d and key and d.consents[key] == true and supported()
    and (not ns.moduleActive or ns.moduleActive("battleground"))
end
local function instance()
  local value = ns.compat and ns.compat.instance()
  if not value or value.type ~= "pvp" or type(value.id) ~= "number" or value.id <= 0 then return nil end
  return value
end
local function epoch() return safe(GetServerTime) end
local function start(backfill)
  local d = store(); local key, name, realm = identity()
  if not enabled(d, key) or not instance() or safe(C_PvP.IsMatchActive) ~= true then return end
  if d.active[key] and not d.active[key].finished then return end
  local at = epoch()
  if type(at) ~= "number" then return end
  d.sequence = (tonumber(d.sequence) or 0) + 1
  -- Persisted local counter plus epoch; reporter identity is scoped server-side.
  local id = "bg:" .. tostring(at) .. ":" .. tostring(d.sequence)
  d.active[key] = { reportId = id, character = name, realm = realm,
    mapId = instance().id, startedAt = at, backfill = backfill == true, reloaded = false }
end
local function complete()
  local d = store(); local key = identity()
  if not enabled(d, key) or safe(C_PvP.IsMatchComplete) ~= true then return end
  local current = instance(); local a = d.active[key]
  if not a or not current or current.id ~= a.mapId or d.reports[a.reportId] then return end
  -- No active-match values or scoreboard APIs are read before this gate.
  local duration = safe(C_PvP.GetActiveMatchDuration)
  local bracket = safe(C_PvP.GetActiveMatchBracket)
  local rated = safe(C_PvP.IsRatedMap)
  local soloRated = safe(C_PvP.IsRatedSoloRBG)
  local soloBrawl = safe(C_PvP.IsBrawlSoloRBG)
  local winner = safe(C_PvP.GetActiveMatchWinner)
  local faction = safe(GetBattlefieldArenaFaction)
  local at = epoch()
  if type(duration) ~= "number" or duration < 0 or duration > 14400
    or duration ~= duration or type(bracket) ~= "number" or bracket ~= bracket
    or type(rated) ~= "boolean" or type(at) ~= "number"
    or type(soloRated) ~= "boolean" or type(soloBrawl) ~= "boolean" then return end
  local outcome = "unknown"
  if (winner == 0 or winner == 1) and (faction == 0 or faction == 1) then outcome = winner == faction and "win" or "loss" end
  local report = { version = 1, reportId = a.reportId, adapter = edition() .. "-postmatch-v1",
    edition = edition(), character = a.character, realm = a.realm, realmType = "normal",
    mode = (soloRated or soloBrawl) and "blitz" or rated and "rated" or "casual", mapId = a.mapId, bracket = tostring(bracket),
    endedAt = math.floor(at), durationSeconds = math.floor(duration), outcome = outcome,
    presence = a.earlyExit and "early-exit" or a.reloaded and "unknown"
      or (a.backfill or a.startedAt > at - duration + 5) and "backfill" or "complete",
    reloaded = a.reloaded == true, postmatch = true, consent = true }
  report.premadeNonce = nextPremade[key]
  d.reports[a.reportId] = report
  nextPremade[key] = nil
  a.finished = true -- retain until leaving, preventing duplicate completion after reload
  -- Bound local history without overwriting durable IDs or inventing acknowledgments.
  local ids = {}; for id, r in pairs(d.reports) do ids[#ids + 1] = { id = id, at = r.endedAt or 0 } end
  table.sort(ids, function(x, y) return x.at < y.at end)
  for i = 1, #ids - 100 do d.reports[ids[i].id] = nil end
end
function bg.onEvent(event)
  local d = store(); local key = identity()
  if not d or not key then return end
  if event == "PLAYER_LOGIN" then
    nextPremade[key] = nil
    if d.active[key] then d.active[key].reloaded = true end
  elseif event == "PVP_MATCH_ACTIVE" then
    -- Start only observes own presence. Duration/outcome are read after completion.
    start(false)
  elseif event == "PVP_MATCH_COMPLETE" then complete()
  elseif event == "PLAYER_ENTERING_WORLD" then
    if not instance() then d.active[key] = nil
    elseif enabled(d, key) and safe(C_PvP.IsMatchActive) == true then start(true)
    elseif enabled(d, key) and safe(C_PvP.IsMatchComplete) == true then complete() end
  elseif event == "PLAYER_LEAVING_WORLD" and d.active[key] and not d.active[key].finished then
    d.active[key].earlyExit = true
  end
end
ns.commandHandlers["bgcapture"] = function(args)
  local d = store(); local key = identity()
  if not d or not key then return end
  local input = type(args) == "table" and table.concat(args, " ") or tostring(args or "")
  local action = input:lower()
  local fr = safe(GetLocale) == "frFR"
  if action == "premade" or action:match("^premade%s") then
    local code = input:match("^%S+%s+(%S+)$")
    if not code or #code < 8 or #code > 100 or not code:match("^[A-Za-z0-9_:%-]+$") then
      ns.message(fr and "Code invalide : 8-100 caracteres A-Z, a-z, 0-9, _, :, -."
        or "Invalid code: use 8-100 characters A-Z, a-z, 0-9, _, :, -."); return
    end
    if not enabled(d, key) then
      ns.message(fr and "Activez d'abord la capture disponible : /guilded bgcapture activer normal."
        or "First enable available capture: /guilded bgcapture on normal."); return
    end
    nextPremade[key] = code
  elseif action == "off" or action == "desactiver" then
    d.consents[key] = nil; d.active[key] = nil; nextPremade[key] = nil
  elseif action == "on normal" or action == "activer normal" then
    if supported() then d.consents[key] = true else
      ns.message(fr and "Capture indisponible : edition/API/royaume non verifie. Aucune donnee capturee."
        or "Capture unavailable: edition/API/realm not verified. No data captured."); return
    end
  end
  ns.message((fr and "Capture JcJ provisoire : " or "Provisional BG capture: ") .. (d.consents[key] and "ON" or "OFF")
    .. ". /guilded bgcapture on normal | off. " .. (fr and "Accord Discord /bg privacy requis; aucun point automatique."
    or "Discord /bg privacy also required; no automatic points.")
    .. (nextPremade[key] and ((fr and " Code prochain resultat (non verifie) : " or "Next-result code (unverified): ") .. nextPremade[key]) or ""))
end
table.insert(ns.commandHelp, "/guilded bgcapture on normal | off - own postmatch pilot / pilote JcJ personnel")
table.insert(ns.commandHelp, "/guilded bgcapture premade <code> - next result only, unverified / prochain resultat non verifie")
local frame = CreateFrame("Frame")
for _, event in ipairs({ "PLAYER_LOGIN", "PLAYER_ENTERING_WORLD", "PLAYER_LEAVING_WORLD", "PVP_MATCH_ACTIVE", "PVP_MATCH_COMPLETE" }) do
  pcall(frame.RegisterEvent, frame, event)
end
frame:SetScript("OnEvent", function(_, event) bg.onEvent(event) end)
