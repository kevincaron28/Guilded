-- SHA-256 of a bounded, printable ledger batch. A digest is trusted only when
-- the game delivered it directly from an officer in the current guild.
local _, ns = ...
local bits = bit or bit32
if not bits then return end
local band, xor, shift = bits.band, bits.bxor, bits.rshift
-- WoW's bit library has band/bor/bxor/lshift/rshift but not always a rotate; build one from shifts.
local rotate = bits.ror or bits.rrotate
if not rotate then
  local bor, left = bits.bor, bits.lshift
  if not (bor and left) then return end
  rotate = function(x, n) return bor(shift(x, n), left(x, 32 - n)) end
end
local K = {
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
}
local function wordBytes(n)
  return string.char(band(shift(n,24),255), band(shift(n,16),255), band(shift(n,8),255), band(n,255))
end
function ns.ledgerDigest(text)
  local size = #text
  text = text .. string.char(128) .. string.rep(string.char(0), (55-size)%64 + 4) .. wordBytes(size*8)
  local hash = {0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19}
  local w = {}
  for start = 1, #text, 64 do
    for i = 1, 16 do
      local a,b,c,d = text:byte(start+4*i-4, start+4*i-1)
      w[i] = ((a*256+b)*256+c)*256+d
    end
    for i = 17, 64 do
      local x,y = w[i-15],w[i-2]
      w[i] = band(w[i-16] + xor(rotate(x,7),rotate(x,18),shift(x,3)) + w[i-7]
        + xor(rotate(y,17),rotate(y,19),shift(y,10)), 0xffffffff)
    end
    local a,b,c,d,e,f,g,h = unpack(hash)
    for i = 1, 64 do
      local choice = xor(g,band(e,xor(f,g)))
      local majority = xor(band(a,b),band(c,xor(a,b)))
      local t1 = h + xor(rotate(e,6),rotate(e,11),rotate(e,25)) + choice + K[i] + w[i]
      local t2 = xor(rotate(a,2),rotate(a,13),rotate(a,22)) + majority
      h,g,f,e,d,c,b,a = g,f,e,band(d+t1,0xffffffff),c,b,a,band(t1+t2,0xffffffff)
    end
    local result = {a,b,c,d,e,f,g,h}
    for i = 1,8 do hash[i] = band(hash[i]+result[i],0xffffffff) end
  end
  local out = {}
  for i = 1,8 do out[i] = (wordBytes(hash[i]):gsub(".",function(c) return string.format("%02x",c:byte()) end)) end
  return table.concat(out)
end
-- WoW's bit library is not the one the tests use. If this client hashes the standard test
-- text wrongly, switch the relay off (officer-direct sync still works) instead of trusting it.
local ok, check = pcall(ns.ledgerDigest, "abc")
if not ok or check ~= "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" then
  ns.ledgerDigest = nil
  if ns.logDiagnostic then ns.logDiagnostic("LEDGER", "SHA-256 self-test failed; member relay disabled") end
end
