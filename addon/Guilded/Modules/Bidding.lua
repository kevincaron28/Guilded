-- In-game GP bidding. An officer opens bidding on an item; raiders bid GP.
--
--   * Raiders with the addon get a popup (item, minimum, time left, their PR
--     from Discord) and bid from it. The bid goes to the officer as a
--     private addon message.
--   * Anyone else (pugs, no addon) whispers the officer a number, e.g. 25.
--   * Bids are sealed. When time runs out (or the officer closes early) the
--     highest bid wins; ties go to the higher PR, then to whoever bid first.
--   * Nothing is recorded until the officer presses Award. Award runs the
--     normal /guilded loot and /guilded gp commands, so the GP gets a ledger id and
--     imports into Discord like any other entry.
--
-- Chat: one raid-chat line to open, one to announce the winner (or that
-- nobody bid). Bid confirmations are private.
local addonName, ns = ...
ns = ns or {}

local PREFIX = "GuildedBid"
-- A saved session that ran out more than this long ago is dropped at login, not resumed.
local STALE_SESSION_SECONDS = 10 * 60
local DEFAULT_SECONDS = 30
local MAX_BID = 100000

local bidding = { current = nil, incoming = nil }
ns.bidding = bidding

local popup

-- Player-facing text goes through ns.L (Locale.lua) for English/French.
local function L(text) return ns.L and ns.L(text) or text end

-- ---------------------------------------------------------------------
-- Messaging
-- ---------------------------------------------------------------------

local function groupChannel()
  local channel = ns.util.groupChannel()
  if channel then return channel end
  -- A running test raid (/guilded sim start) lets an officer try bidding alone:
  -- nothing is sent to anyone, fake raiders bid with /guilded sim bids.
  local raid = ns.getActiveRaid and ns.getActiveRaid()
  if raid and raid.test then return "TEST" end
  return nil
end

local function sendAddon(text, channel, target)
  if channel == "TEST" then return end
  ns.comm.send(PREFIX, text, channel, target)
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

local function clock()
  return GetTime and GetTime() or time()
end

-- The officer's open auction is saved, so a /reload (or a disconnect) mid-bidding picks it
-- up again instead of leaving raiders' popups pointing at nothing. Times are kept on the
-- server clock because GetTime() restarts with the client.
local function persist()
  local d = ns.getDb and ns.getDb()
  if not d then return end
  local auction = bidding.current
  if not auction then d.biddingSession = nil return end
  local saved = {}
  for key, value in pairs(auction) do saved[key] = value end
  saved.endsAt = nil
  saved.endsAtServer = ns.util.serverTime() + math.floor((auction.endsAt or clock()) - clock() + 0.5)
  d.biddingSession = saved
end

local function changed()
  persist()
  if ns.onBiddingChange then pcall(ns.onBiddingChange) end
end

-- "[Name]" out of an item link (or the text itself), for ledger reasons.
local function plainItem(item)
  return string.match(item or "", "%[(.-)%]") or item
end

-- ---------------------------------------------------------------------
-- Officer side
-- ---------------------------------------------------------------------

local function prFor(name)
  local standing = ns.getStanding and ns.getStanding(name)
  return standing and standing.pr or 0
end

-- Bids best first: amount, then PR, then earliest.
local function rankedBids(auction)
  local list = {}
  for name, bid in pairs(auction.bids) do
    table.insert(list, { name = name, amount = bid.amount, at = bid.at, pr = prFor(name) })
  end
  table.sort(list, function(a, b)
    if a.amount ~= b.amount then return a.amount > b.amount end
    if a.pr ~= b.pr then return a.pr > b.pr end
    return a.at < b.at
  end)
  return list
end
bidding.rankedBids = rankedBids

local function closeBidding(id)
  local auction = bidding.current
  if not auction or auction.id ~= id or not auction.open then return end
  auction.open = false
  local ranked = rankedBids(auction)
  sendAddon("CLOSE|" .. auction.id, auction.channel)
  if #ranked == 0 then
    announce(string.format(L("No bids on %s."), auction.item))
    bidding.current = nil
  else
    auction.winner = ranked[1]
    ns.message(string.format("Bidding closed: %s leads with %d GP (%d bid%s). Press Award or /guilded bid award.",
      auction.winner.name, auction.winner.amount, #ranked, #ranked == 1 and "" or "s"))
  end
  changed()
end

local function openBidding(args)
  if not ns.isOfficer() then ns.message("Only officers can run loot bidding."); return end
  if bidding.current then ns.message("Bidding is already running for " .. bidding.current.item .. ". Award or cancel it first."); return end
  local channel = groupChannel()
  if not channel then ns.message("Be in a raid or party to run bidding (or start a test raid: /guilded sim start)."); return end
  local minimum = tonumber(args[1])
  local last = #args
  local seconds = DEFAULT_SECONDS
  if last >= 3 and tonumber(args[last]) then
    seconds = math.max(10, math.min(300, math.floor(tonumber(args[last]))))
    last = last - 1
  end
  local item = table.concat(args, " ", 2, last)
  if not minimum or minimum < 0 or item == "" then
    ns.message("Usage: /guilded bid start <min GP> <item or shift-click link> [seconds]")
    return
  end
  local id = string.format("%d%03d", time(), math.random(0, 999))
  bidding.current = {
    id = id, item = item, min = math.floor(minimum), seconds = seconds,
    endsAt = clock() + seconds, bids = {}, open = true, channel = channel
  }
  sendAddon(string.format("OPEN|%s|%d|%d|%s", id, bidding.current.min, seconds, item), channel)
  announce(string.format(L("Bidding on %s: min %d GP, %ds. Whisper me a number (e.g. 25) or use the Guilded popup."),
    item, bidding.current.min, seconds))
  if C_Timer and C_Timer.After then C_Timer.After(seconds, function() closeBidding(id) end) end
  changed()
end

-- Records a bid. `reply` says how to confirm: "addon" (private addon
-- message), "whisper" (chat whisper, for players without the addon), or
-- nil (simulated bids).
local function addBid(name, amount, replyTo, reply)
  local auction = bidding.current
  if not auction or not auction.open or not name then return end
  amount = math.floor(tonumber(amount) or -1)
  local problem
  if amount < auction.min then problem = string.format(L("Minimum bid is %d GP."), auction.min)
  elseif amount > MAX_BID then problem = "That bid is too high." end
  if problem then
    if reply == "addon" then sendAddon("REJECT|" .. auction.id .. "|" .. problem, "WHISPER", replyTo)
    elseif reply == "whisper" then sendChat("[Guilded] " .. problem, "WHISPER", replyTo) end
    return
  end
  auction.bids[name] = { amount = amount, at = clock() }
  if reply == "addon" then sendAddon("ACK|" .. auction.id .. "|" .. amount, "WHISPER", replyTo)
  elseif reply == "whisper" then sendChat("[Guilded] " .. string.format(L("Bid of %d GP received for %s."), amount, plainItem(auction.item)), "WHISPER", replyTo) end
  changed()
end
bidding.addBid = addBid

local function awardBidding()
  local auction = bidding.current
  if not auction then ns.message("No bidding to award."); return end
  if auction.open then closeBidding(auction.id) end
  auction = bidding.current
  if not auction or not auction.winner then return end
  local winner = auction.winner
  local item = plainItem(auction.item)
  ns.runCommand("loot " .. winner.name .. " " .. item .. " " .. winner.amount)
  ns.runCommand("gp " .. winner.name .. " " .. winner.amount .. " Bid: " .. item)
  sendAddon(string.format("AWARD|%s|%s|%d", auction.id, winner.name, winner.amount), auction.channel)
  announce(string.format(L("%s goes to %s for %d GP."), auction.item, winner.name, winner.amount))
  bidding.current = nil
  changed()
end

local function cancelBidding()
  local auction = bidding.current
  if not auction then ns.message("No bidding to cancel."); return end
  sendAddon("CLOSE|" .. auction.id, auction.channel)
  announce(string.format(L("Bidding on %s cancelled."), auction.item))
  bidding.current = nil
  changed()
end

-- Picks up an auction saved before a /reload: still open -> the timer runs on; its time ran
-- out while reloading -> it closes a few seconds after login (the group is known by then).
function bidding.restore()
  local d = ns.getDb and ns.getDb()
  local saved = d and d.biddingSession
  if type(saved) ~= "table" or not saved.id or bidding.current then return end
  local left = (tonumber(saved.endsAtServer) or 0) - ns.util.serverTime()
  -- Ran out long ago (logged out mid-loot and came back later): nobody is waiting for it any
  -- more, so it is dropped rather than closed and awarded by itself.
  if saved.open and left < -STALE_SESSION_SECONDS then
    d.biddingSession = nil
    ns.message(string.format("Bidding on %s from an earlier session ran out while you were away and was dropped.", plainItem(saved.item)))
    return
  end
  local auction = {}
  for key, value in pairs(saved) do auction[key] = value end
  auction.endsAtServer = nil
  auction.bids = type(auction.bids) == "table" and auction.bids or {}
  auction.endsAt = clock() + math.max(0, left)
  bidding.current = auction
  if auction.open and C_Timer and C_Timer.After then
    C_Timer.After(math.max(5, left), function() closeBidding(auction.id) end)
  end
  ns.message(string.format("Bidding on %s was restored after the reload%s.", plainItem(auction.item),
    auction.open and (left > 0 and string.format(" (%ds left)", left) or " and closes now") or " (waiting for Award)"))
  if ns.onBiddingChange then pcall(ns.onBiddingChange) end
end

-- Short description for the tools window.
function bidding.statusText()
  local auction = bidding.current
  if not auction then return "No bidding running." end
  local ranked = rankedBids(auction)
  local lines = {}
  local left = math.max(0, math.floor(auction.endsAt - clock()))
  table.insert(lines, string.format("%s - min %d GP - %s", plainItem(auction.item), auction.min,
    auction.open and (left .. "s left") or "closed, waiting for Award"))
  for i = 1, math.min(8, #ranked) do
    local bid = ranked[i]
    table.insert(lines, string.format("%d. %s  %d GP  (PR %.2f)", i, bid.name, bid.amount, bid.pr))
  end
  if #ranked == 0 then table.insert(lines, "No bids yet.") end
  return table.concat(lines, "\n")
end

-- /guilded sim bids: fake raiders bid on the open item (test raids).
ns.simulateBids = function()
  local auction = bidding.current
  if not auction or not auction.open then ns.message("Open bidding first (/guilded bid start ...)."); return end
  local names = ns.SIM_NAMES or {}
  for i = 1, math.min(5, #names) do
    addBid(names[i], auction.min + math.random(0, 4) * 5, nil, nil)
  end
  ns.message("Added fake bids. Close or wait for the timer, then Award.")
end

-- ---------------------------------------------------------------------
-- Raider side: the popup
-- ---------------------------------------------------------------------

local function hidePopup()
  if popup then popup:Hide() end
end

local function updatePopup()
  local incoming = bidding.incoming
  if not popup or not incoming then return end
  local left = math.max(0, math.floor(incoming.endsAt - clock()))
  local standing = ns.getStanding and ns.getStanding(ns.playerName())
  popup.item:SetText(incoming.item)
  popup.info:SetText(string.format(L("Min %d GP   -   %ds left"), incoming.min, left) ..
    (standing and string.format(L("   -   your PR %.2f"), standing.pr) or ""))
  popup.mine:SetText(incoming.myBid and string.format(L("Your bid: %d GP"), incoming.myBid) or (incoming.problem or ""))
  if left <= 0 then hidePopup() end
end

local function buildPopup()
  popup = CreateFrame("Frame", "GuildedBidPopup", UIParent, BackdropTemplateMixin and "BackdropTemplate" or nil)
  popup:SetWidth(320)
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
  local title = popup:CreateFontString(nil, "OVERLAY", "GameFontNormal")
  title:SetPoint("TOP", popup, "TOP", 0, -14)
  title:SetText(L("Guilded - GP bidding"))
  popup.item = popup:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
  popup.item:SetPoint("TOP", popup, "TOP", 0, -34)
  popup.info = popup:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  popup.info:SetPoint("TOP", popup, "TOP", 0, -54)

  local box = CreateFrame("EditBox", nil, popup, "InputBoxTemplate")
  box:SetWidth(70)
  box:SetHeight(20)
  box:SetAutoFocus(false)
  box:SetNumeric(true)
  box:SetPoint("TOPLEFT", popup, "TOPLEFT", 30, -76)
  box:SetScript("OnEscapePressed", function(self) self:ClearFocus() end)
  popup.box = box

  local function placeBid()
    local incoming = bidding.incoming
    local amount = tonumber(box:GetText())
    if not incoming or not amount then return end
    incoming.problem = nil
    sendAddon("BID|" .. incoming.id .. "|" .. math.floor(amount), "WHISPER", incoming.officer)
    box:ClearFocus()
  end
  box:SetScript("OnEnterPressed", placeBid)

  local bid = CreateFrame("Button", nil, popup, "UIPanelButtonTemplate")
  bid:SetWidth(80)
  bid:SetHeight(22)
  bid:SetPoint("TOPLEFT", popup, "TOPLEFT", 110, -75)
  bid:SetText(L("Bid"))
  bid:SetScript("OnClick", placeBid)

  local pass = CreateFrame("Button", nil, popup, "UIPanelButtonTemplate")
  pass:SetWidth(80)
  pass:SetHeight(22)
  pass:SetPoint("TOPLEFT", popup, "TOPLEFT", 196, -75)
  pass:SetText(L("Pass"))
  pass:SetScript("OnClick", hidePopup)

  popup.mine = popup:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  popup.mine:SetPoint("TOP", popup, "TOP", 0, -108)
  popup:Hide()
end

local ticker

local function showPopup()
  local ok, err = pcall(function()
    if not popup then buildPopup() end
    popup.box:SetText(tostring(bidding.incoming.min))
    updatePopup()
    popup:Show()
  end)
  if not ok then ns.message("Bid popup failed: " .. tostring(err)) return end
  -- Countdown once a second while the popup is open.
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
ns.commandHandlers["bid"] = function(args)
  local action = string.lower(args[1] or "")
  table.remove(args, 1)
  if action == "start" then openBidding(args)
  elseif action == "close" then
    if not ns.isOfficer() then ns.message("Only officers can run loot bidding."); return end
    if bidding.current then closeBidding(bidding.current.id) end
  elseif action == "award" then
    if not ns.isOfficer() then ns.message("Only officers can run loot bidding."); return end
    awardBidding()
  elseif action == "cancel" then
    if not ns.isOfficer() then ns.message("Only officers can run loot bidding."); return end
    cancelBidding()
  elseif action == "status" then
    ns.message(bidding.statusText())
  else
    ns.message("/guilded bid start <min GP> <item> [seconds] | close | award | cancel | status")
  end
end
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, { officer = true, text = "/guilded bid start <min GP> <item> [seconds] | close | award | cancel | status - GP bidding" })

local function onEvent(_, event, ...)
  if event == "PLAYER_LOGIN" then
    ns.comm.register(PREFIX)
    bidding.restore()
  elseif event == "CHAT_MSG_WHISPER" then
    -- Players without the addon bid by whispering a number ("25" or "bid 25").
    if not bidding.current or not bidding.current.open then return end
    local text, sender = ...
    if ns.isSecret(text) or ns.isSecret(sender) then return end
    local amount = string.match(text or "", "^%s*[Bb][Ii][Dd]%s+(%d+)%s*$") or string.match(text or "", "^%s*(%d+)%s*$")
    -- Only someone in your raid or party can bid; a number whispered by anyone else (a
    -- trade chat reply, a friend) is not a bid.
    if amount and (bidding.current.channel == "TEST" or ns.util.inMyGroup(sender)) then
      addBid(ns.normalizeName(sender), amount, sender, "whisper")
    end
  elseif event == "CHAT_MSG_ADDON" then
    local prefix, text, _, sender = ...
    if ns.isSecret(prefix) or ns.isSecret(text) or ns.isSecret(sender) or prefix ~= PREFIX then return end
    local name = ns.normalizeName(sender)
    if not name or name == ns.playerName() then return end
    local kind = string.match(text, "^(%u+)|")
    if kind == "BID" then
      local id, amount = string.match(text, "^BID|([^|]+)|(%d+)$")
      if bidding.current and bidding.current.id == id and ns.util.inMyGroup(sender) then addBid(name, amount, sender, "addon") end
    elseif kind == "OPEN" then
      -- Only an officer can open bidding for the raid.
      if not ns.isOfficerName(name) then return end
      local id, minimum, seconds, item = string.match(text, "^OPEN|([^|]+)|(%d+)|(%d+)|(.+)$")
      if not id then return end
      bidding.incoming = { id = id, min = tonumber(minimum), item = item, endsAt = clock() + tonumber(seconds), officer = sender }
      showPopup()
    elseif kind == "ACK" or kind == "REJECT" then
      local id, value = string.match(text, "^%u+|([^|]+)|(.+)$")
      local incoming = bidding.incoming
      if incoming and incoming.id == id then
        if kind == "ACK" then incoming.myBid = tonumber(value) else incoming.problem = value end
        updatePopup()
      end
    elseif kind == "CLOSE" then
      local id = string.match(text, "^CLOSE|(.+)$")
      if bidding.incoming and bidding.incoming.id == id then hidePopup() end
    elseif kind == "AWARD" then
      local id, winner, amount = string.match(text, "^AWARD|([^|]+)|([^|]+)|(%d+)$")
      if bidding.incoming and bidding.incoming.id == id then
        hidePopup()
        if winner == ns.playerName() then ns.message(string.format(L("You won %s for %s GP."), bidding.incoming.item, amount)) end
        bidding.incoming = nil
      end
    end
  end
end

local frame = CreateFrame("Frame")
frame:RegisterEvent("PLAYER_LOGIN")
frame:RegisterEvent("CHAT_MSG_WHISPER")
frame:RegisterEvent("CHAT_MSG_ADDON")
frame:SetScript("OnEvent", function(...)
  if ns.moduleActive and not ns.moduleActive("bidding") then return end -- /guilded modules
  local ok, err = pcall(onEvent, ...)
  if not ok and ns.logDiagnostic then ns.logDiagnostic("LUA_ERROR", "Guilded bidding: " .. tostring(err)) end
end)
