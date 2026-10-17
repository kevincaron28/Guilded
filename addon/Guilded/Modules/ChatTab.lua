-- An optional "Guilded" chat tab. With it on, the addon's own lines (bidding results, sync
-- status, command answers) go to that tab instead of the main chat, so raid chat stays
-- readable. Messages to the raid, the party or whispers are not affected.
--
--   /guilded chat tab    open the Guilded tab and send the addon's lines there
--   /guilded chat off    back to the main chat window
--   /guilded chat        say which it is
local addonName, ns = ...
ns = ns or {}

local module = {}
ns.chatTab = module

local TAB_NAME = "Guilded"

local function settings()
  return ns.getSettings and ns.getSettings()
end

-- The chat window named Guilded, or nil.
local function findFrame()
  local count = NUM_CHAT_WINDOWS or 10
  for i = 1, count do
    local name = GetChatWindowInfo and GetChatWindowInfo(i)
    if name == TAB_NAME then return _G["ChatFrame" .. i] end
  end
  return nil
end

-- Finds the tab, opening it when asked to.
function module.frame(create)
  local frame = findFrame()
  if frame then return frame end
  if create and FCF_OpenNewWindow then
    local ok, result = pcall(FCF_OpenNewWindow, TAB_NAME)
    if ok and result and result.AddMessage then return result end
    return findFrame()
  end
  return nil
end

function module.enabled()
  local s = settings()
  return s and s.chatTab == true or false
end

-- Used by Core's message(): the tab when it is on and exists, otherwise nil (main chat).
function ns.chatFrame()
  if not module.enabled() then return nil end
  return module.frame(false)
end

local function say(text)
  -- Confirmations show in the main chat so they are seen whichever way it was switched.
  if DEFAULT_CHAT_FRAME then DEFAULT_CHAT_FRAME:AddMessage("|cffd4af37[Guilded]|r " .. text) end
end

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["chat"] = function(args)
  local s = settings()
  if not s then return end
  local action = string.lower(args[1] or "")
  if action == "tab" or action == "on" then
    local frame = module.frame(true)
    if not frame then
      say("This game version cannot open a chat tab from here. Right-click a chat tab, Open New Window, name it Guilded, then /guilded chat tab.")
      return
    end
    s.chatTab = true
    say("Guilded's own lines now go to the Guilded chat tab. /guilded chat off to go back.")
    if frame.AddMessage then frame:AddMessage("|cffd4af37[Guilded]|r This tab shows Guilded's messages.") end
  elseif action == "off" then
    s.chatTab = false
    -- Close the tab too, so the player is not left with an empty window. The first two chat
    -- windows (General, Combat Log) cannot be closed and are never named Guilded by us.
    local tab = findFrame()
    if tab and tab ~= DEFAULT_CHAT_FRAME and tab ~= ChatFrame1 and tab ~= ChatFrame2 and FCF_Close then
      pcall(FCF_Close, tab)
    end
    say("Guilded's lines are back in the main chat window.")
  else
    say(module.enabled() and "Guilded's own lines go to the Guilded chat tab. /guilded chat off to go back."
      or "Guilded's own lines go to the main chat. /guilded chat tab puts them in their own tab.")
  end
end

ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded chat tab | off - show Guilded's own messages in a separate chat tab")

-- A tab that was turned on but closed by the player: reopen it once at login, quietly.
local frame = CreateFrame("Frame")
frame:RegisterEvent("PLAYER_LOGIN")
frame:SetScript("OnEvent", function()
  if module.enabled() and not findFrame() then pcall(module.frame, true) end
end)
