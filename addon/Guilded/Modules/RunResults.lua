local addonName, ns = ...
local results = {}
ns.runResults = results
local window
local pending
local loading, settle, poll = false, 0, 0

local function active() return not ns.moduleActive or ns.moduleActive("dungeon") end
local function dungeonDb()
  local root = ns.getDb and ns.getDb()
  return root and root.dungeon
end

local function inCombat()
  return (InCombatLockdown and InCombatLockdown()) or (UnitAffectingCombat and UnitAffectingCombat("player"))
end

local function L(text) return ns.L and ns.L(text) or text end

function results.timerEnabled()
  local db = ns.getDb and ns.getDb()
  return db and db.settings and db.settings.hideBossTimer == false or false
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
  return run.synced and L("Companion receipt recorded. Check the website or guild Season for validation and visibility.")
    or L("Saved in game. Type /reload or log out, then let your paired companion sync. Upload and public listing are not confirmed here.")
end

-- Public provisional plan of 18 October 2026, NOT guild-season points or an acceptance receipt.
-- Tests compare every route and rounding boundary with publicRules()/scoreRun() on the server.
-- Fields: target seconds, minimum level, maximum level. Observed difficulty is 0.
local targets = {
  ["389"]={1200,15,18}, ["3065"]={1500,15,20}, ["43"]={2400,15,24},
  ["2999"]={2100,15,22}, ["36"]={2400,17,26}, ["33"]={1800,20,29},
  ["34"]={1200,24,29}, ["48"]={2400,24,29}, ["2998"]={2100,26,29},
  ["189:graveyard"]={900,26,29}, ["2959"]={2700,30,36}, ["90"]={2700,30,38},
  ["47"]={2100,30,38}, ["189:library"]={1500,30,36}, ["189:armory"]={1500,32,42},
  ["189:cathedral"]={1500,35,44}, ["129"]={2400,35,44}, ["70"]={3000,38,44}
}
local wings = {
  graveyard={"bloodmage thalnos","mage de sang thalnos"}, library={"arcanist doan","arcaniste doan"},
  armory={"herod","h\195\169rode"}, cathedral={"high inquisitor whitemane","grande inquisitrice blanchet\195\170te"}
}
function results.routeKey(run)
  if run.instanceId ~= 189 then return tostring(run.instanceId) end
  local found
  for wing, names in pairs(wings) do
    for _, boss in ipairs(run.encounters or {}) do
      if boss.success and type(boss.name) == "string" then
        for _, name in ipairs(names) do
          if string.lower(boss.name) == name then
            if found and found ~= wing then return nil end
            found = wing
          end
        end
      end
    end
  end
  return found and ("189:" .. found) or nil
end
function results.estimate(run)
  local key = results.routeKey(run)
  local route = targets[key]
  local model = { key = key }
  if run.state ~= "COMPLETED" or type(run.durationSec) ~= "number" or run.durationSec <= 0 then
    model.reason = L("Run not completed")
  elseif run.completedBy ~= "final boss" then model.reason = L("Automatic final-boss evidence required")
  elseif not route then model.reason = L("No public target for this route")
  elseif run.difficultyId ~= 0 then model.reason = L("Different difficulty from the public rules")
  else
    local count, low, high = 0, 100, 0
    for _, player in pairs(run.players or {}) do
      local level = player.level
      if type(level) ~= "number" or level % 1 ~= 0 or level < 1 or level > 100 then
        model.reason = L("Party levels missing"); return model
      end
      count = count + 1; low = math.min(low, level); high = math.max(high, level)
    end
    model.target, model.minLevel, model.maxLevel = route[1], route[2], route[3]
    if count == 0 then model.reason = L("Party levels missing")
    elseif low < route[2] or high > route[3] + 3 then model.reason = L("Party levels outside the public range")
    else
      model.penalty = math.max(0, high - route[3]) * 10
      model.base = math.max(50, math.min(400, math.floor(200 * route[1] / run.durationSec + 0.5)))
      model.points = math.floor(model.base * (100 - model.penalty) / 100 + 0.5)
    end
  end
  return model
end

function results.breakdown(run)
  local score = results.estimate(run)
  if not score.points then return score.reason end
  return string.format(L("Target %s / time %s\nTime rating %d (50-400) / level penalty %d%%\nProvisional public estimate; guild rules may differ."),
    clock(score.target), clock(run.durationSec), score.base, score.penalty)
end

local function forgetPending(run)
  local d = dungeonDb()
  if d and run and d.pendingResult == run.id then d.pendingResult = nil end
end
function results.dismiss()
  local run = results.last
  if run then run.resultCardDismissed = true; forgetPending(run) end
  pending = nil
  if window then window:Hide() end
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

function results.show(run, resume)
  if not active() or type(run) ~= "table" then return end
  results.last = run
  if inCombat() or loading then pending = {run=run, resume=resume}; return end
  pending = nil
  if not UIParent or not CreateFrame then return end
  -- Saved with the run, so reloads and repeated zone/completion events cannot reopen it.
  run.resultCardShown = true
  forgetPending(run)
  if not window then
    window = CreateFrame("Frame", "GuildedRunResults", UIParent, BackdropTemplateMixin and "BackdropTemplate" or nil)
    window:SetSize(354, 276)
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
    window.heading:SetPoint("TOPLEFT", 14, -18); window.heading:SetWidth(304); window.heading:SetJustifyH("LEFT")
    window.status = window:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    window.status:SetPoint("TOPLEFT", 14, -42)
    window.metrics = window:CreateFontString(nil, "OVERLAY", "GameFontNormalHuge")
    window.metrics:SetPoint("TOPLEFT", 14, -64); window.metrics:SetWidth(326); window.metrics:SetJustifyH("LEFT")
    window.caption = window:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    window.caption:SetPoint("TOPLEFT", 14, -94); window.caption:SetWidth(326); window.caption:SetJustifyH("LEFT")
    window.breakdown = window:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    window.breakdown:SetPoint("TOPLEFT", 14, -114); window.breakdown:SetWidth(326); window.breakdown:SetJustifyH("LEFT")
    window.scroll = CreateFrame("ScrollFrame", nil, window, "UIPanelScrollFrameTemplate")
    window.scroll:SetPoint("TOPLEFT", 14, -174); window.scroll:SetPoint("BOTTOMRIGHT", -30, 118)
    window.content = CreateFrame("Frame", nil, window.scroll)
    window.content:SetWidth(306)
    window.scroll:SetScrollChild(window.content)
    window.text = window.content:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    window.text:SetPoint("TOPLEFT", 0, 0); window.text:SetWidth(306); window.text:SetJustifyH("LEFT")
    window.footer = window:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    window.footer:SetPoint("BOTTOMLEFT", 14, 52); window.footer:SetWidth(326); window.footer:SetJustifyH("LEFT")
    window.footer:SetTextColor(0.65, 0.7, 0.76)
    window.close = CreateFrame("Button", nil, window, "UIPanelCloseButton")
    window.close:SetPoint("TOPRIGHT", 0, 0)
    window.close:SetScript("OnClick", results.dismiss)
    window.details = CreateFrame("Button", nil, window, "UIPanelButtonTemplate")
    window.details:SetSize(90, 22); window.details:SetPoint("BOTTOMLEFT", 14, 16)
    window.details:SetScript("OnClick", function()
      window.expanded = not window.expanded
      window:SetHeight(window.expanded and 450 or 276)
      window.details:SetText(window.expanded and L("Less detail") or L("Details"))
      if window.expanded then window.scroll:Show() else window.scroll:Hide() end
      window.age = 0; window:SetAlpha(1)
    end)
    window.hint = window:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    window.hint:SetPoint("BOTTOMLEFT", 114, 17); window.hint:SetWidth(226); window.hint:SetJustifyH("LEFT")
    window:SetScript("OnUpdate", function(self, elapsed)
      if inCombat() then
        pending = {run=results.last,resume=true}; self:Hide(); return
      end
      local hovered = self.IsMouseOver and self:IsMouseOver() == true
        or MouseIsOver and MouseIsOver(self) == true
      -- Keep details open for reading. Hover pauses the clock and restores full opacity.
      if self.expanded or hovered then self:SetAlpha(1); return end
      self.age = (self.age or 0) + elapsed
      self:SetAlpha(math.max(0, math.min(1, (15 - self.age) / 2)))
      if self.age >= 15 then results.dismiss() end
    end)
  end
  local roster = rosterText(run)
  local seconds = math.max(0, math.floor(run.durationSec or 0))
  local kills = 0
  for _, boss in ipairs(run.encounters or {}) do if boss.success then kills = kills + 1 end end
  window.heading:SetText(run.name or L("Dungeon"))
  window.status:SetText((run.state == "COMPLETED" and L("RUN COMPLETE") or L("Run not completed"))
    .. "  |cffb0b8c4" .. L("Bosses") .. " " .. kills .. (run.bossCount and ("/" .. run.bossCount) or "") .. "|r")
  if run.state == "COMPLETED" then window.status:SetTextColor(0.4, 0.85, 0.6)
  else window.status:SetTextColor(0.9, 0.7, 0.35) end
  local score = results.estimate(run)
  window.metrics:SetText((score.points and ("~" .. score.points) or L("Unrated")) .. "   |cffffffff" .. clock(seconds) .. "|r")
  window.caption:SetText(L("Estimated public score / recorded duration"))
  window.breakdown:SetText(results.breakdown(run))
  local fights = results.fightText(run)
  window.text:SetText(fights ~= "" and (fights .. "\n\n" .. roster) or roster)
  window.content:SetHeight(math.max(1, window.text:GetStringHeight() + 12))
  window.scroll:SetVerticalScroll(0)
  window.footer:SetText(results.syncText(run))
  window.hint:SetText(ns.standalone and L("Reopen: /gdg results") or L("Reopen: /guilded dungeon results"))
  if not resume then
    window.age = 0; window.expanded = false; window:SetHeight(276)
    window.details:SetText(L("Details")); window.scroll:Hide()
  end
  window:SetAlpha(1)
  window:Show()
end

function results.queue(run)
  if not active() or not run or run.state ~= "COMPLETED" or not run.id
    or run.resultCardShown or run.resultCardDismissed then return end
  local d = dungeonDb()
  if d then d.pendingResult = run.id end
  settle = 1
end

local function insideDungeon()
  local instance = ns.compat and ns.compat.instance and ns.compat.instance()
  -- Avoid interrupting a new dungeon/raid if the player zones straight into another instance.
  return instance and (instance.type == "party" or instance.type == "raid")
end
function results.tryPending()
  if not active() then return end
  local d = dungeonDb()
  if not pending and not (d and d.pendingResult) then return end
  if loading or settle > 0 or inCombat() or insideDungeon() then return end
  if pending then results.show(pending.run, pending.resume); return end
  local run = d and d.runs and d.runs[d.pendingResult]
  -- SavedVariables may be shared with alts. Do not pop up another character's run.
  if run and ns.playerName and not (run.players or {})[ns.playerName()] then return end
  if run and run.state == "COMPLETED" and not run.resultCardShown and not run.resultCardDismissed then
    results.show(run)
  elseif d then d.pendingResult = nil end
end

-- Recheck after loading finishes, never at the last boss or during a new pull.
-- Pending IDs and shown/dismissed flags survive /reload in either addon's own SavedVariables.
if CreateFrame then
  local events = CreateFrame("Frame")
  -- Encounter timing stays active in Dungeon.lua. Never create a floating
  -- boss overlay; optional live text belongs only inside the opened Run tab.
  events:RegisterEvent("PLAYER_REGEN_ENABLED")
  events:RegisterEvent("PLAYER_REGEN_DISABLED")
  events:RegisterEvent("PLAYER_LEAVING_WORLD")
  events:RegisterEvent("PLAYER_ENTERING_WORLD")
  events:RegisterEvent("ZONE_CHANGED_NEW_AREA")
  events:SetScript("OnEvent", function(_, event)
    if not active() then return end
    if event == "PLAYER_REGEN_DISABLED" then
      if window and window:IsShown() then pending = {run=results.last,resume=true}; window:Hide() end
    elseif event == "PLAYER_LEAVING_WORLD" then
      loading = true
      if window and window:IsShown() then pending = {run=results.last,resume=true}; window:Hide() end
    elseif event == "PLAYER_ENTERING_WORLD" or event == "ZONE_CHANGED_NEW_AREA" then
      loading = false; settle = 1
    elseif event == "PLAYER_REGEN_ENABLED" then
      results.tryPending()
    end
  end)
  events:SetScript("OnUpdate", function(_, elapsed)
    settle = math.max(0, settle - elapsed); poll = poll + elapsed
    if poll >= 0.5 then poll = 0; results.tryPending() end
  end)
end

ns.onDungeonSummary = results.show
ns.onDungeonResultReady = results.queue
