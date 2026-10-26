-- Reviewed native guild operations. One explicit click per request; a fresh
-- roster event must verify it before the next request. Nothing runs on login.
local addonName, ns = ...
ns = ns or {}
local tools = { generation = 0, refreshedAt = -1000 }
ns.rosterTools = tools
local function L(s) return ns.L and ns.L(s) or s end
local function secret(v) return ns.isSecret and ns.isSecret(v) end
local function read(fn, ...)
  if type(fn) ~= "function" then return nil end
  local ok, v = pcall(fn, ...)
  if ok and not secret(v) then return v end
end
local function now() return read(GetTime) or 0 end
local function epoch() return read(GetServerTime) or (time and time()) or 0 end
local function text(v, limit)
  return not secret(v) and type(v) == "string" and #v <= limit and not v:find("[%z\1-\31|]")
end
local function outOfCombat()
  if type(InCombatLockdown) ~= "function" then return false end
  local ok, value = pcall(InCombatLockdown)
  return ok and not secret(value) and (value == false or value == nil)
end
function tools.context()
  local guild, realm = read(GetGuildInfo, "player"), read(GetRealmName)
  local edition = ns.util and ns.util.gameEdition()
  if not text(guild, 120) or guild == "" or not text(realm, 120) or not edition or edition == "unknown" then return nil end
  return edition .. ":" .. realm .. ":" .. guild, guild, realm, edition
end
function tools.canViewPrivate()
  local api = C_GuildInfo and C_GuildInfo.CanViewOfficerNote or CanViewOfficerNote
  return read(api) == true
end
function tools.authorized()
  return ns.isOfficer and ns.isOfficer() == true and tools.context() ~= nil
end
function tools.store()
  if not tools.authorized() then return nil end
  local key = tools.context()
  GuildedRosterToolsDB = type(GuildedRosterToolsDB) == "table" and GuildedRosterToolsDB or { scopes = {} }
  local root = GuildedRosterToolsDB
  root.scopes = type(root.scopes) == "table" and root.scopes or {}
  if not root.scopes[key] then
    local count = 0; for _ in pairs(root.scopes) do count = count + 1 end
    if count >= 10 then return nil end -- do not silently erase another guild's audit
    root.scopes[key] = { audit = {}, serial = 0 }
  end
  return root.scopes[key]
end
function tools.requestRoster()
  if not tools.authorized() or not outOfCombat() then return false end
  local fn = C_GuildInfo and C_GuildInfo.GuildRoster or GuildRoster
  if type(fn) ~= "function" then return false end
  return pcall(fn)
end
function tools.snapshot()
  if not tools.authorized() then return nil, "Current officer access is required." end
  if not outOfCombat() then return nil, "Open this tool after combat." end
  if tools.refreshedScope ~= tools.context() or now() - tools.refreshedAt > 30 or now() < tools.refreshedAt then return nil, "Refresh the full guild roster first." end
  local count, ranks = read(GetNumGuildMembers, true), read(GuildControlGetNumRanks)
  if type(count) ~= "number" or count < 1 or count > 1000 or type(ranks) ~= "number" or ranks < 2 or ranks > 20 or type(GetGuildRosterInfo) ~= "function" then return nil, "A complete readable guild roster is required." end
  local rows, me = {}, nil
  for index = 1, count do
    local ok, name, rankName, rank, _, _, _, public, officer, _, _, _, _, _, _, _, _, guid = pcall(GetGuildRosterInfo, index)
    if not ok or not text(name, 160) or name == "" or secret(rank) or type(rank) ~= "number" or rank < 0 or rank >= ranks then return nil, "A complete readable guild roster is required." end
    local key = ns.normalizeName(name)
    if not key or rows[key] then return nil, "Ambiguous character identity." end
    local display = ns.displayName and ns.displayName(name) or name
    rows[key] = { key = key, name = name, display = display, rank = rank, rankName = text(rankName, 120) and rankName or "?", public = text(public, 500) and public or nil,
      officer = tools.canViewPrivate() and text(officer, 500) and officer or nil, guid = text(guid, 100) and guid or nil, index = index }
    if key == ns.playerName() then me = rows[key] end
  end
  if not me then return nil, "Your character is missing from the roster." end
  local layout = {}
  for i = 1, ranks do
    local rankName = read(GuildControlGetRankName, i)
    layout[i] = text(rankName, 120) and rankName or tostring(i)
  end
  return { rows = rows, actor = me, ranks = ranks, layout = table.concat(layout, "\n"), scope = tools.context(), at = now() }
end
local function permitted(action, target, snapshot)
  if target.key == snapshot.actor.key or target.rank <= snapshot.actor.rank then return false end
  if action == "promote" then return target.rank - 1 > snapshot.actor.rank and read(CanGuildPromote) == true end
  if action == "demote" then return target.rank + 1 < snapshot.ranks and read(CanGuildDemote) == true end
  if action == "kick" then return read(CanGuildRemove) == true end
  if action == "public" then return target.public ~= nil and read(CanEditPublicNote) == true end
  if action == "officer" then return target.officer ~= nil and tools.canViewPrivate() and read(C_GuildInfo and C_GuildInfo.CanEditOfficerNote or CanEditOfficerNote) == true end
  return false
end
local function beforeValue(row, action)
  if action == "public" or action == "officer" then return row[action] end
  return row.rank
end
local function operation(row, action, value)
  local api = C_GuildInfo or {}
  if action == "public" or action == "officer" then
    if api.SetNote and row.guid then return api.SetNote, { row.guid, value, action == "public" } end
    if action == "public" then return GuildRosterSetPublicNote, { row.index, value } end
    return GuildRosterSetOfficerNote, { row.index, value }
  end
  if action == "kick" and api.RemoveFromGuild and row.guid then return api.RemoveFromGuild, { row.guid } end
  if (action == "promote" or action == "demote") and api.SetGuildRankOrder and row.guid then
    local rankOrder = row.rank + (action == "promote" and -1 or 1) + 1
    if api.IsGuildRankAssignmentAllowed and read(api.IsGuildRankAssignmentAllowed, row.guid, rankOrder) ~= true then return nil end
    return api.SetGuildRankOrder, { row.guid, rankOrder }
  end
  local name = ns.util and ns.util.address(row.name) or row.name
  if ns.util.gameEdition() == "forever" and not name:find(" ", 1, true) then
    -- Only a known full display name may substitute for the raw roster spelling.
    name = row.display
    if not name:find(" ", 1, true) then return nil end
  end
  if action == "promote" then return api.Promote or GuildPromote, { name } end
  if action == "demote" then return api.Demote or GuildDemote, { name } end
  if action == "kick" then return api.Uninvite or GuildUninvite, { name } end
end
local function makePlan(entries)
  if tools.plan and tools.plan.pending then return nil, "Wait for the pending operation to be verified." end
  local snapshot, err = tools.snapshot(); if not snapshot then return nil, err end
  local plan = { scope = snapshot.scope, actor = snapshot.actor.key, actorGuid = snapshot.actor.guid, layout = snapshot.layout, at = now(), rows = {}, cursor = 1, confirmed = false, blocked = false, kicks = 0 }
  local seen = {}
  for _, input in ipairs(entries) do
    local row, matches
    matches = 0
    for _, candidate in pairs(snapshot.rows) do
      if input.name:lower() == candidate.name:lower() or input.name:lower() == candidate.display:lower() then row = candidate; matches = matches + 1 end
    end
    local item = { name = input.name, action = input.action, value = input.value, status = "ready" }
    if matches ~= 1 or not row then item.status = "Unknown or ambiguous character."
    elseif seen[row.key] then item.status = "Duplicate character in plan."
    elseif not permitted(input.action, row, snapshot) then item.status = "Permission or rank hierarchy prevents this action."
    else
      seen[row.key] = true
      item.key, item.guid, item.before, item.beforeRank = row.key, row.guid, beforeValue(row, input.action), row.rank
      item.after = input.action == "promote" and row.rank - 1 or input.action == "demote" and row.rank + 1 or input.action == "kick" and "removed" or input.value
      local fn = operation(row, input.action, input.value)
      if type(fn) ~= "function" then item.status = "This action is unavailable on this client."
      elseif item.before == item.after then item.status = "unchanged" end
    end
    if item.status ~= "ready" and item.status ~= "unchanged" then plan.blocked = true end
    if input.action == "kick" then plan.kicks = plan.kicks + 1 end
    plan.rows[#plan.rows + 1] = item
  end
  plan.phrase = (plan.kicks > 0 and "REMOVE " or "APPLY ") .. #plan.rows
  tools.plan = plan
  return plan
end
function tools.preview(input)
  tools.invalidatePreview()
  if tools.plan and tools.plan.pending then return nil, "Wait for the pending operation to be verified." end
  if type(input) ~= "string" or #input > 12000 then return nil, "Plan too large (50 rows maximum)." end
  input = input:gsub("\r\n", "\n")
  local rows = {}; local first = true
  for line in (input .. "\n"):gmatch("([^\n]*)\n") do
    if line ~= "" then
      if first then
        if line ~= "character\taction\tvalue" then return nil, "Expected tab-separated header: character, action, value." end
        first = false
      else
        local name, action, value = line:match("^([^\t]+)\t([^\t]+)\t([^\t]*)$")
        if not name or not text(name, 160) or not ({ promote = true, demote = true, kick = true, public = true, officer = true })[action]
          or not text(value, 31) or ((action == "kick" or action == "promote" or action == "demote") and value ~= "") then return nil, "Invalid action, name or note (31 bytes maximum)." end
        rows[#rows + 1] = { name = name, action = action, value = value }
        if #rows > 50 then return nil, "Plan too large (50 rows maximum)." end
      end
    end
  end
  if #rows == 0 then return nil, "The plan has no actions." end
  return makePlan(rows)
end
function tools.confirm(phrase)
  local p = tools.plan
  if not p or p.blocked or phrase ~= p.phrase or p.scope ~= tools.context() or now() - p.at > 120 or not tools.authorized() then return false end
  p.confirmed = true; return true
end
local function auditText(item)
  if item.action == "officer" and not tools.canViewPrivate() then return "[private]" end
  return tostring(item.before or "?") .. " -> " .. tostring(item.after or "?")
end
function tools.describe()
  if not tools.authorized() then return L("Current officer access is required.") end
  local p = tools.plan
  if not p or p.scope ~= tools.context() then return L("Preview a plan first. No actions run automatically.") end
  local lines = { L("One click sends one action. Wait for roster verification before continuing."), L("Confirmation") .. ": " .. p.phrase }
  if p.kicks > 0 then lines[#lines + 1] = L("Removal cannot be undone. Reinviting requires the player's acceptance.") end
  for i, row in ipairs(p.rows) do lines[#lines + 1] = i .. ". " .. row.name .. " / " .. row.action .. " / " .. auditText(row) .. " / " .. L(row.status) end
  return table.concat(lines, "\n")
end
function tools.step()
  local p = tools.plan
  if not p or not p.confirmed or p.blocked or p.pending or now() - p.at > 120 or p.scope ~= tools.context() then return false, "Preview and confirm a fresh plan first." end
  local snapshot, err = tools.snapshot(); if not snapshot then p.confirmed = false; return false, err end
  if snapshot.actor.key ~= p.actor or snapshot.actor.guid ~= p.actorGuid or snapshot.layout ~= p.layout then p.confirmed = false; return false, "Officer identity or guild ranks changed." end
  while p.rows[p.cursor] and p.rows[p.cursor].status == "unchanged" do p.cursor = p.cursor + 1 end
  local item = p.rows[p.cursor]; if not item then return false, "Plan complete." end
  local current = snapshot.rows[item.key]
  if not current or current.guid ~= item.guid or current.rank ~= item.beforeRank or beforeValue(current, item.action) ~= item.before or not permitted(item.action, current, snapshot) then
    item.status = "Roster changed; preview again."; p.confirmed = false; return false, item.status
  end
  local fn, args = operation(current, item.action, item.value)
  if type(fn) ~= "function" then p.confirmed = false; return false, "This action is unavailable on this client." end
  local store = tools.store(); if not store then return false, "Local audit storage is unavailable." end
  store.serial = (store.serial or 0) + 1
  local record = { id = store.serial, at = epoch(), actor = p.actor, key = item.key, name = item.name, guid = item.guid, action = item.action, before = item.before, after = item.after, status = "requested" }
  store.audit[#store.audit + 1] = record
  while #store.audit > 200 do table.remove(store.audit, 1) end
  item.status = "requested"; p.pending = { item = item, record = record, generation = tools.generation, at = now() }
  local ok = pcall(fn, unpack(args))
  if not ok then record.status = "failed"; item.status = "failed"; p.pending = nil; p.confirmed = false; return false, "The game rejected the request. Preview again." end
  tools.requestRoster()
  return true
end
function tools.verify()
  local p = tools.plan; if not p or not p.pending then return end
  local pending = p.pending
  if p.scope ~= tools.context() or now() - pending.at > 15 or now() < pending.at then
    pending.record.status = "unverified"; pending.item.status = "unverified"; p.pending = nil; p.confirmed = false; return
  end
  if tools.generation <= pending.generation or pending.checked == tools.generation then return end
  pending.checked = tools.generation
  local snapshot = tools.snapshot(); if not snapshot then return end
  local row, item = snapshot.rows[pending.item.key], pending.item
  local changed = item.action == "kick" and not row or row and row.guid == item.guid and beforeValue(row, item.action) == item.after
  if changed then
    pending.record.status = "verified"; item.status = "verified"; p.pending = nil; p.cursor = p.cursor + 1
  end
end
function tools.cancel()
  if tools.plan and tools.plan.pending then
    tools.plan.pending.record.status = "unverified"
  end
  tools.plan = nil
end
-- Editing or rejecting a draft must not leave an older plan confirmable.
-- Keep an in-flight receipt until verified; never silently lose its outcome.
function tools.invalidatePreview()
  if tools.plan and tools.plan.pending then tools.plan.confirmed = false
  else tools.plan = nil end
end
function tools.undoPreview()
  tools.invalidatePreview()
  if tools.plan and tools.plan.pending then return nil, "Wait for the pending operation to be verified." end
  local store = tools.store(); if not store then return nil, "Current officer access is required." end
  local snapshot, err = tools.snapshot(); if not snapshot then return nil, err end
  for i = #store.audit, 1, -1 do
    local record = store.audit[i]
    if record.status == "verified" and record.action ~= "kick" then
      local row = snapshot.rows[record.key]
      if not row or row.guid ~= record.guid or beforeValue(row, record.action) ~= record.after then return nil, "Roster changed; recovery would overwrite newer data." end
      local action = record.action == "promote" and "demote" or record.action == "demote" and "promote" or record.action
      return makePlan({ { name = row.name, action = action, value = (action == "public" or action == "officer") and record.before or "" } })
    end
  end
  return nil, "No reversible verified action is available."
end
function tools.auditText()
  local store = tools.store(); if not store then return L("Current officer access is required.") end
  local lines = { L("Local action audit. Requested or unverified does not mean success.") }
  for i = math.max(1, #store.audit - 49), #store.audit do
    local row = store.audit[i]; lines[#lines + 1] = row.id .. " / " .. row.at .. " / " .. row.name .. " / " .. row.action .. " / " .. auditText(row) .. " / " .. L(row.status)
  end
  return table.concat(lines, "\n")
end
local frame = CreateFrame("Frame")
for _, event in ipairs({ "GUILD_ROSTER_UPDATE", "PLAYER_GUILD_UPDATE", "PLAYER_LOGIN" }) do pcall(frame.RegisterEvent, frame, event) end
frame:SetScript("OnEvent", function(_, event)
  if event == "GUILD_ROSTER_UPDATE" then tools.generation = tools.generation + 1; tools.refreshedAt = now(); tools.refreshedScope = tools.context(); tools.verify()
  elseif event == "PLAYER_GUILD_UPDATE" then tools.cancel(); tools.refreshedAt = -1000
  elseif event == "PLAYER_LOGIN" then
    local store = tools.store()
    if store then for _, record in ipairs(store.audit) do if record.status == "requested" then record.status = "unverified" end end end
  end
end)
local elapsedSinceVerify = 0
frame:SetScript("OnUpdate", function(_, elapsed)
  elapsedSinceVerify = elapsedSinceVerify + (elapsed or 0.25)
  if elapsedSinceVerify < 0.25 then return end
  elapsedSinceVerify = 0
  if tools.plan and tools.plan.pending then tools.verify() end
end)
