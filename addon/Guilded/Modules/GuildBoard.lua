-- Guild board (9.1, docs/GUILD_BOARD.md): officers' news and the open Discord polls on the "Board"
-- page of the Guilded window, with voting from the game.
--
--   Discord -> game  The companion writes GuildedBoard (news, open polls with counts, your own picks)
--                    next to the standings. A member whose copy came from the companion shares it with
--                    the guild (GuildedBoard addon messages), so members without the companion see it too.
--   game -> Discord  A vote is saved in db.board.votes and uploaded by your companion; the bot records it
--                    like a button vote (one vote per member, changeable while the poll is open). It is
--                    also said on GUILD, so a guildmate's companion carries it for members without one.
--                    Officers can write news here; their companion posts it in the announcements channel.
--
-- On by default. Officers turn the board off for the server with /poll board in Discord; each member
-- turns off the "new guild news" line at login with the News alerts button or /guilded board alerts off.
-- Plain Guilded frames only (text, bars, buttons): nothing protected, safe in combat.
local addonName, ns = ...
ns = ns or {}

local PREFIX = "GuildedBoard"
local PART = 190
local MAX_PARTS = 40
local COOLDOWN = 60
local KEEP = 14 * 86400
local MAX_HEARD = 200
local OPTION_ROWS = 8
local NEWS_ROWS = 3
local BAR_TEXTURE = "Interface\\TargetingFrame\\UI-StatusBar"

local board = {}
ns.guildBoard = board

local function L(text) return ns.L and ns.L(text) or text end
local function clock() return (GetServerTime and GetServerTime()) or (time and time()) or 0 end
local function secret(value) return ns.isSecret and ns.isSecret(value) end

local function state()
  local db = ns.getDb and ns.getDb()
  if not db then return nil end
  db.board = type(db.board) == "table" and db.board or {}
  local s = db.board
  s.votes = type(s.votes) == "table" and s.votes or {}
  s.heard = type(s.heard) == "table" and s.heard or {}
  s.posts = type(s.posts) == "table" and s.posts or {}
  return s
end

-- ---------------------------------------------------------------------
-- What to show: the companion's copy, or a guildmate's when that one is newer.
-- ---------------------------------------------------------------------
local function fromCompanion()
  local file = rawget(_G, "GuildedBoard")
  if type(file) ~= "table" or type(file.at) ~= "string" then return nil end
  return file
end

function board.current()
  local file, s = fromCompanion(), state()
  local relayed = s and type(s.relayed) == "table" and type(s.relayed.at) == "string" and s.relayed or nil
  if file and (not relayed or file.at >= relayed.at) then
    return { at = file.at, off = file.off == true, news = type(file.news) == "table" and file.news or {}, polls = type(file.polls) == "table" and file.polls or {}, source = "companion" }
  end
  if relayed then
    return { at = relayed.at, off = relayed.off == true, news = relayed.news or {}, polls = relayed.polls or {}, source = "guild", from = relayed.from }
  end
  return nil
end

local function findPoll(id)
  local current = board.current()
  for index, poll in ipairs(current and current.polls or {}) do
    if poll.id == id then return poll, index, current end
  end
  return nil, nil, current
end

local function samePicks(a, b)
  if #a ~= #b then return false end
  local seen = {}
  for _, v in ipairs(a) do seen[v] = true end
  for _, v in ipairs(b) do if not seen[v] then return false end end
  return true
end

local function picksText(picks)
  local parts = {}
  for i, v in ipairs(picks) do parts[i] = tostring(v) end
  return table.concat(parts, ",")
end

-- Drops votes the bot already has (the companion's copy lists them as yours), votes for polls that
-- closed since (a newer board no longer lists them), old ones, and stale heard votes.
function board.prune()
  local s = state()
  if not s then return end
  local file, current, now = fromCompanion(), board.current(), clock()
  for id, vote in pairs(s.votes) do
    local poll = findPoll(id)
    local mine = poll and file and current and current.source == "companion" and type(poll.mine) == "table" and poll.mine
    if type(vote) ~= "table" or now - (tonumber(vote.at) or 0) > KEEP
      or (mine and samePicks(mine, vote.picks or {}))
      or (not poll and current and type(vote.boardAt) == "string" and current.at > vote.boardAt) then
      s.votes[id] = nil
    end
  end
  local count = 0
  for key, vote in pairs(s.heard) do
    if type(vote) ~= "table" or now - (tonumber(vote.at) or 0) > KEEP then s.heard[key] = nil else count = count + 1 end
  end
  while count > MAX_HEARD do
    local oldestKey, oldestAt
    for key, vote in pairs(s.heard) do if not oldestAt or vote.at < oldestAt then oldestKey, oldestAt = key, vote.at end end
    s.heard[oldestKey] = nil
    count = count - 1
  end
  local known = {}
  for _, item in ipairs(file and file.news or {}) do if type(item) == "table" and item.ref then known[item.ref] = true end end
  for ref, post in pairs(s.posts) do
    if type(post) ~= "table" or known[ref] or now - (tonumber(post.at) or 0) > KEEP then s.posts[ref] = nil end
  end
end

-- Your picks on a poll: the one waiting to be sent, else what the bot has.
function board.picks(poll)
  local s = state()
  local vote = s and poll and s.votes[poll.id]
  if vote and type(vote.picks) == "table" then return vote.picks, true end
  return type(poll and poll.mine) == "table" and poll.mine or {}, false
end

local function send(text)
  if not (IsInGuild and IsInGuild()) or not ns.comm then return end
  local key = ns.currentGuildKey and ns.currentGuildKey() or nil
  ns.comm.send(PREFIX, text, "GUILD", nil, function() return (ns.currentGuildKey and ns.currentGuildKey() or nil) == key end, "hold-in-instance")
end

local function sayVote(id, vote)
  send(string.format("VOTE|%s|%s|%d", id, picksText(vote.picks or {}), tonumber(vote.at) or 0))
end

-- Picks or unpicks option `option` (from 1) of poll `id`. Returns the new picks, or nil and why.
function board.vote(id, option)
  local poll, _, current = findPoll(id)
  if not poll then return nil, L("That poll is no longer open.") end
  if current.off then return nil, L("Your officers turned the guild board off.") end
  if poll.closes and tonumber(poll.closes) and tonumber(poll.closes) <= clock() then return nil, L("That poll is closed.") end
  option = math.floor(tonumber(option) or 0)
  if option < 1 or option > #(poll.opts or {}) then return nil, L("That option does not exist.") end
  local s = state()
  if not s then return nil, L("Guilded is not ready yet.") end
  local picks = board.picks(poll)
  local max = math.max(1, tonumber(poll.max) or 1)
  local nextPicks = {}
  if max == 1 then
    nextPicks = { option }
  else
    local had = false
    for _, v in ipairs(picks) do if v == option then had = true else nextPicks[#nextPicks + 1] = v end end
    if not had then
      if #nextPicks >= max then return nil, string.format(L("You can pick up to %d options. Click a picked option again to remove it first."), max) end
      nextPicks[#nextPicks + 1] = option
    end
    table.sort(nextPicks)
  end
  local vote = { picks = nextPicks, at = clock(), boardAt = current.at }
  s.votes[id] = vote
  sayVote(id, vote)
  if ns.onBoardChange then pcall(ns.onBoardChange) end
  return nextPicks
end

-- Officers: a news post written in game. Your companion uploads it; the bot posts it in Discord.
function board.post(text)
  if not (ns.isOfficer and ns.isOfficer()) then return nil, L("Only officers can post guild news.") end
  local current = board.current()
  if current and current.off then return nil, L("Your officers turned the guild board off.") end
  local s = state()
  if not s then return nil, L("Guilded is not ready yet.") end
  text = type(text) == "string" and string.match(string.gsub(string.gsub(text, "|", ""), "%c", " "), "^%s*(.-)%s*$") or ""
  if #text < 3 then return nil, L("Write the news first (at least 3 characters).") end
  local waiting = 0
  for _ in pairs(s.posts) do waiting = waiting + 1 end
  if waiting >= 5 then return nil, L("Five news posts are already waiting for your companion.") end
  local now = clock()
  local ref = string.format("%d-%d", now, math.random(100000, 999999))
  s.posts[ref] = { ref = ref, text = string.sub(text, 1, 500), at = now }
  if ns.onBoardChange then pcall(ns.onBoardChange) end
  return s.posts[ref]
end

-- ---------------------------------------------------------------------
-- Sharing the board with guildmates (members without the companion) and hearing their votes.
-- ---------------------------------------------------------------------
local function encode(value)
  return (string.gsub(tostring(value or ""), "[%%;\r\n|]", function(c) return string.format("%%%02X", string.byte(c)) end))
end
local function decode(value)
  return (string.gsub(value, "%%(%x%x)", function(hex) return string.char(tonumber(hex, 16)) end))
end

-- The board as lines: X (off), N;id;at;by;text, P;id;max;closes;total;q, O;count;label. Items that
-- would pass MAX_PARTS are left out (newest news and polls first).
function board.encode(current)
  if current.off then return "X" end
  local lines, size = {}, 0
  local function add(block)
    local text = table.concat(block, "\n")
    if size + #text + 1 > PART * MAX_PARTS then return false end
    for _, line in ipairs(block) do lines[#lines + 1] = line end
    size = size + #text + 1
    return true
  end
  for _, item in ipairs(current.news or {}) do
    add({ table.concat({ "N", encode(item.id), tonumber(item.at) or 0, encode(item.by), encode(item.text) }, ";") })
  end
  for _, poll in ipairs(current.polls or {}) do
    local block = { table.concat({ "P", encode(poll.id), tonumber(poll.max) or 1, tonumber(poll.closes) or 0, tonumber(poll.total) or 0, encode(poll.q) }, ";") }
    for i, label in ipairs(poll.opts or {}) do block[#block + 1] = "O;" .. (tonumber(poll.counts and poll.counts[i]) or 0) .. ";" .. encode(label) end
    add(block)
  end
  return #lines > 0 and table.concat(lines, "\n") or "E"
end

function board.decode(text)
  if text == "X" then return { off = true, news = {}, polls = {} } end
  local result, poll = { news = {}, polls = {} }, nil
  if text == "E" then return result end
  for line in string.gmatch(text .. "\n", "([^\n]*)\n") do
    local kind = string.sub(line, 1, 2)
    if kind == "N;" then
      local id, at, by, body = string.match(line, "^N;([^;]+);(%d+);([^;]*);([^;]*)$")
      if not id or #result.news >= 5 then return nil end
      result.news[#result.news + 1] = { id = decode(id), at = tonumber(at), by = decode(by), text = string.sub(decode(body), 1, 300) }
    elseif kind == "P;" then
      local id, max, closes, total, q = string.match(line, "^P;([^;]+);(%d+);(%d+);(%d+);([^;]*)$")
      if not id or #result.polls >= 5 then return nil end
      poll = { id = decode(id), max = tonumber(max), closes = tonumber(closes) ~= 0 and tonumber(closes) or nil, total = tonumber(total), q = decode(q), opts = {}, counts = {} }
      result.polls[#result.polls + 1] = poll
    elseif kind == "O;" then
      local count, label = string.match(line, "^O;(%d+);([^;]*)$")
      if not poll or not count or #poll.opts >= 25 then return nil end
      poll.opts[#poll.opts + 1] = decode(label)
      poll.counts[#poll.counts + 1] = tonumber(count)
    else
      return nil
    end
  end
  for _, p in ipairs(result.polls) do if #p.opts < 2 then return nil end end
  return result
end

local lastShare, heardStamp, heardAt, replyScheduled, incoming = 0, nil, 0, false, nil

function board.share()
  local current = board.current()
  if not current or clock() - lastShare < COOLDOWN then return false end
  if heardStamp and heardStamp >= current.at and clock() - heardAt < COOLDOWN then return false end
  local payload = board.encode(current)
  local total = math.ceil(#payload / PART)
  if total < 1 or total > MAX_PARTS then return false end
  lastShare = clock()
  for part = 1, total do
    send(string.format("BOARD|%s|%d|%d|%s", current.at, part, total, string.sub(payload, (part - 1) * PART + 1, part * PART)))
  end
  return true
end

local function scheduleReply()
  if replyScheduled then return end
  replyScheduled = true
  local current = board.current()
  local quick = (current and current.source == "companion") or (ns.isOfficer and ns.isOfficer())
  local delay = quick and 1 + math.random() * 4 or 6 + math.random() * 9
  local function reply() replyScheduled = false; board.share() end
  if C_Timer and C_Timer.After then C_Timer.After(delay, reply) else reply() end
end

local function receiveBoard(text, sender)
  local stamp, part, total, payload = string.match(text, "^BOARD|([^|]+)|(%d+)|(%d+)|(.*)$")
  part, total = tonumber(part), tonumber(total)
  if not stamp or #stamp > 40 or not part or not total or total < 1 or total > MAX_PARTS or part < 1 or part > total or #payload > PART then return end
  if ns.util and ns.util.tooFarAhead and ns.util.tooFarAhead(stamp) then return end
  if not heardStamp or stamp >= heardStamp or clock() - heardAt >= COOLDOWN then heardStamp, heardAt = stamp, clock() end
  local current = board.current()
  if current and current.at >= stamp then return end
  if not incoming or incoming.stamp ~= stamp or incoming.sender ~= sender or clock() - incoming.started > 60 then
    incoming = { stamp = stamp, sender = sender, total = total, started = clock(), parts = {}, received = 0 }
  end
  if incoming.total ~= total then return end
  if not incoming.parts[part] then incoming.parts[part] = payload; incoming.received = incoming.received + 1 end
  if incoming.received ~= total then return end
  local whole = table.concat(incoming.parts)
  incoming = nil
  local decoded = board.decode(whole)
  local s = state()
  if not decoded or not s then return end
  decoded.at, decoded.from = stamp, sender
  s.relayed = decoded
  board.prune()
  if ns.onBoardChange then pcall(ns.onBoardChange) end
end

-- A guildmate's vote, as the game reported its sender: kept for this PC's companion to carry.
local function receiveVote(text, sender)
  local id, picks, at = string.match(text, "^VOTE|([%w_%-]+)|([%d,]*)|(%d+)$")
  at = tonumber(at)
  if not id or #id > 40 or not at or at > clock() + 600 or clock() - at > KEEP then return end
  local list = {}
  for v in string.gmatch(picks, "(%d+)") do
    local n = tonumber(v)
    if not n or n < 1 or n > 25 or #list >= 25 then return end
    list[#list + 1] = n
  end
  local s = state()
  if not s then return end
  local key = id .. "@" .. sender
  local old = s.heard[key]
  if old and (tonumber(old.at) or 0) >= at then return end
  s.heard[key] = { poll = id, picks = list, at = at, name = sender }
  board.prune()
end

function board.request()
  local current = board.current()
  send("REQ|" .. ((current and current.at) or "0"))
end

-- ---------------------------------------------------------------------
-- Text for chat and the page.
-- ---------------------------------------------------------------------
local function when(epoch)
  epoch = tonumber(epoch)
  if not epoch or epoch <= 0 then return "" end
  return date and date("%Y-%m-%d %H:%M", epoch) or tostring(epoch)
end
board.when = when

function board.sourceText(current)
  if not current then return L("Nothing from Discord yet. The board fills in after your companion syncs, or when a guildmate who has it shares it.") end
  if current.off then return L("Your officers turned the guild board off (in Discord: /poll board).") end
  if current.source == "guild" then return string.format(L("Shared by %s (from Discord)."), ns.displayName and ns.displayName(current.from) or tostring(current.from)) end
  return L("From Discord, through your companion.")
end

function board.alertsOn()
  local s = state()
  return not (s and s.alerts == false)
end
function board.setAlerts(on)
  local s = state()
  if s then s.alerts = on and true or false end
end

-- Once per new post, at login: "Guild news from Ann: ...". Off with /guilded board alerts off.
function board.newsAlert()
  local current, s = board.current(), state()
  local newest = current and not current.off and current.news and current.news[1]
  if not (s and newest and newest.id) or s.seenNews == newest.id then return false end
  s.seenNews = newest.id
  if not board.alertsOn() or not ns.message then return false end
  ns.message(string.format(L("Guild news from %s: %s (the Board page of the Guilded window)"), tostring(newest.by or "?"), tostring(newest.text or "")))
  return true
end

local function chatLines()
  local current = board.current()
  ns.message(board.sourceText(current))
  if not current or current.off then return end
  if #current.news == 0 then ns.message(L("No guild news yet.")) end
  for i = 1, math.min(3, #current.news) do
    local item = current.news[i]
    ns.message(string.format("  %s - %s: %s", when(item.at), tostring(item.by or "?"), tostring(item.text or "")))
  end
  if #current.polls == 0 then ns.message(L("No open polls.")) end
  for index, poll in ipairs(current.polls) do
    ns.message(string.format(L("Poll %d: %s"), index, tostring(poll.q or "")))
    local picks = board.picks(poll)
    local picked = {}
    for _, v in ipairs(picks) do picked[v] = true end
    for i, label in ipairs(poll.opts or {}) do
      ns.message(string.format("   %d. %s (%d)%s", i, tostring(label), tonumber(poll.counts and poll.counts[i]) or 0, picked[i] and (" - " .. L("your pick")) or ""))
    end
  end
end

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["board"] = function(args)
  args = args or {}
  local action = string.lower(args[1] or "")
  if action == "vote" then
    local current = board.current()
    local poll = current and current.polls and current.polls[tonumber(args[2]) or 0]
    if not poll then ns.message(L("Use /guilded board vote <poll number> <option number> (see /guilded board).")) return end
    local picks, why = board.vote(poll.id, args[3])
    if not picks then ns.message(why) return end
    ns.message(L("Vote saved. Your companion sends it to Discord with your next sync (or a guildmate's does)."))
    return
  end
  if action == "post" then
    local row, why = board.post(table.concat(args, " ", 2))
    if not row then ns.message(why) return end
    ns.message(L("News saved. Your companion posts it in Discord with your next sync."))
    return
  end
  if action == "alerts" then
    local on = string.lower(args[2] or "") ~= "off"
    board.setAlerts(on)
    ns.message(on and L("Guild news alerts at login are on.") or L("Guild news alerts at login are off."))
    return
  end
  chatLines()
end
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded board [vote <poll> <option> | post <text> | alerts on|off] - officers' news and open polls")

-- ---------------------------------------------------------------------
-- The Board page of the Guilded window.
-- ---------------------------------------------------------------------
local function newBar(parent, width)
  local bar = CreateFrame("StatusBar", nil, parent)
  bar:SetWidth(width)
  bar:SetHeight(20)
  bar:SetStatusBarTexture(BAR_TEXTURE)
  bar:SetStatusBarColor(0.25, 0.55, 0.9)
  bar:SetMinMaxValues(0, 1)
  bar:SetValue(0)
  local back = bar:CreateTexture(nil, "BACKGROUND")
  back:SetAllPoints(bar)
  if back.SetColorTexture then back:SetColorTexture(0, 0, 0, 0.45) end
  bar.label = bar:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  bar.label:SetPoint("LEFT", bar, "LEFT", 4, 0)
  bar.label:SetJustifyH("LEFT")
  bar.count = bar:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  bar.count:SetPoint("RIGHT", bar, "RIGHT", -4, 0)
  bar.count:SetJustifyH("RIGHT")
  bar:Hide()
  return bar
end

local function clip(text, max)
  text = tostring(text or "")
  if #text <= max then return text end
  return string.sub(text, 1, max - 3) .. "..."
end

function board.render(view)
  if not view then return end
  board.prune()
  local current = board.current()
  view.header:SetText(board.sourceText(current))
  view.alertsButton:SetText(board.alertsOn() and L("News alerts: on") or L("News alerts: off"))
  local off = not current or current.off
  local news = not off and current.news or {}
  local polls = not off and current.polls or {}
  for i, row in ipairs(view.newsRows) do
    local item = news[i]
    if item then
      row:SetText(string.format("|cffffd100%s - %s|r  %s", when(item.at), tostring(item.by or "?"), clip(item.text, 220)))
      row:Show()
    else
      row:SetText(i == 1 and not off and L("No guild news yet.") or "")
    end
  end
  if view.pollIndex > #polls then view.pollIndex = math.max(1, #polls) end
  local poll = polls[view.pollIndex]
  view.pollCount:SetText(#polls > 0 and string.format(L("Poll %d of %d"), view.pollIndex, #polls) or (off and "" or L("No open polls.")))
  if #polls > 1 then view.prevButton:Show(); view.nextButton:Show() else view.prevButton:Hide(); view.nextButton:Hide() end
  view.question:SetText(poll and clip(poll.q, 250) or "")
  local picks, pending = board.picks(poll)
  local picked = {}
  for _, v in ipairs(picks) do picked[v] = true end
  local opts = poll and poll.opts or {}
  if view.optionOffset >= #opts then view.optionOffset = 0 end
  local most = 1
  for i = 1, #opts do most = math.max(most, tonumber(poll.counts and poll.counts[i]) or 0) end
  for row = 1, OPTION_ROWS do
    local index = view.optionOffset + row
    local bar, button = view.optionBars[row], view.voteButtons[row]
    if poll and opts[index] then
      local count = tonumber(poll.counts and poll.counts[index]) or 0
      bar:SetMinMaxValues(0, most)
      bar:SetValue(count)
      if picked[index] then bar:SetStatusBarColor(1, 0.82, 0) else bar:SetStatusBarColor(0.25, 0.55, 0.9) end
      bar.label:SetText(index .. ". " .. clip(opts[index], 60))
      bar.count:SetText(tostring(count))
      bar:Show()
      button.pollId, button.option = poll.id, index
      button:SetText(picked[index] and ((tonumber(poll.max) or 1) > 1 and L("Remove") or L("Your pick")) or L("Vote"))
      button:Show()
    else
      bar:Hide(); button:Hide()
    end
  end
  if #opts > OPTION_ROWS then view.moreButton:Show() else view.moreButton:Hide() end
  local note = ""
  if poll then
    local max = tonumber(poll.max) or 1
    note = max > 1 and string.format(L("Pick up to %d. %d member(s) voted."), max, tonumber(poll.total) or 0) or string.format(L("One vote each, you can change it. %d member(s) voted."), tonumber(poll.total) or 0)
    if poll.closes then note = note .. " " .. string.format(L("Closes %s."), when(poll.closes)) end
    if pending then note = note .. " " .. L("Your vote goes to Discord with your next sync (/reload or logging out), or through a guildmate's companion.") end
  end
  view.note:SetText(note)
  local officer = ns.isOfficer and ns.isOfficer() and not off
  if officer then view.postBox:Show(); view.postButton:Show() else view.postBox:Hide(); view.postButton:Hide() end
end

function board.buildPage(page, helpers)
  local width = helpers.width or 580
  local view = { page = page, newsRows = {}, optionBars = {}, voteButtons = {}, pollIndex = 1, optionOffset = 0 }
  local function redraw() board.refresh() end
  view.header = helpers.at(helpers.newLabel(page, "", "GameFontDisableSmall"), page, 0, 0)
  view.header:SetWidth(width - 140)
  view.alertsButton = helpers.newButton(page, "News alerts: on", 130, function() board.setAlerts(not board.alertsOn()); redraw() end)
  view.alertsButton:SetPoint("TOPRIGHT", page, "TOPRIGHT", 0, 4)
  local newsHeading = helpers.at(helpers.newLabel(page, "Guild news", "GameFontNormal"), page, 0, -22)
  local above = newsHeading
  for i = 1, NEWS_ROWS do
    local row = helpers.newLabel(page, "", "GameFontHighlightSmall")
    row:SetPoint("TOPLEFT", above, "BOTTOMLEFT", 0, i == 1 and -6 or -4)
    row:SetWidth(width)
    if row.SetWordWrap then row:SetWordWrap(true) end
    if row.SetMaxLines then row:SetMaxLines(2) end
    view.newsRows[i] = row
    above = row
  end
  local pollHeading = helpers.at(helpers.newLabel(page, "Open polls", "GameFontNormal"), page, 0, -140)
  view.pollCount = helpers.newLabel(page, "", "GameFontHighlightSmall")
  view.pollCount:SetPoint("LEFT", pollHeading, "RIGHT", 12, 0)
  view.prevButton = helpers.newButton(page, "Previous", 80, function() view.pollIndex = math.max(1, view.pollIndex - 1); view.optionOffset = 0; redraw() end)
  view.prevButton:SetPoint("TOPRIGHT", page, "TOPRIGHT", -86, -136)
  view.nextButton = helpers.newButton(page, "Next", 80, function() view.pollIndex = view.pollIndex + 1; view.optionOffset = 0; redraw() end)
  view.nextButton:SetPoint("TOPRIGHT", page, "TOPRIGHT", 0, -136)
  view.question = helpers.newLabel(page, "", "GameFontHighlight")
  view.question:SetPoint("TOPLEFT", pollHeading, "BOTTOMLEFT", 0, -12)
  view.question:SetWidth(width)
  for row = 1, OPTION_ROWS do
    local bar = newBar(page, width - 110)
    bar:SetPoint("TOPLEFT", page, "TOPLEFT", 0, -196 - (row - 1) * 24)
    view.optionBars[row] = bar
    local button = helpers.newButton(page, "Vote", 100, function(self)
      local picks, why = board.vote(self.pollId, self.option)
      if not picks and ns.message then ns.message(why) end
      redraw()
    end)
    button:SetPoint("LEFT", bar, "RIGHT", 8, 0)
    button:Hide()
    view.voteButtons[row] = button
  end
  view.moreButton = helpers.newButton(page, "More options", 120, function() view.optionOffset = view.optionOffset + OPTION_ROWS; redraw() end)
  view.moreButton:SetPoint("TOPLEFT", page, "TOPLEFT", 0, -196 - OPTION_ROWS * 24)
  view.note = helpers.newLabel(page, "", "GameFontDisableSmall")
  view.note:SetPoint("TOPLEFT", page, "TOPLEFT", 0, -196 - OPTION_ROWS * 24 - 28)
  view.note:SetWidth(width)
  if helpers.newEdit then
    view.postBox = helpers.newEdit(page, width - 150)
    view.postBox:SetPoint("TOPLEFT", page, "TOPLEFT", 6, -196 - OPTION_ROWS * 24 - 60)
    if view.postBox.SetMaxLetters then view.postBox:SetMaxLetters(500) end
  else
    view.postBox = CreateFrame("Frame", nil, page)
  end
  view.postButton = helpers.newButton(page, "Post news", 130, function()
    local text = view.postBox.GetText and view.postBox:GetText() or ""
    local row, why = board.post(text)
    if ns.message then ns.message(row and L("News saved. Your companion posts it in Discord with your next sync.") or why) end
    if row and view.postBox.SetText then view.postBox:SetText("") end
    redraw()
  end)
  view.postButton:SetPoint("TOPRIGHT", page, "TOPRIGHT", 0, -196 - OPTION_ROWS * 24 - 60)
  board.view = view
  page:HookScript("OnShow", redraw)
  return view
end

function board.refresh()
  local view = board.view
  if not view or (view.page and view.page.IsShown and not view.page:IsShown()) then return end
  local ok, err = pcall(board.render, view)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "guild board: " .. tostring(err)) end
end
ns.onBoardChange = board.refresh

-- ---------------------------------------------------------------------
-- Events: share at login, answer requests, hear boards and votes.
-- ---------------------------------------------------------------------
local frame = CreateFrame("Frame")
frame:RegisterEvent("PLAYER_ENTERING_WORLD")
frame:RegisterEvent("CHAT_MSG_ADDON")
local started = false
frame:SetScript("OnEvent", function(_, event, prefix, text, channel, sender)
  local ok, err = pcall(function()
    if event == "PLAYER_ENTERING_WORLD" then
      if ns.comm and ns.comm.register then ns.comm.register(PREFIX) end
      if started then return end
      started = true
      local function later()
        board.prune()
        local current = board.current()
        if current and current.source == "companion" then board.share() end
        board.request()
        -- Votes still waiting: said again once, for a guildmate's companion to carry.
        local s = state()
        for id, vote in pairs(s and s.votes or {}) do sayVote(id, vote) end
        board.newsAlert()
      end
      if C_Timer and C_Timer.After then C_Timer.After(30, later) end
      return
    end
    if not (ns.comm and ns.comm.accept(prefix, text, channel, sender, PREFIX)) or channel ~= "GUILD" or secret(text) or secret(sender) then return end
    sender = ns.normalizeName and ns.normalizeName(sender) or sender
    if not sender or sender == (ns.playerName and ns.playerName()) or (ns.isGuildMember and not ns.isGuildMember(sender)) then return end
    if string.sub(text, 1, 4) == "REQ|" then
      local current = board.current()
      if current and current.at > string.sub(text, 5) then scheduleReply() end
    elseif string.sub(text, 1, 6) == "BOARD|" then receiveBoard(text, sender)
    elseif string.sub(text, 1, 5) == "VOTE|" then receiveVote(text, sender) end
  end)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "guild board: " .. tostring(err)) end
end)
