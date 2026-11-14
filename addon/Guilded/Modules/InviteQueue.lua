-- 8.5 batch 3 (#14): the "To invite" panel for officers. Players write their full character name in the Discord
-- guild-invite channel; the officer's companion brings the waiting names into GuildedInvites (Standings.lua). Each row has
-- its own Invite button: one click runs /ginvite for that name (a secure macro button: the game refuses the invite API to addons). Nothing is invited
-- automatically, and the list never leaves this computer. The bot puts the check mark on Discord when the character
-- shows up in a roster upload; the panel also hides names that are already in the guild.
-- 9.3: the window shows only what needs action: "To invite now", then the invitations still pending (with the time since, and
-- Invite again), then a toggle for the handled names (already in another guild, or declined). Names already in OUR guild are gone.
-- The panel's own marks (invited, handled, removed) are local to this computer: the bot is told nothing new, it still checks a
-- name off when the character shows in a roster upload.
local _, ns = ...
ns = ns or {}
local module = {}
ns.inviteQueue = module
local function L(s) return ns.L and ns.L(s) or s end
local function db() return ns.getDb and ns.getDb() end
local function nowSeconds() return (GetServerTime and GetServerTime()) or (time and time()) or 0 end
-- Guesses, not game facts (the repo has no evidence of the client's real values; confirm in a real client): how long a sent
-- invitation counts as pending, from when the officer may invite again, and how long a declined row stays in the invited
-- section. A "declined" or "expired" system message acts at once.
-- (9.3.1) PENDING was 120 s: after a slow /reload (the officer's took three minutes) every invited name was back under
-- "To invite now" and would have been invited twice. A sent invitation is now kept as pending for 30 minutes (the marks
-- are saved in GuildedDB and survive /reload and relog); "Invite again" stays available after AGAIN_SECONDS.
local PENDING_SECONDS, AGAIN_SECONDS, DECLINED_KEEP = 1800, 60, 3600
module.PENDING_SECONDS, module.AGAIN_SECONDS = PENDING_SECONDS, AGAIN_SECONDS

-- Accents folded like the bot's foldKey (invite-queue.ts): codepoint+letter pairs for Latin-1 and Latin Extended-A.
local FOLD = {}
for cp, letter in string.gmatch("192a 193a 194a 195a 196a 197a 199c 200e 201e 202e 203e 204i 205i 206i 207i 209n 210o 211o 212o 213o 214o 216o 217u 218u 219u 220u 221y 224a 225a 226a 227a 228a 229a 231c 232e 233e 234e 235e 236i 237i 238i 239i 241n 242o 243o 244o 245o 246o 248o 249u 250u 251u 252u 253y 255y 256a 257a 258a 259a 260a 261a 262c 263c 264c 265c 266c 267c 268c 269c 270d 271d 272d 273d 274e 275e 276e 277e 278e 279e 280e 281e 282e 283e 284g 285g 286g 287g 288g 289g 290g 291g 292h 293h 296i 297i 298i 299i 300i 301i 302i 303i 304i 305i 308j 309j 310k 311k 313l 314l 315l 316l 317l 318l 321l 322l 323n 324n 325n 326n 327n 328n 332o 333o 334o 335o 336o 337o 340r 341r 342r 343r 344r 345r 346s 347s 348s 349s 350s 351s 352s 353s 354t 355t 356t 357t 360u 361u 362u 363u 364u 365u 366u 367u 368u 369u 370u 371u 372w 373w 374y 375y 376y 377z 378z 379z 380z 381z 382z", "(%d+)(%a)") do FOLD[tonumber(cp)] = letter end
local LOWER = {}
for cp, low in string.gmatch("198:230 208:240 222:254 294:295 306:307 319:320 330:331 338:339 358:359", "(%d+):(%d+)") do LOWER[tonumber(cp)] = tonumber(low) end
local function key(name)
  local text = string.gsub(tostring(name or ""), "([\195-\197])([\128-\191])", function(a, b)
    local cp = (string.byte(a) - 192) * 64 + string.byte(b) - 128
    if FOLD[cp] then return FOLD[cp] end
    local low = LOWER[cp]
    if low then return string.char(192 + math.floor(low / 64), 128 + low % 64) end
  end)
  return string.lower((string.gsub(text, "%s+", " ")))
end
module.foldKey = key

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
  { "joined", "ERR_GUILD_JOIN_S", "%s has joined the guild." },
  { "sent", "ERR_GUILD_INVITE_S", "You have invited %s to join your guild." },
  { "expired", "ERR_GUILD_INVITE_EXPIRED_S", "The guild invitation to %s has expired." }
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

-- "first last-realm" -> "first last", "realm". Only a dash after a complete first+last pair can be a realm; the same
-- rule as the bot (invite-queue.ts knownRealms/stripRealm): a hyphenated surname is not a realm.
local function splitRealm(folded)
  local pos = string.find(folded, "%-[^%-]*$")
  if not pos then return folded, nil end
  local base, suffix = string.sub(folded, 1, pos - 1), string.sub(folded, pos + 1)
  if suffix == "" or string.find(suffix, "%s") or not string.find(base, ".+ .+") then return folded, nil end
  return base, suffix
end

-- The guild's names without their realm, and the realms in use (a suffix at least two names carry and half or more do).
local function guildKeys()
  local names, keys, counts, realms = {}, {}, {}, {}
  if not (GetNumGuildMembers and GetGuildRosterInfo) then return keys, realms end
  local total = select(1, GetNumGuildMembers()) or 0
  for i = 1, total do
    local ok, name = pcall(GetGuildRosterInfo, i)
    if ok and type(name) == "string" then names[#names + 1] = key(name) end
  end
  for _, n in ipairs(names) do
    local _, suffix = splitRealm(n)
    if suffix then counts[suffix] = (counts[suffix] or 0) + 1 end
  end
  for suffix, count in pairs(counts) do
    if count >= 2 and count * 2 >= #names then realms[suffix] = true end
  end
  for _, n in ipairs(names) do
    local base, suffix = splitRealm(n)
    keys[(suffix and realms[suffix]) and base or n] = true
  end
  return keys, realms
end
module.splitRealm = splitRealm

-- A request posted with its realm ("Anna Smith-Realm") is clicked as "Anna Smith" (the Invite button drops the realm) and the game
-- answers with whichever form it likes, so a mark is looked up under the key as posted first, then without the realm (the same
-- rule as splitRealm: a hyphenated surname is only a realm when a full first+last pair stands before the dash).
local function markOf(tbl, k)
  if type(tbl) ~= "table" or not k then return nil end
  if tbl[k] ~= nil then return tbl[k], k end
  local base, suffix = splitRealm(k)
  if suffix and tbl[base] ~= nil then return tbl[base], base end
  return nil
end
-- An answer ("already in a guild", "joined") belongs to the post it followed; a newer post of the name is a new request.
local ANSWER_KEEP = 86400
local function answerStale(answer, row, at)
  if type(answer.postAt) == "string" and type(row.at) == "string" then return row.at > answer.postAt end
  return (at - (answer.at or 0)) >= ANSWER_KEEP
end
local function postTimeOf(k)
  local base, suffix = splitRealm(k)
  for _, row in ipairs((type(_G.GuildedInvites) == "table" and _G.GuildedInvites.names) or {}) do
    local rk = type(row) == "table" and type(row.name) == "string" and key(row.name)
    if rk and (rk == k or (suffix and rk == base) or select(1, splitRealm(rk)) == k) then return row.at end
  end
end

-- Waiting names in three groups (9.3): `todo` (still to invite, oldest first; a name the game could not find stays here with
-- its Remove button), `invited` (the line was copied or sent less than PENDING_SECONDS ago and the player has not joined, or
-- the player declined: the officer may invite again), and `handled` (already in another guild). A name already in OUR guild is
-- gone from all three. One row per name. Each item: { name, at, sent (seconds since the invite), state, copied (not yet confirmed
-- by a game message), again (the Invite again button shows) }.
local function classify(item)
  if item.state == "notfound" then return "todo" end
  if item.state == "inguild" then return "handled" end
  if item.sent then return "invited" end
  return "todo"
end
function module.sections()
  if not officer() then return nil, L("Current officer access is required.") end
  local out = { todo = {}, invited = {}, handled = {} }
  local data = _G.GuildedInvites
  if type(data) ~= "table" or type(data.names) ~= "table" then return out end
  local inGuild, realms = guildKeys()
  local d, at, seen = db() or {}, nowSeconds(), {}
  d.inviteSent = type(d.inviteSent) == "table" and d.inviteSent or {}
  d.inviteState = type(d.inviteState) == "table" and d.inviteState or {}
  d.inviteRemoved = type(d.inviteRemoved) == "table" and d.inviteRemoved or {}
  for _, row in ipairs(data.names) do
    local k = type(row) == "table" and type(row.name) == "string" and key(row.name)
    -- A request typed with its realm ("Anna Smith-RealmName") is checked without it too.
    local base, suffix = splitRealm(k or "")
    local joined = k and (inGuild[k] or (suffix and realms[suffix] and inGuild[base]))
    if k and row.name ~= "" and not joined and not seen[k] then
      local sent = markOf(d.inviteSent, k)
      local answer = markOf(d.inviteState, k)
      -- A row the officer removed stays gone until the requester posts the name again (a newer post).
      local removed = markOf(d.inviteRemoved, k)
      local hidden = removed and (type(row.at) ~= "string" or type(removed.postAt) ~= "string" or row.at <= removed.postAt)
      -- "Joined" and "already in a guild" belong to the post they followed: a newer post (or a day later) starts over.
      if answer and (answer.state == "joined" or answer.state == "inguild") and answerStale(answer, row, at) then answer = nil end
      if not hidden and not (answer and answer.state == "joined") then
        seen[k] = true
        -- An answer only counts for the click it followed.
        if answer and sent and answer.at < sent then answer = nil end
        -- "Already invited" means the invitation is pending: it counts from the game's answer.
        local since = sent or (answer and answer.state == "already" and answer.at) or nil
        local pending = since and (at - since) < PENDING_SECONDS and (at - since) or nil
        local state = answer and answer.state or nil
        if state == "already" and not pending then state = nil end
        if state == "sent" and not pending then state = nil end
        if state == "expired" then state = nil; pending = nil end
        -- A declined row stays in the invited section (the officer may be asked to try again) for DECLINED_KEEP seconds.
        if state == "declined" then
          if (at - answer.at) < DECLINED_KEEP then pending = at - answer.at else state = nil end
        end
        local item = { name = row.name, at = row.at, sent = pending, state = state }
        item.copied = pending ~= nil and state == nil
        item.again = pending ~= nil and (state == "declined" or pending >= AGAIN_SECONDS)
        local list = out[classify(item)]
        list[#list + 1] = item
      end
    end
  end
  -- The oldest invitation (closest to expiring) first.
  table.sort(out.invited, function(x, y) return x.sent > y.sent end)
  return out
end
-- What still needs an invite now.
function module.list()
  local sections, err = module.sections()
  if not sections then return nil, err end
  return sections.todo
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
      -- The name as the game wrote it, or without a realm (never cut at a hyphenated surname).
      local k = key(name)
      d.inviteState = type(d.inviteState) == "table" and d.inviteState or {}
      d.inviteSent = type(d.inviteSent) == "table" and d.inviteSent or {}
      local _, markKey = markOf(d.inviteSent, k)
      -- Only names the officer sent from this panel (or that waited in it) are tracked.
      if markKey or entry[1] == "joined" then
        k = markKey or k
        d.inviteState[k] = { state = entry[1], at = nowSeconds(), postAt = postTimeOf(k) }
        if entry[1] == "expired" then d.inviteSent[k] = nil end
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
  local base, suffix = splitRealm(k)
  for _, mk in ipairs(suffix and { k, base } or { k }) do
    if d.inviteSent then d.inviteSent[mk] = nil end
    if d.inviteState then d.inviteState[mk] = nil end
  end
  module.refresh()
  return true
end

local STATE_TEXT = {
  notfound = "not found: check the spelling", inguild = "already in a guild", already = "already invited",
  declined = "declined", joined = "joined"
}
local MAX_TODO, MAX_INVITED, MAX_HANDLED = 10, 8, 8
local ROW_HEIGHT = 26
local function rowText(item)
  if item.state and STATE_TEXT[item.state] then return item.name .. " (" .. L(STATE_TEXT[item.state]) .. ")" end
  return item.name
end
local function agoText(seconds)
  if seconds < 60 then return L("just now") end
  return string.format(L("%d min ago"), math.floor(seconds / 60))
end

function module.text()
  local rows, err = module.list()
  if not rows then return err end
  local lines = {}
  for _, row in ipairs(rows) do
    if row.state ~= "notfound" then lines[#lines + 1] = "/ginvite " .. row.name end
  end
  if #lines == 0 then return L("Nobody is waiting for a guild invite.") end
  return table.concat(lines, "\n")
end

local window
local pools = { todo = {}, invited = {}, handled = {} }
module.showHandled = false

local function place(region, y)
  region:ClearAllPoints(); region:SetPoint("TOPLEFT", 18, y)
end
-- The window shows only what needs action: "To invite now (N)" first, then the dimmer pending invitations, then a
-- small toggle for the handled names. The first name still to invite is highlighted and named in the header.
local function refreshNow()
  if not window then return end
  local sections, err = module.sections()
  if not sections then window.status:SetText(tostring(err)); return end
  local todo, invited, handled = sections.todo, sections.invited, sections.handled
  local first
  for _, item in ipairs(todo) do if item.state ~= "notfound" then first = item; break end end
  module.selected = first and key(first.name) or nil
  -- No row is highlighted and no copy box is shown until Invite is clicked, so the line says what to do, in order.
  do
    local fetched = type(_G.GuildedInvites) == "table" and _G.GuildedInvites.fetchedAt
    local whenText = ns.util and ns.util.whenText
    local when = type(fetched) == "string" and fetched ~= "" and whenText and whenText(fetched) or nil
    window.listAge:SetText(type(when) == "string" and string.format(L("List from %s. Reload after the companion syncs."), when) or "")
  end
  window.status:SetText(first and L("Click Invite on a row, then Ctrl+C, paste it in your chat box (Ctrl+V) and press Enter.") or "")
  local y = -70
  -- The window never grows past the screen: the rows that fit are shared out todo first, then invited, then handled.
  local screen = UIParent and UIParent.GetHeight and UIParent:GetHeight()
  if type(screen) ~= "number" or screen < 300 then screen = 768 end
  local budget = math.max(6, math.floor((screen * 0.9 - 230) / ROW_HEIGHT))
  local limits = {}
  limits.todo = math.min(MAX_TODO, budget); budget = budget - math.min(#todo, limits.todo)
  limits.invited = math.min(MAX_INVITED, math.max(budget, 0)); budget = budget - math.min(#invited, limits.invited)
  limits.handled = module.showHandled and math.min(MAX_HANDLED, math.max(budget, 0)) or 0
  local function fill(group, list, max, show)
    local pool = pools[group]
    for i = 1, #pool do
      local row, item = pool[i], list[i]
      if item and i <= max and show then
        place(row.label, y - 4); row.label:Show()
        row.item = item
        if group == "invited" then
          local note
          if item.state == "declined" then note = L("declined")
          elseif item.copied then note = string.format(L("copied %s, waiting"), agoText(item.sent or 0))
          else note = string.format(L("invited %s"), agoText(item.sent or 0)) end
          row.label:SetText(item.name .. "  |cff8c96a3" .. note .. "|r")
        else
          row.label:SetText(rowText(item))
        end
        if group == "invited" or group == "handled" then row.label:SetTextColor(0.65, 0.7, 0.76) else row.label:SetTextColor(1, 1, 1) end
        if group == "invited" and not item.again then
          row.button:Hide(); row.button.setInvite(nil); row.remove:Hide()
        elseif group ~= "handled" and item.state ~= "notfound" then
          row.button:ClearAllPoints(); row.button:SetPoint("TOPLEFT", 310, y); row.button:Show(); row.button.setInvite(item.name)
          row.remove:Hide()
        elseif group ~= "handled" then
          row.button:Hide(); row.button.setInvite(nil)
          row.remove:ClearAllPoints(); row.remove:SetPoint("TOPLEFT", 310, y); row.remove:Show()
        else
          row.button:Hide(); row.button.setInvite(nil); row.remove:Hide()
        end
        if row.highlight then
          if group == "todo" and first and item == first then
            row.highlight:ClearAllPoints(); row.highlight:SetPoint("TOPLEFT", 12, y + 2); row.highlight:Show()
          else row.highlight:Hide() end
        end
        y = y - ROW_HEIGHT
      else
        row.item = nil; row.label:Hide(); row.button:Hide(); row.button.setInvite(nil); row.remove:Hide()
        if row.highlight then row.highlight:Hide() end
      end
    end
  end
  -- To invite now
  place(window.todoHead, y); window.todoHead:SetText(string.format(L("To invite now (%d)"), #todo)); y = y - 22
  if #todo == 0 then
    place(window.empty, y); window.empty:SetText(L("Nobody to invite right now.")); y = y - 24
  else window.empty:SetText("") end
  fill("todo", todo, limits.todo, true)
  place(window.todoMore, y); window.todoMore:SetText(#todo > limits.todo and string.format(L("+%d more"), #todo - limits.todo) or "")
  if #todo > limits.todo then y = y - 18 end
  -- Invited, waiting for them to accept
  if #invited > 0 then
    y = y - 8
    place(window.invitedHead, y); window.invitedHead:SetText(string.format(L("Invited, waiting for them to accept (%d)"), #invited)); y = y - 22
  else window.invitedHead:SetText("") end
  fill("invited", invited, limits.invited, true)
  place(window.invitedMore, y); window.invitedMore:SetText(#invited > limits.invited and string.format(L("+%d more"), #invited - limits.invited) or "")
  if #invited > limits.invited then y = y - 18 end
  -- Handled: already in another guild, or declined
  if #handled > 0 then
    y = y - 8
    window.handledToggle:ClearAllPoints(); window.handledToggle:SetPoint("TOPLEFT", 14, y)
    window.handledToggle:SetText(string.format(L(module.showHandled and "Hide handled (%d)" or "Show handled (%d)"), #handled))
    window.handledToggle:Show(); y = y - 28
  else window.handledToggle:Hide() end
  fill("handled", handled, limits.handled, module.showHandled and #handled > 0)
  place(window.handledMore, y); window.handledMore:SetText(module.showHandled and #handled > limits.handled and string.format(L("+%d more"), #handled - limits.handled) or "")
  if module.showHandled and #handled > limits.handled then y = y - 18 end
  -- The marks are per officer: say so plainly (nothing is shared between officers' computers).
  place(window.help, y - 6); window.help:SetText(L("Marks stay on this computer: another officer may invite the same names.")); y = y - 24
  if window.SetHeight then window:SetHeight(math.min(screen * 0.95, math.max(160, -y + 24))) end
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
  window = f; f:SetSize(420, 420); f:SetPoint("CENTER"); f:SetMovable(true); f:EnableMouse(true); f:SetClampedToScreen(true)
  f:RegisterForDrag("LeftButton"); f:SetScript("OnDragStart", f.StartMoving); f:SetScript("OnDragStop", f.StopMovingOrSizing)
  if f.TitleText then f.TitleText:SetText(L("To invite")) end
  if UISpecialFrames then table.insert(UISpecialFrames, "GuildedInviteQueuePanel") end
  local function text(y, font)
    local t = f:CreateFontString(nil, "OVERLAY", font or "GameFontHighlightSmall")
    t:SetPoint("TOPLEFT", 18, y); t:SetWidth(380); t:SetJustifyH("LEFT"); return t
  end
  f.status = text(-30)
  -- When the companion last wrote the waiting names, so an old list is not mistaken for a complete one.
  f.listAge = text(-398, "GameFontDisableSmall")
  f.todoHead = text(-70, "GameFontNormal")
  f.empty = text(-92)
  f.todoMore = text(-92)
  f.invitedHead = text(-92, "GameFontDisableSmall")
  f.invitedMore = text(-92)
  f.handledMore = text(-92)
  f.help = text(-92, "GameFontDisableSmall")
  f.handledToggle = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
  f.handledToggle:SetSize(190, 22)
  f.handledToggle:SetScript("OnClick", function() module.showHandled = not module.showHandled; refreshNow() end)
  local function makeRow(group, index, buttonText)
    local highlight = f:CreateTexture(nil, "BACKGROUND")
    if highlight.SetColorTexture then highlight:SetColorTexture(1, 0.82, 0, 0.18) end
    highlight:SetSize(396, 24); highlight:Hide()
    local label = f:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    label:SetPoint("TOPLEFT", 18, -92); label:SetWidth(285); label:SetJustifyH("LEFT")
    local button = ns.util.inviteButton(f, "guild", buttonText, 100, 22, function(name)
      module.markInvited(name)
      module.refresh()
    end)
    button:SetPoint("TOPLEFT", 310, -92)
    button.copyAnchor = function() return window end -- the copy box opens below this window, not on top of the rows
    local remove = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
    remove:SetSize(100, 22); remove:SetText(L("Remove")); remove:SetPoint("TOPLEFT", 310, -92); remove:Hide()
    remove:SetScript("OnClick", function()
      local item = pools[group][index] and pools[group][index].item
      if item then module.remove(item.name) end
    end)
    pools[group][index] = { label = label, button = button, remove = remove, highlight = highlight }
  end
  for i = 1, MAX_TODO do makeRow("todo", i, L("Invite")) end
  for i = 1, MAX_INVITED do makeRow("invited", i, L("Invite again")) end
  for i = 1, MAX_HANDLED do makeRow("handled", i, L("Invite")) end
  f:SetScript("OnShow", function() module.refresh() end)
  -- A light ticker while the window is shown (OnUpdate does not run on a hidden frame): an invitation moves from "invited" to
  -- "to invite now" when it expires, without a click or a game message.
  local waited = 0
  f:SetScript("OnUpdate", function(_, elapsed)
    waited = waited + (tonumber(elapsed) or 0)
    if waited >= 30 then waited = 0; module.refresh() end
  end)
  module.refresh()
end

-- A quiet reminder in chat after login (officers only): how many names wait, once per count.
local notified
function module.notify()
  if not officer() then return end
  -- Counted only once the guild roster is loaded: before that every name looks like it still needs an invite.
  if GetNumGuildMembers and (select(1, GetNumGuildMembers()) or 0) == 0 then return end
  local list = module.list()
  if not list or #list == 0 or notified == #list then return end
  notified = #list
  if ns.message then ns.message(string.format(L("%d waiting for a guild invite. Open them with /guilded invites."), #list)) end
end

local frame = CreateFrame("Frame")
pcall(frame.RegisterEvent, frame, "PLAYER_ENTERING_WORLD")
pcall(frame.RegisterEvent, frame, "CHAT_MSG_SYSTEM")
pcall(frame.RegisterEvent, frame, "GUILD_ROSTER_UPDATE")
local rosterWait, rosterNotified
frame:SetScript("OnEvent", function(_, event, text)
  if event == "CHAT_MSG_SYSTEM" then
    if officer() then pcall(module.onSystemMessage, text) end
    return
  end
  if event == "GUILD_ROSTER_UPDATE" then
    -- The roster arrives in bursts: refresh an open window (and count the waiting names once) shortly after the last one.
    if rosterWait or not officer() then return end
    local function run()
      rosterWait = false
      if window and window.IsShown and window:IsShown() then module.refresh() end
      if not rosterNotified and GetNumGuildMembers and (select(1, GetNumGuildMembers()) or 0) > 0 then rosterNotified = true; pcall(module.notify) end
    end
    if C_Timer and C_Timer.After then rosterWait = true; C_Timer.After(2, run) else run() end
    return
  end
  if C_Timer and C_Timer.After then C_Timer.After(25, function() pcall(module.notify) end) end
end)

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHelp = ns.commandHelp or {}
ns.commandHandlers.invites = function(args)
  if not officer() then
    if ns.message then ns.message(L("Officers only.")) end
    return
  end
  local sub = args and args[1] and string.lower(args[1])
  if sub == "list" then
    if ns.showCopyText then ns.showCopyText(module.text(), L("To invite")) end
  else module.open() end
end
table.insert(ns.commandHelp, { officer = true, text = "/guilded invites - officers: players waiting for a guild invite (from Discord), one click each" })
