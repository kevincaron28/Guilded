-- Speed recorder (opt-in, local only): how long Guilded's own work takes on this PC, to find
-- what makes a raid night or a sync feel slow. Nothing is saved or sent; /reload empties it.
--
--   /guilded perf on | off       start / stop recording
--   /guilded perf                show the slowest operations
--   /guilded perf copy           the same as text to copy into a bug report
--   /guilded perf clear          forget what was recorded
--
-- Records Guilded's event handler per event (Core.lua), each /guilded command, and the addon
-- messages each Guilded prefix sent. Bounded: 100 kinds of operation, the last 50 slow ones.
local addonName, ns = ...
ns = ns or {}

local MAX_KINDS = 100
local MAX_SLOW = 50
local SLOW_MS = 16 -- longer than one frame at 60 fps

local perf = { active = false }
ns.perf = perf

local stats, slow, kinds, startedAt = {}, {}, 0, nil

local function L(text) return ns.L and ns.L(text) or text end
local function clock() return debugprofilestop and debugprofilestop() or 0 end

-- One timing for an operation ("event:CHAT_MSG_ADDON", "command:reserve").
function perf.record(name, ms)
  -- The recorder's own command is left out, so "perf clear" leaves it empty.
  if not perf.active or type(ms) ~= "number" or name == "command:perf" then return end
  local s = stats[name]
  if not s then
    if kinds >= MAX_KINDS then return end
    s = { count = 0, total = 0, max = 0 }
    stats[name] = s
    kinds = kinds + 1
  end
  s.count, s.total = s.count + 1, s.total + ms
  if ms > s.max then s.max = ms end
  if ms >= SLOW_MS then
    table.insert(slow, { name = name, ms = ms, at = ns.now and ns.now() or "" })
    while #slow > MAX_SLOW do table.remove(slow, 1) end
  end
end

-- Runs fn and records how long it took (errors still propagate to the caller's pcall).
function perf.measure(name, fn, ...)
  if not perf.active then return fn(...) end
  local started = clock()
  local results = { pcall(fn, ...) }
  perf.record(name, clock() - started)
  if not results[1] then error(results[2], 0) end
  return unpack(results, 2)
end

function perf.clear()
  stats, slow, kinds = {}, {}, 0
  startedAt = perf.active and (ns.now and ns.now()) or nil
end

-- The report: slowest operations by total time, then the latest slow ones, then message counts.
function perf.lines(limit)
  local rows = {}
  for name, s in pairs(stats) do table.insert(rows, { name = name, s = s }) end
  table.sort(rows, function(a, b) return a.s.total > b.s.total end)
  local out = { string.format(L("Speed recorder: %s since %s, %d kind(s) of operation."), perf.active and L("on") or L("off"), startedAt or "-", #rows) }
  for i = 1, math.min(limit or 15, #rows) do
    local r = rows[i]
    table.insert(out, string.format("  %s: %d x, %.1f ms total, %.1f ms average, %.1f ms max", r.name, r.s.count, r.s.total, r.s.total / r.s.count, r.s.max))
  end
  if #slow > 0 then
    table.insert(out, string.format(L("Slowest moments (over %d ms):"), SLOW_MS))
    for i = math.max(1, #slow - 9), #slow do table.insert(out, string.format("  %s %s %.1f ms", slow[i].at, slow[i].name, slow[i].ms)) end
  end
  if ns.comm and ns.comm.status then
    for _, prefix in ipairs(perf.prefixes or {}) do
      local c = ns.comm.status(prefix)
      if c.sent + c.throttled + c.queued > 0 then
        table.insert(out, string.format("  %s: %d sent, %d throttled, %d waiting", prefix, c.sent, c.throttled, c.queued))
      end
    end
  end
  return out
end

-- Guilded's prefixes, for the message counts (modules keep their own; these are the busy ones).
perf.prefixes = { "Guilded", "GuildedLedger", "GuildedRes", "GuildedBid", "GuildedRcp", "GuildedLC", "GuildedDgn", "GuildedRec" }

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["perf"] = function(args)
  local action = string.lower(args[1] or "")
  if action == "on" then
    perf.active = true
    perf.clear()
    ns.message(L("Speed recorder on. Play normally, then /guilded perf to see what took time. Nothing is saved or sent."))
  elseif action == "off" then
    perf.active = false
    ns.message(L("Speed recorder off. /guilded perf still shows what it recorded until /reload."))
  elseif action == "clear" then
    perf.clear()
    ns.message(L("Speed recorder cleared."))
  elseif action == "copy" then
    if ns.showCopyText then ns.showCopyText(table.concat(perf.lines(40), "\n"), L("Guilded speed recorder")) end
  else
    for _, line in ipairs(perf.lines(15)) do ns.message(line) end
  end
end
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded perf on | off | copy | clear - record how long Guilded's work takes on this PC")
