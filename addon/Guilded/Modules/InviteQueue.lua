-- 8.5 batch 3 (#14): the "To invite" panel for officers. Players write their full character name in the Discord
-- guild-invite channel; the officer's companion brings the waiting names into GuildedInvites (Standings.lua). Each row has
-- its own Invite button: one click runs /ginvite for that name (a secure macro button: the game refuses the invite API to addons). Nothing is invited
-- automatically, and the list never leaves this computer. The bot puts the check mark on Discord when the character
-- shows up in a roster upload; the panel also hides names that are already in the guild.
local _, ns = ...
ns = ns or {}
local module = {}
ns.inviteQueue = module
local function L(s) return ns.L and ns.L(s) or s end
local function db() return ns.getDb and ns.getDb() end
local function nowSeconds() return (GetServerTime and GetServerTime()) or (time and time()) or 0 end
local RECENT_SECONDS = 600
local MAX_ROWS = 12

local function key(name) return string.lower((string.gsub(tostring(name or ""), "%s+", " "))) end

-- What the game answered to /ginvite, per name (English strings of the game's own messages; the client's
-- localized global strings are used when it has them): notfound, inguild, already (invited), declined, joined.
local function fmtPattern(fmt)
  if type(fmt) ~= "string" then return nil end
  local p = string.gsub(fmt, "[%^%$%(%)%.%[%]%*%+%-%?]", "%%%0")
  p = string.gsub(p, "%%s", "(.+)")
  p = string.gsub(p, "%%d", "(%%d+)")
  return "^" .. p .. "$"
end
local ANSWERS = {
  { "notfound", "ERR_GUILD_PLAYER_NOT_FOUND_S", "Player %s not found." },
  { "notfound", "ERR_CHAT_PLAYER_NOT_FOUND_S", "No player named '%s' is currently playing." },
  { "inguild", "ERR_ALREADY_IN_GUILD_S", "%s is already in a guild." },
  { "already", "ERR_ALREADY_INVITED_TO_GUILD_S", "%s has already been invited to a guild." },
  { "declined", "ERR_GUILD_DECLINE_S", "%s declines your guild invitation." },
  { "joined", "ERR_GUILD_JOIN_S", "%s has joined the guild." }
}
local patterns
local function answerPatterns()
  if patterns then return patterns end
  patterns = {}
  for _, entry in ipairs(ANSWERS) do
    local fmt = _G[entry[2]] or entry[3]
    local pat = fmtPattern(fmt)
    if pat then patterns[#patterns + 1] = { entry[1], pat } end
    local en = fmtPattern(entry[3])
    if en and en ~= pat then patterns[#patterns + 1] = { entry[1], en } end
  end
  return patterns
end

local function officer() return ns.isOfficer and ns.isOfficer() end

local function guildKeys()
  local keys = {}
  if not (GetNumGuildMembers and GetGuildRosterInfo) then return keys end
  local total = select(1, GetNumGuildMembers()) or 0
  for i = 1, total do
    local ok, name = pcall(GetGuildRosterInfo, i)
    if ok and type(name) == "string" then
      keys[key((string.gsub(name, "%-.*$", "")))] = true
    end
  end
  return keys
end

-- Waiting names: { { name, at, invitedAt } }, oldest first. Names already in the guild are left out.
function module.list()
  if not officer() then return nil, L("Current officer access is required.") end
  local data = _G.GuildedInvites
  if type(data) ~= "table" or type(data.names) ~= "table" then return {} end
  local d, inGuild, out, at = db() or {}, guildKeys(), {}, nowSeconds()
  d.inviteSent = type(d.inviteSent) == "table" and d.inviteSent or {}
  d.inviteState = type(d.inviteState) == "table" and d.inviteState or {}
  d.inviteRemoved = type(d.inviteRemoved) == "table" and d.inviteRemoved or {}
  for _, row in ipairs(data.names) do
    local k = type(row) == "table" and type(row.name) == "string" and key(row.name)
    if k and row.name ~= "" and not inGuild[k] then
      local sent = d.inviteSent[k]
      local answer = d.inviteState[k]
      -- A row the officer removed stays gone until the requester posts the name again (a newer post).
      local removed = d.inviteRemoved[k]
      local hidden = removed and (type(row.at) ~= "string" or type(removed.postAt) ~= "string" or row.at <= removed.postAt)
      if not hidden and not (answer and answer.state == "joined") then
        -- An answer only counts for the click it followed.
        if answer and sent and answer.at < sent then answer = nil end
        out[#out + 1] = { name = row.name, at = row.at, sent = sent and (at - sent) < RECENT_SECONDS and sent or nil,
          state = answer and answer.state or nil }
      end
    end
  end
  return out
end

-- The Invite button shows "/ginvite First Last" in the copy box (util.inviteButton) for the officer to paste in chat: the
-- guild invite API and macro buttons are both refused on WoW Forever. This only checks the officer's rank.
function module.canInvite()
  if not officer() then return false, L("Current officer access is required.") end
  if CanGuildInvite and not CanGuildInvite() then return false, L("Your rank cannot invite to the guild.") end
  return true
end

-- Called after the Invite button's click (the line is in the copy box, not sent yet). Remembers the click so the row
-- shows "(invited)"; the game prints its own error when the name is wrong. util.inviteButton says what to do in chat.
function module.markInvited(name)
  if type(name) ~= "string" or name == "" or name:find("%c") then return false, L("Unknown or ambiguous character.") end
  local d = db()
  if d then d.inviteSent = type(d.inviteSent) == "table" and d.inviteSent or {}; d.inviteSent[key(name)] = nowSeconds() end
  module.selected = key(name)
  if d and d.inviteState then d.inviteState[key(name)] = nil end
  return true, string.format(L("Copy %s for the highlighted row (Ctrl+C), paste it in your chat box (Ctrl+V) and press Enter."), "/ginvite " .. name)
end

-- The game's reply to a /ginvite: shown on the row in place of "(invited)".
function module.onSystemMessage(text)
  if type(text) ~= "string" or (ns.isSecret and ns.isSecret(text)) then return false end
  local d = db()
  if not d then return false end
  for _, entry in ipairs(answerPatterns()) do
    local name = string.match(text, entry[2])
    if name then
      local k = key((string.gsub(name, "%-.*$", "")))
      d.inviteState = type(d.inviteState) == "table" and d.inviteState or {}
      d.inviteSent = type(d.inviteSent) == "table" and d.inviteSent or {}
      -- Only names the officer sent from this panel (or that waited in it) are tracked.
      if d.inviteSent[k] or entry[1] == "joined" then
        d.inviteState[k] = { state = entry[1], at = nowSeconds() }
        module.refresh()
        return true
      end
    end
  end
  return false
end

-- Remove button on a "not found" row: the row stays gone (and is never sent again) until the name is posted again.
function module.remove(name)
  local d = db()
  if not d or type(name) ~= "string" then return false end
  local k = key(name)
  local postAt
  for _, row in ipairs((type(_G.GuildedInvites) == "table" and _G.GuildedInvites.names) or {}) do
    if type(row) == "table" and type(row.name) == "string" and key(row.name) == k then postAt = row.at end
  end
  d.inviteRemoved = type(d.inviteRemoved) == "table" and d.inviteRemoved or {}
  d.inviteRemoved[k] = { at = nowSeconds(), postAt = postAt }
  if d.inviteSent then d.inviteSent[k] = nil end
  if d.inviteState then d.inviteState[k] = nil end
  module.refresh()
  return true
end

local STATE_TEXT = {
  notfound = "not found: check the spelling", inguild = "already in a guild", already = "already invited",
  declined = "declined", joined = "joined"
}
local function rowText(item)
  if item.state and STATE_TEXT[item.state] then return item.name .. " (" .. L(STATE_TEXT[item.state]) .. ")" end
  return item.name .. (item.sent and (" (" .. L("invited") .. ")") or "")
end

function module.text()
  local rows, err = module.list()
  if not rows then return err end
  if #rows == 0 then return L("Nobody is waiting for a guild invite.") end
  local lines = {}
  for _, row in ipairs(rows) do
    if row.state ~= "notfound" then lines[#lines + 1] = "/ginvite " .. row.name end
  end
  if #lines == 0 then return L("Nobody is waiting for a guild invite.") end
  return table.concat(lines, "\n")
end

local window, rows = nil, {}
local function refreshNow()
  if not window then return end
  local list, err = module.list()
  window.status:SetText(list and string.format(L("%d waiting for a guild invite."), #list) or tostring(err))
  for i = 1, MAX_ROWS do
    local row, item = rows[i], list and list[i]
    if item then
      row.label:SetText(rowText(item))
      row.item = item; row.label:Show()
      -- A name the game could not find is not sent again: Remove instead of Invite.
      if item.state == "notfound" then
        row.button:Hide(); row.button.setInvite(nil); row.remove:Show()
      else
        row.remove:Hide(); row.button:Show(); row.button.setInvite(item.name)
      end
      if row.highlight then
        if module.selected and module.selected == key(item.name) then row.highlight:Show() else row.highlight:Hide() end
      end
    else
      row.item = nil; row.label:Hide(); row.button:Hide(); row.button.setInvite(nil); row.remove:Hide()
      if row.highlight then row.highlight:Hide() end
    end
  end
  window.empty:SetText(list and #list == 0 and L("Nobody is waiting for a guild invite.") or "")
  window.more:SetText(list and #list > MAX_ROWS and string.format(L("+%d more"), #list - MAX_ROWS) or "")
end

-- Rows and labels change together, out of combat (kept from the secure-button days; plain buttons would allow more).
function module.refresh()
  if not window then return end
  if ns.util and ns.util.afterCombat then ns.util.afterCombat("inviteQueue.refresh", refreshNow, true) else refreshNow() end
end

local build
function module.open()
  if not officer() then if ns.message then ns.message(L("Current officer access is required.")) end; return end
  if window then window:Show(); module.refresh(); return end
  -- Opened in combat, the window is built afterwards.
  if ns.util and ns.util.afterCombat then ns.util.afterCombat("inviteQueue.open", function() build() end) else build() end
end

function build()
  if window then window:Show(); module.refresh(); return end
  local f = CreateFrame("Frame", "GuildedInviteQueuePanel", UIParent, "BasicFrameTemplateWithInset")
  window = f; f:SetSize(420, 120 + MAX_ROWS * 26); f:SetPoint("CENTER"); f:SetMovable(true); f:EnableMouse(true)
  f:RegisterForDrag("LeftButton"); f:SetScript("OnDragStart", f.StartMoving); f:SetScript("OnDragStop", f.StopMovingOrSizing)
  if f.TitleText then f.TitleText:SetText(L("To invite")) end
  if UISpecialFrames then table.insert(UISpecialFrames, "GuildedInviteQueuePanel") end
  local function text(y)
    local t = f:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    t:SetPoint("TOPLEFT", 18, y); t:SetWidth(380); t:SetJustifyH("LEFT"); return t
  end
  f.status = text(-34)
  f.empty = text(-60)
  f.more = text(-90 - MAX_ROWS * 26)
  for i = 1, MAX_ROWS do
    local y = -56 - (i - 1) * 26
    local highlight = f:CreateTexture(nil, "BACKGROUND")
    if highlight.SetColorTexture then highlight:SetColorTexture(1, 0.82, 0, 0.18) end
    highlight:SetPoint("TOPLEFT", 12, y + 2); highlight:SetSize(396, 24); highlight:Hide()
    local label = f:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    label:SetPoint("TOPLEFT", 18, y - 4); label:SetWidth(280); label:SetJustifyH("LEFT")
    local button = ns.util.inviteButton(f, "guild", L("Invite"), 90, 22, function(name)
      local ok, message = module.markInvited(name)
      module.refresh()
      f.status:SetText(message or "")
    end)
    button:SetPoint("TOPLEFT", 310, y)
    local remove = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
    remove:SetSize(90, 22); remove:SetText(L("Remove")); remove:SetPoint("TOPLEFT", 310, y); remove:Hide()
    remove:SetScript("OnClick", function()
      local item = rows[i] and rows[i].item
      if item then module.remove(item.name) end
    end)
    rows[i] = { label = label, button = button, remove = remove, highlight = highlight }
  end
  f:SetScript("OnShow", function() module.refresh() end)
  module.refresh()
end

-- A quiet reminder in chat after login (officers only): how many names wait, once per count.
local notified
function module.notify()
  if not officer() then return end
  local list = module.list()
  if not list or #list == 0 or notified == #list then return end
  notified = #list
  if ns.message then ns.message(string.format(L("%d waiting for a guild invite. Open them with /guilded invites."), #list)) end
end

local frame = CreateFrame("Frame")
pcall(frame.RegisterEvent, frame, "PLAYER_ENTERING_WORLD")
pcall(frame.RegisterEvent, frame, "CHAT_MSG_SYSTEM")
frame:SetScript("OnEvent", function(_, event, text)
  if event == "CHAT_MSG_SYSTEM" then
    if officer() then pcall(module.onSystemMessage, text) end
    return
  end
  if C_Timer and C_Timer.After then C_Timer.After(25, function() pcall(module.notify) end) end
end)

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHelp = ns.commandHelp or {}
ns.commandHandlers.invites = function(args)
  local sub = args and args[1] and string.lower(args[1])
  if sub == "list" then
    if ns.showCopyText then ns.showCopyText(module.text(), L("To invite")) end
  else module.open() end
end
table.insert(ns.commandHelp, { officer = true, text = "/guilded invites - officers: players waiting for a guild invite (from Discord), one click each" })
