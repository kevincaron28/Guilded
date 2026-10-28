-- Copied from addon/Guilded/Transport.lua by scripts/build-dungeons-addon.mjs. Edit the original, then run npm run dungeons:sync.
-- Shared incoming transport boundary. Loaded after Util.lua in both addons.
local _, ns = ...
local comm, util = ns.comm, ns.util
local MAX_ADDON_MESSAGE = 255
local function isSecret(value)
  if ns.isSecret then return ns.isSecret(value) end
  return issecretvalue and issecretvalue(value) == true or false
end
local incomingChannels = { GUILD = true, PARTY = true, RAID = true, WHISPER = true, INSTANCE_CHAT = true }
-- Shared transport boundary for every Guilded receiver. Module-specific
-- revision/checksum/participant checks still bind the payload to its session.
-- A checksum detects corruption; Blizzard's delivered sender plus role checks
-- authorize writes. It is never treated as a cryptographic identity proof.
function comm.authorized(sender, policy)
  if type(sender) ~= "string" or isSecret(sender) then return false end
  if policy == "officer" then return ns.isOfficerName and ns.isOfficerName(sender) == true or false end
  if policy == "guild" then
    return (ns.isOfficerName and ns.isOfficerName(sender) == true) or (ns.isGuildMember and ns.isGuildMember(sender) == true) or false
  end
  if policy == "group" then return util.inMyGroup(sender) end
  return false
end
function comm.accept(prefix, text, channel, sender, expected, authorize)
  if isSecret(prefix) or isSecret(text) or isSecret(channel) or isSecret(sender) then return false end
  if type(prefix) ~= "string" or prefix ~= expected or type(text) ~= "string" or #text > MAX_ADDON_MESSAGE or text:find("%z")
    or not incomingChannels[channel] or type(sender) ~= "string" or sender == "" or #sender > 200 or sender:find("[|%c]") then return false end
  if authorize then
    local ok, allowed = pcall(authorize, sender, channel)
    if not ok or allowed ~= true then return false end
  end
  return true
end

-- Cache delivered reply addresses only after the same transport checks as data.
if CreateFrame then
  local addressFrame = CreateFrame("Frame")
  addressFrame:RegisterEvent("CHAT_MSG_ADDON")
  addressFrame:SetScript("OnEvent", function(_, _, prefix, text, channel, sender)
    if util.rememberAddress and comm.accept(prefix, text, channel, sender, prefix) and string.sub(prefix, 1, 7) == "Guilded" then
      util.rememberAddress(sender)
    end
  end)
end
