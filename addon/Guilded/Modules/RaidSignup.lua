-- In-game raid sign-up with role counts (9.0): the Signups page lists the guild's upcoming raids and
-- calendar events, with Sign up / Tentative / Can't buttons, a role pick (tank, healer, DPS) and live
-- counts such as "2 T - 4 H - 14 D" plus how many of each class are coming.
--
-- One source of truth: the Discord raid signup, one per member and raid.
--   * Discord -> game: the companion writes each upcoming raid's signup list next to the standings
--     (GuildedRaids[n].signups = { { name, "T"|"H"|"D", CLASS, "S"|"M"|"W", unixTime }, ... }).
--   * Game -> Discord: a click saves db.signupAnswers[raidId] = { status, role, at, name }; the
--     companion uploads it and the bot applies it (services/signup-answers.ts).
--   * Conflict rule, the same on both sides: the LATEST change per member wins. Here an answer
--     hides the older list row of the same player (M.merge); the bot applies an answer only when
--     it is newer than the member's last Discord change.
-- A raid that is also a calendar event gets the player's answer in the game's own calendar too,
-- but only where the API allows it and only on the click (Calendar.lua, calendar.reply). Nothing
-- here is protected or automatic: every answer is a button press.
--
--   /guilded signups                   the upcoming raids with their counts
--   /guilded signups yes|maybe|no N [tank|healer|dps]    answer raid number N
local _, ns = ...
local M = {}
ns.raidSignup = M

local DOT = " \194\183 "
local PER_PAGE = 3
local MAX_EVENTS = 12
-- After the standings file is this much newer than an answer, the list is taken as the truth even
-- when it no longer shows the player (they cancelled on Discord afterwards).
local GRACE = 120
local KEEP_ANSWERS = 30 * 86400
local ROLE_OF = { T = "TANK", H = "HEALER", D = "DPS" }
local LETTER_OF = { TANK = "T", HEALER = "H", DPS = "D" }
local ROLE_TEXT = { TANK = "Tank", HEALER = "Healer", DPS = "DPS" }

local function L(text) return ns.L and ns.L(text) or text end
local function active() return not ns.moduleActive or ns.moduleActive("raidsignup") end
local function db() return ns.getDb and ns.getDb() or nil end
local function epoch()
  if GetServerTime then local ok, v = pcall(GetServerTime); if ok and tonumber(v) then return tonumber(v) end end
  return time()
end
local function short(name)
  if type(name) ~= "string" then return nil end
  return ns.normalizeName and ns.normalizeName(name) or name
end
local function me() return short(ns.playerName and ns.playerName() or nil) end
local function say(text) if ns.message then ns.message(text) end end

local function answers()
  local d = db()
  if not d then return {} end
  d.signupAnswers = d.signupAnswers or {}
  return d.signupAnswers
end

local function calendarAnswers()
  local d = db()
  if not d then return {} end
  d.signupCalendar = d.signupCalendar or {}
  return d.signupCalendar
end

-- Reads never create the saved tables (an empty answers table would be uploaded for nothing).
local function answerFor(raidId)
  local d = db()
  return d and d.signupAnswers and d.signupAnswers[raidId] or nil
end

-- The role used by the next answer: the last one picked, DPS at first.
function M.role()
  local d = db()
  local role = d and d.signupRole
  return ROLE_TEXT[role] and role or "DPS"
end

function M.setRole(role)
  local d = db()
  if d and ROLE_TEXT[role] then d.signupRole = role end
end

-- When the standings file was written (the bot's view of every signup), as unix time.
local function standingsStamp()
  local text = type(GuildedStandings) == "table" and GuildedStandings.updatedAt
  return type(text) == "string" and ns.util and ns.util.isoEpoch and ns.util.isoEpoch(text) or nil
end

-- The signup list of one raid, with the player's own answer laid over it. `remote` are the rows the
-- bot wrote ({ name, role T/H/D, class, status S/M/W, at }); `answer` is { status, role, at, name }.
-- Latest wins: a row of the same player stays unless the answer is newer.
function M.merge(remote, answer, myName, stamp)
  local rows, mine = {}, nil
  for _, raw in ipairs(type(remote) == "table" and remote or {}) do
    if type(raw) == "table" and type(raw[1]) == "string" then
      local row = { name = raw[1], role = ROLE_OF[raw[2]] or "DPS", class = tostring(raw[3] or ""), status = raw[4] or "S", at = tonumber(raw[5]) or 0 }
      if myName and short(row.name) == myName then mine = row else rows[#rows + 1] = row end
    end
  end
  local use
  if type(answer) == "table" and answer.status then
    local at = tonumber(answer.at) or 0
    if mine then use = at > mine.at
    else use = not (stamp and stamp > at + GRACE) end
  end
  if use then
    if answer.status ~= "DECLINED" then
      local class = mine and mine.class or ""
      if class == "" and UnitClass then local ok, _, file = pcall(UnitClass, "player"); if ok and type(file) == "string" then class = file end end
      rows[#rows + 1] = { name = myName or answer.name or "?", role = ROLE_TEXT[answer.role] and answer.role or "DPS", class = class,
        status = answer.status == "TENTATIVE" and "M" or "S", at = tonumber(answer.at) or 0, mine = true }
    end
  elseif mine then
    mine.mine = true
    rows[#rows + 1] = mine
  end
  return rows
end

-- Role and class numbers of a merged list. Only "S" rows fill the roles; tentative and waitlist are counted apart.
function M.counts(rows)
  local counts = { T = 0, H = 0, D = 0, maybe = 0, wait = 0, classes = {} }
  for _, row in ipairs(rows or {}) do
    if row.status == "M" then counts.maybe = counts.maybe + 1
    elseif row.status == "W" then counts.wait = counts.wait + 1
    else
      local letter = LETTER_OF[row.role] or "D"
      counts[letter] = counts[letter] + 1
      if row.class and row.class ~= "" then counts.classes[row.class] = (counts.classes[row.class] or 0) + 1 end
    end
  end
  return counts
end

function M.countText(counts)
  local text = string.format("%d T" .. DOT .. "%d H" .. DOT .. "%d D", counts.T, counts.H, counts.D)
  if counts.maybe > 0 then text = text .. DOT .. string.format(L("%d tentative"), counts.maybe) end
  if counts.wait > 0 then text = text .. DOT .. string.format(L("%d waitlisted"), counts.wait) end
  return text
end

local function className(file)
  local names = LOCALIZED_CLASS_NAMES_MALE
  if type(names) == "table" and names[file] then return names[file] end
  return (file:sub(1, 1) .. file:sub(2):lower())
end

function M.classText(counts)
  local list = {}
  for file, n in pairs(counts.classes or {}) do list[#list + 1] = { file = file, n = n } end
  table.sort(list, function(a, b) if a.n ~= b.n then return a.n > b.n end return a.file < b.file end)
  local parts = {}
  for _, item in ipairs(list) do parts[#parts + 1] = className(item.file) .. " " .. item.n end
  return table.concat(parts, DOT)
end

local function inviteCounts(invites)
  local counts = { T = 0, H = 0, D = 0, maybe = 0, wait = 0, classes = {}, yes = 0, no = 0 }
  for _, invite in ipairs(invites or {}) do
    if invite.status == "ACCEPTED" then counts.yes = counts.yes + 1
    elseif invite.status == "TENTATIVE" then counts.maybe = counts.maybe + 1
    elseif invite.status == "DECLINED" then counts.no = counts.no + 1 end
  end
  return counts
end

-- Upcoming raids and events, soonest first: the Discord raids (with their signup lists), then
-- calendar events that are no Discord raid.
function M.events()
  local out = {}
  local d = db()
  local now = epoch()
  local myName, stamp = me(), standingsStamp()
  local scan = d and d.calendarEvents and d.calendarEvents.events or {}
  local raids = ns.calendar and ns.calendar.discordRaids and ns.calendar.discordRaids() or {}
  for _, raid in ipairs(raids) do
    if raid.id ~= "" and not raid.id:find("^discord:") then
      local link
      for _, event in ipairs(scan) do if event.botRaidId == raid.id then link = event.ref end end
      local rows = M.merge(raid.signups, answerFor(raid.id), myName, stamp)
      local counts = M.counts(rows)
      local mine
      for _, row in ipairs(rows) do if row.mine then mine = row end end
      out[#out + 1] = { raidId = raid.id, calendarRef = link, title = raid.title, at = raid.at, core = raid.core, rows = rows, counts = counts, mine = mine }
    end
  end
  for _, event in ipairs(scan) do
    local linked = event.botRaidId ~= nil
    if not linked and tonumber(event.startsAt) and event.startsAt >= now then
      for _, raid in ipairs(raids) do
        if tostring(raid.title):lower() == tostring(event.title):lower() and math.abs(raid.at - event.startsAt) <= 5400 then linked = true end
      end
      if not linked then
        local counts = inviteCounts(event.invites)
        local d2 = db()
        local answer = d2 and d2.signupCalendar and d2.signupCalendar[tostring(event.ref)]
        out[#out + 1] = { calendarRef = tostring(event.ref), title = tostring(event.title), at = event.startsAt, rows = {}, counts = counts,
          calendarOnly = true, answer = answer }
      end
    end
  end
  table.sort(out, function(a, b) return a.at < b.at end)
  while #out > MAX_EVENTS do out[#out] = nil end
  return out
end

-- "Signed up as Healer" / "Tentative as DPS" / "Not signed up".
function M.mineText(entry)
  if entry.calendarOnly then
    local answer = entry.answer
    if answer and answer.status == "ACCEPTED" then return L("You said yes in the calendar.") end
    if answer and answer.status == "TENTATIVE" then return L("You said maybe in the calendar.") end
    if answer and answer.status == "DECLINED" then return L("You said no in the calendar.") end
    return L("No answer from you yet.")
  end
  local row = entry.mine
  if not row then
    local answer = answerFor(entry.raidId)
    if answer and answer.status == "DECLINED" then return L("You can't make it.") end
    return L("Not signed up.")
  end
  local role = L(ROLE_TEXT[row.role] or "DPS")
  if row.status == "M" then return string.format(L("Tentative as %s."), role) end
  if row.status == "W" then return string.format(L("On the waitlist as %s."), role) end
  return string.format(L("Signed up as %s."), role)
end

-- Saves a click: status ACCEPTED, TENTATIVE or DECLINED for this raid/event. Returns true when saved.
function M.answer(entry, status, role)
  if not active() or type(entry) ~= "table" then return false end
  if status ~= "ACCEPTED" and status ~= "TENTATIVE" and status ~= "DECLINED" then return false end
  role = role or M.role()
  if not ROLE_TEXT[role] then role = "DPS" end
  local at = epoch()
  if entry.raidId then
    answers()[entry.raidId] = { status = status, role = role, at = at, name = me() }
    M.setRole(role)
  elseif entry.calendarRef then
    calendarAnswers()[entry.calendarRef] = { status = status, at = at }
  else
    return false
  end
  if entry.calendarRef and ns.calendar and ns.calendar.reply then
    ns.calendar.reply(entry.calendarRef, status, function(ok)
      if ok then say(string.format(L("Answered in the game calendar too: %s."), entry.title)) end
    end)
  end
  if entry.raidId then
    local text
    if status == "ACCEPTED" then text = string.format(L("Signed up for %s as %s."), entry.title, L(ROLE_TEXT[role]))
    elseif status == "TENTATIVE" then text = string.format(L("Tentative for %s as %s."), entry.title, L(ROLE_TEXT[role]))
    else text = string.format(L("You can't make %s."), entry.title) end
    say(text .. " " .. L("It reaches Discord with the next companion upload."))
  end
  if M.refreshView then M.refreshView() end
  return true
end

-- Old answers are dropped (a raid is long over).
function M.prune()
  local d = db()
  local list = d and d.signupAnswers
  if not list then return end
  local now = epoch()
  for id, answer in pairs(list) do
    if type(answer) ~= "table" or (tonumber(answer.at) or 0) < now - KEEP_ANSWERS then list[id] = nil end
  end
end

local function lineFor(entry, index)
  local when = date("%a %d %b %H:%M", entry.at)
  local text = string.format("%d. %s - %s", index, entry.title, when)
  if entry.calendarOnly then
    return text .. "\n" .. string.format(L("%d yes") .. DOT .. L("%d maybe") .. DOT .. L("%d no"), entry.counts.yes, entry.counts.maybe, entry.counts.no)
  end
  local classes = M.classText(entry.counts)
  return text .. "\n" .. M.countText(entry.counts) .. (classes ~= "" and ("\n" .. classes) or "")
end

-- ---------------------------------------------------------------------
-- The Signups page of the tools window (Minimap.lua passes its widget helpers)
-- ---------------------------------------------------------------------

local ROW = 126

function M.buildPage(page, ui)
  local newLabel, newButton, at = ui.newLabel, ui.newButton, ui.at
  local view = { offset = 0, blocks = {} }
  M.view = view
  at(newLabel(page, "Your answers reach Discord with the next companion upload; Discord signups show here after it refreshes the standings.", "GameFontHighlightSmall"), page, 0, 0)
  view.roleButtons = {}
  for i, role in ipairs({ "TANK", "HEALER", "DPS" }) do
    view.roleButtons[role] = at(newButton(page, ROLE_TEXT[role], 90, function() M.setRole(role); M.refreshView() end), page, (i - 1) * 96, -40)
  end
  view.scan = at(newButton(page, "Read calendar", 110, function()
    if ns.calendar and ns.calendar.scanEvents then ns.calendar.scanEvents(function() M.refreshView() end) end
  end), page, 300, -40)
  for i = 1, PER_PAGE do
    local block = { top = -76 - (i - 1) * ROW }
    block.text = at(newLabel(page, "", "GameFontHighlight"), page, 0, block.top)
    if ui.width then block.text:SetWidth(ui.width) end
    block.yes = at(newButton(page, "Sign up", 90, function() if block.entry then M.answer(block.entry, "ACCEPTED") end end), page, 0, block.top - 66)
    block.maybe = at(newButton(page, "Tentative", 90, function() if block.entry then M.answer(block.entry, "TENTATIVE") end end), page, 96, block.top - 66)
    block.no = at(newButton(page, "Can't", 90, function() if block.entry then M.answer(block.entry, "DECLINED") end end), page, 192, block.top - 66)
    block.mine = at(newLabel(page, "", "GameFontDisableSmall"), page, 290, block.top - 71)
    view.blocks[i] = block
  end
  view.empty = at(newLabel(page, "", "GameFontDisableSmall"), page, 0, -80)
  view.prev = at(newButton(page, "Previous", 90, function() view.offset = math.max(0, view.offset - PER_PAGE); M.refreshView() end), page, 0, -76 - PER_PAGE * ROW)
  view.next = at(newButton(page, "Next", 90, function() view.offset = view.offset + PER_PAGE; M.refreshView() end), page, 96, -76 - PER_PAGE * ROW)
  function M.refreshView()
    if not (page.IsShown and page:IsShown()) then return end
    local events = M.events()
    if view.offset >= #events then view.offset = 0 end
    local selected = M.role()
    for role, button in pairs(view.roleButtons) do
      button:SetText(role == selected and ("[" .. L(ROLE_TEXT[role]) .. "]") or L(ROLE_TEXT[role]))
    end
    for i, block in ipairs(view.blocks) do
      local entry = events[view.offset + i]
      block.entry = entry
      if entry then
        block.text:SetText(lineFor(entry, view.offset + i))
        block.mine:SetText(M.mineText(entry))
        block.text:Show(); block.yes:Show(); block.maybe:Show(); block.no:Show(); block.mine:Show()
        if entry.calendarOnly then
          block.yes:SetText(L("Yes")); block.maybe:SetText(L("Maybe")); block.no:SetText(L("No"))
        else
          block.yes:SetText(L("Sign up")); block.maybe:SetText(L("Tentative")); block.no:SetText(L("Can't"))
        end
      else
        block.text:SetText(""); block.mine:SetText("")
        block.text:Hide(); block.yes:Hide(); block.maybe:Hide(); block.no:Hide(); block.mine:Hide()
      end
    end
    view.empty:SetText(#events == 0 and L("No upcoming raids known yet. The companion brings them with the standings; Read calendar adds the game's own events.") or "")
    if #events > PER_PAGE then view.prev:Show(); view.next:Show() else view.prev:Hide(); view.next:Hide() end
  end
  local elapsed = 0
  page:SetScript("OnShow", function() M.refreshView() end)
  page:SetScript("OnUpdate", function(_, dt)
    elapsed = elapsed + dt
    if elapsed >= 5 then elapsed = 0; M.refreshView() end
  end)
  M.refreshView()
end

-- ---------------------------------------------------------------------
-- /guilded signups
-- ---------------------------------------------------------------------

local ANSWER_WORD = { yes = "ACCEPTED", signup = "ACCEPTED", maybe = "TENTATIVE", tentative = "TENTATIVE", no = "DECLINED", cant = "DECLINED" }
local ROLE_WORD = { tank = "TANK", healer = "HEALER", heal = "HEALER", dps = "DPS", dd = "DPS" }

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["signups"] = function(args)
  if not active() then say(L("Raid sign-up is turned off.")) return end
  local first = string.lower(args[1] or "")
  local events = M.events()
  if ANSWER_WORD[first] then
    local entry = events[tonumber(args[2]) or 0]
    if not entry then say(L("Use the number from /guilded signups.")) return end
    M.answer(entry, ANSWER_WORD[first], ROLE_WORD[string.lower(args[3] or "")])
    return
  end
  if #events == 0 then say(L("No upcoming raids known yet. The companion brings them with the standings; Read calendar adds the game's own events.")) return end
  for i, entry in ipairs(events) do say(lineFor(entry, i):gsub("\n", " - ") .. " (" .. M.mineText(entry) .. ")") end
end
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded signups [yes|maybe|no N [tank|healer|dps]] - upcoming raids with role counts, and your answer")

local frame = CreateFrame("Frame")
frame:RegisterEvent("PLAYER_LOGIN")
frame:SetScript("OnEvent", function() pcall(M.prune) end)
