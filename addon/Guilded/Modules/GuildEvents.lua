-- Guild events feed (9.4.9): who joined, left or changed rank, read from the guild roster the addon already takes (GuildSnapshot),
-- so it needs no extra game call and is never refused. A short chat line for each (a few at a time, never in guild chat), and a
-- list of the recent ones kept in this guild's saved data.
--
--   /guilded events   the recent events in a list window (newest first)
-- On by default; a member turns it off in Settings (Chat: "Guild events") or with /guilded modules off guildevents.
--
-- Rules that keep it honest: the first roster of a guild is only a baseline; a roster older than 3 days is a new baseline; a read that
-- shows a third of the guild coming or going is a bad read and is skipped; a partial roster (offline members hidden) never counts.
local addonName, ns = ...
ns = ns or {}

local events = {}
ns.guildEvents = events

local MAX_KEPT = 200
local KEEP_SECONDS = 60 * 86400
local BASELINE_MAX_AGE = 3 * 86400
local MAX_LINES_AT_ONCE = 3
local BAD_READ_FRACTION = 0.34

local function L(text) return ns.L and ns.L(text) or text end
local function clock() return ns.util and ns.util.serverTime and ns.util.serverTime() or (time and time()) or 0 end
local function display(name) return ns.displayName and ns.displayName(name) or name end

local function active()
  return not ns.moduleActive or ns.moduleActive("guildevents")
end

local function store()
  local db = ns.getDb and ns.getDb()
  if not db then return nil end
  if type(db.guildEvents) ~= "table" then db.guildEvents = {} end
  if type(db.guildEvents.list) ~= "table" then db.guildEvents.list = {} end
  return db.guildEvents
end

local function line(event)
  local who = display(event.name)
  if event.kind == "join" then return string.format(L("%s joined the guild."), who) end
  if event.kind == "leave" then return string.format(L("%s left the guild."), who) end
  if event.kind == "promote" then return string.format(L("%s was promoted to %s."), who, event.to or "?") end
  if event.kind == "demote" then return string.format(L("%s was moved to %s."), who, event.to or "?") end
  return who
end
events.line = line

local function trim(list, now)
  local cutoff = now - KEEP_SECONDS
  for i = #list, 1, -1 do
    if type(list[i]) ~= "table" or (tonumber(list[i].at) or 0) < cutoff then table.remove(list, i) end
  end
  while #list > MAX_KEPT do table.remove(list, 1) end
end

local function sorted(map)
  local names = {}
  for name in pairs(map) do names[#names + 1] = name end
  table.sort(names)
  return names
end

-- What changed between two snapshots of the same guild: { kind, name, from, to } rows, or nil when the pair cannot be compared.
function events.diff(old, new, now)
  if type(old) ~= "table" or type(new) ~= "table" or type(old.members) ~= "table" or type(new.members) ~= "table" then return nil end
  if old.complete ~= true or new.complete ~= true then return nil end
  local oldAt = tonumber(old.at)
  if not oldAt or now - oldAt > BASELINE_MAX_AGE or now < oldAt then return nil end
  local oldCount, joins, leaves = 0, {}, {}
  for _ in pairs(old.members) do oldCount = oldCount + 1 end
  if oldCount < 2 then return nil end
  for name in pairs(new.members) do if not old.members[name] then joins[name] = true end end
  for name in pairs(old.members) do if not new.members[name] then leaves[name] = true end end
  local churn = 0
  for _ in pairs(joins) do churn = churn + 1 end
  for _ in pairs(leaves) do churn = churn + 1 end
  if churn > math.max(4, math.floor(oldCount * BAD_READ_FRACTION)) then return nil end
  local out = {}
  for _, name in ipairs(sorted(joins)) do out[#out + 1] = { kind = "join", name = name } end
  for _, name in ipairs(sorted(leaves)) do out[#out + 1] = { kind = "leave", name = name } end
  for _, name in ipairs(sorted(new.members)) do
    local was, now_ = old.members[name], new.members[name]
    if was and type(was) == "table" and type(now_) == "table" and was.rankIndex and now_.rankIndex and was.rankIndex ~= now_.rankIndex then
      out[#out + 1] = { kind = now_.rankIndex < was.rankIndex and "promote" or "demote", name = name, from = was.rankName, to = now_.rankName }
    end
  end
  return out
end

-- Called by GuildSnapshot.read just before the new snapshot replaces the old one.
function events.onSnapshot(old, new, now)
  if not active() then return end
  local s = store()
  if not s then return end
  now = tonumber(now) or clock()
  local changes = events.diff(old, new, now)
  if not changes or #changes == 0 then return end
  local mine = ns.normalizeName and UnitName and ns.normalizeName((UnitName("player"))) or nil
  local shown = 0
  for _, change in ipairs(changes) do
    change.at = now
    s.list[#s.list + 1] = change
    if change.name ~= mine then
      shown = shown + 1
      if shown <= MAX_LINES_AT_ONCE then ns.message(line(change)) end
    end
  end
  if shown > MAX_LINES_AT_ONCE then
    ns.message(string.format(L("More guild changes (%d): /guilded events lists them."), shown - MAX_LINES_AT_ONCE))
  end
  trim(s.list, now)
end

-- The recent events as text, newest first.
function events.text()
  local s = store()
  local list = s and s.list or {}
  if #list == 0 then return L("No guild changes seen yet. They are noticed while you are logged in.") end
  local rows = {}
  for i = #list, 1, -1 do
    local e = list[i]
    if type(e) == "table" then
      rows[#rows + 1] = (date and date("%Y-%m-%d %H:%M", tonumber(e.at) or 0) or "") .. "  " .. line(e)
    end
  end
  return table.concat(rows, "\n")
end

function events.show()
  if ns.showCopyText then ns.showCopyText(events.text(), L("Guilded - recent guild events")) else ns.message(events.text()) end
end

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["events"] = function() events.show() end
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded events - who joined, left or changed rank in the guild recently (your own switch: /guilded modules off guildevents)")
