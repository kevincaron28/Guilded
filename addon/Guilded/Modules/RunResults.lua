local addonName, ns = ...
local results = {}
ns.runResults = results
local window
local pending

local function inCombat()
  return (InCombatLockdown and InCombatLockdown()) or (UnitAffectingCombat and UnitAffectingCombat("player"))
end

local function L(text) return ns.L and ns.L(text) or text end

function results.timerEnabled()
  local db = ns.getDb and ns.getDb()
  return not (db and db.settings and db.settings.hideBossTimer)
end

function results.setTimerEnabled(enabled)
  local db = ns.getDb and ns.getDb()
  if not db then return end
  db.settings = db.settings or {}
  db.settings.hideBossTimer = not enabled
end

local function clock(seconds)
  seconds = math.max(0, math.floor(seconds))
  return string.format("%d:%02d", math.floor(seconds / 60), seconds % 60)
end

function results.liveText(run, stamp)
  local boss = run and run.activeEncounter
  if not run or run.state ~= "ACTIVE" or not run.inside or not boss
    or type(boss.startedAt) ~= "number" or stamp < boss.startedAt then return nil end
  return string.format(L("Boss fight: %s - %s"), boss.name or (L("Boss") .. " #" .. tostring(boss.id or "?")),
    clock(stamp - boss.startedAt))
end

function results.fightText(run)
  local lines = {}
  for _, boss in ipairs(run.encounters or {}) do
    local timed = type(boss.startedAt) == "number" and type(boss.at) == "number"
      and boss.at >= boss.startedAt and (not run.startedAt or boss.startedAt >= run.startedAt)
      and (not run.endedAt or boss.at <= run.endedAt)
    lines[#lines + 1] = string.format("%s - %s - %s",
      boss.name or (L("Boss") .. " #" .. tostring(boss.id or "?")),
      boss.success and L("Defeated") or L("Failed attempt"),
      timed and clock(boss.at - boss.startedAt) or L("Fight not timed"))
  end
  return #lines > 0 and (L("Boss fight times") .. "\n" .. table.concat(lines, "\n")) or ""
end

local function rosterText(run)
  local names, lines = {}, {}
  for name in pairs(run.players or {}) do names[#names + 1] = name end
  table.sort(names)
  local roles = { TANK = L("Tank"), HEALER = L("Healer"), DPS = "DPS", DAMAGER = "DPS" }
  for _, name in ipairs(names) do
    local player = run.players[name]
    local info = player.class or ""
    if roles[player.role] then info = info .. (info ~= "" and " / " or "") .. roles[player.role] end
    local deaths = type(player.deaths) == "number" and string.format(L("%d deaths"), player.deaths) or L("deaths unknown")
    lines[#lines + 1] = "|cffffd36a" .. name .. "|r" .. (info ~= "" and ("  |cffb0b8c4" .. info .. "|r") or "") .. "\n  " .. deaths
  end
  return table.concat(lines, "\n\n"), #names
end

function results.syncText(run)
  return run.synced and L("Received by Discord. See Season for official points.")
    or L("Saved in game. Type /reload or log out to let your companion upload it. Discord validates the run and awards points.")
end

function results.text(run)
  local seconds = math.max(0, math.floor(run.durationSec or 0))
  local lines = { (run.name or "Dungeon") .. " - " .. (run.state or "?"),
    string.format("Time: %d:%02d", math.floor(seconds / 60), seconds % 60) }
  local kills = 0
  for _, boss in ipairs(run.encounters or {}) do if boss.success then kills = kills + 1 end end
  lines[#lines + 1] = "Bosses defeated: " .. kills .. (run.bossCount and ("/" .. run.bossCount) or "")
  lines[#lines + 1] = results.fightText(run)
  local names = {}
  for name in pairs(run.players or {}) do names[#names + 1] = name end
  table.sort(names)
  lines[#lines + 1] = ""
  for _, name in ipairs(names) do
    local player = run.players[name]
    lines[#lines + 1] = name .. ": " .. (type(player.deaths) == "number" and (player.deaths .. " deaths") or "deaths unknown")
  end
  lines[#lines + 1] = ""
  lines[#lines + 1] = results.syncText(run)
  return table.concat(lines, "\n")
end

function results.show(run)
  results.last = run
  if inCombat() then pending = run; return end
  pending = nil
  if not UIParent or not CreateFrame then return end
  if not window then
    window = CreateFrame("Frame", "GuildedRunResults", UIParent, BackdropTemplateMixin and "BackdropTemplate" or nil)
    window:SetSize(320, 280)
    window:SetPoint("BOTTOMRIGHT", UIParent, "BOTTOMRIGHT", -24, 150)
    window:SetClampedToScreen(true)
    window:SetMovable(true); window:EnableMouse(true); window:RegisterForDrag("LeftButton")
    window:SetScript("OnDragStart", function(self) self:StartMoving() end)
    window:SetScript("OnDragStop", function(self) self:StopMovingOrSizing() end)
    if window.SetBackdrop then
      window:SetBackdrop({ bgFile = "Interface\\Tooltips\\UI-Tooltip-Background", edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border", edgeSize = 12 })
      window:SetBackdropColor(0.035, 0.045, 0.065, 0.97)
      window:SetBackdropBorderColor(0.72, 0.54, 0.2, 1)
    end
    window.heading = window:CreateFontString(nil, "OVERLAY", "GameFontNormal")
    window.heading:SetPoint("TOPLEFT", 14, -18); window.heading:SetWidth(268); window.heading:SetJustifyH("LEFT")
    window.status = window:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    window.status:SetPoint("TOPLEFT", 14, -42)
    window.metrics = window:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    window.metrics:SetPoint("TOPLEFT", 14, -64); window.metrics:SetWidth(288); window.metrics:SetJustifyH("LEFT")
    window.scroll = CreateFrame("ScrollFrame", nil, window, "UIPanelScrollFrameTemplate")
    window.scroll:SetPoint("TOPLEFT", 14, -90); window.scroll:SetPoint("BOTTOMRIGHT", -30, 94)
    window.content = CreateFrame("Frame", nil, window.scroll)
    window.content:SetWidth(276)
    window.scroll:SetScrollChild(window.content)
    window.text = window.content:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    window.text:SetPoint("TOPLEFT", 0, 0); window.text:SetWidth(276); window.text:SetJustifyH("LEFT")
    window.footer = window:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    window.footer:SetPoint("BOTTOMLEFT", 14, 14); window.footer:SetWidth(288); window.footer:SetJustifyH("LEFT")
    window.footer:SetTextColor(0.65, 0.7, 0.76)
    local close = CreateFrame("Button", nil, window, "UIPanelCloseButton")
    close:SetPoint("TOPRIGHT", 0, 0)
    close:SetScript("OnClick", function() window:Hide() end)
  end
  local roster = rosterText(run)
  local seconds = math.max(0, math.floor(run.durationSec or 0))
  local kills = 0
  for _, boss in ipairs(run.encounters or {}) do if boss.success then kills = kills + 1 end end
  window.heading:SetText(run.name or L("Dungeon"))
  window.status:SetText(run.state == "COMPLETED" and L("RUN COMPLETE") or (run.state or "?"))
  window.status:SetTextColor(0.4, 0.85, 0.6)
  window.metrics:SetText(string.format("%d:%02d   |cffb0b8c4%s %d%s|r", math.floor(seconds / 60), seconds % 60,
    L("Bosses"), kills, run.bossCount and ("/" .. run.bossCount) or ""))
  local fights = results.fightText(run)
  window.text:SetText(fights ~= "" and (fights .. "\n\n" .. roster) or roster)
  window.content:SetHeight(math.max(1, window.text:GetStringHeight() + 12))
  window.scroll:SetVerticalScroll(0)
  window.footer:SetText(results.syncText(run))
  window:Show()
end

-- Queue the latest result while fighting; also get an open result out of the way
-- if another pull starts. Manually dismissed results stay dismissed.
if CreateFrame then
  local events = CreateFrame("Frame")
  -- A separate, small display stays visible while the main addon window is closed.
  -- Create it before combat; it has no protected actions or combat-log dependency.
  local timer = CreateFrame("Frame", "GuildedBossTimer", UIParent, BackdropTemplateMixin and "BackdropTemplate" or nil)
  timer:SetSize(300, 48)
  timer:SetPoint("TOP", UIParent, "TOP", 0, -160)
  timer:SetClampedToScreen(true)
  timer:SetMovable(true); timer:EnableMouse(true); timer:RegisterForDrag("LeftButton")
  timer:SetScript("OnDragStart", function(self) self:StartMoving() end)
  timer:SetScript("OnDragStop", function(self) self:StopMovingOrSizing() end)
  if timer.SetBackdrop then
    timer:SetBackdrop({ bgFile = "Interface\\Tooltips\\UI-Tooltip-Background" })
    timer:SetBackdropColor(0.035, 0.045, 0.065, 0.9)
  end
  local label = timer:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
  label:SetPoint("TOPLEFT", 8, -6); label:SetPoint("BOTTOMRIGHT", -8, 6)
  timer:Hide()
  local elapsed = 0
  events:SetScript("OnUpdate", function(_, delta)
    elapsed = elapsed + delta
    if elapsed < 0.2 then return end
    elapsed = 0
    local db = ns.getDb and ns.getDb()
    local stamp = ns.compat and ns.compat.serverTime() or (GetServerTime and GetServerTime() or time())
    local text = results.timerEnabled() and (not ns.moduleActive or ns.moduleActive("dungeon"))
      and results.liveText(db and db.dungeon and db.dungeon.current, stamp)
    if text then label:SetText(text); timer:Show() else timer:Hide() end
  end)
  events:RegisterEvent("PLAYER_REGEN_ENABLED")
  events:RegisterEvent("PLAYER_REGEN_DISABLED")
  events:SetScript("OnEvent", function(_, event)
    if event == "PLAYER_REGEN_DISABLED" then
      if window and window:IsShown() then pending = results.last; window:Hide() end
    elseif event == "PLAYER_REGEN_ENABLED" and pending then
      results.show(pending)
    end
  end)
end

ns.onDungeonSummary = results.show
