-- The guild calendar, both ways.
--
--   /guilded calendar check         does this game client's calendar work for addons? (read only)
--   /guilded calendar sync          read the guild's calendar events and who answered each one; the
--                                   companion sends them to Discord, where they fill in raid signups
--                                   (Discord stays the official list: an existing signup is never changed)
--   /guilded calendar list          the upcoming raids from Discord and whether they are in the game calendar
--   /guilded calendar create [n]    make an in-game guild event for the next (or nth) Discord raid
--
-- Creating an event needs a real click in some clients: the Calendar tab of the window has a button
-- for it. Everything here is guarded, so a client without the calendar API just says so.
local addonName, ns = ...
ns = ns or {}

local DAYS_AHEAD = 14
local SYNC_DAYS_AHEAD = 30
local WAIT_SECONDS = 3

local waiting = false

local function has(name)
  return C_Calendar ~= nil and type(C_Calendar[name]) == "function"
end

-- Calendar day in `days` from `today` ({ year, month, monthDay }).
local function addDays(today, days)
  local t = time({ year = today.year, month = today.month, day = today.monthDay, hour = 12 }) + days * 86400
  local d = date("*t", t)
  return { year = d.year, month = d.month, monthDay = d.day }
end

local function scan()
  local result = {
    checkedAt = ns.now(),
    apiPresent = C_Calendar ~= nil,
    functions = {},
    canAddEvent = nil,
    eventsByType = {},
    guildEvents = {},
    errors = {}
  }
  for _, name in ipairs({ "OpenCalendar", "SetAbsMonth", "GetNumDayEvents", "GetDayEvent", "CanAddEvent",
    "CreateGuildSignUpEvent", "CreateGuildAnnouncementEvent", "OpenEvent", "GetEventInfo", "EventGetInvite", "GetNumInvites" }) do
    result.functions[name] = has(name)
  end
  if not result.apiPresent then return result end

  local ok, err = pcall(function()
    if has("CanAddEvent") then result.canAddEvent = C_Calendar.CanAddEvent() and true or false end
    local now = C_DateAndTime and C_DateAndTime.GetCurrentCalendarTime and C_DateAndTime.GetCurrentCalendarTime()
    if not now then
      local d = date("*t")
      now = { year = d.year, month = d.month, monthDay = d.day }
    end
    if has("SetAbsMonth") then C_Calendar.SetAbsMonth(now.month, now.year) end
    for offset = 0, DAYS_AHEAD - 1 do
      local day = addDays(now, offset)
      local monthOffset = (day.year - now.year) * 12 + (day.month - now.month)
      local count = C_Calendar.GetNumDayEvents(monthOffset, day.monthDay) or 0
      for index = 1, count do
        local event = C_Calendar.GetDayEvent(monthOffset, day.monthDay, index)
        if event then
          local kind = tostring(event.calendarType or "UNKNOWN")
          result.eventsByType[kind] = (result.eventsByType[kind] or 0) + 1
          if kind == "GUILD_EVENT" or kind == "GUILD_ANNOUNCEMENT" then
            local start = event.startTime or {}
            table.insert(result.guildEvents, {
              title = tostring(event.title or "?"),
              kind = kind,
              date = string.format("%04d-%02d-%02d %02d:%02d", start.year or day.year, start.month or day.month,
                start.monthDay or day.monthDay, start.hour or 0, start.minute or 0),
              myStatus = event.inviteStatus
            })
          end
        end
      end
    end
  end)
  if not ok then table.insert(result.errors, tostring(err)) end
  return result
end

local function report(result)
  local db = ns.getDb and ns.getDb()
  if db then db.calendarCheck = result end
  if not result.apiPresent then
    ns.message("Calendar check: this client has NO calendar API for addons. Calendar sync isn't possible here.")
    return
  end
  local missing = {}
  for name, present in pairs(result.functions) do
    if not present then table.insert(missing, name) end
  end
  table.sort(missing)
  ns.message("Calendar check: calendar API found." .. (#missing > 0 and (" Missing: " .. table.concat(missing, ", ")) or " All needed functions are present."))
  ns.message("Can this character create events: " .. (result.canAddEvent == nil and "unknown" or (result.canAddEvent and "yes" or "no")))
  local kinds = {}
  for kind, count in pairs(result.eventsByType) do table.insert(kinds, kind .. " " .. count) end
  table.sort(kinds)
  ns.message(string.format("Next %d days: %s.", DAYS_AHEAD, #kinds > 0 and table.concat(kinds, ", ") or "no events at all"))
  if #result.guildEvents > 0 then
    for i = 1, math.min(8, #result.guildEvents) do
      local event = result.guildEvents[i]
      ns.message(string.format("  Guild event: %s - %s", event.date, event.title))
    end
  else
    ns.message("No guild events found. To test fully, have an officer create a test guild event in the calendar, then run this again.")
  end
  if #result.errors > 0 then ns.message("Errors: " .. table.concat(result.errors, " | ")) end
  ns.message("Saved. Send a screenshot of these lines (or /guilded export) so we know what to build.")
end

-- The calendar loads asynchronously: ask for it, then scan once the game
-- says it's ready (or after a few seconds, whichever comes first).
local frame = CreateFrame("Frame")
frame:SetScript("OnEvent", function(self)
  if not waiting then return end
  waiting = false
  self:UnregisterEvent("CALENDAR_UPDATE_EVENT_LIST")
  local ok, err = pcall(function() report(scan()) end)
  if not ok then ns.message("Calendar check failed: " .. tostring(err)) end
end)

local function check()
  if C_Calendar == nil then
    report(scan())
    return
  end
  waiting = true
  frame:RegisterEvent("CALENDAR_UPDATE_EVENT_LIST")
  ns.message("Checking the in-game calendar...")
  pcall(function() if has("OpenCalendar") then C_Calendar.OpenCalendar() end end)
  if C_Timer and C_Timer.After then
    C_Timer.After(WAIT_SECONDS, function()
      if waiting then frame:GetScript("OnEvent")(frame) end
    end)
  end
end

-- ---------------------------------------------------------------------
-- Time: the calendar speaks server time, Discord speaks UTC
-- ---------------------------------------------------------------------

local calendar = {}
ns.calendar = calendar

local function L(text) return ns.L and ns.L(text) or text end

-- A date and clock reading taken as UTC -> seconds since 1970 (date math in Util.lua).
local function utcEpoch(y, m, d, hour, minute, second)
  return ns.util.daysFromCivil(y, m, d) * 86400 + (hour or 0) * 3600 + (minute or 0) * 60 + (second or 0)
end
calendar.utcEpoch = utcEpoch

-- "2026-10-01T23:00:00.000Z" -> seconds since 1970 (UTC), or nil.
local function isoEpoch(text) return ns.util.isoEpoch(text) end
calendar.isoEpoch = isoEpoch

local function serverNow()
  if GetServerTime then return GetServerTime() end
  return time()
end

-- Seconds the server's clock is ahead of UTC (rounded to a quarter hour: no time zone is finer).
local function serverOffset()
  local clock
  pcall(function()
    if C_DateAndTime and C_DateAndTime.GetCurrentCalendarTime then
      local now = C_DateAndTime.GetCurrentCalendarTime()
      if now and now.year then clock = utcEpoch(now.year, now.month, now.monthDay, now.hour, now.minute, 0) end
    end
  end)
  if not clock and GetGameTime then
    local hour, minute = GetGameTime()
    local utc = serverNow() % 86400
    local diff = (hour * 3600 + minute * 60) - utc
    clock = serverNow() + diff
  end
  if not clock then return 0 end
  local offset = clock - serverNow()
  return math.floor(offset / 900 + 0.5) * 900
end

-- { year, month, monthDay, hour, minute } (server clock) -> seconds since 1970 (UTC).
local function eventEpoch(start, offset)
  if type(start) ~= "table" or not start.year then return nil end
  return utcEpoch(start.year, start.month, start.monthDay, start.hour or 0, start.minute or 0, 0) - (offset or serverOffset())
end
calendar.eventEpoch = eventEpoch

-- seconds since 1970 (UTC) -> server clock fields.
local function serverClock(epoch, offset)
  local t = date("!*t", epoch + (offset or serverOffset()))
  return { year = t.year, month = t.month, monthDay = t.day, hour = t.hour, minute = t.min }
end
calendar.serverClock = serverClock

-- ---------------------------------------------------------------------
-- Reading the guild's events and who answered them
-- ---------------------------------------------------------------------

-- Enum.CalendarStatus: 0 invited, 1 available, 2 declined, 3 confirmed, 4 out, 5 standby,
-- 6 signed up, 7 not signed up, 8 tentative.
local ANSWER = { [1] = "ACCEPTED", [3] = "ACCEPTED", [6] = "ACCEPTED", [5] = "TENTATIVE", [8] = "TENTATIVE", [2] = "DECLINED", [4] = "DECLINED" }
calendar.ANSWER = ANSWER

local function readInvites()
  local invites = {}
  local count = 0
  pcall(function()
    if has("GetNumInvites") then count = C_Calendar.GetNumInvites() or 0 end
  end)
  for i = 1, math.min(count, 100) do
    pcall(function()
      local first, _, _, _, status = C_Calendar.EventGetInvite(i)
      local name, answer
      if type(first) == "table" then name, answer = first.name, first.inviteStatus else name, answer = first, status end
      local mapped = ANSWER[tonumber(answer) or -1]
      if type(name) == "string" and name ~= "" and mapped then
        table.insert(invites, { name = ns.normalizeName and ns.normalizeName(name) or name, status = mapped })
      end
    end)
  end
  return invites
end

local scanning = false
local openFrame = CreateFrame("Frame")
local onOpened

openFrame:SetScript("OnEvent", function()
  if onOpened then onOpened() end
end)

-- Opens each guild event in turn (the calendar loads an event asynchronously), reads who
-- answered, and saves the list. `done(events)` is called when finished.
local function scanEvents(done)
  if scanning then return end
  if not (C_Calendar and has("GetNumDayEvents") and has("GetDayEvent")) then
    done(nil, "This game client has no calendar for addons.")
    return
  end
  scanning = true
  local found = {}
  local ok, err = pcall(function()
    if has("OpenCalendar") then C_Calendar.OpenCalendar() end
    local now = C_DateAndTime and C_DateAndTime.GetCurrentCalendarTime and C_DateAndTime.GetCurrentCalendarTime()
    if not now then
      local d = date("*t")
      now = { year = d.year, month = d.month, monthDay = d.day }
    end
    if has("SetAbsMonth") then C_Calendar.SetAbsMonth(now.month, now.year) end
    local offset = serverOffset()
    for dayOffset = 0, SYNC_DAYS_AHEAD - 1 do
      local day = addDays(now, dayOffset)
      local monthOffset = (day.year - now.year) * 12 + (day.month - now.month)
      for index = 1, (C_Calendar.GetNumDayEvents(monthOffset, day.monthDay) or 0) do
        local event = C_Calendar.GetDayEvent(monthOffset, day.monthDay, index)
        if event and tostring(event.calendarType) == "GUILD_EVENT" then
          local at = eventEpoch(event.startTime or { year = day.year, month = day.month, monthDay = day.monthDay }, offset)
          if at then
            table.insert(found, {
              ref = tostring(event.eventID or (tostring(event.title) .. "|" .. at)),
              title = tostring(event.title or "?"), startsAt = at, invites = {},
              monthOffset = monthOffset, day = day.monthDay, index = index
            })
          end
        end
      end
    end
  end)
  if not ok then
    scanning = false
    done(nil, tostring(err))
    return
  end

  local position = 0
  local function finishAll()
    scanning = false
    onOpened = nil
    pcall(function() openFrame:UnregisterEvent("CALENDAR_OPEN_EVENT") end)
    for _, event in ipairs(found) do
      event.monthOffset, event.day, event.index = nil, nil, nil
    end
    local db = ns.getDb and ns.getDb()
    if db then db.calendarEvents = { scannedAt = ns.now and ns.now() or nil, events = found } end
    done(found)
  end

  local function nextEvent()
    position = position + 1
    local event = found[position]
    if not event then finishAll() return end
    if not (has("OpenEvent") and has("EventGetInvite")) then nextEvent() return end
    local answered = false
    onOpened = function()
      if answered then return end
      answered = true
      event.invites = readInvites()
      pcall(function() if has("CloseEvent") then C_Calendar.CloseEvent() end end)
      nextEvent()
    end
    pcall(function() openFrame:RegisterEvent("CALENDAR_OPEN_EVENT") end)
    local opened = pcall(C_Calendar.OpenEvent, event.monthOffset, event.day, event.index)
    if not opened then answered = true; nextEvent() return end
    -- If the game never says the event opened, read what is there and move on.
    if C_Timer and C_Timer.After then C_Timer.After(2, function() if not answered and onOpened then onOpened() end end)
    elseif onOpened then onOpened() end
  end
  nextEvent()
end
calendar.scanEvents = scanEvents

local function syncEvents(silent)
  scanEvents(function(events, problem)
    if not events then
      if not silent then ns.message(L("Calendar sync: ") .. tostring(problem)) end
      return
    end
    local answers = 0
    for _, event in ipairs(events) do answers = answers + #event.invites end
    if not silent or #events > 0 then
      ns.message(string.format(L("Calendar: %d guild event(s) with %d answer(s) read. The companion sends them to Discord."), #events, answers))
    end
    if ns.onCalendarChange then pcall(ns.onCalendarChange) end
  end)
end
calendar.sync = syncEvents

-- ---------------------------------------------------------------------
-- Discord raids -> the in-game calendar
-- ---------------------------------------------------------------------

-- The upcoming raids the bot wrote next to the standings (GuildedRaids).
function calendar.discordRaids()
  local out = {}
  if type(GuildedRaids) ~= "table" then return out end
  for _, raid in ipairs(GuildedRaids) do
    local at = type(raid) == "table" and isoEpoch(raid.at)
    if at and at >= serverNow() then local core = type(raid.core) == "string" and raid.core ~= "" and raid.core or nil
      local note = type(raid.note) == "string" and raid.note ~= "" and raid.note or nil
      table.insert(out, { id = tostring(raid.id or ""), title = tostring(raid.title or "Raid"), at = at, core = core, note = note }) end
  end
  table.sort(out, function(a, b) return a.at < b.at end)
  return out
end

-- Is there already a guild event at (about) this time with this title, from the last scan?
local pendingCreates = {}
local function alreadyInGame(raid)
  -- Read the actual day, including announcements, instead of relying on a six-hour-old scan.
  if has("GetNumDayEvents") and has("GetDayEvent") then
    local clock = serverClock(raid.at)
    local now = serverClock(serverNow())
    if has("SetAbsMonth") then C_Calendar.SetAbsMonth(now.month, now.year) end
    local offset = (clock.year - now.year) * 12 + clock.month - now.month
    for i = 1, (C_Calendar.GetNumDayEvents(offset, clock.monthDay) or 0) do
      local event = C_Calendar.GetDayEvent(offset, clock.monthDay, i)
      if event and (event.calendarType == "GUILD_EVENT" or event.calendarType == "GUILD_ANNOUNCEMENT") then
        local at = eventEpoch(event.startTime or {}, serverOffset())
        if at and math.abs(at - raid.at) <= 30 * 60 and string.lower(event.title or "") == string.lower(raid.title) then return true end
      end
    end
  end
  local db = ns.getDb and ns.getDb()
  local scan = db and db.calendarEvents
  for _, event in ipairs(scan and scan.events or {}) do
    if math.abs(event.startsAt - raid.at) <= 30 * 60 and string.lower(event.title) == string.lower(raid.title) then return true end
  end
  return false
end
calendar.alreadyInGame = alreadyInGame

-- Makes the in-game guild event. Returns true, or false and the reason.
function calendar.createEvent(raid)
  if not raid then return false, L("No upcoming Discord raid to create.") end
  if scanning then return false, "Calendar scan in progress; try again when it finishes." end
  if InCombatLockdown and InCombatLockdown() then return false, "Sync calendar events outside combat." end
  if not (C_Calendar and has("CreateGuildSignUpEvent") and has("EventSetTitle") and has("EventSetDate")
    and has("EventSetTime") and has("AddEvent")) then
    return false, L("This game client cannot create calendar events for addons.")
  end
  if raid.at < serverNow() - 3600 then return false, L("That raid is in the past.") end
  if alreadyInGame(raid) then return false, L("That raid is already in the game calendar.") end
  local ref = raid.id ~= "" and raid.id or (raid.title .. "|" .. raid.at)
  if pendingCreates[ref] and serverNow() - pendingCreates[ref] < 30 then return false, "Waiting for the calendar to confirm this event. Try again shortly." end
  if has("CanAddEvent") and not C_Calendar.CanAddEvent() then return false, "This character cannot add calendar events right now." end
  local ok, err = pcall(function()
    if has("OpenCalendar") then C_Calendar.OpenCalendar() end
    local clock = serverClock(raid.at)
    C_Calendar.CreateGuildSignUpEvent()
    C_Calendar.EventSetTitle(string.sub(raid.title, 1, 30))
    if has("EventSetDescription") then C_Calendar.EventSetDescription(raid.note or ("Guilded raid" .. (raid.core and (" - " .. raid.core) or ""))) end
    C_Calendar.EventSetDate(clock.month, clock.monthDay, clock.year)
    C_Calendar.EventSetTime(clock.hour, clock.minute)
    C_Calendar.AddEvent()
  end)
  if not ok then return false, tostring(err) end
  pendingCreates[ref] = serverNow()
  return true
end

-- One event per real click: AddEvent is a hardware-event restricted API.
function calendar.createMissing()
  for _, raid in ipairs(calendar.discordRaids()) do
    if not alreadyInGame(raid) then
      local ok, problem = calendar.createEvent(raid)
      ns.message(ok and ("Calendar event submitted: " .. raid.title .. ". Click again for the next missing event.") or (L("Could not create the event: ") .. tostring(problem)))
      if ns.onCalendarChange then pcall(ns.onCalendarChange) end
      return ok
    end
  end
  ns.message("All upcoming Discord events are already in the guild calendar (or none are available).")
  return false
end

function calendar.createNext(n)
  local raids = calendar.discordRaids()
  local ok, problem = calendar.createEvent(raids[tonumber(n) or 1])
  if ok then
    ns.message(L("Created the in-game event. Members answer it in the calendar; run /guilded calendar sync later to send the answers to Discord."))
  else
    ns.message(L("Could not create the event: ") .. tostring(problem))
  end
  return ok
end

function calendar.statusText()
  local db = ns.getDb and ns.getDb()
  local scan = db and db.calendarEvents
  local lines = {}
  if not (C_Calendar and has("GetNumDayEvents")) then
    table.insert(lines, L("This game client has no calendar for addons."))
  elseif scan then
    local answers = 0
    for _, event in ipairs(scan.events or {}) do answers = answers + #event.invites end
    table.insert(lines, string.format(L("Last scan: %d guild event(s), %d answer(s) (%s)."), #(scan.events or {}), answers, tostring(scan.scannedAt or "?")))
  else
    table.insert(lines, L("The calendar has not been read yet: press Scan."))
  end
  local raids = calendar.discordRaids()
  if #raids == 0 then
    table.insert(lines, L("No upcoming Discord raids known (the companion sends them with the standings)."))
  else
    table.insert(lines, L("Upcoming Discord raids:"))
    for i = 1, math.min(6, #raids) do
      local raid = raids[i]
      table.insert(lines, string.format("%d. %s - %s%s", i, raid.title, date("%Y-%m-%d %H:%M", raid.at),
        alreadyInGame(raid) and (" (" .. L("in the calendar") .. ")") or ""))
    end
  end
  return table.concat(lines, "\n")
end

-- Read the calendar by itself once in a while (officers; quietly).
local autoFrame = CreateFrame("Frame")
autoFrame:RegisterEvent("PLAYER_LOGIN")
autoFrame:SetScript("OnEvent", function()
  if ns.moduleActive and not ns.moduleActive("calendar") then return end
  if not (C_Timer and C_Timer.After) then return end
  C_Timer.After(90, function()
    if not (ns.isOfficer and ns.isOfficer()) then return end
    local db = ns.getDb and ns.getDb()
    local last = db and db.calendarAutoAt
    if last and serverNow() - last < 6 * 3600 then return end
    if db then db.calendarAutoAt = serverNow() end
    pcall(syncEvents, true)
  end)
end)

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["calendar"] = function(args)
  local action = string.lower(args[1] or "check")
  if action == "check" then check()
  elseif action == "sync" or action == "scan" then
    if not ns.isOfficer() then ns.message(L("Only officers can do that.")) return end
    ns.message(L("Reading the guild calendar..."))
    syncEvents(false)
  elseif action == "list" or action == "status" then
    ns.message(calendar.statusText())
  elseif action == "create" then
    if not ns.isOfficer() then ns.message(L("Only officers can do that.")) return end
    calendar.createNext(args[2])
  elseif action == "import" then
    if not ns.isOfficer() then ns.message(L("Only officers can do that.")) return end
    calendar.createMissing()
  else
    ns.message("/guilded calendar check | sync | list | create [n]")
  end
end
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded calendar check | sync | list | create - the guild calendar, both ways with Discord")
