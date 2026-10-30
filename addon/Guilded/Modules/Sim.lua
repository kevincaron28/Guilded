-- Test raid for officers: WoW Forever has no raids yet, so this plays a
-- fake one through the real addon commands (start, attendance, boss kills,
-- loot, end) with made-up raiders. The names match the bot's /setup testraid, so
-- exporting this raid and running the companion lines up with a Discord
-- test raid started around the same time.
--
-- Everything is marked test = true and /guilded sim clear removes it, including
-- any EP/GP it recorded. Saved tests can sync to Discord as test records.
local addonName, ns = ...
ns = ns or {}
local function L(text) return ns.L and ns.L(text) or text end

local SIM_NAMES = { "Testalpha", "Testbravo", "Testcharlie", "Testdelta", "Testecho", "Testfoxtrot",
  "Testgolf", "Testhotel", "Testindia", "Testjuliet" }
local SIM_BOSSES = { "Test Boss One", "Test Boss Two", "Test Boss Three" }
ns.SIM_NAMES = SIM_NAMES

local function db() return ns.getDb and ns.getDb() end
local clearSimDungeons -- defined with /guilded sim dungeon below

local function simStart()
  local raid = ns.getActiveRaid and ns.getActiveRaid()
  if raid then ns.message("A raid is already active (" .. raid.title .. "). /guilded end it first."); return end
  ns.runCommand("start [TEST] Simulated raid")
  raid = ns.getActiveRaid()
  if not raid then return end
  raid.test = true
  -- Everyone "was in the group" except Testindia (the no-show).
  local d = db()
  d.presence[raid.id] = d.presence[raid.id] or {}
  for _, name in ipairs(SIM_NAMES) do
    if name ~= "Testindia" then d.presence[raid.id][name] = { firstSeen = ns.now(), lastSeen = ns.now(), test = true } end
  end
  ns.runCommand("attendance Testbravo LATE")
  ns.message("Test raid started with " .. (#SIM_NAMES - 1) .. " fake raiders in the group. Try the Raid and EPGP tabs, then /guilded sim end.")
end

local function simEnd()
  local raid = ns.getActiveRaid and ns.getActiveRaid()
  if not raid or not raid.test then ns.message("No test raid running. /guilded sim start first."); return end
  for _, boss in ipairs(SIM_BOSSES) do ns.runCommand("boss " .. boss) end
  ns.runCommand("attendance seen")
  ns.runCommand("loot Testcharlie [Test Helm of Testing] 30")
  ns.runCommand("gp Testcharlie 30 Test Helm of Testing")
  ns.runCommand("end")
  ns.message("Test raid ended. /reload to save it; the companion will send it to Discord. /guilded sim clear removes it.")
end

-- Removes every test raid and everything recorded during one.
local function simClear()
  local d = db()
  if not d then return end
  if ns.getActiveRaid and ns.getActiveRaid() and ns.getActiveRaid().test then ns.runCommand("end") end
  local testIds = {}
  for i = #d.raids, 1, -1 do
    local raid = d.raids[i]
    if raid.test then
      testIds[raid.id] = true
      table.remove(d.raids, i)
    end
  end
  local removedEntries = 0
  for id in pairs(testIds) do
    d.attendance[id] = nil
    d.presence[id] = nil
    d.bosses[id] = nil
  end
  for i = #d.loot, 1, -1 do
    if d.loot[i].raid and testIds[d.loot[i].raid] then table.remove(d.loot, i) end
  end
  for _, account in pairs(d.epgp) do
    for i = #account.ledger, 1, -1 do
      local entry = account.ledger[i]
      if entry.raid and testIds[entry.raid] then
        account.ep = account.ep - (entry.epAmount or 0)
        account.gp = account.gp - (entry.gpAmount or 0)
        table.remove(account.ledger, i)
        removedEntries = removedEntries + 1
      end
    end
  end
  -- Fake raiders with nothing left are dropped entirely.
  for _, name in ipairs(SIM_NAMES) do
    local account = d.epgp[name]
    if account and #account.ledger == 0 then d.epgp[name] = nil end
    d.roster[name] = nil
  end
  local count = 0
  for _ in pairs(testIds) do count = count + 1 end
  local dungeons = clearSimDungeons(d)
  ns.message(string.format(L("Removed %d test raid(s), %d EP/GP entries and %d test dungeon run(s)."), count, removedEntries, dungeons))
end

-- A finished fake dungeon run (you + 4 fake players) saved like a real
-- one, so the export, the bot's points and records can be tested without
-- running a dungeon. Same made-up dungeon and SIM- id as the bot's
-- /setup testraid dungeon, so /setup testraid cleanup removes it on the Discord side.
-- Not shared with the guild.
local SIM_DUNGEON_ID, SIM_DUNGEON_NAME = 999001, "Test Dungeon"
local function simDungeon(minutesArg)
  local root = db()
  if not root then return end
  root.dungeon = root.dungeon or {}
  root.dungeon.runs = root.dungeon.runs or {}
  local minutes = tonumber(minutesArg) or (20 + math.random(0, 10))
  if minutes < 1 or minutes > 300 then ns.message("Minutes must be from 1 to 300."); return end
  local ended = GetServerTime and GetServerTime() or time()
  local duration = math.floor(minutes * 60)
  local id = string.format("SIM-%d-%s", ended, ns.playerName())
  local roles = { "TANK", "HEALER", "DPS", "DPS", "DPS" }
  local players = { [ns.playerName()] = { role = roles[1], deaths = 0, presentSec = duration, inGuild = true, addon = true } }
  for index = 1, 4 do
    local deaths = 0
    if index == 2 then deaths = 1 end
    if index == 4 then deaths = nil end -- no addon: deaths unknown
    players[SIM_NAMES[index]] = { role = roles[index + 1], deaths = deaths, presentSec = duration, inGuild = true }
  end
  root.dungeon.runs[id] = {
    id = id, protocolVersion = 1, addonVersion = ns.compat and ns.compat.addonVersion() or nil, state = "COMPLETED", test = true,
    instanceId = SIM_DUNGEON_ID, name = SIM_DUNGEON_NAME, difficultyId = 1,
    startedAt = ended - duration, endedAt = ended, durationSec = duration,
    completedBy = "boss", recorder = ns.playerName(), reporters = { [ns.playerName()] = true },
    encounters = {}, players = players
  }
  ns.message(string.format(L("Test dungeon run saved (%d:%02d, you + %s). /reload so the companion sends it; an officer runs /import apply. /guilded sim clear removes it here, /setup testraid cleanup in Discord."),
    math.floor(duration / 60), duration % 60, table.concat({ SIM_NAMES[1], SIM_NAMES[2], SIM_NAMES[3], SIM_NAMES[4] }, ", ")))
end

clearSimDungeons = function(root)
  local removed = 0
  if root and root.dungeon and root.dungeon.runs then
    for id, run in pairs(root.dungeon.runs) do
      if run.test or string.sub(id, 1, 4) == "SIM-" then
        if ns.runResults and ns.runResults.remove then ns.runResults.remove(id) end
        root.dungeon.runs[id] = nil; removed = removed + 1
      end
    end
  end
  return removed
end


ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["sim"] = function(args)
  if not ns.isOfficer() then ns.message("Only officers can run test raids."); return end
  local action = string.lower(args[1] or "")
  if action == "start" then simStart()
  elseif action == "end" then simEnd()
  elseif action == "clear" then simClear()
  elseif action == "dungeon" then
    if ns.moduleActive and not ns.moduleActive("dungeon") then ns.message("The Dungeons module is off (/guilded modules)."); return end
    simDungeon(args[2])
  elseif action == "bids" then
    if ns.moduleActive and not ns.moduleActive("bidding") then ns.message("GP bidding is off (/guilded modules).")
    elseif ns.simulateBids then ns.simulateBids() else ns.message("GP bidding is not loaded.") end
  elseif action == "council" then
    if ns.moduleActive and not ns.moduleActive("council") then ns.message("Loot council is off (/guilded modules).")
    elseif ns.simulateCouncil then ns.simulateCouncil() else ns.message("Loot council is not loaded.") end
  else
    ns.message("/guilded sim start | end | bids (fake bids on open bidding) | council (fake answers) | dungeon [minutes] | clear")
  end
end
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, { officer = true, text = "/guilded sim start|end|bids|council|dungeon|clear - test raid or dungeon run with fake players" })
