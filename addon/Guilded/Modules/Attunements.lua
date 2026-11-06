-- Attunements, tracked by themselves.
--
-- Your own addon checks your character (finished quests, reputation) and records every
-- attunement you have completed, then tells the guild, so nobody has to fill them in by hand:
-- your gear check, the Discord bot and the officers' lists pick them up like any other data.
-- The other players' addons do the same for themselves; an officer's addon keeps what they
-- report (only ever about themselves).
--
--   /guilded attune auto                          look now and list what was found
--   /guilded attune track "<name>" quest <id> ... start tracking one (any finished quest id counts)
--   /guilded attune track "<name>" rep <factionId> <standing 1-8>
--   /guilded attune untrack "<name>"
--   /guilded attune tracked                       list what is tracked
--
-- It only ever ADDS: a completed attunement is never cleared by itself. Manual /guilded attune
-- still works for anything not tracked.
--
-- Nothing is built in: WoW Forever's raids (Barrow Deeps, Hyjal Summit, Onyxia's Lair) are not
-- the old ones, so guessing quest ids would be wrong. Find the quest id of the attunement quest
-- (its Wowhead-style link, or /dump on the quest link) and track it once with the command above;
-- the choice is saved on this computer. Built-in entries can still be added to LIST below.
local addonName, ns = ...
ns = ns or {}

local module = {}
ns.attunements = module

local REVERED = 6

-- name: what the guild calls it (also the key the bot stores).
-- quests: any one finished quest counts (Alliance and Horde have different ones).
-- reputation: { factionId, standing } counts when you are at least that standing.
local LIST = {}
module.LIST = LIST

-- Built-in entries plus the ones this player chose to track.
local function entries()
  local all = {}
  for _, entry in ipairs(LIST) do table.insert(all, entry) end
  local s = ns.getSettings and ns.getSettings()
  for _, entry in ipairs(s and s.attuneTracked or {}) do table.insert(all, entry) end
  return all
end
module.entries = entries

local function isSecret(value) return ns.isSecret and ns.isSecret(value) end

local function questDone(id)
  local fn = (C_QuestLog and C_QuestLog.IsQuestFlaggedCompleted) or IsQuestFlaggedCompleted
  if type(fn) ~= "function" then return nil end
  local ok, done = pcall(fn, id)
  if not ok or isSecret(done) then return nil end
  return done == true
end

-- The standing (1 hated .. 8 exalted) with a faction, or nil.
local function standing(factionId)
  if C_Reputation and C_Reputation.GetFactionDataByID then
    local ok, data = pcall(C_Reputation.GetFactionDataByID, factionId)
    if ok and type(data) == "table" and not isSecret(data.reaction) then return tonumber(data.reaction) end
  end
  if GetFactionInfoByID then
    local ok, _, _, standingId = pcall(GetFactionInfoByID, factionId)
    if ok and not isSecret(standingId) then return tonumber(standingId) end
  end
  return nil
end

-- true / false / nil (cannot tell) for one entry.
function module.check(entry)
  if entry.quests then
    local known = false
    for _, id in ipairs(entry.quests) do
      local done = questDone(id)
      if done then return true end
      if done ~= nil then known = true end
    end
    return known and false or nil
  end
  if entry.reputation then
    local current = standing(entry.reputation[1])
    if current == nil then return nil end
    return current >= entry.reputation[2]
  end
  return nil
end

-- Records what you have completed and tells the guild about anything new. Returns the names
-- newly recorded and the names that are done.
function module.scan(silent)
  local newly, done = {}, {}
  local me = ns.playerName and ns.playerName()
  local d = ns.getDb and ns.getDb()
  if not me or not d then return newly, done end
  for _, entry in ipairs(entries()) do
    if module.check(entry) == true then
      table.insert(done, entry.name)
      local key = ns.canonicalKey and ns.canonicalKey(entry.name) or entry.name
      local known = d.attunements and d.attunements[me] and d.attunements[me][key]
      if not (known and known.completed) then
        table.insert(newly, entry.name)
        if ns.setAttunement then ns.setAttunement(me, entry.name, true, silent) end
      end
    end
  end
  return newly, done
end

-- What another player's addon says about themselves: "ATTUNEMENT|<name>|<key>|true".
-- Kept only when they say it about themselves, through the guild channel.
function module.handleMessage(text, channel, sender)
  if channel ~= "GUILD" then return false end
  local name, key, flag = string.match(text or "", "^ATTUNEMENT|([^|]+)|([^|]+)|(%a+)$")
  if not name then return false end
  local who = ns.normalizeName and ns.normalizeName(sender)
  -- (8.5) An older addon names a Forever character by first name only: kept under the sender's full name.
  local same = ns.util and ns.util.sameCharacter and ns.util.sameCharacter(name, sender) or who == ns.normalizeName(name)
  if not who or not same or who == ns.playerName() then return false end
  local d = ns.getDb and ns.getDb()
  if not d then return false end
  key = ns.canonicalKey and ns.canonicalKey(key) or key
  d.attunements = d.attunements or {}
  d.attunements[who] = d.attunements[who] or {}
  d.attunements[who][key] = { completed = flag == "true", at = ns.now and ns.now() or nil, by = who }
  return true
end

-- Looks a few seconds after the game has loaded (quest data arrives late) and again when a
-- quest is handed in or a reputation changes.
local pending = false
local function scanSoon(delay)
  if pending then return end
  pending = true
  local function run()
    pending = false
    pcall(module.scan, true)
  end
  if C_Timer and C_Timer.After then C_Timer.After(delay, run) else run() end
end

if CreateFrame then
  local frame = CreateFrame("Frame")
  frame:RegisterEvent("PLAYER_ENTERING_WORLD")
  frame:RegisterEvent("QUEST_TURNED_IN")
  frame:RegisterEvent("UPDATE_FACTION")
  frame:SetScript("OnEvent", function(_, event)
    if event ~= "PLAYER_ENTERING_WORLD" and event ~= "QUEST_TURNED_IN" and event ~= "UPDATE_FACTION" then return end
    if ns.moduleActive and not ns.moduleActive("attunements") then return end
    scanSoon(event == "PLAYER_ENTERING_WORLD" and 8 or 3)
  end)
end

-- /guilded attune auto | track | untrack | tracked   (args[1] is "attune", args[2] the subcommand)
function module.command(args)
  args = args or {}
  local sub = string.lower(args[2] or "auto")
  local s = ns.getSettings and ns.getSettings()
  if sub == "tracked" then
    local names = {}
    for _, entry in ipairs(entries()) do table.insert(names, entry.name) end
    ns.message(#names > 0 and ("Tracked attunements: " .. table.concat(names, ", ") .. ".")
      or "No attunement is tracked yet. /guilded attune track \"<name>\" quest <id>")
    return
  end
  if sub == "track" or sub == "untrack" then
    if not s then return end
    -- The name may be several words; the kind (quest / rep) and numbers come after it.
    local words, index = {}, 3
    while args[index] and string.lower(args[index]) ~= "quest" and string.lower(args[index]) ~= "rep" do
      table.insert(words, args[index])
      index = index + 1
    end
    local name = string.gsub(table.concat(words, " "), '"', "")
    if name == "" then ns.message("/guilded attune track \"<name>\" quest <id> ... | rep <factionId> <standing 1-8> | untrack \"<name>\"") return end
    name = ns.canonicalKey and ns.canonicalKey(name) or name
    s.attuneTracked = s.attuneTracked or {}
    for i = #s.attuneTracked, 1, -1 do
      if s.attuneTracked[i].name == name then table.remove(s.attuneTracked, i) end
    end
    if sub == "untrack" then ns.message("No longer tracking " .. name .. ".") return end
    local kind = string.lower(args[index] or "")
    local numbers = {}
    for i = index + 1, #args do
      local number = tonumber(args[i])
      if number then table.insert(numbers, number) end
    end
    if kind == "quest" and #numbers > 0 then
      table.insert(s.attuneTracked, { name = name, quests = numbers })
    elseif kind == "rep" and #numbers >= 1 then
      table.insert(s.attuneTracked, { name = name, reputation = { numbers[1], numbers[2] or REVERED } })
    else
      ns.message("/guilded attune track \"<name>\" quest <id> ... | rep <factionId> <standing 1-8>")
      return
    end
    ns.message("Tracking " .. name .. ". It is recorded by itself once you complete it.")
    scanSoon(1)
    return
  end
  local newly, done = module.scan(true)
  if #done == 0 then
    ns.message("No tracked attunement is complete on this character. Track one with /guilded attune track \"<name>\" quest <id>, or mark it by hand: /guilded attune <name>.")
    return
  end
  ns.message("Attunements found: " .. table.concat(done, ", ") .. ".")
  if #newly > 0 then ns.message("Newly recorded and shared with the guild: " .. table.concat(newly, ", ") .. ".") end
end
