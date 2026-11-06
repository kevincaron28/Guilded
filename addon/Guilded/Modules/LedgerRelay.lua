-- An officer broadcasts a SHA-256 receipt, while the actual day goes by whisper.
-- A guildmate who heard that receipt may later fetch the exact bytes from any
-- holder. Offers select one sender. An unrecognized digest never creates trust.
local _, ns = ...
local CAPACITY, CHUNK, MAX_BYTES = 16, 160, 12002
local MAX_PENDING = 8
local OFFER_JITTER = 3  -- seconds; ns.ledgerOfferJitter overrides (tests)
-- A holder whose bytes failed the digest, or who went quiet, is skipped for a while.
local REFUSE_BAD, REFUSE_STALLED, MAX_REFUSED = 600, 300, 64

function ns.createLedgerRelay(send, apply, active, onDelivery)
  local incoming, lastRequest, lastServed
  local refused = {}
  local function refuse(digest, sender, seconds, now)
    local n = 0
    for key, until_ in pairs(refused) do if until_ <= now then refused[key] = nil else n = n + 1 end end
    if n < MAX_REFUSED and digest and sender then refused[digest .. sender] = now + seconds end
  end
  local function cache()
    local d, guild = ns.getDb(), ns.currentGuildKey()
    if not d or not guild or not ns.ledgerDigest or not active() then return end
    if not d.ledgerRelay or d.ledgerRelay.guild ~= guild then
      d.ledgerRelay = { guild = guild, records = {}, order = {} }
      incoming, lastRequest, lastServed, refused = nil, nil, nil, {}
    end
    return d.ledgerRelay
  end
  local function record(c, digest, officer)
    if not c.records[digest] then
      if #c.order >= CAPACITY then c.records[table.remove(c.order, 1)] = nil end
      c.order[#c.order+1] = digest
      c.records[digest] = { officer = officer }
    end
    return c.records[digest]
  end
  local relay = {}
  function relay.remember(wire, officer, announce)
    local c = cache()
    if not c or #wire > MAX_BYTES then return end
    local digest = ns.ledgerDigest(wire)
    local r = record(c, digest, officer)
    r.wire = wire
    local now = ns.util.serverTime()
    if announce and (not r.advertised or now - r.advertised >= 300) then
      r.advertised = now
      send("SEAL|1|" .. digest, "GUILD")
    end
  end
  function relay.request()
    local c, now = cache(), ns.util.serverTime()
    if not c or (lastRequest and now - lastRequest < 15) then return end
    if incoming and incoming.cache == c and now - incoming.at < (incoming.sender and 120 or 15) then return end
    if incoming and incoming.sender then refuse(incoming.digest, incoming.sender, REFUSE_STALLED, now) end
    incoming = nil
    -- Rotate misses so one unavailable holder cannot starve later receipts.
    for _ = 1,#c.order do
      local digest = table.remove(c.order,1)
      c.order[#c.order+1] = digest
      if not c.records[digest].wire then
        lastRequest = now
        incoming = { cache = c, digest = digest, at = now, chunks = {}, count = 0 }
        send("SEEK|1|" .. digest, "GUILD")
        return
      end
    end
  end
  function relay.handle(kind, text, channel, sender, role)
    if kind ~= "SEAL" and kind ~= "SEEK" and kind ~= "HAVE" and kind ~= "FETCH" and kind ~= "PART" then return false end
    local digest, tail = text:match("^%u+|1|([0-9a-f]+)(.*)$")
    if not digest or #digest ~= 64 or (kind ~= "PART" and tail ~= "") then return true end
    local c, now = cache(), ns.util.serverTime()
    if not c then return true end
    local r = c.records[digest]
    if kind == "SEAL" and channel == "GUILD" and role == "officer" then
      if not r then
        record(c, digest, sender)
        -- Give the officer's direct transfer a chance to finish first.
        if C_Timer and C_Timer.After then C_Timer.After(15 + math.random()*5, relay.request) end
      end
    elseif kind == "SEEK" and channel == "GUILD" and r and r.wire then
      if ns.comm.pending and ns.comm.pending("GuildedLedger") > MAX_PENDING then return true end
      if not r.offerAt or now - r.offerAt >= 5 then
        r.offerAt, r.offerTo = now, sender
        -- With everyone on, many holders hear one SEEK: spread the short offers out.
        local function offer() if cache() == c and r.wire and r.offerTo == sender then send("HAVE|1|" .. digest, "WHISPER", sender) end end
        local spread = ns.ledgerOfferJitter or OFFER_JITTER
        if spread > 0 and C_Timer and C_Timer.After then C_Timer.After(math.random() * spread, offer) else offer() end
      end
    elseif kind == "FETCH" and channel == "WHISPER" and r and r.wire then
      if r.offerTo ~= sender or not r.offerAt or now - r.offerAt > 120 then return true end
      if (lastServed and now - lastServed < 5) or (ns.comm.pending and ns.comm.pending("GuildedLedger") > MAX_PENDING) then return true end
      r.offerTo = nil
      lastServed = now
      local parts = math.ceil(#r.wire/CHUNK)
      for i=1,parts do
        send("PART|1|" .. digest .. "|" .. i .. "|" .. parts .. "|" .. r.wire:sub((i-1)*CHUNK+1,i*CHUNK), "WHISPER", sender)
      end
    elseif channel == "WHISPER" and r and not r.wire and incoming and incoming.cache == c
      and incoming.digest == digest and now - incoming.at < 120 then
      if kind == "HAVE" and not incoming.sender and not (refused[digest .. sender] and refused[digest .. sender] > now) then
        incoming.sender, incoming.at = sender, now
        send("FETCH|1|" .. digest, "WHISPER", sender)
      elseif kind == "PART" and sender == incoming.sender then
        local part, total, chunk = tail:match("^|(%d+)|(%d+)|(.+)$")
        part, total = tonumber(part), tonumber(total)
        if not part or part < 1 or part > total or total > math.ceil(MAX_BYTES/CHUNK)
          or #chunk > CHUNK or (part < total and #chunk ~= CHUNK) or (part-1)*CHUNK+#chunk > MAX_BYTES
          or (incoming.total and incoming.total ~= total) or incoming.chunks[part] then return true end
        incoming.chunks[part], incoming.total, incoming.at = chunk, total, now
        incoming.count = incoming.count + 1
        if incoming.count == total then
          local wire = table.concat(incoming.chunks)
          incoming = nil
          if ns.ledgerDigest(wire) == digest and apply(wire, r.officer) then
            r.wire = wire
            onDelivery(sender)
          else
            refuse(digest, sender, REFUSE_BAD, now)
          end
          if C_Timer and C_Timer.After then C_Timer.After(15, relay.request) end
        end
      end
    end
    return true
  end
  return relay
end
