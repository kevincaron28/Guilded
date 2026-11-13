import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// 13 November 2026 (owner report): "in Discord and the addon we have Cooking and Cuisine as two separate professions, same for the
// other professions". 9.1.2 gave every profession one English key; these tests keep a French and an English client, and data saved
// before that, on the same key in the places that still compared or stored the game's own spelling: the "open your profession window"
// reminder (compared "Cuisine" with a book keyed "Cooking"), craft orders (the profession on a request), and the saved-data merge
// (which kept only the newest of two copies and left reminders and orders untouched).
let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

const lua = (text: string) => `"${Array.from(Buffer.from(text, "utf8")).map(b => b < 128 && b !== 34 && b !== 92 ? String.fromCharCode(b) : `\\${String(b).padStart(3, "0")}`).join("")}"`;

function loggedIn(files: string[], before = ""): LuaSession {
  session = newLuaSession();
  session.run(String.raw`
    NS = {}
    MOCK_UNITS = { player = { name = "Kev", buffs = {} } }
    ${before}
  `);
  session.load("Core.lua");
  session.load("Compat.lua");
  for (const file of files) session.load(file);
  session.run(`fire_event("PLAYER_LOGIN")`);
  return session;
}

const FRENCH_CLIENT = String.raw`
  GetProfessions = function() return 1, 2 end
  GetProfessionInfo = function(index)
    if index == 1 then return ${lua("Cuisine")}, nil, 150, 300, nil, nil, 185 end
    return ${lua("Pêche")}, nil, 75, 300, nil, nil, 356
  end
`;

describe("the unread-profession reminder on a French client", () => {
  it("does not ask for the Cuisine window when the Cooking recipes are already in the book", () => {
    const s = loggedIn(["Locale.lua", "Modules/Recipes.lua"]);
    s.run(FRENCH_CLIENT);
    s.run(`NS.recipes.book().people.Kev = { Cooking = { v = 5, keys = { 11 } } }`);
    expect(s.run("return table.concat(NS.recipes.unreadProfessions(), ',')")).toBe("");
    expect(s.run("return table.concat(NS.recipes.remindUnread(), ',')")).toBe("");
  });

  it("names the profession once under its English key and says it in French", () => {
    const s = loggedIn(["Locale.lua", "Modules/Recipes.lua"]);
    s.run(FRENCH_CLIENT);
    s.run(`NS.getSettings().language = "fr"`);
    // Fishing has no recipes (a gathering profession); Cooking is not in the book yet.
    expect(s.run("return table.concat(NS.recipes.remindUnread(), ',')")).toBe("Cooking");
    expect(s.chat().join("\n")).toContain("Cuisine");
    expect(s.chat().join("\n")).not.toContain("Cooking");
    // Reminded once, under the English key: an English client on the same saved variables is not reminded again.
    expect(s.run("return tostring(GuildedDB.recipeBook.reminded['Kev:Cooking'])")).toBe("true");
    s.run(`NS.getSettings().language = "en"; GetProfessionInfo = function() return "Cooking", nil, 150, 300, nil, nil, 185 end; GetProfessions = function() return 1 end`);
    expect(s.run("return table.concat(NS.recipes.remindUnread(), ',')")).toBe("");
  });
});

describe("craft orders carry one profession name", () => {
  function orders(): LuaSession {
    const s = loggedIn(["Locale.lua", "Modules/Recipes.lua", "Modules/CraftOrders.lua"]);
    s.run(`
      NS.isGuildMember = function(name) return name ~= "Stranger" end
      NS.util.tooFarAhead = function() return false end
      MESSAGES = {}; NS.message = function(text) MESSAGES[#MESSAGES + 1] = text end
    `);
    return s;
  }

  it("a request heard from a French client is saved as Cooking, the same as an English one", () => {
    const s = orders();
    s.run(`fire_event("CHAT_MSG_ADDON", "GuildedOrd", ${lua("NEW|g6a0b1c2d3|2580|1|0|1799999900|Cuisine||Brown Linen Shirt|")}, "GUILD", "Ann Walker")
      fire_event("CHAT_MSG_ADDON", "GuildedOrd", ${lua("NEW|g6a0b1c2d4|2581|1|0|1799999900|Cooking||Linen Belt|")}, "GUILD", "Bo Dee")`);
    const profs = s.run(`local t = {} for _, v in pairs(GuildedDB.craftOrders.heardRequests) do t[#t + 1] = tostring(v.prof) end table.sort(t) return table.concat(t, ",")`);
    expect(profs).toBe("Cooking,Cooking");
  });

  it("a request made on a French client names the English profession when it is sent", () => {
    const s = orders();
    s.run(`NS.craftOrders.submit({ item = "Brown Linen Shirt", key = 2580, prof = ${lua("Cuisine")}, qty = 1 })`);
    expect(s.run(`local t = {} for _, v in pairs(GuildedDB.craftOrders.requests) do t[#t + 1] = tostring(v.prof) end return table.concat(t, ",")`)).toBe("Cooking");
  });
});

describe("data saved before the one-name versions is merged on load, without losing anything", () => {
  const SAVED = String.raw`
    GuildedDB = {
      recipeBook = {
        people = {
          Amy = { Cuisine = { v = 5, keys = { 1, 2 } }, Cooking = { v = 9, keys = { 3 } }, [${lua("Pêche")}] = { v = 2, keys = { 8 } } },
          Bob = { Kochkunst = { v = 4, keys = { 6 } } }
        },
        cooldowns = { Amy = { { prof = "Cuisine", name = "Pot", readyAt = 5 } } },
        reminded = { ["Kev:Cuisine"] = true, ["Kev:Cooking"] = true, ["Kev:Alchemy"] = true }, names = {}, mats = {}, cooldownAt = {}
      },
      peerRoster = { Cy = { professions = ${lua("Cuisine:300,Cooking:225,Pêche:75")} } },
      craftOrders = { requests = { g1 = { ref = "g1", prof = "Cuisine", item = "Stew" }, g2 = { ref = "g2", prof = "Alchemy", item = "Flask" } },
        heardRequests = { ["g3@Ann"] = { ref = "g3", prof = ${lua("Kochkunst")}, item = "Bread" } }, actions = {}, heard = {} }
    }
  `;

  it("a French client's saved Cuisine, an English one's Cooking and the rest become one entry each, with every recipe kept", () => {
    const s = loggedIn(["Locale.lua", "Modules/Recipes.lua", "Modules/CraftOrders.lua"], SAVED);
    expect(s.run("local t = {} for p in pairs(GuildedDB.recipeBook.people.Amy) do t[#t + 1] = p end table.sort(t) return table.concat(t, ',')")).toBe("Cooking,Fishing");
    // The newest list leads, the older one's recipes are added: nothing lost.
    expect(s.run("local e = GuildedDB.recipeBook.people.Amy.Cooking; return e.v .. ':' .. table.concat(e.keys, ',')")).toBe("9:3,1,2");
    expect(s.run("return tostring(next(GuildedDB.recipeBook.people.Bob)) .. GuildedDB.recipeBook.people.Bob.Cooking.keys[1]")).toBe("Cooking6");
    expect(s.run("return GuildedDB.recipeBook.cooldowns.Amy[1].prof")).toBe("Cooking");
    expect(s.run("return GuildedDB.peerRoster.Cy.professions")).toBe("Cooking:300,Fishing:75");
    expect(s.run("local t = {} for k in pairs(GuildedDB.recipeBook.reminded) do t[#t + 1] = k end table.sort(t) return table.concat(t, ',')")).toBe("Kev:Alchemy,Kev:Cooking");
    expect(s.run("return GuildedDB.craftOrders.requests.g1.prof .. ',' .. GuildedDB.craftOrders.requests.g2.prof .. ',' .. GuildedDB.craftOrders.heardRequests['g3@Ann'].prof")).toBe("Cooking,Alchemy,Cooking");
    // Running it again (the next login) changes nothing.
    expect(s.run("return tostring(NS.util.normalizeProfessionData(GuildedDB))")).toBe("false");
  });

  it("a French client that loads the merged data shares and shows Cooking once, in French", () => {
    const s = loggedIn(["Locale.lua", "Modules/Recipes.lua"], SAVED + String.raw`
      SENT = {}
      IsInGuild = function() return true end
      C_Timer = { After = function(_, fn) fn() end }
      C_ChatInfo = { SendAddonMessage = function(_, text, channel) SENT[#SENT + 1] = text end, RegisterAddonMessagePrefix = function() return true end }
    `);
    s.run(`NS.getSettings().language = "fr"`);
    expect(s.run(`return NS.util.professionLabel("Cooking")`)).toBe("Cuisine");
    expect(s.run("return tostring(GuildedDB.recipeBook.people.Amy.Cuisine)")).toBe("nil");
    const lines = s.run(`local t = {} for _, line in ipairs(NS.recipes.mineText and {} or {}) do t[#t + 1] = line end
      local whoLines = {} for _, c in ipairs(NS.recipes.crafters(3)) do whoLines[#whoLines + 1] = c.name .. "=" .. c.profession end table.sort(whoLines) return table.concat(whoLines, ",")`);
    expect(lines).toBe("Amy=Cooking");
  });
});
