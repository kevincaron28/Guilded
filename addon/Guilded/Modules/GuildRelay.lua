-- Guildmate relay (8.5, Track K): addon-only members still reach Discord.
--
-- A member who never installs the companion already tells the guild who they are (level, class,
-- race, professions in Core.lua's READINESS digest) and their finished dungeon runs (Dungeon.lua's
-- SUM). Every guildmate's addon keeps those under the sender's name (the game says who sent it),
-- and any guildmate's companion uploads them; the bot accepts them as "reported by a guildmate"
-- and never lets them link a character or replace newer first-hand data (docs/ADDON_ONLY_SYNC.md).
--
-- This module adds what other guild addons do and Guilded lacked:
--   * HI|<protocol>|<carrier 0/1>|<addon version> on GUILD at login (and every 15 minutes from a
--     carrier): a sync protocol check with a "please update" line, and which guildmates have a
--     working companion ("carriers") so a member sees "Synced via Lebowski, 2 h ago".
--   * Stale pruning: guildmates' digests not refreshed in 45 days are dropped, with a visible age.
--   * Sent through ns.comm's "hold-in-instance" lane: held inside dungeons, raids and battlegrounds.
-- Older addons ignore the unknown prefix, so nothing changes for them.
local addonName, ns = ...
ns = ns or {}

local PREFIX = "GuildedRly"
local PROTOCOL = 1
local STARTUP_DELAY_SECONDS = 25
local CARRIER_EVERY_SECONDS = 15 * 60
local CARRIER_KEEP_SECONDS = 14 * 86400
local PEER_STALE_SECONDS = 45 * 86400
local MAX_CARRIERS = 50

local relay = { protocols = {}, warned = false }
ns.relay = relay
relay.PROTOCOL = PROTOCOL
relay.PEER_STALE_SECONDS = PEER_STALE_SECONDS

local function L(text) return ns.L and ns.L(text) or text end
local function now() return (GetServerTime and GetServerTime()) or time() end

local function guildKey()
  return ns.currentGuildKey and ns.currentGuildKey() or nil
end

-- Saved state for the current guild only; a guild change starts over.
local function state()
  local d = ns.getDb and ns.getDb()
  if not d then return nil end
  local key = guildKey()
  if type(d.relay) ~= "table" or d.relay.guild ~= key then d.relay = { guild = key, carriers = {} } end
  d.relay.carriers = type(d.relay.carriers) == "table" and d.relay.carriers or {}
  return d.relay, d
end

-- This PC's companion is connected for this guild: it wrote Standings.lua and that copy is the
-- newest guild data this client knows (a stopped companion's file falls behind relayed copies).
function relay.isCarrier()
  local file = GuildedStandings
  if type(file) ~= "table" or type(file.updatedAt) ~= "string" or file.updatedAt == "" then return false end
  local d = ns.getDb and ns.getDb()
  local mine = d and d.standings
  return not (mine and type(mine.updatedAt) == "string" and mine.updatedAt > file.updatedAt)
end

-- "5 min", "2 h", "3 d": short, the same in every language but the unit words.
function relay.ageText(seconds)
  seconds = math.max(0, math.floor(tonumber(seconds) or 0))
  if seconds < 90 then return L("just now") end
  if seconds < 5400 then return string.format(L("%d min ago"), math.floor(seconds / 60 + 0.5)) end
  if seconds < 36 * 3600 then return string.format(L("%d h ago"), math.floor(seconds / 3600 + 0.5)) end
  return string.format(L("%d d ago"), math.floor(seconds / 86400 + 0.5))
end

local function send(text)
  if not (IsInGuild and IsInGuild()) then return end
  local key = guildKey()
  ns.comm.send(PREFIX, text, "GUILD", nil, function() return guildKey() == key end, "hold-in-instance")
end

function relay.announce()
  send(string.format("HI|%d|%d|%s", PROTOCOL, relay.isCarrier() and 1 or 0,
    (string.gsub(tostring(ns.addonVersion and ns.addonVersion() or "0"), "[|%c]", ""))))
end

-- Drops guildmates' digests nobody refreshed in 45 days and carriers silent for 14 days.
-- Returns how many digests were dropped.
function relay.prune()
  local saved, d = state()
  if not saved then return 0 end
  local cutoff, dropped = now() - PEER_STALE_SECONDS, 0
  for name, entry in pairs(d.peerRoster or {}) do
    if type(entry) ~= "table" or (tonumber(entry.seenAt) and entry.seenAt < cutoff) then
      d.peerRoster[name] = nil
      dropped = dropped + 1
    end
  end
  local carrierCutoff = now() - CARRIER_KEEP_SECONDS
  for name, entry in pairs(saved.carriers) do
    if type(entry) ~= "table" or (tonumber(entry.heardAt) or 0) < carrierCutoff then saved.carriers[name] = nil end
  end
  return dropped
end

-- Who last carried this member's data, as far as this client can tell: the most recent
-- guildmate with a working companion heard while both were online (their next sync uploads the
-- digest this client keeps sending). nil when this PC is a carrier itself or none was heard.
function relay.via()
  local saved = state()
  if not saved or relay.isCarrier() then return nil end
  local best
  for name, entry in pairs(saved.carriers) do
    if type(entry) == "table" and tonumber(entry.heardAt) and (not best or entry.heardAt > best.heardAt) then
      best = { name = name, heardAt = entry.heardAt }
    end
  end
  return best
end

-- "Synced via Lebowski, 2 h ago." or nil.
function relay.viaText()
  local best = relay.via()
  if not best then return nil end
  local shown = ns.displayName and ns.displayName(best.name) or best.name
  return string.format(L("Synced via %s, %s."), shown, relay.ageText(now() - best.heardAt))
end

function relay.handle(text, sender)
  local protocol, carrier, version = string.match(text, "^HI|(%d+)|([01])|([^|]*)")
  protocol = tonumber(protocol)
  if not protocol then return end
  relay.protocols[sender] = { protocol = protocol, version = string.sub(version or "", 1, 20) }
  if protocol > PROTOCOL and not relay.warned then
    relay.warned = true
    ns.message(string.format(L("%s runs a newer Guilded sync (%s). Please update Guilded so your data keeps reaching Discord."),
      ns.displayName and ns.displayName(sender) or sender, version ~= "" and version or ("protocol " .. protocol)))
  end
  local saved = state()
  if not saved then return end
  if carrier == "1" then
    local count = 0
    for _ in pairs(saved.carriers) do count = count + 1 end
    if saved.carriers[sender] or count < MAX_CARRIERS then
      saved.carriers[sender] = { heardAt = now(), version = string.sub(version or "", 1, 20) }
    end
  else
    saved.carriers[sender] = nil
  end
end

local function status()
  local saved, d = state()
  if not saved then return end
  ns.message(string.format(L("Guild sync protocol %d. Companion on this PC: %s."), PROTOCOL,
    relay.isCarrier() and L("connected (you carry guildmates' data)") or L("not connected")))
  local viaText = relay.viaText()
  if viaText then ns.message(viaText)
  elseif not relay.isCarrier() then
    ns.message(L("No guildmate with a connected companion seen yet. Your data reaches Discord when one is online with you."))
  end
  local names = {}
  for name, entry in pairs(saved.carriers) do
    table.insert(names, { name = name, heardAt = tonumber(entry.heardAt) or 0 })
  end
  table.sort(names, function(a, b) return a.heardAt > b.heardAt end)
  if #names > 0 then
    local parts = {}
    for index = 1, math.min(8, #names) do
      local shown = ns.displayName and ns.displayName(names[index].name) or names[index].name
      table.insert(parts, shown .. " (" .. relay.ageText(now() - names[index].heardAt) .. ")")
    end
    ns.message(L("Guildmates with a companion:") .. " " .. table.concat(parts, ", "))
  end
  local held, oldest = 0, nil
  for _, entry in pairs(d.peerRoster or {}) do
    held = held + 1
    local seen = type(entry) == "table" and tonumber(entry.seenAt)
    if seen and (not oldest or seen < oldest) then oldest = seen end
  end
  if held > 0 then
    ns.message(string.format(L("Guildmates' data held here: %d, oldest %s (dropped after 45 days)."), held, relay.ageText(now() - (oldest or now()))))
  end
  local older = {}
  for name, peer in pairs(relay.protocols) do
    if peer.protocol < PROTOCOL then table.insert(older, ns.displayName and ns.displayName(name) or name) end
  end
  table.sort(older)
  if #older > 0 then ns.message(L("Older Guilded (please update):") .. " " .. table.concat(older, ", ")) end
end
relay.status = status

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["relay"] = function() status() end
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded relay - which guildmate's companion carries your data to Discord, and data ages")

local started, lastCarrierAt = false, 0
local function after(seconds, fn)
  if C_Timer and C_Timer.After then C_Timer.After(seconds, fn) end
end
local function heartbeat()
  after(CARRIER_EVERY_SECONDS, function()
    pcall(function()
      if relay.isCarrier() and now() - lastCarrierAt >= CARRIER_EVERY_SECONDS - 5 then
        lastCarrierAt = now()
        relay.announce()
      end
    end)
    heartbeat()
  end)
end

local frame = CreateFrame("Frame")
frame:RegisterEvent("PLAYER_ENTERING_WORLD")
frame:RegisterEvent("CHAT_MSG_ADDON")
frame:SetScript("OnEvent", function(_, event, ...)
  local args = { ... }
  local ok, err = pcall(function()
    if event == "PLAYER_ENTERING_WORLD" then
      if started then return end
      started = true
      ns.comm.register(PREFIX)
      after(STARTUP_DELAY_SECONDS, function()
        pcall(relay.prune)
        lastCarrierAt = now()
        relay.announce()
        heartbeat()
      end)
    elseif event == "CHAT_MSG_ADDON" then
      local prefix, text, channel, sender = args[1], args[2], args[3], args[4]
      if not ns.comm.accept(prefix, text, channel, sender, PREFIX, function(author, delivery)
        return delivery == "GUILD" and ns.comm.authorized(author, "guild")
      end) then return end
      sender = ns.normalizeName(sender)
      if not sender or sender == ns.playerName() then return end
      relay.handle(text, sender)
    end
  end)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "Guilded relay: " .. tostring(err)) end
end)
