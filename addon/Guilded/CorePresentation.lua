-- Pure presentation helpers extracted from Core.lua; no SavedVariables mutation.
local _, ns = ...

function ns.createSheetExport(getDb)
local db
-- /guilded sheet <table>: tab-separated rows with a header, for pasting into Excel or Google
-- Sheets (each value lands in its own cell). Tabs and line breaks inside a value become
-- spaces so a cell can't spill; the edit box gets slow with huge text, so rows stop at 1000.
local SHEET_ROW_LIMIT = 1000
local SHEET_TABLES = { "standings", "loot", "attendance", "raids", "dungeons" }
local function sheetCell(value)
  local text = string.gsub(tostring(value == nil and "" or value), "[\t\r\n]", " ")
  -- Pasted text must stay text in a spreadsheet, including after whitespace.
  -- Keep actual numbers and plain decimal strings (such as formatted PR) numeric.
  local decimal = string.match(text, "^%s*[+%-]?%d+%.?%d*%s*$") or string.match(text, "^%s*[+%-]?%.%d+%s*$")
  if type(value) ~= "number" and not decimal and string.match(text, "^%s*[=+%-@]") then text = "'" .. text end
  return text
end
local function sheetTime(stamp)
  if not stamp then return "" end
  return (string.gsub(string.gsub(tostring(stamp), "T", " "), "Z$", ""))
end
local sheetBuilders = {
  standings = function()
    local names, rows = {}, {}
    for name in pairs(db.standings and db.standings.players or {}) do names[name] = true end
    for name in pairs(db.epgp or {}) do names[name] = true end
    for name in pairs(names) do
      local row = ns.effectiveStanding(name)
      table.insert(rows, { name = name, ep = row.ep or 0, gp = row.gp or 0, pr = row.pr or 0 })
    end
    table.sort(rows, function(a, b) if a.pr ~= b.pr then return a.pr > b.pr end return a.name < b.name end)
    local out = { { "Rank", "Name", "EP", "GP", "PR" } }
    for i, r in ipairs(rows) do table.insert(out, { i, r.name, r.ep, r.gp, string.format("%.2f", r.pr) }) end
    return out
  end,
  loot = function()
    local titles = {}
    for _, raid in ipairs(db.raids or {}) do titles[raid.id] = raid.title end
    local out = { { "Date (UTC)", "Raid", "Item", "Player", "GP", "Boss" } }
    for i = #(db.loot or {}), 1, -1 do
      local row = db.loot[i]
      table.insert(out, { sheetTime(row.at), row.raid and titles[row.raid] or "", row.item, row.player, row.cost or 0, row.boss or "" })
    end
    return out
  end,
  attendance = function()
    local out = { { "Raid", "Date (UTC)", "Player", "Status" } }
    for i = #(db.raids or {}), 1, -1 do
      local raid = db.raids[i]
      local names = {}
      for name in pairs(db.attendance[raid.id] or {}) do table.insert(names, name) end
      table.sort(names)
      for _, name in ipairs(names) do
        table.insert(out, { raid.title or "Raid", sheetTime(raid.startedAt), name, db.attendance[raid.id][name].status or "" })
      end
    end
    return out
  end,
  raids = function()
    local out = { { "Raid", "Started (UTC)", "Ended (UTC)", "Attended", "Bosses", "Loot" } }
    for i = #(db.raids or {}), 1, -1 do
      local raid = db.raids[i]
      local present, loot = 0, 0
      for _, row in pairs(db.attendance[raid.id] or {}) do if row.status ~= "ABSENT" then present = present + 1 end end
      for _, row in ipairs(db.loot or {}) do if row.raid == raid.id then loot = loot + 1 end end
      table.insert(out, { raid.title or "Raid", sheetTime(raid.startedAt), sheetTime(raid.endedAt), present, #(db.bosses[raid.id] or {}), loot })
    end
    return out
  end,
  dungeons = function()
    local out = { { "Rank", "Name", "Score", "Dungeons" } }
    for i, row in ipairs(ns.scores and ns.scores.ranking and ns.scores.ranking() or {}) do
      table.insert(out, { i, row.name, row.score, row.n or "" })
    end
    return out
  end
}

-- The text, the number of data rows in it (header not counted) and whether rows were cut;
-- nil for an unknown table.
local function sheetText(kind)
  db = getDb()
  local build = sheetBuilders[kind]
  if not build then return nil end
  local rows, lines = build(), {}
  local count = math.min(#rows - 1, SHEET_ROW_LIMIT)
  for i = 1, count + 1 do
    local cells = {}
    for j, value in ipairs(rows[i]) do cells[j] = sheetCell(value) end
    lines[i] = table.concat(cells, "\t")
  end
  return table.concat(lines, "\n"), count, #rows - 1 > SHEET_ROW_LIMIT
end


return sheetText, SHEET_TABLES, SHEET_ROW_LIMIT
end

function ns.createRollParser(normalizeName, isSecret)
-- /roll results. The pattern is built from the client's own
-- RANDOM_ROLL_RESULT text so French (and other) clients work, with the
-- English form as a fallback. Returns name, value, min, max.
local function buildRollPattern(template)
  template = string.gsub(template, "%%%d*%$?s", "\001")
  template = string.gsub(template, "%%%d*%$?d", "\002")
  template = string.gsub(template, "([%%%(%)%.%+%-%*%?%[%]%^%$])", "%%%1")
  template = string.gsub(template, "\001", "(.-)")
  template = string.gsub(template, "\002", "(%%d+)")
  return "^" .. template .. "$"
end

local ROLL_PATTERNS = { buildRollPattern("%s rolls %d (%d-%d)") }
if type(RANDOM_ROLL_RESULT) == "string" then
  table.insert(ROLL_PATTERNS, 1, buildRollPattern(RANDOM_ROLL_RESULT))
end

local function parseRoll(text)
  if type(text) ~= "string" or isSecret(text) then return nil end
  for _, pattern in ipairs(ROLL_PATTERNS) do
    local roller, value, minValue, maxValue = string.match(text, pattern)
    if roller then return normalizeName(roller), tonumber(value), tonumber(minValue), tonumber(maxValue) end
  end
  return nil
end

return parseRoll
end
