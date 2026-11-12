-- Local officer workspace. Every native mutation has its own hardware click.
-- Layout (9.1): one scrolling page of sections, each a header and a row of buttons:
--   Members, Ranks and promotion (bulk plan), Notes, Invites and greeting, Sync, GRM archive.
-- "Buff coverage" was removed from this window: it is a raid-readiness tool and lives on the Ready
-- page. The officer-client switches (professions, EP/GP, promote, greet) that used to be slash-only
-- are check boxes here.
local _, ns = ...
local function L(s) return ns.L and ns.L(s) or s end
local window
local CONTENT_WIDTH = 650

function ns.openRosterAdmin()
  if not ns.rosterTools.authorized() then ns.message(L("Current officer access is required.")); return end
  if window then window:Show(); return end
  local f = CreateFrame("Frame", "GuildedRosterAdmin", UIParent, "BasicFrameTemplateWithInset")
  window = f; f:SetSize(720, 580); f:SetPoint("CENTER"); f:SetMovable(true); f:EnableMouse(true)
  if f.SetClampedToScreen then f:SetClampedToScreen(true) end
  if f.SetFrameStrata then f:SetFrameStrata("DIALOG") end
  f:RegisterForDrag("LeftButton"); f:SetScript("OnDragStart", f.StartMoving); f:SetScript("OnDragStop", f.StopMovingOrSizing)
  if f.TitleText then f.TitleText:SetText(L("Roster admin")) end
  -- Escape closes the window like any other Blizzard panel.
  if type(UISpecialFrames) == "table" then table.insert(UISpecialFrames, "GuildedRosterAdmin") end

  local scroll = CreateFrame("ScrollFrame", nil, f, "UIPanelScrollFrameTemplate")
  scroll:SetPoint("TOPLEFT", f, "TOPLEFT", 14, -32); scroll:SetPoint("BOTTOMRIGHT", f, "BOTTOMRIGHT", -32, 50)
  local content = CreateFrame("Frame", nil, scroll)
  content:SetSize(CONTENT_WIDTH + 20, 900); scroll:SetScrollChild(content)

  local status = f:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  status:SetPoint("BOTTOMLEFT", f, "BOTTOMLEFT", 18, 18); status:SetWidth(680); status:SetJustifyH("LEFT")
  status:SetText(L("Nothing runs automatically. Refresh the roster before a bulk preview."))

  local tools, grm = ns.rosterTools, ns.grmMigration
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
  button("Refresh roster", function() return tools.requestRoster() end, "Asks the game for a fresh guild roster. Do this before a bulk preview.")
  button("Local audit", function() show(tools.auditText()); return true end, "What this officer client changed, with the result of each change.")
  endRow()

  -- ---- Ranks and promotion ---------------------------------------------------
  header("Ranks and promotion")
  button("Ready to promote", function() if ns.promotion then ns.promotion.open() end; return true end, "Members who meet the promotion rules.")
  officerSwitch("promote")
  note("Bulk changes: paste tab-separated actions or a converted GGRM1 archive. Preview before confirming.")
  local pasteScroll = CreateFrame("ScrollFrame", nil, content, "UIPanelScrollFrameTemplate")
  pasteScroll:SetPoint("TOPLEFT", content, "TOPLEFT", 4, y); pasteScroll:SetSize(CONTENT_WIDTH - 40, 110)
  local input = CreateFrame("EditBox", nil, pasteScroll)
  input:SetMultiLine(true); input:SetAutoFocus(false); input:SetFontObject(GameFontHighlightSmall)
  input:SetWidth(CONTENT_WIDTH - 50); input:SetHeight(110); input:SetMaxLetters(2700000); pasteScroll:SetScrollChild(input)
  input:SetScript("OnEscapePressed", function(self) self:ClearFocus() end)
  y = y - 118
  note("Bulk format: character [TAB] action [TAB] value. Actions: public, officer, promote, demote, kick.")
  note("Exact character names; one row per character. Notes: 31 bytes. Empty value for rank/removal.")
  text("Confirmation phrase / history search", "GameFontNormalSmall"); y = y - 16
  local confirmation = CreateFrame("EditBox", nil, content, "InputBoxTemplate")
  confirmation:SetPoint("TOPLEFT", content, "TOPLEFT", 10, y); confirmation:SetSize(230, 24); confirmation:SetAutoFocus(false); confirmation:SetMaxLetters(160)
  confirmation:SetScript("OnEscapePressed", function(self) self:ClearFocus() end)
  y = y - 32
  button("Preview actions", function() grm.pending = nil; local p, err = tools.preview(input:GetText()); if p then show(tools.describe()) end; return p, err end)
  button("Confirm plan", function() return tools.confirm(confirmation:GetText()) end)
  button("Apply next action", function() return tools.step() end)
  endRow()
  button("View plan / status", function() show(tools.describe()); return true end)
  button("Cancel plan", function() tools.cancel(); return true end)
  button("Recovery preview", function() grm.pending = nil; local p, err = tools.undoPreview(); if p then show(tools.describe()) end; return p, err end)
  endRow()

  -- ---- Notes -----------------------------------------------------------------
  header("Notes")
  button("Professions to notes", function()
    grm.pending = nil
    if not (ns.rosterProfessions and ns.rosterProfessions.preview) then return nil, "Professions are not available yet." end
    local p, count = ns.rosterProfessions.preview()
    if not p then return nil, count end
    show(tools.describe()); return true
  end, "Preview writing each member's professions into their public note.")
  endRow()
  officerSwitch("professions")
  officerSwitch("epgp")

  -- ---- Invites and greeting ----------------------------------------------------
  header("Invites and greeting")
  button("Invite queue", function() if ns.inviteQueue then ns.inviteQueue.open() end; return true end, "Players waiting for a guild invite.")
  endRow()
  officerSwitch("greet")
  button("Greeting in English", function() if ns.officerNotes then ns.officerNotes.command({ "officer", "auto", "lang", "en" }) end; return true end)
  button("Greeting in French", function() if ns.officerNotes then ns.officerNotes.command({ "officer", "auto", "lang", "fr" }) end; return true end)
  endRow()

  -- ---- Sync --------------------------------------------------------------------
  header("Sync")
  button("Sync with guildmates", function() local h = ns.commandHandlers and ns.commandHandlers.sync; if h then h({ "peers" }) end; return true end, "Asks online guildmates for their latest data.")
  button("Sync report", function() local h = ns.commandHandlers and ns.commandHandlers.sync; if h then h({ "stats" }) end; return true end)
  endRow()

  -- ---- GRM archive -------------------------------------------------------------
  header("GRM archive")
  note("These use the paste box and confirmation phrase above. Confirm with IMPORT; recover with UNDO IMPORT. Archives stay on this character; no guild notes are changed.", 2)
  button("Preview GRM", function() tools.invalidatePreview(); local p, err = grm.preview(input:GetText()); if p then show(grm.summary(p)) end; return p, err end)
  button("Import GRM", function() return grm.import(confirmation:GetText()) end)
  button("Undo GRM import", function() return grm.undo(confirmation:GetText()) end)
  endRow()
  button("Export GRM archive", function() local code = grm.export(); if code then show(code) end; return code end)
  button("Search GRM history", function() show(grm.history(confirmation:GetText())); return true end)
  endRow()
  content:SetHeight(-y + 20)

  local windowScope = tools.context()
  f:SetScript("OnShow", function()
    if windowScope ~= tools.context() then
      tools.invalidatePreview(); grm.pending = nil; input:SetText(""); confirmation:SetText("")
    end
    windowScope = tools.context()
    refreshChecks()
  end)
  refreshChecks()
  input:SetScript("OnTextChanged", function()
    tools.invalidatePreview(); grm.pending = nil; confirmation:SetText("")
  end)
  local elapsedSinceAccessCheck = 0
  f:SetScript("OnUpdate", function(self, elapsed)
    elapsedSinceAccessCheck = elapsedSinceAccessCheck + (elapsed or 0.5)
    if elapsedSinceAccessCheck < 0.5 then return end
    elapsedSinceAccessCheck = 0
    if not tools.authorized() or windowScope ~= tools.context() then
      tools.invalidatePreview(); grm.pending = nil
      input:SetText(""); confirmation:SetText(""); self:Hide()
    end
  end)
end
ns.commandHandlers = ns.commandHandlers or {}
ns.commandHelp = ns.commandHelp or {}
ns.commandHandlers.rosteradmin = function() ns.openRosterAdmin() end
table.insert(ns.commandHelp, { officer = true, text = "/guilded rosteradmin - local bulk actions and GRM archive" })
