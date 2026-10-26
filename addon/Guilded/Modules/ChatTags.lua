-- Main/alt names in guild and officer chat: when an alt speaks, the line starts with their
-- main's name, e.g. "(Thrall) lfg deadmines". Off until you turn it on; it only changes what
-- this client shows.
--
--   /guilded chattags on | off
--
-- Who is whose alt comes from the EPGP standings the companion writes from Discord (characters
-- of the same linked member; the one marked main). Without standings nothing is tagged. Chat
-- the game marks secret is never touched.
local addonName, ns = ...
ns = ns or {}

local EVENTS = { "CHAT_MSG_GUILD", "CHAT_MSG_OFFICER" }
local TAG_COLOR = "|cff9d9d9d"

local chatTags = {}
ns.chatTags = chatTags

local cache, cacheStamp = nil, nil

local function L(text) return ns.L and ns.L(text) or text end
local function settings() local db = ns.getDb and ns.getDb(); return db and db.settings end
local function bare(name) return ns.normalizeName and ns.normalizeName(name) or name end

-- character -> main's display name, for characters whose linked member has another main.
function chatTags.mains(standings)
  standings = standings or GuildedStandings
  local players = type(standings) == "table" and standings.players or nil
  if type(players) ~= "table" then return {} end
  local mainByAccount, out = {}, {}
  for _, row in ipairs(players) do
    if row.main and row.account and row.account ~= "" then mainByAccount[row.account] = row end
  end
  for _, row in ipairs(players) do
    local main = row.account and row.account ~= "" and mainByAccount[row.account]
    local name = bare(row.name)
    if main and not row.main and name and bare(main.name) ~= name then out[name] = main.displayName or main.name end
  end
  return out
end

local function lookup(author)
  local stamp = type(GuildedStandings) == "table" and GuildedStandings.updatedAt or nil
  if not cache or stamp ~= cacheStamp then cache, cacheStamp = chatTags.mains(), stamp end
  return cache[bare(author) or ""]
end

function chatTags.enabled()
  local s = settings()
  return s and s.chatTags == true and (not ns.moduleActive or ns.moduleActive("chattags")) or false
end

-- The chat filter: returns the game's (filtered, message, author, ...) contract.
function chatTags.filter(_, _, message, author, ...)
  if not chatTags.enabled() or type(message) ~= "string" or type(author) ~= "string" then return false, message, author, ... end
  if ns.isSecret and (ns.isSecret(message) or ns.isSecret(author)) then return false, message, author, ... end
  local main = lookup(author)
  if not main then return false, message, author, ... end
  return false, TAG_COLOR .. "(" .. main .. ")|r " .. message, author, ...
end

local function addFilter(event)
  local add = ChatFrame_AddMessageEventFilter or (ChatFrameUtil and ChatFrameUtil.AddMessageEventFilter)
  if type(add) == "function" then pcall(add, event, chatTags.filter) end
end
for _, event in ipairs(EVENTS) do addFilter(event) end

ns.commandHandlers = ns.commandHandlers or {}
ns.commandHandlers["chattags"] = function(args)
  if ns.moduleActive and not ns.moduleActive("chattags") then return end
  local s = settings()
  if not s then return end
  local action = string.lower(args[1] or "")
  if action == "on" or action == "off" then s.chatTags = action == "on" end
  local count = 0
  for _ in pairs(chatTags.mains()) do count = count + 1 end
  ns.message(string.format(L("Main names in guild chat: %s. %d alt(s) known from the standings."), s.chatTags and L("on") or L("off"), count))
end
ns.commandHelp = ns.commandHelp or {}
table.insert(ns.commandHelp, "/guilded chattags on | off - show an alt's main name in guild and officer chat")
