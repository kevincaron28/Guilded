-- A paste window for text that is too long for the chat line (imports): a multi-line box, an
-- Import button and a status line. ns.showPasteBox(title, help, onImport) where onImport(text)
-- returns ok, message. Nothing happens until the button is clicked.
local addonName, ns = ...
ns = ns or {}

local function L(text) return ns.L and ns.L(text) or text end

local window, input, status, helpText, handler

local function build()
  local f = CreateFrame("Frame", "GuildedPasteBox", UIParent, "BasicFrameTemplateWithInset")
  f:SetSize(560, 360); f:SetPoint("CENTER"); f:SetMovable(true); f:EnableMouse(true); f:SetFrameStrata("DIALOG")
  f:RegisterForDrag("LeftButton"); f:SetScript("OnDragStart", f.StartMoving); f:SetScript("OnDragStop", f.StopMovingOrSizing)
  helpText = f:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
  helpText:SetPoint("TOPLEFT", 16, -32); helpText:SetWidth(525); helpText:SetJustifyH("LEFT")
  local scroll = CreateFrame("ScrollFrame", nil, f, "UIPanelScrollFrameTemplate")
  scroll:SetPoint("TOPLEFT", 16, -80); scroll:SetSize(505, 200)
  input = CreateFrame("EditBox", nil, scroll)
  input:SetMultiLine(true); input:SetAutoFocus(true); input:SetFontObject(GameFontHighlightSmall)
  input:SetWidth(500); input:SetHeight(200); input:SetMaxLetters(400000); scroll:SetScrollChild(input)
  input:SetScript("OnEscapePressed", function() f:Hide() end)
  status = f:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
  status:SetPoint("BOTTOMLEFT", 16, 46); status:SetWidth(525); status:SetJustifyH("LEFT")
  local button = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
  button:SetSize(140, 24); button:SetPoint("BOTTOMLEFT", 16, 14); button:SetText(L("Import"))
  button:SetScript("OnClick", function()
    if not handler then return end
    local ok, result, message = pcall(handler, input:GetText() or "")
    if not ok then status:SetText(L("Could not read that text.")); return end
    status:SetText(message or (result and L("Imported.") or L("Nothing was imported.")))
  end)
  local close = CreateFrame("Button", nil, f, "UIPanelButtonTemplate")
  close:SetSize(100, 24); close:SetPoint("BOTTOMRIGHT", -16, 14); close:SetText(L("Close"))
  close:SetScript("OnClick", function() f:Hide() end)
  window = f
end

function ns.showPasteBox(title, help, onImport)
  if not window then build() end
  if window.TitleText then window.TitleText:SetText(title) end
  helpText:SetText(help or "")
  status:SetText("")
  input:SetText("")
  handler = onImport
  window:Show()
  input:SetFocus()
end
