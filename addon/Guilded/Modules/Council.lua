-- Loot council: response voting. An officer opens an item; raiders answer with
-- how much they want it, and the officers decide.
--
--   * Raiders with the addon get a popup with four buttons: BiS, Upgrade,
--     Off-spec, Pass. It also sends what they wear in that slot, so the council
--     can see how big the upgrade is. The answer goes to the officer as a
--     private addon message.
--   * Anyone else whispers the officer one word: bis, upgrade, os or pass.
--   * Answers are ranked BiS, then Upgrade, then Off-spec; inside each group the
--     higher PR comes first, then whoever answered first. Players whose
--     wishlist (from Discord) names the item are marked. This is a guide: the
--     officer awards to whoever the council picks.
--   * Nothing is recorded until the officer awards. Award runs the normal
--     /guilded loot command (and /guilded gp when a price is given), so it lands in
--     the ledger and loot history like any other award.
--
-- The same window also runs EPGP priority loot (a core's loot system, see Loot.lua): every item
-- has a set GP price, raiders answer "I want it", Off-spec or Pass, and the highest PR among those
-- who want it wins and pays that price (an off-spec answer only wins when nobody wants it for
-- their main spec, and pays the core's off-spec share, 50% unless Discord says otherwise). A core
-- can set a minimum EP: players below it rank after everyone who has it. It is awarded by itself
-- when time runs out.
--
-- Council votes: when a loot council closes, the officers in the group get the answers and vote
-- (/guilded council vote <player or number>, or the Loot page). The host sees the count per
-- player; the host still awards.
--
-- Chat: one raid-chat line to open, one to announce the winner. Answers stay private.
local addonName, ns = ...
ns = ns or {}

local PREFIX = "GuildedLC"
-- A saved session that ran out more than this long ago is dropped at login, not resumed.
local STALE_SESSION_SECONDS = 10 * 60
local DEFAULT_SECONDS = 60
local MAX_GP = 100000

local council = { current = nil, incoming = nil }
ns.council = council

local popup

local function L(text) return ns.L and ns.L(text) or text end

-- Answers, best first. Pass is kept but never ranked.
local TIERS = {
  bis = { rank = 1, label = "BiS", chat = "BiS" },
  up = { rank = 2, label = "Upgrade", chat = "Upgrade" },
  os = { rank = 3, label = "Off-spec", chat = "Off-spec" },
  want = { rank = 1, label = "I want it", chat = "Want" },
  pass = { rank = 9, label = "Pass", chat = "Pass" }
}
-- Which answers a kind of session takes, in popup order.
local KIND_TIERS = {
  council = { "bis", "up", "os", "pass" },
  priority = { "want", "os", "pass" }
}
local WORDS = {
  bis = "bis", upgrade = "up", up = "up", os = "os", offspec = "os", ["off-spec"] = "os", pass = "pass",
  want = "want", need = "want", yes = "want", ["+"] = "want"
}
local function takes(kind, tier)
  for _, allowed in ipairs(KIND_TIERS[kind or "council"] or KIND_TIERS.council) do
    if allowed == tier then return true end
  end
  return false
end
council.TIERS = TIERS

-- ---------------------------------------------------------------------
-- Messaging
-- ---------------------------------------------------------------------

local function groupChannel()
  local channel = ns.util.groupChannel()
  if channel then return channel end
  -- A running test raid (/guilded sim start) lets an officer try it alone.
  local raid = ns.getActiveRaid and ns.getActiveRaid()
  if raid and raid.test then return "TEST" end
  return nil
end

local function sendAddon(text, channel, target)
  if channel == "TEST" then return end
  return ns.comm.send(PREFIX, text, channel, target)
end

local function sendChat(text, channel, target)
  if channel == "TEST" then return end
  pcall(function()
    if C_ChatInfo and C_ChatInfo.SendChatMessage then
      C_ChatInfo.SendChatMessage(text, channel, nil, target)
    elseif SendChatMessage then
      SendChatMessage(text, channel, nil, target)
    end
  end)
end

local function announce(text)
  ns.message(text)
  local channel = groupChannel()
  if channel then sendChat("[Guilded] " .. text, channel) end
end

local function plainItem(item)
  return string.match(item or "", "%[(.-)%]") or item
end

local function clock()
  return GetTime and GetTime() or time()
end

-- The officer's open session is saved (like Bidding.lua does), so a /reload mid-council
-- picks it up again. Times are kept on the server clock.
local function persist()
  local d = ns.getDb and ns.getDb()
  if not d then return end
  local session = council.current
  if not session then d.councilSession = nil return end
  local saved = {}
  for key, value in pairs(session) do saved[key] = value end
  saved.endsAt = nil
  saved.endsAtServer = ns.util.serverTime() + math.floor((session.endsAt or clock()) - clock() + 0.5)
  d.councilSession = saved
end

local function changed()
  persist()
  if ns.onCouncilChange then pcall(ns.onCouncilChange) end
end

-- ---------------------------------------------------------------------
-- What the player wears in the slot of an item (sent with the answer)
-- ---------------------------------------------------------------------

local SLOTS = {
  INVTYPE_HEAD = { 1 }, INVTYPE_NECK = { 2 }, INVTYPE_SHOULDER = { 3 }, INVTYPE_CLOAK = { 15 },
  INVTYPE_CHEST = { 5 }, INVTYPE_ROBE = { 5 }, INVTYPE_WRIST = { 9 }, INVTYPE_HAND = { 10 },
  INVTYPE_WAIST = { 6 }, INVTYPE_LEGS = { 7 }, INVTYPE_FEET = { 8 }, INVTYPE_FINGER = { 11, 12 },
  INVTYPE_TRINKET = { 13, 14 }, INVTYPE_WEAPON = { 16, 17 }, INVTYPE_2HWEAPON = { 16 },
  INVTYPE_WEAPONMAINHAND = { 16 }, INVTYPE_WEAPONOFFHAND = { 17 }, INVTYPE_SHIELD = { 17 },
  INVTYPE_HOLDABLE = { 17 }, INVTYPE_RANGED = { 18 }, INVTYPE_RANGEDRIGHT = { 18 },
  INVTYPE_THROWN = { 18 }, INVTYPE_RELIC = { 18 }
}

-- "Name (ilvl); Name (ilvl)" for what is worn where `item` would go, or "".
local function equippedFor(item)
  local text = ""
  pcall(function()
    if not (GetItemInfoInstant and GetInventoryItemLink) then return end
    local _, _, _, equipLoc = GetItemInfoInstant(item)
    local slots = SLOTS[equipLoc]
    if not slots then return end
    local parts = {}
    for _, slot in ipairs(slots) do
      local link = GetInventoryItemLink("player", slot)
      if link then
        local name, _, _, level = GetItemInfo(link)
        name = string.gsub(name or plainItem(link) or "?", "[|;]", "")
        table.insert(parts, level and string.format("%s (%d)", name, level) or name)
      end
    end
    text = table.concat(parts, "; ")
  end)
  return text
end
council.equippedFor = equippedFor

-- ---------------------------------------------------------------------
-- Officer side
-- ---------------------------------------------------------------------

local function prFor(name)
  -- A core with its own point pool ranks by that pool (Loot.lua).
  if ns.loot and ns.loot.prFor then return ns.loot.prFor(name) end
  local standing = ns.getStanding and ns.getStanding(name)
  return standing and standing.pr or 0
end

-- True when the player's Discord wishlist names this item.
local function wishlisted(name, item)
  if not (ns.getItemInsight and name) then return false end
  local key = ns.tooltip and ns.tooltip.itemKey and ns.tooltip.itemKey(plainItem(item))
  local info = key and ns.getItemInsight(key)
  if not (info and info.wish) then return false end
  for _, entry in ipairs(info.wish) do
    if entry[1] == name then return true end
  end
  return false
end

local function epFor(name)
  if ns.loot and ns.loot.epFor then return ns.loot.epFor(name) end
  local standing = ns.getStanding and ns.getStanding(name)
  return standing and standing.ep or 0
end

local function voteCounts(session)
  local counts = {}
  for _, candidate in pairs(session.votes or {}) do counts[candidate] = (counts[candidate] or 0) + 1 end
  return counts
end

-- Answers that count, best first: tier, then PR, then earliest.
local function rankedResponses(session)
  local list = {}
  local minEp = tonumber(session.minEp) or 0
  local votes = voteCounts(session)
  for name, r in pairs(session.responses) do
    if r.tier ~= "pass" then
      table.insert(list, {
        name = name, tier = r.tier, at = r.at, gear = r.gear, pr = prFor(name),
        wish = wishlisted(name, session.item), votes = votes[name] or 0,
        belowMin = minEp > 0 and epFor(name) < minEp,
        reserved = ns.reserve and ns.reserve.isReserved and ns.reserve.isReserved(name, session.item) or false
      })
    end
  end
  table.sort(list, function(a, b)
    if session.kind == "priority" then
      -- EPGP priority: players with the core's minimum EP first, then main spec before
      -- off-spec, then the highest PR.
      if a.belowMin ~= b.belowMin then return not a.belowMin end
      local ra, rb = TIERS[a.tier].rank, TIERS[b.tier].rank
      if ra ~= rb then return ra < rb end
      if a.pr ~= b.pr then return a.pr > b.pr end
      return a.at < b.at
    end
    -- Someone who soft-reserved the item comes before everyone else.
    if a.reserved ~= b.reserved then return a.reserved end
    local ra, rb = TIERS[a.tier].rank, TIERS[b.tier].rank
    if ra ~= rb then return ra < rb end
    if a.pr ~= b.pr then return a.pr > b.pr end
    return a.at < b.at
  end)
  return list
end
council.ranked = function() return council.current and rankedResponses(council.current) or {} end

local function passCount(session)
  local n = 0
  for _, r in pairs(session.responses) do
    if r.tier == "pass" then n = n + 1 end
  end
  return n
end

local awardSession

local function closeSession(id)
  local session = council.current
  if not session or session.id ~= id or not session.open then return end
  session.open = false
  sendAddon("CLOSE|" .. session.id, session.channel)
  local ranked = rankedResponses(session)
  if #ranked == 0 then
    announce(string.format(L("Nobody wants %s."), session.item))
    council.current = nil
  elseif session.kind == "priority" then
    -- The set price goes to the highest PR: no decision left to make.
    changed()
    awardSession({})
    return
  else
    ns.message(string.format("Council closed: %d want %s. Look at the list, then award: /guilded council award <player> [GP].",
      #ranked, plainItem(session.item)))
    council.sendList(session, ranked)
  end
  changed()
end

-- The answers go to the other officers in the group (a whisper each), so they can vote.
-- "LIST|<id>|<item>|Name:tier;Name:tier" (as many as fit in one message).
function council.sendList(session, ranked)
  if session.channel == "TEST" or not ns.groupMembers then return 0 end
  local head = string.format("LIST|%s|%s|", session.id, string.gsub(plainItem(session.item) or "?", "|", ""))
  local parts = {}
  local size = string.len(head)
  for _, r in ipairs(ranked) do
    local part = r.name .. ":" .. r.tier
    if size + string.len(part) + 1 > 250 then break end
    table.insert(parts, part)
    size = size + string.len(part) + 1
  end
  local sent = 0
  for _, name in ipairs(ns.groupMembers()) do
    if name ~= ns.playerName() and ns.isOfficerName and ns.isOfficerName(name) then
      sendAddon(head .. table.concat(parts, ";"), "WHISPER", name)
      sent = sent + 1
    end
  end
  return sent
end

-- An officer's vote (host side): one vote per officer, the latest counts.
function council.addVote(officer, id, candidate)
  local session = council.current
  if not (session and session.id == id and session.kind ~= "priority" and officer and candidate) then return false end
  if not session.responses[candidate] or session.responses[candidate].tier == "pass" then return false end
  session.votes = session.votes or {}
  session.votes[officer] = candidate
  changed()
  return true
end

-- opts: { kind = "priority", price = GP } for EPGP priority loot; nothing for a loot council.
local function openSession(args, opts)
  opts = opts or {}
  if not ns.isOfficer() then ns.message("Only officers can run the loot council."); return end
  if council.current then ns.message("The council is already looking at " .. council.current.item .. ". Award or cancel it first."); return end
  local channel = groupChannel()
  if not channel then ns.message("Be in a raid or party to run the loot council (or start a test raid: /guilded sim start)."); return end
  local last = #args
  local seconds = DEFAULT_SECONDS
  if last >= 2 and tonumber(args[last]) then
    seconds = math.max(15, math.min(600, math.floor(tonumber(args[last]))))
    last = last - 1
  end
  local item = table.concat(args, " ", 1, last)
  if item == "" then ns.message("Usage: /guilded council start <item or shift-click link> [seconds]"); return end
  local id = string.format("%d%03d", time(), math.random(0, 999))
  council.current = {
    id = id, item = item, seconds = seconds, endsAt = clock() + seconds,
    responses = {}, votes = {}, open = true, channel = channel, kind = opts.kind or "council", price = opts.price,
    minEp = ns.loot and ns.loot.minEp and ns.loot.minEp() or 0,
    offspec = ns.loot and ns.loot.offspecPercent and ns.loot.offspecPercent() or 50
  }
  if opts.kind == "priority" then
    sendAddon(string.format("OPENP|%s|%d|%d|%s", id, seconds, opts.price or 0, item), channel)
    announce(string.format(L("%s costs %d GP. Want it? Answer in the Guilded popup, or whisper me want, os or pass. The highest PR gets it (%ds)."),
      item, opts.price or 0, seconds))
  else
    sendAddon(string.format("OPEN|%s|%d|%s", id, seconds, item), channel)
    announce(string.format(L("Loot council on %s: answer in the Guilded popup, or whisper me bis, upgrade, os or pass (%ds)."), item, seconds))
  end
  if C_Timer and C_Timer.After then C_Timer.After(seconds, function() closeSession(id) end) end
  changed()
end

-- Records an answer. `reply`: "addon" (private addon message), "whisper" (chat
-- whisper, for players without the addon), or nil (simulated).
local function addResponse(name, tier, gear, replyTo, reply)
  local session = council.current
  if not session or not session.open or not name or not TIERS[tier] or not takes(session.kind, tier) then return end
  local previous = session.responses[name]
  session.responses[name] = { tier = tier, at = clock(), gear = gear ~= "" and gear or nil }
  if not previous or previous.tier ~= tier then
    ns.message(string.format(L("%s answered %s for %s."), name, L(TIERS[tier].label), plainItem(session.item)))
  end
  if reply == "addon" then sendAddon("ACK|" .. session.id .. "|" .. tier, "WHISPER", replyTo)
  elseif reply == "whisper" then
    sendChat("[Guilded] " .. string.format(L("Got it: %s for %s."), TIERS[tier].chat, plainItem(session.item)), "WHISPER", replyTo)
  end
  changed()
end
council.addResponse = addResponse

awardSession = function(args)
  local session = council.current
  if not session then ns.message("No loot council to award."); return end
  if session.open then closeSession(session.id) end
  session = council.current
  if not session then return end
  local name = args[1] and ns.normalizeName and ns.normalizeName(args[1])
  local ranked = rankedResponses(session)
  if not name then
    if not ranked[1] then ns.message("Say who gets it: /guilded council award <player> [GP]."); return end
    name = ranked[1].name
  end
  -- Priority loot costs the set price unless the officer names another one; an off-spec win
  -- costs the core's off-spec share of it.
  local gp = math.floor(tonumber(args[2]) or session.price or 0)
  local answer = session.responses[name]
  local offspecWin = not tonumber(args[2]) and session.price and answer and answer.tier == "os"
  if offspecWin then gp = math.floor(session.price * (tonumber(session.offspec) or 50) / 100 + 0.5) end
  if gp < 0 or gp > MAX_GP then ns.message("That GP is out of range."); return end
  local item = plainItem(session.item)
  ns.runCommand("loot " .. name .. " " .. item .. " " .. gp)
  if gp > 0 then ns.runCommand("gp " .. name .. " " .. gp .. " " .. (session.kind == "priority" and "Priority: " or "Council: ") .. item) end
  sendAddon(string.format("AWARD|%s|%s", session.id, name), session.channel)
  if session.kind == "priority" then
    announce(string.format(L("%s goes to %s for %d GP."), session.item, name, gp) .. (offspecWin and (" " .. L("(off-spec)")) or ""))
  else
    announce(string.format(L("%s goes to %s."), session.item, name))
  end
  council.current = nil
  changed()
end

local function cancelSession()
  local session = council.current
  if not session then ns.message("No loot council to cancel."); return end
  sendAddon("CLOSE|" .. session.id, session.channel)
  announce(string.format(L("Loot council on %s cancelled."), session.item))
  council.current = nil
  changed()
end

-- Picks up a session saved before a /reload (see persist above).
function council.restore()
  local d = ns.getDb and ns.getDb()
  local saved = d and d.councilSession
  if type(saved) ~= "table" or not saved.id or council.current then return end
  local left = (tonumber(saved.endsAtServer) or 0) - ns.util.serverTime()
  -- Ran out long ago (logged out mid-loot and came back later): nobody is waiting for it any
  -- more, so it is dropped rather than closed and awarded by itself.
  if saved.open and left < -STALE_SESSION_SECONDS then
    d.councilSession = nil
    ns.message(string.format("Loot council on %s from an earlier session ran out while you were away and was dropped.", plainItem(saved.item)))
    return
  end
  local session = {}
  for key, value in pairs(saved) do session[key] = value end
  session.endsAtServer = nil
  session.responses = type(session.responses) == "table" and session.responses or {}
  session.endsAt = clock() + math.max(0, left)
  council.current = session
  if session.open and C_Timer and C_Timer.After then
    C_Timer.After(math.max(5, left), function() closeSession(session.id) end)
  end
  ns.message(string.format("Loot council on %s was restored after the reload%s.", plainItem(session.item),
    session.open and (left > 0 and string.format(" (%ds left)", left) or " and closes now") or " (waiting for Award)"))
  if ns.onCouncilChange then pcall(ns.onCouncilChange) end
end

-- Short description for the window.
function council.statusText(limit)
  local session = council.current
  if not session then return "No loot council running." end
  local ranked = rankedResponses(session)
  local left = math.max(0, math.floor(session.endsAt - clock()))
  local lines = { string.format("%s%s - %s", plainItem(session.item),
    session.kind == "priority" and string.format(" (%d GP, priority)", session.price or 0) or "",
    session.open and (left .. "s left") or "closed, waiting for Award") }
  for i = 1, math.min(limit or 10, #ranked) do
    local r = ranked[i]
    local extra = {}
    if r.reserved then table.insert(extra, "reserved") end
    if r.belowMin then table.insert(extra, "below min EP") end
    if r.votes > 0 then table.insert(extra, string.format("%d vote%s", r.votes, r.votes == 1 and "" or "s")) end
    if r.wish then table.insert(extra, "wishlist") end
    if r.gear then table.insert(extra, "wears " .. r.gear) end
    local answer = session.kind == "priority" and (r.tier == "os" and "off-spec" or "wants it") or TIERS[r.tier].label
    table.insert(lines, string.format("%d. %s  %s  (PR %.2f)%s", i, r.name, answer, r.pr,
      #extra > 0 and ("  - " .. table.concat(extra, ", ")) or ""))
  end
  if #ranked == 0 then table.insert(lines, "No answers yet.") end
  local passes = passCount(session)
  if passes > 0 then table.insert(lines, string.format("%d passed.", passes)) end
  return table.concat(lines, "\n")
end

-- EPGP priority loot (called by Loot.lua): the item at its set price.
function council.startPriority(item, price, seconds)
  openSession({ item, tostring(seconds or DEFAULT_SECONDS) }, { kind = "priority", price = math.floor(tonumber(price) or 0) })
end

-- /guilded sim council: fake raiders answer the open item (test raids).
ns.simulateCouncil = function()
  local session = council.current
  if not session or not session.open then ns.message("Open the loot council first (/guilded council start ...)."); return end
  local names = ns.SIM_NAMES or {}
  local pick = { "bis", "up", "os", "up", "pass" }
  if session.kind == "priority" then pick = { "want", "os", "pass", "want", "want" } end
  for i = 1, math.min(#pick, #names) do
    addResponse(names[i], pick[i], i == 2 and "Old Sword (60)" or "", nil, nil)
  end
  ns.message("Added fake answers. Close or wait for the timer, then Award.")
end

-- ---------------------------------------------------------------------
-- Raider side: the popup
-- ---------------------------------------------------------------------

local function hidePopup()
  if popup then popup:Hide() end
end

-- Shows the buttons this kind of session takes, side by side.
local function layoutButtons(kind)
  local x = 22
  for _, entry in ipairs(popup.buttons) do
    if takes(kind, entry.tier) then
      entry.button:ClearAllPoints()
      entry.button:SetPoint("TOPLEFT", popup, "TOPLEFT", x, -78)
      entry.button:Show()
      x = x + 80
    else
      entry.button:Hide()
    end
  end
end

local function updatePopup()
  local incoming = council.incoming
  if not popup or not incoming then return end
  local left = math.max(0, math.floor(incoming.endsAt - clock()))
  popup.title:SetText(incoming.kind == "priority" and L("Guilded - EPGP priority") or L("Guilded - loot council"))
  popup.item:SetText(incoming.item)
  popup.info:SetText(string.format(L("%ds left"), left) .. (incoming.kind == "priority" and string.format(L("   -   costs %d GP"), incoming.price or 0) or ""))
  layoutButtons(incoming.kind)
  popup.mine:SetText(incoming.pending and string.format(L("Sending: %s (awaiting confirmation)"), L(TIERS[incoming.pending].label))
    or (incoming.mine and string.format(L("Your answer: %s"), L(TIERS[incoming.mine].label)) or ""))
  if left <= 0 then hidePopup() end
end

local function respond(tier)
  local incoming = council.incoming
  if not incoming or not TIERS[tier] or not takes(incoming.kind, tier) or incoming.endsAt <= clock() then return end
  local gear = tier == "pass" and "" or equippedFor(incoming.item)
  local queued = sendAddon(string.format("RESP|%s|%s|%s", incoming.id, tier, gear), "WHISPER", incoming.officer)
  if queued == false then ns.message(L("Could not send your answer. Please try again.")); return end
  incoming.pending = tier
  updatePopup()
  -- Sent to the officer; the answer shows as accepted when the ACK comes back.
  if tier == "pass" then hidePopup() end
end

local function buildPopup()
  popup = CreateFrame("Frame", "GuildedCouncilPopup", UIParent, BackdropTemplateMixin and "BackdropTemplate" or nil)
  popup:SetWidth(360)
  popup:SetHeight(140)
  popup:SetPoint("TOP", UIParent, "TOP", 0, -140)
  popup:SetFrameStrata("DIALOG")
  popup:SetMovable(true)
  popup:EnableMouse(true)
  popup:RegisterForDrag("LeftButton")
  popup:SetScript("OnDragStart", popup.StartMoving)
  popup:SetScript("OnDragStop", popup.StopMovingOrSizing)
  if popup.SetBackdrop then
    popup:SetBackdrop({
      bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background",
      edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border",
      tile = true, tileSize = 32, edgeSize = 32,
      insets = { left = 11, right = 12, top = 12, bottom = 11 }
    })
  end
  popup.title = popup:CreateFontString(nil, "OVERLAY", "GameFontNormal")
  popup.title:SetPoint("TOP", popup, "TOP", 0, -14)
  popup.title:SetText(L("Guilded - loot council"))
  popup.item = popup:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
  popup.item:SetPoint("TOP", popup, "TOP", 0, -34)
  popup.info = popup:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  popup.info:SetPoint("TOP", popup, "TOP", 0, -54)

  -- One button per answer; a session shows the ones it takes (see layoutButtons).
  popup.buttons = {}
  for _, tier in ipairs({ "bis", "up", "os", "want", "pass" }) do
    local button = CreateFrame("Button", nil, popup, "UIPanelButtonTemplate")
    button:SetWidth(76)
    button:SetHeight(22)
    button:SetText(L(TIERS[tier].label))
    button:SetScript("OnClick", function() respond(tier) end)
    table.insert(popup.buttons, { tier = tier, button = button })
  end

  popup.mine = popup:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  popup.mine:SetPoint("TOP", popup, "TOP", 0, -110)
  popup:Hide()
end

local ticker

local function showPopup()
  local ok, err = pcall(function()
    if not popup then buildPopup() end
    updatePopup()
    popup:Show()
  end)
  if not ok then ns.message("Council popup failed: " .. tostring(err)) return end
  if ticker then ticker:Cancel() end
  if C_Timer and C_Timer.NewTicker then
    ticker = C_Timer.NewTicker(1, function()
      if not popup or not popup:IsShown() then if ticker then ticker:Cancel() end return end
      updatePopup()
    end)
  end
end

-- ---------------------------------------------------------------------
-- Commands and events
-- ---------------------------------------------------------------------

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["council"] = function(args)
  local action = string.lower(args[1] or "")
  table.remove(args, 1)
  local officerActions = { start = true, priority = true, close = true, award = true, cancel = true }
  if officerActions[action] and not ns.isOfficer() then
    ns.message("Only officers can run the loot council.")
    return
  end
  if action == "start" then openSession(args)
  elseif action == "priority" then
    -- /guilded council priority <GP> <item> [seconds]
    local price = tonumber(args[1])
    if not price or price < 0 or #args < 2 then ns.message("Usage: /guilded council priority <GP> <item or link> [seconds]"); return end
    table.remove(args, 1)
    openSession(args, { kind = "priority", price = math.floor(price) })
  elseif action == "close" then
    if council.current then closeSession(council.current.id) end
  elseif action == "award" then awardSession(args)
  elseif action == "cancel" then cancelSession()
  elseif action == "status" then ns.message(council.statusText())
  elseif action == "vote" then council.vote(args[1])
  elseif WORDS[action] then
    -- A member answering from the keyboard, e.g. /guilded council bis
    if council.incoming then respond(WORDS[action]) else ns.message("No loot council is open for you.") end
  else
    ns.message("/guilded council start <item> [seconds] | priority <GP> <item> [seconds] | close | award [player] [GP] | cancel | status | vote <player>  -  members: bis | upgrade | os | want | pass")
  end
end
ns.commandHandlers["lc"] = ns.commandHandlers["council"]

-- Officer side of a vote: the list from the host (council.voting), a name or a number from it.
function council.vote(choice)
  local voting = council.voting
  if not voting then ns.message("No loot council is waiting for your vote.") return end
  if not ns.isOfficer() then ns.message("Only officers vote on the loot council.") return end
  local pick = voting.candidates[tonumber(choice or "") or 0]
  if not pick then
    local wanted = ns.normalizeName and ns.normalizeName(choice)
    for _, entry in ipairs(voting.candidates) do
      if entry.name == wanted then pick = entry end
    end
  end
  if not pick then
    local names = {}
    for i, entry in ipairs(voting.candidates) do table.insert(names, string.format("%d. %s (%s)", i, entry.name, L(TIERS[entry.tier] and TIERS[entry.tier].label or entry.tier))) end
    ns.message(string.format(L("Vote for %s: %s  -  /guilded council vote <number or name>"), voting.item, table.concat(names, ", ")))
    return
  end
  sendAddon(string.format("VOTE|%s|%s", voting.id, pick.name), "WHISPER", voting.host)
  voting.mine = pick.name
  ns.message(string.format(L("Your vote: %s for %s."), pick.name, voting.item))
  if ns.onCouncilChange then pcall(ns.onCouncilChange) end
end
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, { officer = true, text = "/guilded council start <item> [seconds] | close | award [player] [GP] | cancel | status - loot council answers" })

local function onEvent(_, event, ...)
  if event == "PLAYER_LOGIN" then
    ns.comm.register(PREFIX)
    council.restore()
  elseif event == "CHAT_MSG_WHISPER" then
    -- Players without the addon answer by whispering one word.
    if not council.current or not council.current.open then return end
    local text, sender = ...
    if ns.isSecret(text) or ns.isSecret(sender) then return end
    local word = string.match(string.lower(text or ""), "^%s*([%a%-%+]+)%s*$")
    local tier = word and WORDS[word]
    -- Only someone in your raid or party can answer. Words like "yes" or "need" are everyday
    -- chat, and in priority loot the top answer is charged GP by itself.
    if tier and (council.current.channel == "TEST" or ns.util.inMyGroup(sender)) then
      addResponse(ns.normalizeName(sender), tier, "", sender, "whisper")
    end
  elseif event == "CHAT_MSG_ADDON" then
    local prefix, text, _, sender = ...
    if ns.isSecret(prefix) or ns.isSecret(text) or ns.isSecret(sender) or prefix ~= PREFIX then return end
    local name = ns.normalizeName(sender)
    if not name or name == ns.playerName() then return end
    local kind = string.match(text, "^(%u+)|")
    if kind == "RESP" then
      local id, tier, gear = string.match(text, "^RESP|([^|]+)|(%a+)|?(.*)$")
      if council.current and council.current.id == id and ns.util.inMyGroup(sender) then addResponse(name, tier, gear or "", sender, "addon") end
    elseif kind == "OPEN" then
      -- Only an officer can open the council for the raid.
      if not ns.isOfficerName(name) then return end
      local id, seconds, item = string.match(text, "^OPEN|([^|]+)|(%d+)|(.+)$")
      if not id then return end
      council.incoming = { id = id, item = item, endsAt = clock() + tonumber(seconds), officer = sender, kind = "council" }
      showPopup()
    elseif kind == "OPENP" then
      -- EPGP priority: the price comes with the message.
      if not ns.isOfficerName(name) then return end
      local id, seconds, price, item = string.match(text, "^OPENP|([^|]+)|(%d+)|(%d+)|(.+)$")
      if not id then return end
      council.incoming = { id = id, item = item, endsAt = clock() + tonumber(seconds), officer = sender, kind = "priority", price = tonumber(price) }
      showPopup()
    elseif kind == "ACK" then
      local id, tier = string.match(text, "^ACK|([^|]+)|(%a+)$")
      local incoming = council.incoming
      if incoming and incoming.id == id and TIERS[tier]
        and name == ns.normalizeName(incoming.officer)
        and (not incoming.pending or incoming.pending == tier) then
        local changedAnswer = incoming.mine ~= tier or incoming.pending ~= nil
        incoming.pending = nil
        incoming.mine = tier
        updatePopup()
        if changedAnswer then ns.message(string.format(L("Answer confirmed: %s for %s."), L(TIERS[tier].label), plainItem(incoming.item))) end
      end
    elseif kind == "LIST" then
      -- The host's answers, for officers to vote on.
      if not (ns.isOfficerName(name) and ns.isOfficer()) then return end
      local id, item, body = string.match(text, "^LIST|([^|]+)|([^|]*)|(.*)$")
      if not id then return end
      local candidates = {}
      for who, tier in string.gmatch(body, "([^:;]+):(%a+)") do table.insert(candidates, { name = who, tier = tier }) end
      if #candidates == 0 then return end
      council.voting = { id = id, item = item, host = sender, candidates = candidates }
      council.vote(nil)
      if ns.onCouncilChange then pcall(ns.onCouncilChange) end
    elseif kind == "VOTE" then
      if not ns.isOfficerName(name) then return end
      local id, candidate = string.match(text, "^VOTE|([^|]+)|(.+)$")
      if id and council.addVote(name, id, candidate) then
        ns.message(string.format(L("%s votes for %s."), name, candidate))
      end
    elseif kind == "CLOSE" then
      local id = string.match(text, "^CLOSE|(.+)$")
      if council.incoming and council.incoming.id == id then hidePopup() end
    elseif kind == "AWARD" then
      local id, winner = string.match(text, "^AWARD|([^|]+)|(.+)$")
      if council.voting and council.voting.id == id then council.voting = nil end
      if council.incoming and council.incoming.id == id then
        hidePopup()
        if winner == ns.playerName() then ns.message(string.format(L("You got %s."), council.incoming.item)) end
        council.incoming = nil
      end
    end
  end
end

local frame = CreateFrame("Frame")
frame:RegisterEvent("PLAYER_LOGIN")
frame:RegisterEvent("CHAT_MSG_WHISPER")
frame:RegisterEvent("CHAT_MSG_ADDON")
frame:SetScript("OnEvent", function(...)
  if ns.moduleActive and not ns.moduleActive("council") then return end -- /guilded modules
  local ok, err = pcall(onEvent, ...)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "Guilded loot council: " .. tostring(err)) end
end)
