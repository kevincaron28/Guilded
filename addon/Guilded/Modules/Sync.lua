-- Guild-wide sync that isn't raid data:
--
-- 1. Version check. Every client says its addon version to the guild at
--    login; anyone running an older build is told a newer one exists.
--
-- 2. EPGP standings from the Discord bot. The officer PC's companion writes
--    Standings.lua (global GuildedStandings) into this addon folder. A
--    client that has fresher standings than its saved copy adopts them and
--    shares them with the guild in small chunks, so members who don't run
--    the companion still get /guilded standings. Only standings sent by an
--    officer are accepted.
local addonName, ns = ...
ns = ns or {}

local PREFIX = "GuildedSync"
local CHUNK_BYTES = 220
local STARTUP_DELAY_SECONDS = 20
local SHARE_COOLDOWN_SECONDS = 60

local myVersion = "0"
local warnedNewer = false
local repliedTo = {}
local lastShareAt = 0
local incoming -- { updatedAt, total, parts = { [i] = text } }
local peerVersions = {} -- sender -> addon version they announced this session

local function getMetadata(field)
  if C_AddOns and C_AddOns.GetAddOnMetadata then return C_AddOns.GetAddOnMetadata(addonName, field) end
  if GetAddOnMetadata then return GetAddOnMetadata(addonName, field) end
  return nil
end

-- "1.10.0" > "1.9.2": compare each number, not the text.
local function versionNewer(a, b)
  local pa, pb = {}, {}
  for n in string.gmatch(a or "", "%d+") do table.insert(pa, tonumber(n)) end
  for n in string.gmatch(b or "", "%d+") do table.insert(pb, tonumber(n)) end
  for i = 1, math.max(#pa, #pb) do
    local x, y = pa[i] or 0, pb[i] or 0
    if x ~= y then return x > y end
  end
  return false
end

-- Through Core's paced queue (ns.comm), so a long standings list is never dropped by the
-- client's message throttle.
local function send(text, channel, target)
  ns.comm.send(PREFIX, text, channel, target)
end

local function db()
  return ns.getDb and ns.getDb()
end

local function standings()
  local d = db()
  return d and d.standings
end

-- Normalized lookup: name -> { ep, gp, pr }
local function lookup(name)
  local s = standings()
  name = ns.normalizeName(name)
  if not s or not name then return nil end
  return s.players[name]
end

local function after(seconds, fn)
  if C_Timer and C_Timer.After then C_Timer.After(seconds, fn) else fn() end
end

-- ---------------------------------------------------------------------
-- Standings sharing
-- ---------------------------------------------------------------------

-- PR = EP / (GP + base GP), the same rule the bot uses.
local function priority(ep, gp, baseGp)
  local denominator = gp + math.max(0, baseGp or 0)
  return denominator > 0 and ep / denominator or 0
end

local function encodePlayers(players)
  local entries = {}
  for name, row in pairs(players) do
    table.insert(entries, string.format("%s:%d:%d", name, row.ep or 0, row.gp or 0))
  end
  table.sort(entries)
  return entries
end

local shareItems -- defined below, next to the item tooltip data

local function shareStandings()
  local s = standings()
  if not s or not s.updatedAt then return end
  if time() - lastShareAt < SHARE_COOLDOWN_SECONDS then return end
  lastShareAt = time()
  local chunks, current = {}, ""
  for _, entry in ipairs(encodePlayers(s.players)) do
    if current ~= "" and string.len(current) + string.len(entry) + 1 > CHUNK_BYTES then
      table.insert(chunks, current)
      current = ""
    end
    current = current == "" and entry or (current .. ";" .. entry)
  end
  if current ~= "" then table.insert(chunks, current) end
  -- The queue paces the chunks inside the client's addon-message throttle.
  for i, chunk in ipairs(chunks) do
    send(string.format("STAND|%s|%d|%d|%d|%s", s.updatedAt, s.baseGp or 0, i, #chunks, chunk), "GUILD")
  end
  shareItems()
end

-- Item tooltip data (who wishlisted an item, what it usually costs) travels next to the
-- standings: ITEM|<updatedAt>|<i>|<total>|key~gp~awards~wishTotal~Name:prio,Name:prio;...
-- The bot keeps keys and names free of the separators.
local function encodeItems(list)
  local entries = {}
  for key, item in pairs(list or {}) do
    local wish = {}
    for _, w in ipairs(item.wish or {}) do table.insert(wish, string.format("%s:%d", w[1], w[2] or 2)) end
    local entry = string.format("%s~%s~%d~%d~%s", key, item.gp and tostring(item.gp) or "", item.n or 0, item.wn or 0, table.concat(wish, ","))
    if string.len(entry) <= CHUNK_BYTES then table.insert(entries, entry) end
  end
  table.sort(entries)
  return entries
end

function shareItems()
  local d = db()
  local s = standings()
  if not d or not d.items or not s or not s.updatedAt then return end
  local chunks, current = {}, ""
  for _, entry in ipairs(encodeItems(d.items.list)) do
    if current ~= "" and string.len(current) + string.len(entry) + 1 > CHUNK_BYTES then
      table.insert(chunks, current)
      current = ""
    end
    current = current == "" and entry or (current .. ";" .. entry)
  end
  if current ~= "" then table.insert(chunks, current) end
  for i, chunk in ipairs(chunks) do
    send(string.format("ITEM|%s|%d|%d|%s", s.updatedAt, i, #chunks, chunk), "GUILD")
  end
end

local function decodeItems(text)
  local list = {}
  for entry in string.gmatch(text or "", "[^;]+") do
    local key, gp, awards, wishTotal, wish = string.match(entry, "^([^~]+)~([^~]*)~(%d*)~(%d*)~(.*)$")
    if key then
      local item = { gp = tonumber(gp), n = tonumber(awards) or 0, wn = tonumber(wishTotal) or 0, wish = {} }
      for name, prio in string.gmatch(wish or "", "([^:,]+):(%d)") do table.insert(item.wish, { name, tonumber(prio) }) end
      list[key] = item
    end
  end
  return list
end

local incomingItems -- { updatedAt, total, parts, received }

local function receiveItemChunk(text, sender)
  local updatedAt, index, total, payload = string.match(text, "^ITEM|([^|]+)|(%d+)|(%d+)|(.*)$")
  index, total = tonumber(index), tonumber(total)
  if not updatedAt or not index or not total or total < 1 or total > 60 then return end
  if index < 1 or index > total then return end
  if not ns.isOfficerName(sender) then return end
  -- A date in the future would make this copy "newest" forever.
  if ns.util.tooFarAhead(updatedAt) then return end
  local d = db()
  if not d or (d.items and d.items.updatedAt and d.items.updatedAt >= updatedAt) then return end
  if not incomingItems or incomingItems.updatedAt ~= updatedAt then
    incomingItems = { updatedAt = updatedAt, total = total, sender = sender, parts = {}, received = 0 }
  elseif incomingItems.total ~= total or incomingItems.sender ~= sender then
    return -- inconsistent chunk for an in-progress snapshot; ignore rather than corrupt it
  end
  if not incomingItems.parts[index] then
    incomingItems.parts[index] = payload
    incomingItems.received = incomingItems.received + 1
  end
  if incomingItems.received < incomingItems.total then return end
  d.items = { updatedAt = updatedAt, list = decodeItems(table.concat(incomingItems.parts, ";")), from = sender }
  incomingItems = nil
end

local function receiveChunk(text, sender)
  local updatedAt, baseGp, index, total, payload = string.match(text, "^STAND|([^|]+)|(%d+)|(%d+)|(%d+)|(.*)$")
  index, total, baseGp = tonumber(index), tonumber(total), tonumber(baseGp)
  if not updatedAt or not index or not total or total < 1 or total > 50 then return end
  if index < 1 or index > total then return end
  if not ns.isOfficerName(sender) then return end
  if ns.util.tooFarAhead(updatedAt) then return end
  local s = standings()
  if s and s.updatedAt and s.updatedAt >= updatedAt then return end
  if not incoming or incoming.updatedAt ~= updatedAt then
    incoming = { updatedAt = updatedAt, baseGp = baseGp, total = total, sender = sender, parts = {}, received = 0 }
  elseif incoming.total ~= total or incoming.sender ~= sender or incoming.baseGp ~= baseGp then
    return -- inconsistent chunk for an in-progress snapshot; ignore rather than corrupt it
  end
  if not incoming.parts[index] then
    incoming.parts[index] = payload
    incoming.received = incoming.received + 1
  end
  if incoming.received < incoming.total then return end
  local players = {}
  for i = 1, incoming.total do
    for name, ep, gp in string.gmatch(incoming.parts[i] or "", "([^:;]+):(%-?%d+):(%-?%d+)") do
      ep, gp = tonumber(ep), tonumber(gp)
      players[name] = { ep = ep, gp = gp, pr = priority(ep, gp, incoming.baseGp) }
    end
  end
  local d = db()
  if d then d.standings = { updatedAt = updatedAt, baseGp = incoming.baseGp, players = players, from = sender } end
  incoming = nil
end

-- How each raid core decides loot, from the companion-written GuildedLoot (see Modules/Loot.lua).
local function cleanValues(source)
  local out = {}
  if type(source) == "table" then
    for key, gp in pairs(source) do
      if type(key) == "string" and tonumber(gp) then out[key] = math.floor(tonumber(gp)) end
    end
  end
  return out
end

local function adoptLootRules(file, updatedAt)
  local rules = {
    updatedAt = updatedAt, default = tostring(file.default or "EPGP"), minimumBid = tonumber(file.minimumBid) or 10,
    values = cleanValues(file.values), cores = {}
  }
  for _, core in ipairs(file.cores or {}) do
    if type(core) == "table" and type(core.name) == "string" then
      local baseGp = tonumber(core.baseGp) or 0
      local players = {}
      for _, row in ipairs(core.players or {}) do
        local name = ns.normalizeName(row.name)
        if name then
          local ep, gp = tonumber(row.ep) or 0, tonumber(row.gp) or 0
          players[name] = { ep = ep, gp = gp, pr = priority(ep, gp, baseGp) }
        end
      end
      table.insert(rules.cores, {
        id = tostring(core.id or ""), name = core.name, mode = tostring(core.mode or "EPGP"), pool = core.pool == true,
        reserves = tonumber(core.reserves) or 1, baseGp = baseGp, values = cleanValues(core.values), players = players,
        -- 4.6: the share of the price an off-spec win costs (percent) and the EP a player needs
        -- before priority counts them ahead of those below it.
        offspec = math.max(0, math.min(100, tonumber(core.offspec) or 50)), minEp = math.max(0, tonumber(core.minEp) or 0)
      })
    end
  end
  return rules
end

-- Adopt the companion-written Standings.lua if it is newer than the saved copy.
local function adoptFileStandings()
  local file = GuildedStandings
  local d = db()
  if not d or type(file) ~= "table" or type(file.updatedAt) ~= "string" then return false end
  if d.standings and d.standings.updatedAt and d.standings.updatedAt >= file.updatedAt then return false end
  local players = {}
  local baseGp = tonumber(file.baseGp) or 0
  for _, row in ipairs(file.players or {}) do
    local name = ns.normalizeName(row.name)
    if name then
      local ep, gp = tonumber(row.ep) or 0, tonumber(row.gp) or 0
      players[name] = { ep = ep, gp = gp, pr = priority(ep, gp, baseGp) }
    end
  end
  d.standings = { updatedAt = file.updatedAt, baseGp = baseGp, players = players, from = "companion" }
  -- Item tooltip data written next to the standings (none when nobody wishlisted anything yet).
  local items = {}
  if type(GuildedItems) == "table" then
    for key, row in pairs(GuildedItems) do
      if type(key) == "string" and type(row) == "table" then
        items[key] = { gp = tonumber(row.gp), n = tonumber(row.n) or 0, wn = tonumber(row.wn) or 0, wish = type(row.wish) == "table" and row.wish or {} }
      end
    end
  end
  d.items = { updatedAt = file.updatedAt, list = items, from = "companion" }
  if type(GuildedLoot) == "table" then d.lootRules = adoptLootRules(GuildedLoot, file.updatedAt) end
  return true
end

-- The loot systems and item prices per raid core (nil until the companion has sent them).
function ns.getLootRules()
  local d = db()
  return d and d.lootRules or nil
end

-- What the item tooltip shows for an item key (see Tooltip.lua): { gp, n, wn, wish } or nil.
function ns.getItemInsight(key)
  local d = db()
  return d and d.items and d.items.list and d.items.list[key] or nil
end

-- ---------------------------------------------------------------------
-- /guilded standings [player]
-- ---------------------------------------------------------------------

-- Why there is no standing for `name`: the three real cases, in words.
--   "none"    the standings have not arrived yet
--   "empty"   they arrived but the bot has no linked characters at all yet
--   "missing" they arrived and this character is not among them
-- Returns nil when the character has a standing.
local function standingProblem(name)
  local s = standings()
  if not s or not s.updatedAt then return "none" end
  local any = false
  for _ in pairs(s.players or {}) do any = true break end
  if not any then return "empty" end
  if not lookup(name) then return "missing" end
  return nil
end
ns.standingProblem = standingProblem

local PROBLEM_TEXT = {
  none = "Discord standings have not arrived yet. The companion on an officer's PC sends them within a couple of minutes; /reload loads the newest.",
  empty = "The bot has no linked characters yet. In Discord, everyone links theirs once: /character claim (or /setup > /setup config auto-import does it for you).",
  missing = "%s is not linked to a Discord member yet. In Discord run /character claim and pick it (or have an officer /character link it)."
}
function ns.standingProblemText(name)
  local problem = standingProblem(name)
  if not problem then return nil end
  return string.format(PROBLEM_TEXT[problem], name or "?")
end

-- Standalone guilds (no Discord bot): an officer shares the EPGP ledger kept on this PC as the
-- guild's standings. They travel like the bot's (STAND chunks, officers only); a newer
-- companion upload replaces them again.
function ns.publishLocalStandings()
  local d = db()
  if not d then return false, "no data" end
  if not (ns.isOfficer and ns.isOfficer()) then return false, "Officer or guild-master rank is required for this command." end
  local baseGp = (d.standings and d.standings.baseGp) or 0
  local players, count = {}, 0
  for name, account in pairs(d.epgp or {}) do
    local ep, gp = tonumber(account.ep) or 0, tonumber(account.gp) or 0
    if ep ~= 0 or gp ~= 0 then
      players[name] = { ep = ep, gp = gp, pr = priority(ep, gp, baseGp) }
      count = count + 1
    end
  end
  if count == 0 then return false, "Nothing to share: the ledger on this PC is empty." end
  d.standings = { updatedAt = date("!%Y-%m-%dT%H:%M:%S.000Z", ns.util.serverTime()), baseGp = baseGp, players = players, from = ns.playerName() .. " (in game)" }
  lastShareAt = 0
  shareStandings()
  return true, count
end

local function showStandings(args)
  if args[1] and string.lower(args[1]) == "publish" then
    local ok, result = ns.publishLocalStandings()
    ns.message(ok and string.format(ns.L and ns.L("Shared the standings of %d players from this PC's ledger with the guild.") or "Shared the standings of %d players from this PC's ledger with the guild.", result) or tostring(result))
    return
  end
  local s = standings()
  if not s or not s.updatedAt then
    ns.message(PROBLEM_TEXT.none)
    return
  end
  if args[1] then
    local row = lookup(args[1])
    if row then
      local source = (s.from and string.find(s.from, "(in game)", 1, true)) and s.from or "Discord"
      ns.message(string.format("%s: EP %d, GP %d, PR %.2f (%s, %s)", ns.normalizeName(args[1]), row.ep, row.gp, row.pr, source, s.updatedAt))
    else
      ns.message(ns.standingProblemText(ns.normalizeName(args[1])) or "No standing.")
    end
    return
  end
  local rows = {}
  for name, row in pairs(s.players) do table.insert(rows, { name = name, row = row }) end
  table.sort(rows, function(a, b) return a.row.pr > b.row.pr end)
  ns.message(string.format("EPGP standings from Discord (%s):", s.updatedAt))
  for i = 1, math.min(10, #rows) do
    local r = rows[i]
    ns.message(string.format("%d. %s  PR %.2f  (EP %d / GP %d)", i, r.name, r.row.pr, r.row.ep, r.row.gp))
  end
  if #rows > 10 then ns.message("/guilded standings <player> for anyone else.") end
end

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["standings"] = showStandings
ns.commandHandlers["version"] = function() ns.message("Guilded version " .. myVersion .. ".") end
-- Who runs which version (this session). Messages are "KIND|field|..." and
-- every receiver ignores kinds and trailing fields it doesn't know, so an
-- older addon keeps working next to a newer one; this shows who is behind.
ns.commandHandlers["peers"] = function()
  local names = {}
  for name in pairs(peerVersions) do table.insert(names, name) end
  table.sort(names)
  if #names == 0 then
    ns.message("No guildmate with the addon has announced a version yet this session.")
    return
  end
  local behind = 0
  local parts = {}
  for _, name in ipairs(names) do
    local theirs = peerVersions[name]
    local old = versionNewer(myVersion, theirs)
    if old then behind = behind + 1 end
    table.insert(parts, name .. " " .. theirs .. (old and " (older)" or ""))
  end
  ns.message(string.format("%d addon user(s) seen, you run %s, %d older: %s", #names, myVersion, behind, table.concat(parts, ", ")))
end
ns.peerVersions = function() return peerVersions end
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded peers - which guildmates run which addon version (this session)")
ns.getStanding = lookup
ns.getStandingsUpdatedAt = function()
  local s = standings()
  return s and s.updatedAt
end

-- ---------------------------------------------------------------------
-- Guild module switches (/guilded modules guild off casino). Officers share
-- them; everyone keeps the newest one an officer sent.
-- MODS|<updatedAt>|<by>|<comma-separated keys that are off>
-- ---------------------------------------------------------------------

local function guildModules()
  local settings = ns.getSettings and ns.getSettings()
  return settings and settings.guildModules
end

local MODS_REPLY_COOLDOWN_SECONDS = 300
local modsAnsweredAt = {}

local function shareModules(channel, target)
  local g = guildModules()
  if not g or not g.updatedAt then return end
  local off = {}
  for key, isOff in pairs(g.off or {}) do if isOff then table.insert(off, key) end end
  table.sort(off)
  send(string.format("MODS|%d|%s|%s", g.updatedAt, g.by or "?", table.concat(off, ",")), channel, target)
end

ns.onGuildModulesChanged = function() shareModules("GUILD") end

local function receiveModules(text, sender)
  if not ns.isOfficerName(sender) then return end
  local updatedAt, by, list = string.match(text, "^MODS|(%d+)|([^|]*)|(.*)$")
  updatedAt = tonumber(updatedAt)
  if not updatedAt or not ns.applyGuildModules then return end
  local off, names = {}, {}
  for key in string.gmatch(list or "", "[%a]+") do
    off[key] = true
    table.insert(names, ns.moduleName and ns.moduleName(key) or key)
  end
  if not ns.applyGuildModules(off, updatedAt, by ~= "" and by or sender) then return end
  ns.message("Guild module settings from " .. (by ~= "" and by or sender) .. ": " .. (#names > 0 and ("off: " .. table.concat(names, ", ")) or "everything on") .. ". /guilded modules for details.")
  for _, module in ipairs(ns.MODULES or {}) do
    if ns.moduleEnabled(module.key) and not ns.moduleActive(module.key) then
      ns.message(module.name .. " was turned back on - /reload to start it.")
    end
  end
  if ns.onModulesChange then pcall(ns.onModulesChange) end
end

-- ---------------------------------------------------------------------
-- Events
-- ---------------------------------------------------------------------

local started = false

local function onEvent(_, event, ...)
  if event == "PLAYER_ENTERING_WORLD" then
    if started then return end
    started = true
    myVersion = getMetadata("Version") or "0"
    ns.comm.register(PREFIX)
    local adopted = adoptFileStandings()
    -- Wait for the guild channel to be ready before talking on it.
    after(STARTUP_DELAY_SECONDS, function()
      send("VERSION|" .. myVersion, "GUILD")
      local s = standings()
      send("STANDREQ|" .. ((s and s.updatedAt) or "0"), "GUILD")
      local g = guildModules()
      send("MODSREQ|" .. ((g and g.updatedAt) or 0), "GUILD")
      if adopted and ns.isOfficer() then shareStandings() end
    end)
  elseif event == "CHAT_MSG_ADDON" then
    local prefix, text, channel, sender = ...
    if ns.isSecret(prefix) or ns.isSecret(text) or ns.isSecret(sender) or prefix ~= PREFIX then return end
    sender = ns.normalizeName(sender)
    if not sender or sender == ns.playerName() then return end
    local kind = string.match(text, "^(%u+)|")
    if kind == "VERSION" then
      local theirs = string.match(text, "^VERSION|(.+)$")
      if theirs then peerVersions[sender] = theirs end
      if versionNewer(theirs, myVersion) and not warnedNewer then
        warnedNewer = true
        ns.message("A newer Guilded (" .. theirs .. ") is out - you have " .. myVersion .. ". Grab it from the guild's download link.")
      elseif versionNewer(myVersion, theirs) and channel == "GUILD" and not repliedTo[sender] then
        -- Tell the outdated player directly, once per session.
        repliedTo[sender] = true
        send("VERSION|" .. myVersion, "WHISPER", sender)
      end
    elseif kind == "STANDREQ" then
      local theirs = string.match(text, "^STANDREQ|(.+)$") or "0"
      local s = standings()
      if ns.isOfficer() and s and s.updatedAt and s.updatedAt > theirs then shareStandings() end
    elseif kind == "STAND" then
      receiveChunk(text, sender)
    elseif kind == "ITEM" then
      receiveItemChunk(text, sender)
    elseif kind == "MODSREQ" then
      local theirs = tonumber(string.match(text, "^MODSREQ|(%d+)$")) or 0
      local g = guildModules()
      -- One answer per requester every few minutes, so a login storm or a
      -- misbehaving peer cannot make an officer spam whispers.
      local nowTime = time()
      if modsAnsweredAt[sender] and nowTime - modsAnsweredAt[sender] < MODS_REPLY_COOLDOWN_SECONDS then return end
      if ns.isOfficer() and g and (g.updatedAt or 0) > theirs then modsAnsweredAt[sender] = nowTime end
      if ns.isOfficer() and g and (g.updatedAt or 0) > theirs then shareModules("WHISPER", sender) end
    elseif kind == "MODS" then
      receiveModules(text, sender)
    end
  end
end

local frame = CreateFrame("Frame")
frame:RegisterEvent("PLAYER_ENTERING_WORLD")
frame:RegisterEvent("CHAT_MSG_ADDON")
frame:SetScript("OnEvent", function(...)
  local ok, err = pcall(onEvent, ...)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "Guilded sync: " .. tostring(err)) end
end)
