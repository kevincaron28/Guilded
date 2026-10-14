import { afterEach, describe, expect, it } from "vitest";
import { standingsToLua } from "../../companion/standings-format.mjs";
import { betaSeasonRules } from "../../src/services/dungeon-beta-preset.js";
import { newLuaSession, type LuaSession } from "./harness.js";
const sessions: LuaSession[] = [];
afterEach(() => { for (const s of sessions) s.close(); sessions.length = 0; });

it("shows the complete beta catalogue before any runs and relays separate Scarlet wings", () => {
  const officer = setup(true), member = setup();
  officer.run('NS.playerName=function() return "Officer" end');
  const preset = betaSeasonRules();
  const details = ["graveyard", "library"].map((wing, i) => ({ instanceId: 189, dungeonKey: `189:${wing}`, name: wing,
    points: 200, speedBonus: 0, durationSec: i ? 1500 : 900, targetSec: i ? 1500 : 900, runRef: wing,
    bosses: [{ id: 1, name: wing, durationSec: 60, runRef: wing }] }));
  officer.run(standingsToLua({ updatedAt: "stamp", standings: [], dungeonBoard: { id: "beta", season: "Beta", status: "ACTIVE",
    ratingVersion: 3, detailsAvailable: true, provisionalTargets: true, rows: [], catalog: preset.catalog,
    profiles: [{ name: "Tester", characters: [], points: 400, details }] } }));
  officer.run("DB.dungeonBoard=GuildedDungeonBoard");
  expect(officer.run('return #NS.dungeonScorePanel.model("Officer",1).cards')).toBe("16");
  expect(officer.run('return NS.dungeonScorePanel.model("Officer",1).total')).toBe("0");
  member.run('DB.dungeonBoard={updatedAt="stamp",season="Beta",status="ACTIVE",rows={}}; NS.seasonDetails.request(1)');
  officer.run(`fire_event("CHAT_MSG_ADDON","GuildedRating",${JSON.stringify(member.run("return SENT[#SENT].text"))},"GUILD","Tester")`);
  for (let i = 1; i <= Number(officer.run("return #SENT")); i++) {
    member.run(`fire_event("CHAT_MSG_ADDON","GuildedRating",${JSON.stringify(officer.run(`return SENT[${i}].text`))},"WHISPER","Officer")`);
  }
  expect(member.run('return #NS.dungeonScorePanel.model("Tester",1).cards')).toBe("16");
  expect(member.run('return NS.dungeonScorePanel.model("Tester",1).total')).toBe("400");
  expect(member.run('return NS.seasonDetails.get(1,"Tester").profile.details[2].bosses[1].runRef')).toBe("library");
  expect(member.run('return tostring(NS.seasonDetails.get(1,"Tester").provisional)')).toBe("true");
  expect(member.run('return NS.seasonDetails.get(1,"Tester").catalog[1].minLevel')).toBe("13");
});
const best = { instanceId: 36, name: 'Deadmines; "West"', points: 110, speedBonus: 10, durationSec: 1020, targetSec: 1200, runRef: "run;one" };
const current = { id: "current", season: "Current", status: "ACTIVE", ratingVersion: 2, detailsAvailable: true,
  rows: [{ name: "Tester", points: 110 }],
  profiles: [{ name: "Tester", points: 110, characters: [], details: [best] }],
  catalog: [{ instanceId: 36, name: best.name, targetSec: 1200 }] };
const data = { updatedAt: "2026-10-13T18:00:00Z", standings: [], dungeonBoard: { ...current,
  history: [{ ...current, id: "past", season: "Past", status: "ENDED", profiles: [{ name: "Main", points: 120, characters: ["Tester"],
    details: [{ ...best, durationSec: 840, speedBonus: 20, points: 120 }] }], rows: [{ name: "Main", points: 120 }] }] } };
function setup(officer = false) {
  const s = newLuaSession(); sessions.push(s);
  s.run(`NS={}; GuildedDB=nil; CLOCK=100; function GetTime() return CLOCK end`);
  for (const file of ["Core.lua", "Modules/Scores.lua", "Modules/SeasonDetails.lua", "Modules/DungeonScorePanel.lua"]) s.load(file);
  s.run(`fire_event("PLAYER_LOGIN"); DB=NS.getDb()
    DB.roster.Officer={inGuild=true}; DB.roster.Tester={inGuild=true}; DB.roster.Second={inGuild=true}
    NS.isOfficer=function() return ${officer ? "true" : "false"} end
    NS.isOfficerName=function(n) return n=="Officer" or n=="Second" end`);
  return s;
}
describe("per-dungeon seasonal snapshot and independent relay", () => {
  it("keeps current alt scores and tooltips separate, including stale account aliases", () => {
    const s = setup();
    s.run(standingsToLua({ ...data, dungeonBoard: { ...current, profiles: [
      { name: "Main", points: 120, characters: ["Tester"], details: [{ ...best, points: 120, speedBonus: 20, durationSec: 840 }] },
      { name: "Tester", points: 110, characters: [], details: [best] }
    ] } }));
    s.run('DB.dungeonBoard=GuildedDungeonBoard; DB.roster.Main={inGuild=true}');
    expect(s.run('return NS.scores.scoreOf("Tester")')).toBe("110");
    expect(s.run('return NS.scores.scoreOf("Main")')).toBe("120");
    expect(s.run('return #NS.scores.ranking()')).toBe("2");
    s.run('DB.dungeonBoard.profiles[2]=nil');
    expect(s.run('return NS.scores.scoreOf("Tester")')).toBe("0");
    expect(s.run('return NS.seasonDetails.profile(DB.dungeonBoard,"Tester").name')).toBe("Tester");
  });
  it("round-trips character scores and retains legacy archived account results", () => {
    const s = setup();
    s.run(standingsToLua(data));
    s.run("DB.dungeonBoard=GuildedDungeonBoard");
    expect(s.run('return NS.dungeonScorePanel.model("Tester",1).total')).toBe("110");
    expect(s.run('return NS.dungeonScorePanel.model("Tester",2).total')).toBe("120");
    expect(s.run('return NS.seasonDetails.get(2,"Tester").profile.details[1].durationSec')).toBe("840");
    expect(s.run('return NS.seasonDetails.get(1,"Tester").profile.details[1].name')).toBe(best.name);
    expect(s.run('return NS.seasonDetails.get(1,"Tester").profile.details[1].runRef')).toBe("run;one");
    s.run('DB.roster.Main={inGuild=true}');
    expect(s.run('return #NS.scores.ranking()')).toBe("1"); // Only the character with a recorded score is ranked.
    expect(s.run('return NS.scores.scoreOf("Tester")')).toBe("110");
  });
  it("relays only the requesting player's selected season and rejects mixed senders", () => {
    const officer = setup(true);
    officer.run('NS.playerName=function() return "Officer" end');
    officer.run(standingsToLua(data)); officer.run("DB.dungeonBoard=GuildedDungeonBoard; DB.dungeonBoard.history[1].profiles[1].details[1].runRef=string.rep('r',100)");
    const member = setup();
    member.run(`DB.dungeonBoard={season="Current",status="ACTIVE",updatedAt="2026-10-13T18:00:00Z",rows={},
      history={{season="Past",status="ENDED",rows={}}}}
      NS.seasonDetails.request(2)`);
    const request = member.run("return SENT[#SENT].text");
    officer.run(`fire_event("CHAT_MSG_ADDON","GuildedRating",${JSON.stringify(request)},"GUILD","Tester")`);
    const parts = Number(officer.run("return #SENT"));
    expect(parts).toBeGreaterThan(1);
    for (let i = 1; i <= parts; i++) {
      const packet = officer.run(`return SENT[${i}].text`);
      expect(packet.length).toBeLessThanOrEqual(255);
      member.run(`fire_event("CHAT_MSG_ADDON","GuildedRating",${JSON.stringify(packet)},"WHISPER","Stranger")`);
    }
    expect(member.run('return tostring(NS.seasonDetails.get(2,"Tester"))')).toBe("nil");
    const first = officer.run("return SENT[1].text");
    member.run(`fire_event("CHAT_MSG_ADDON","GuildedRating",${JSON.stringify(first)},"WHISPER","Officer")`);
    for (let i = 2; i <= parts; i++) {
      const packet = officer.run(`return SENT[${i}].text`);
      member.run(`fire_event("CHAT_MSG_ADDON","GuildedRating",${JSON.stringify(packet)},"WHISPER","Second")`);
    }
    expect(member.run('return tostring(NS.seasonDetails.get(2,"Tester"))')).toBe("nil");
    for (let i = 2; i <= parts; i++) {
      const packet = officer.run(`return SENT[${i}].text`);
      member.run(`fire_event("CHAT_MSG_ADDON","GuildedRating",${JSON.stringify(packet)},"WHISPER","Officer")`);
    }
    expect(member.run('return NS.seasonDetails.get(2,"Tester").profile.points')).toBe("120");
    expect(member.run('return tostring(NS.seasonDetails.get(1,"Tester"))')).toBe("nil");
    member.run('DB.dungeonBoard.updatedAt="2026-10-13T19:00:00Z"');
    expect(member.run('return tostring(NS.seasonDetails.get(2,"Tester"))')).toBe("nil");
  });
  it("retains legacy totals without making up historical dungeon scores", () => {
    const s = setup();
    s.run(`DB.dungeonBoard={season="Old",status="ENDED",detailsAvailable=false,rows={{name="Tester",points=250}}}`);
    expect(s.run('return NS.dungeonScorePanel.model("Tester").total')).toBe("250");
    expect(s.run('return tostring(NS.dungeonScorePanel.model("Tester").cards[1].points)')).toBe("nil");
    expect(s.run('return tostring(NS.scores.scoreOf("Tester"))')).toBe("nil"); // No current season.
  });
  it("rejects impossible bonus, duplicate dungeons, partial totals and unsolicited payloads", () => {
    const s = setup();
    const good = "S;s;2;110;1\nC;36;Dungeon;1200\nR;36;Dungeon;110;10;1020;1200;r";
    expect(s.run(`return NS.seasonDetails.parse(${JSON.stringify(good)}).profile.points`)).toBe("110");
    for (const bad of [good.replace(";10;1020", ";10;1100"), good + "\nR;36;Dungeon;110;10;1020;1200;r",
      good.replace(";2;110;1", ";2;120;1"), good.replace("S;s;2;", "S;s;0;")]) {
      expect(s.run(`return tostring((NS.seasonDetails.parse(${JSON.stringify(bad)})))`)).toBe("nil");
    }
  });
});

it("round-trips wider ratings, separate boss records and unranked reasons", () => {
  const s = setup();
  const timed = { ...current, ratingVersion: 3, profiles: [{ ...current.profiles[0]!, points: 235,
    details: [{ ...best, points: 235, speedBonus: 0, bosses: [{ id: 1, name: "Boss; one", durationSec: 60, runRef: "other" }] }] }] };
  s.run(standingsToLua({ ...data, dungeonBoard: timed })); s.run("DB.dungeonBoard=GuildedDungeonBoard");
  expect(s.run('return NS.seasonDetails.get(1,"Tester").profile.details[1].bosses[1].durationSec')).toBe("60");
  const packet = "S;s;3;235;1\nC;36;Dungeon;1200\nR;36;Dungeon;235;0;1020;1200;r;\nB;36;1;Boss;60;other";
  expect(s.run(`return NS.seasonDetails.parse(${JSON.stringify(packet)}).profile.details[1].bosses[1].runRef`)).toBe("other");
  const unranked = "S;s;3;0;1\nC;36;Dungeon;1200\nR;36;Dungeon;0;0;600;1200;r;Overlevel carry";
  expect(s.run(`return NS.seasonDetails.parse(${JSON.stringify(unranked)}).profile.details[1].unrankedReason`)).toBe("Overlevel carry");
  expect(s.run(`return tostring((NS.seasonDetails.parse(${JSON.stringify(packet.replace(";235;0;1020", ";400;0;1020"))})))`)).toBe("nil");
});

it("keeps a paced large response alive through UI retries and more than sixty seconds", () => {
  const member = setup();
  member.run('DB.dungeonBoard={season="Current",status="ACTIVE",updatedAt="stamp",rows={}}; NS.seasonDetails.request(1)');
  const nonce = member.run('return string.match(SENT[#SENT].text,"([^|]+)$")');
  const payload = ['S;current;3;0;1', ...Array.from({length:80}, (_,i)=>`C;${i+1};${'Dungeon'.repeat(20)};1200`) ].join('\n');
  const chunks = payload.match(/[\s\S]{1,180}/g)!;
  expect(chunks.length).toBeGreaterThan(60);
  for(let i=0;i<chunks.length;i++) {
    member.run(`CLOCK=${101+i}; fire_event("CHAT_MSG_ADDON","GuildedRating",${JSON.stringify(`D|${nonce}|${i+1}|${chunks.length}|${chunks[i]}`)},"WHISPER","Officer")`);
    if(i%16===0) member.run('NS.seasonDetails.request(1)');
  }
  expect(member.run('return #NS.seasonDetails.get(1,"Tester").catalog')).toBe('80');
  expect(member.run('return #SENT')).toBe('1');
});
it("preserves the request sender's routable name for cross-segment whispers", () => {
  const officer=setup(true);
  officer.run('NS.playerName=function() return "Officer" end');
  officer.run(standingsToLua(data));
  officer.run('DB.dungeonBoard=GuildedDungeonBoard; NS.comm.send=function(_,_,channel,target) REPLY_CHANNEL=channel; REPLY_TARGET=target end');
  officer.run('fire_event("CHAT_MSG_ADDON","GuildedRating","Q|2026-10-13T18:00:00Z|1|1-100","GUILD","Tester-ClassicBetaPvP2")');
  expect(officer.run('return REPLY_TARGET')).toBe('Tester-ClassicBetaPvP2');
  expect(officer.run('return REPLY_CHANNEL')).toBe('WHISPER');
});
