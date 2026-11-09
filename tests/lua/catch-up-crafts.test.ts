import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// 9.1: guildmates' recipe lists and attunements travel between online addons (Modules/CatchUp.lua kinds
// C and A), so a carrier who never met the author still uploads them. Three mocked clients.
const CLOCK = 1800000000;
let sessions: LuaSession[] = [];
afterEach(() => { for (const s of sessions) s.close(); sessions = []; });

function client(name: string, options: { carrier?: boolean } = {}) {
  const s = newLuaSession();
  sessions.push(s);
  s.run(`NS = {}; GuildedDB = nil; CLOCK = ${CLOCK}; GT = 0; INSTANCE = false
    function GetServerTime() return CLOCK end
    function GetTime() GT = GT + 1; return GT end
    function IsInInstance() if INSTANCE then return true, "party" end return false, "none" end
    -- The test harness's os.date ignores a leading "!" (UTC): strip it so ISO stamps stay well-formed.
    date = function(fmt, t) return os.date((string.gsub(fmt, "^!", "")), t) end
    TIMERS = {}
    C_Timer = { After = function(_, fn) TIMERS[#TIMERS + 1] = fn end }
    function run_timers() for _ = 1, 20 do local list = TIMERS; TIMERS = {}; if #list == 0 then return end; for _, fn in ipairs(list) do fn() end end end`);
  s.load("Core.lua");
  s.load("DungeonRoutes.lua");
  s.load("Compat.lua");
  s.load("Modules/Dungeon.lua");
  s.load("Modules/Recipes.lua");
  s.load("Modules/Attunements.lua");
  s.load("Modules/GuildRelay.lua");
  s.load("Modules/CatchUp.lua");
  s.run(`fire_event("PLAYER_LOGIN")
    NS.compat.serverTime = function() return CLOCK end
    NS.playerName = function() return "${name}" end
    MEMBERS = { Walter = true, Lebowski = true, Donny = true, Maude = true }
    NS.isGuildMember = function(n) return MEMBERS[(n or ""):match("^[^-]+")] == true end
    NS.isOfficerName = function() return false end
    NS.currentGuildKey = function() return "Achievers-Realm" end
    GuildedStandings = ${options.carrier ? `{ updatedAt = "2026-12-20T10:00:00Z", players = {} }` : "nil"}
    NS.getDb().standings = { updatedAt = "2026-12-20T10:00:00Z" }
    NS.getDb().peerRoster = {}
    fire_event("PLAYER_ENTERING_WORLD")
    run_timers(); SENT = {}`);
  return s;
}

const sent = (s: LuaSession) => s.run(`local out = {}; for _, m in ipairs(SENT or {}) do out[#out + 1] = m.prefix .. ">" .. m.text end; SENT = {}; return table.concat(out, "\\n")`)
  .split("\n").filter(Boolean);
function deliver(from: LuaSession, fromName: string, ...to: LuaSession[]) {
  const lines = sent(from);
  for (const line of lines) {
    const [prefix, ...rest] = line.split(">");
    for (const target of to) target.run(`fire_event("CHAT_MSG_ADDON", ${JSON.stringify(prefix)}, ${JSON.stringify(rest.join(">"))}, "GUILD", "${fromName}-Realm")`);
  }
  return lines;
}
const timers = (...s: LuaSession[]) => { for (const one of s) one.run("run_timers()"); };
const isoAgo = (s: LuaSession, seconds: number) => s.run(`return date("!%Y-%m-%dT%H:%M:%SZ", CLOCK - ${seconds})`);

// Donny (no companion) shared his Alchemy recipes and an attunement; Walter heard both.
function seed(walter: LuaSession) {
  walter.run(`local b = NS.recipes.book()
    b.people.Donny = { Alchemy = { v = CLOCK - 3600, keys = { 13446, 13510, -17187 } }, Mining = { v = CLOCK - 90 * 86400, keys = { 2841 } } }
    NS.getDb().attunements = { Donny = { Onyxia = { completed = true, at = date("!%Y-%m-%dT%H:%M:%SZ", CLOCK - 7200), by = "Donny" } } }`);
}
function exchange(asker: LuaSession, askerName: string, holder: LuaSession, holderName: string) {
  asker.run("NS.catchUp.sendDigest(true)");
  const dig = deliver(asker, askerName, holder);
  timers(holder);
  const have = deliver(holder, holderName, asker); // HAVE
  const want = deliver(asker, askerName, holder); // WANT
  const items = deliver(holder, holderName, asker); // items
  if (process.env["DEBUG_CATCHUP"]) console.log(JSON.stringify({ dig, have, want, items }, null, 1));
  return dig;
}

describe("recipes and attunements in catch-up", () => {
  it("a carrier logging in gets a guildmate's recipes and attunement through a member, not the stale 90-day list", () => {
    const walter = client("Walter");
    const carrier = client("Lebowski", { carrier: true });
    seed(walter);
    const dig = exchange(carrier, "Lebowski", walter, "Walter");
    expect(dig[0]).toMatch(/^GuildedCatch>DIG\|1\|1\|R:0:0\|P:0:0\|C:0:0\|A:0:0$/);
    expect(carrier.run(`local e = NS.recipes.book().people.Donny.Alchemy; return table.concat(e.keys, ",") .. "/" .. e.v .. "/" .. tostring(e.forwarded) .. "/" .. e.via`))
      .toBe(`13446,13510,-17187/${CLOCK - 3600}/true/Walter`);
    expect(carrier.run(`return tostring(NS.recipes.book().people.Donny.Mining)`)).toBe("nil");
    expect(carrier.run(`local e = NS.getDb().attunements.Donny.Onyxia; return tostring(e.completed) .. "/" .. e.at .. "/" .. e.by .. "/" .. e.via`))
      .toBe(`true/${isoAgo(carrier, 7200)}/Donny/Walter`);
    // Afterwards both hold the same items: the digests agree and nothing is asked again.
    for (const kind of ["C", "A"]) expect(carrier.run(`return NS.catchUp.digestOf("${kind}")`)).toBe(walter.run(`return NS.catchUp.digestOf("${kind}")`));
  });

  it("a third member who only hears the carrier's push also stores it, and nothing is double counted", () => {
    const walter = client("Walter");
    const carrier = client("Lebowski", { carrier: true });
    const maude = client("Maude");
    seed(walter);
    // Each of them already holds something (a guildmate with nothing stays quiet), so both answer.
    for (const who of [carrier, maude]) who.run(`NS.recipes.book().people.Walter = { Cooking = { v = CLOCK - 500, keys = { 6888 } } }; NS.getDb().attunements = { Walter = { Karazhan = { completed = true, at = date("!%Y-%m-%dT%H:%M:%SZ", CLOCK - 300) } } }`);
    // Walter logs in with Lebowski and Maude online: both hear what Walter pushes.
    walter.run("NS.catchUp.sendDigest(true)");
    deliver(walter, "Walter", carrier, maude);
    timers(carrier, maude);
    deliver(carrier, "Lebowski", walter); deliver(maude, "Maude", walter);
    const pushed = deliver(walter, "Walter", carrier, maude);
    expect(pushed.some((l) => l.startsWith("GuildedCatch>RCP|Donny|Alchemy|"))).toBe(true);
    for (const who of [carrier, maude]) {
      expect(who.run(`return #NS.recipes.book().people.Donny.Alchemy.keys`)).toBe("3");
      expect(who.run(`return NS.getDb().attunements.Donny.Onyxia.via`)).toBe("Walter");
    }
    // A repeat of the same message changes nothing (same stamp: not newer).
    const before = carrier.run(`return NS.catchUp.stats.relayedIn`);
    carrier.run(`fire_event("CHAT_MSG_ADDON", "GuildedCatch", "ATT|Donny|Onyxia|1|${isoAgo(carrier, 7200)}", "GUILD", "Walter-Realm")`);
    expect(carrier.run(`return NS.catchUp.stats.relayedIn`)).toBe(before);
  });

  it("never replaces a newer list, never stores the future, strangers, oversized lists or junk", () => {
    const carrier = client("Lebowski", { carrier: true });
    carrier.run(`NS.recipes.book().people.Donny = { Alchemy = { v = CLOCK - 60, keys = { 1, 2 } } }`);
    const msg = (text: string, from = "Walter") => carrier.run(`fire_event("CHAT_MSG_ADDON", "GuildedCatch", ${JSON.stringify(text)}, "GUILD", "${from}-Realm")`);
    msg(`RCP|Donny|Alchemy|${CLOCK - 3600}|1|1|9,9,9`); // older than what is held
    expect(carrier.run(`return #NS.recipes.book().people.Donny.Alchemy.keys`)).toBe("2");
    msg(`RCP|Donny|Mining|${CLOCK + 5000}|1|1|2841`); // from the future
    msg(`RCP|Stranger|Mining|${CLOCK - 100}|1|1|2841`); // not a guild member
    msg(`RCP|Donny|Mining|${CLOCK - 100}|1|1|28x1`); // junk
    msg(`RCP|Donny|Tailoring|${CLOCK - 100}|1|1|${Array.from({ length: 401 }, (_, i) => i + 1).join(",").slice(0, 200)}`); // partial: never completes
    msg(`ATT|Donny|Onyxia|1|2999-01-01T00:00:00Z`); // future date
    msg(`ATT|Stranger|Onyxia|1|${isoAgo(carrier, 100)}`);
    msg(`ATT|Lebowski|Onyxia|1|${isoAgo(carrier, 100)}`); // about yourself: your own addon is the authority
    expect(carrier.run(`local p = NS.recipes.book().people; return tostring(p.Donny.Mining) .. tostring(p.Stranger)`)).toBe("nilnil");
    expect(carrier.run(`return tostring(next(NS.getDb().attunements or {}))`)).toBe("nil");
  });

  it("an older addon's DIG (no C or A) is never asked about recipes", () => {
    const walter = client("Walter");
    seed(walter);
    walter.run(`fire_event("CHAT_MSG_ADDON", "GuildedCatch", "DIG|1|1|R:0:0|P:0:0", "GUILD", "Old-Realm")`);
    timers(walter);
    const lines = sent(walter);
    expect(lines.some((l) => /^GuildedCatch>HAVE\|[CA]\|/.test(l))).toBe(false);
  });

  it("sends at most two recipe lists per request and skips lists over 400 recipes", () => {
    const walter = client("Walter");
    walter.run(`local b = NS.recipes.book()
      for i, prof in ipairs({ "Alchemy", "Mining", "Tailoring", "Cooking" }) do b.people.Donny = b.people.Donny or {}; b.people.Donny[prof] = { v = CLOCK - i * 60, keys = { i, i + 10 } } end
      local big = {}; for i = 1, 401 do big[i] = 1000 + i end
      b.people.Maude = { Engineering = { v = CLOCK - 5, keys = big } }`);
    expect(walter.run(`return NS.catchUp.digestOf("C")`)).toMatch(/^4:/);
    const keys = walter.run(`local out = {}; for k in pairs(NS.catchUp.collect("C")) do out[#out + 1] = k end table.sort(out) return table.concat(out, ",")`);
    walter.run(`fire_event("CHAT_MSG_ADDON", "GuildedCatch", "WANT|C|Walter|${keys}", "GUILD", "Lebowski-Realm")`);
    const lists = sent(walter).filter((l) => l.startsWith("GuildedCatch>RCP|"));
    expect(lists.length).toBe(2);
  });
});
