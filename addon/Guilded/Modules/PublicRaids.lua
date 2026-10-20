-- Public recruitment snapshots from the companion. Discord owns the actual signup.
local _, ns = ...
ns = ns or {}
local browser = {}
ns.publicRaids = browser
local function L(text) return ns.L and ns.L(text) or text end
local function clean(value) return tostring(value or ""):gsub("|", ""):gsub("[%c]", " ") end
local function now() return GetServerTime and GetServerTime() or time() end

function browser.rows(role, realm)
  local snapshot = GuildedPublicRaids
  local stamp = type(snapshot) == "table" and ns.util.isoEpoch(snapshot.fetchedAt) or nil
  if not stamp or now() - stamp > 600 or stamp > now() + 60 then return {}, false end
  local rows = {}
  for _, row in ipairs(snapshot.raids or {}) do
    local at = ns.util.isoEpoch(row.at)
    local open = (tonumber(row.tanks) or 0) + (tonumber(row.healers) or 0) + (tonumber(row.dps) or 0)
    if at and at > now() and open > 0
      and (not role or (tonumber(row[role]) or 0) > 0)
      and (not realm or realm == "" or string.lower(row.realm or "") == string.lower(realm)) then
      rows[#rows + 1] = row
    end
  end
  return rows, true
end

function browser.statusText(role, realm)
  local rows, fresh = browser.rows(role, realm)
  if not fresh then return L("Open raids need a fresh companion snapshot. Sync the companion, then /reload. Browse the website for current spots.") end
  local lines = {
    L("Open raids - other guilds welcome guests."),
    L("Snapshot from:") .. " " .. clean(GuildedPublicRaids.fetchedAt),
    L("Counts may change. Join the host Discord and confirm there. Reload after companion sync."),
    ""
  }
  if #rows == 0 then lines[#lines + 1] = L("No open raids match these filters.") end
  for i = 1, math.min(#rows, 8) do
    local row = rows[i]
    lines[#lines + 1] = string.format("%d. %s - %s", i, clean(row.title), clean(row.guildName))
    lines[#lines + 1] = clean(row.at) .. " UTC | " .. clean(row.realm) .. " | " .. clean(row.faction) .. " | " .. clean(row.language)
    lines[#lines + 1] = string.format(L("Tank: %d | Healer: %d | DPS: %d"), row.tanks or 0, row.healers or 0, row.dps or 0)
    lines[#lines + 1] = ""
  end
  return table.concat(lines, "\n")
end

function browser.copy(index, role, realm)
  local rows = browser.rows(role, realm)
  local row = rows[tonumber(index) or 0]
  local url = row and row.inviteUrl or "https://guilded.kcaron.top/recruitment/?kind=raids"
  -- Copyable links only; no game invitations or HTTP requests.
  if ns.showCopyText then ns.showCopyText(url, L("Guilded - copy the link into your browser")) else ns.message(url) end
end

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["pug"] = function(args)
  if args[1] == "copy" then browser.copy(args[2]); return end
  if ns.openToolsPage then ns.openToolsPage("Open raids") else ns.message(browser.statusText()) end
end
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded pug | pug copy <number> - browse open raids and copy the host Discord link")
