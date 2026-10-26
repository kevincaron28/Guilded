-- Local officer workspace. Every native mutation has its own hardware click.
local _, ns = ...
local function L(s) return ns.L and ns.L(s) or s end
local window
function ns.openRosterAdmin()
  if not ns.rosterTools.authorized() then ns.message(L("Current officer access is required.")); return end
  if window then window:Show(); return end
  local f = CreateFrame("Frame", "GuildedRosterAdmin", UIParent, "BasicFrameTemplateWithInset")
  window = f; f:SetSize(740, 570); f:SetPoint("CENTER"); f:SetMovable(true); f:EnableMouse(true)
  f:RegisterForDrag("LeftButton"); f:SetScript("OnDragStart", f.StartMoving); f:SetScript("OnDragStop", f.StopMovingOrSizing)
  if f.TitleText then f.TitleText:SetText(L("Roster admin")) end
  local function label(text, y)
    local t = f:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    t:SetPoint("TOPLEFT", 18, y); t:SetWidth(700); t:SetJustifyH("LEFT"); t:SetText(L(text)); return t
  end
  label("Paste tab-separated actions or a converted GGRM1 archive. Preview before confirming.", -40)
  local scroll = CreateFrame("ScrollFrame", nil, f, "UIPanelScrollFrameTemplate")
  scroll:SetPoint("TOPLEFT", 20, -70); scroll:SetSize(675, 145)
  local input = CreateFrame("EditBox", nil, scroll)
  input:SetMultiLine(true); input:SetAutoFocus(false); input:SetFontObject(GameFontHighlightSmall)
  input:SetWidth(670); input:SetHeight(145); input:SetMaxLetters(2700000); scroll:SetScrollChild(input)
  input:SetScript("OnEscapePressed", function(self) self:ClearFocus() end)
  label("Bulk format: character [TAB] action [TAB] value. Actions: public, officer, promote, demote, kick.", -230)
  label("Exact character names; one row per character. Notes: 31 bytes. Empty value for rank/removal.", -249)
  local confirmation = CreateFrame("EditBox", nil, f, "InputBoxTemplate")
  confirmation:SetPoint("TOPLEFT", 24, -280); confirmation:SetSize(230, 24); confirmation:SetAutoFocus(false); confirmation:SetMaxLetters(160)
  label("Confirmation phrase / history search", -311)
  local status = label("Nothing runs automatically. Refresh the roster before a bulk preview.", -500)
  local function show(text) ns.showCopyText(text or "", L("Roster admin")) end
  local function button(title, x, y, fn)
    local b = CreateFrame("Button", nil, f, "UIPanelButtonTemplate"); b:SetPoint("TOPLEFT", x, y); b:SetSize(166, 26); b:SetText(L(title))
    b:SetScript("OnClick", function()
      if not ns.rosterTools.authorized() then status:SetText(L("Current officer access is required.")); return end
      local ok, message = fn(); status:SetText(L(message or (ok and "Done. Review the result." or "Not applied. Check the preview and confirmation.")))
    end)
  end
  local tools, grm = ns.rosterTools, ns.grmMigration
  local windowScope = tools.context()
  f:SetScript("OnShow", function()
    if windowScope ~= tools.context() then
      tools.invalidatePreview(); grm.pending = nil; input:SetText(""); confirmation:SetText("")
    end
    windowScope = tools.context()
  end)
  input:SetScript("OnTextChanged", function()
    tools.invalidatePreview(); grm.pending = nil; confirmation:SetText("")
  end)
  button("Refresh roster", 18, -345, function() return tools.requestRoster() end)
  button("Preview actions", 194, -345, function() grm.pending = nil; local p, err = tools.preview(input:GetText()); if p then show(tools.describe()) end; return p, err end)
  button("Confirm plan", 370, -345, function() return tools.confirm(confirmation:GetText()) end)
  button("Apply next action", 546, -345, function() return tools.step() end)
  button("View plan / status", 18, -380, function() show(tools.describe()); return true end)
  button("Cancel plan", 194, -380, function() tools.cancel(); return true end)
  button("Recovery preview", 370, -380, function() grm.pending = nil; local p, err = tools.undoPreview(); if p then show(tools.describe()) end; return p, err end)
  button("Local audit", 546, -380, function() show(tools.auditText()); return true end)
  button("Preview GRM", 18, -415, function() tools.invalidatePreview(); local p, err = grm.preview(input:GetText()); if p then show(grm.summary(p)) end; return p, err end)
  button("Import GRM", 194, -415, function() return grm.import(confirmation:GetText()) end)
  button("Undo GRM import", 370, -415, function() return grm.undo(confirmation:GetText()) end)
  button("Export GRM archive", 546, -415, function() local code = grm.export(); if code then show(code) end; return code end)
  button("Search GRM history", 18, -450, function() show(grm.history(confirmation:GetText())); return true end)
  button("Buff coverage", 194, -450, function() show(ns.ready and ns.ready.buffCoverageText()); return true end)
  label("GRM confirmation: IMPORT. Recovery: UNDO IMPORT. Archives stay on this character; no guild notes are changed.", -535)
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
