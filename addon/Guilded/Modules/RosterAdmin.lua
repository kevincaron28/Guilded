-- Local officer workspace. Every native mutation has its own hardware click.
-- Layout: one scrolling page of sections, each a header and a row of buttons: Members, Ranks and promotion, Invites,
-- Sync. (19 Nov 2026: the bulk plan, paste box, confirmation field, local audit and GRM archive buttons were removed:
-- WoW Forever refuses addon guild edits, so they could not do anything.) (9.2: the Notes section and the
--   greeting switches were removed with the guild-note writers and the automatic welcome.)
-- "Buff coverage" was removed from this window: it is a raid-readiness tool and lives on the Ready
-- page. The officer-client switch (promote) that used to be slash-only is a check box here.
local _, ns = ...
local function L(s) return ns.L and ns.L(s) or s end
local window
local CONTENT_WIDTH = 650

function ns.openRosterAdmin()
  if not ns.rosterTools.authorized() then ns.message(ns.rosterTools.accessMessage()); return end
  local function place(frame) if ns.util and ns.util.placeBeside then ns.util.placeBeside(frame) end end
  if window then window:Show(); place(window); return end
  local f = CreateFrame("Frame", "GuildedRosterAdmin", UIParent, "BasicFrameTemplateWithInset")
  window = f; f:SetSize(720, 580); f:SetPoint("CENTER"); f:SetMovable(true); f:EnableMouse(true)
  if f.SetClampedToScreen then f:SetClampedToScreen(true) end
  if f.SetFrameStrata then f:SetFrameStrata("DIALOG") end
  f:RegisterForDrag("LeftButton"); f:SetScript("OnDragStart", f.StartMoving); f:SetScript("OnDragStop", f.StopMovingOrSizing)
  if f.TitleText then f.TitleText:SetText(L("Roster admin")) end
  -- Escape closes the window like any other Blizzard panel.
  if type(UISpecialFrames) == "table" then table.insert(UISpecialFrames, "GuildedRosterAdmin") end
  -- Beside the Guilded main window (and any other officer window), never on top of it.
  place(f)

  local scroll = CreateFrame("ScrollFrame", nil, f, "UIPanelScrollFrameTemplate")
  scroll:SetPoint("TOPLEFT", f, "TOPLEFT", 14, -32); scroll:SetPoint("BOTTOMRIGHT", f, "BOTTOMRIGHT", -32, 50)
  local content = CreateFrame("Frame", nil, scroll)
  content:SetSize(CONTENT_WIDTH + 20, 900); scroll:SetScrollChild(content)

  local status = f:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  status:SetPoint("BOTTOMLEFT", f, "BOTTOMLEFT", 18, 18); status:SetWidth(680); status:SetJustifyH("LEFT")
  status:SetText(L("Nothing runs automatically. Refresh the roster to see who is ready."))

  local tools = ns.rosterTools
  local y, x = -4, 0
  local function text(str, font, width)
    local t = content:CreateFontString(nil, "OVERLAY", font or "GameFontHighlightSmall")
    t:SetPoint("TOPLEFT", content, "TOPLEFT", 4, y); t:SetWidth(width or CONTENT_WIDTH); t:SetJustifyH("LEFT"); t:SetText(L(str))
    return t
  end
  local function endRow() if x > 0 then y = y - 30 end; x = 0 end
  local function header(title)
    endRow(); y = y - 8
    text(title, "GameFontNormal"); y = y - 20
  end
  local function note(str, lines)
    endRow(); text(str); y = y - 14 * (lines or 1) - 2
  end
  local function show(str) if ns.showCopyText then ns.showCopyText(str or "", L("Roster admin")) end end
  local function button(title, fn, hint)
    local b = CreateFrame("Button", nil, content, "UIPanelButtonTemplate")
    b:SetText(L(title))
    local w = 166
    local tw = b.GetTextWidth and b:GetTextWidth()
    if type(tw) == "number" and tw + 24 > w then w = math.min(CONTENT_WIDTH, math.floor(tw + 24)) end
    if x + w > CONTENT_WIDTH then endRow() end
    b:SetSize(w, 24); b:SetPoint("TOPLEFT", content, "TOPLEFT", x, y); x = x + w + 6
    b:SetScript("OnClick", function()
      if not ns.rosterTools.authorized() then status:SetText(L("Current officer access is required.")); return end
      local ok, a, message = pcall(fn)
      if not ok then status:SetText(L("Not applied. Check the preview and confirmation.")); return end
      -- A button returns (ok, message): a message is shown whether it worked or not.
      local worked, note2 = a, message
      status:SetText(L(note2 or (worked and "Done. Review the result." or "Not applied. Check the preview and confirmation.")))
    end)
    if hint and b.SetScript then
      b:SetScript("OnEnter", function(self)
        if GameTooltip then GameTooltip:SetOwner(self, "ANCHOR_RIGHT"); GameTooltip:SetText(L(hint), 1, 1, 1, 1, true); GameTooltip:Show() end
      end)
      b:SetScript("OnLeave", function() if GameTooltip then GameTooltip:Hide() end end)
    end
    return b
  end
  local checks = {}
  local function officerSwitch(key)
    endRow()
    local cb = CreateFrame("CheckButton", nil, content, "UICheckButtonTemplate")
    cb:SetSize(24, 24); cb:SetPoint("TOPLEFT", content, "TOPLEFT", 0, y)
    local label = content:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    label:SetPoint("LEFT", cb, "RIGHT", 4, 0)
    local notes = ns.officerNotes
    label:SetText(L(notes and notes.LABELS and notes.LABELS[key] or key))
    cb:SetScript("OnClick", function(self)
      if notes and notes.set then notes.set(key, self:GetChecked() and true or false) end
    end)
    checks[#checks + 1] = { box = cb, key = key }
    y = y - 26
  end
  local function refreshChecks()
    local notes = ns.officerNotes
    for _, c in ipairs(checks) do
      if c.box.SetChecked then c.box:SetChecked(notes and notes.enabled and notes.enabled(c.key) and true or false) end
    end
  end

  -- ---- Members --------------------------------------------------------------
  header("Members")
  button("Refresh roster", function() return tools.requestRoster() end, "Asks the game for a fresh guild roster.")
  endRow()

  -- ---- Ranks and promotion ---------------------------------------------------
  header("Ranks and promotion")
  button("Ready to promote", function() if ns.promotion then ns.promotion.open() end; return true end, "Who is ready to promote (the list and the guild roster steps).")
  officerSwitch("promote")
  endRow()

  -- ---- Invites -----------------------------------------------------------------
  header("Invites")
  button("Invite queue", function() if ns.inviteQueue then ns.inviteQueue.open() end; return true end, "Players waiting for a guild invite.")
  endRow()

  -- ---- Sync --------------------------------------------------------------------
  header("Sync")
  button("Sync with guildmates", function() local h = ns.commandHandlers and ns.commandHandlers.sync; if h then h({ "peers" }) end; return true end, "Asks online guildmates for their latest data.")
  button("Sync report", function() local h = ns.commandHandlers and ns.commandHandlers.sync; if h then h({ "stats" }) end; return true end)
  endRow()

  content:SetHeight(-y + 20)

  local windowScope = tools.context()
  f:SetScript("OnShow", function()
    windowScope = tools.context()
    refreshChecks()
  end)
  refreshChecks()
  local elapsedSinceAccessCheck = 0
  f:SetScript("OnUpdate", function(self, elapsed)
    elapsedSinceAccessCheck = elapsedSinceAccessCheck + (elapsed or 0.5)
    if elapsedSinceAccessCheck < 0.5 then return end
    elapsedSinceAccessCheck = 0
    if not tools.authorized() or windowScope ~= tools.context() then self:Hide() end
  end)
end
ns.commandHandlers = ns.commandHandlers or {}
ns.commandHelp = ns.commandHelp or {}
ns.commandHandlers.rosteradmin = function() ns.openRosterAdmin() end
table.insert(ns.commandHelp, { officer = true, text = "/guilded rosteradmin - officer tools: roster refresh, who is ready to promote, invite queue, sync" })
