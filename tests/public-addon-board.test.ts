import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { publicAddonBoard } from "../src/services/public-addon-board.js";
import { publicRules, type ScoreRun, type PublicPeriod } from "../src/services/public-score.js";
import { personalResponseToLua } from "../companion/personal-runs-content.mjs";
import { tocFiles } from "../scripts/build-dungeons-addon.mjs";
import { newLuaSession } from "./lua/harness.js";

const now = new Date("2026-10-23T12:00:00Z");
const me = { character: "Tester", realm: "TestRealm", level: 20, minLevel: 20, role: "TANK", className: "WARRIOR", presentSec: 2400 };
const rules = publicRules();
const periods: PublicPeriod[] = [{ id: "current", label: "Current", labelFr: "Actuelle", from: new Date("2026-10-20"), to: null, rules },
  { id: "old", label: "Old", labelFr: "Ancienne", from: null, to: new Date("2026-10-20"), rules }];
const run = (role: string | null, seconds = 2400, date = now): ScoreRun => ({ runId: `${role}-${date.toISOString()}`, instanceId: 36, routeKey: "36", difficultyId: 0,
  dungeonName: "The Deadmines", durationSec: seconds, endedAt: date, confirmations: 2,
  evidence: { startedAt: new Date(date.getTime() - seconds * 1000), completedBy: "final boss", encounters: [] },
  players: [{ ...me, role, presentSec: seconds }] });

describe("standalone public score snapshots", () => {
  it("keeps roles, realm identity, history and unknown-role runs separate", () => {
    const board = publicAddonBoard([run("TANK"), run("HEALER", 2000), run(null, 1800), run("TANK", 1200, new Date("2026-10-19")),
      { ...run("DAMAGER", 1000), players: [{ ...me, realm: "Other", role: "DAMAGER" }] }], me, periods, now)!;
    const p = board.profiles.find(p => p.bracket === "15-29")!;
    expect(p).toMatchObject({ points: 267, roles: [{ points: 200 }, { points: 240 }, { points: 0 }] });
    expect(p.roles[0]!.guidance!.routes.find(r => r.key === "36")?.next?.total).toBe(205);
    expect(board.history[0]!.profiles[0]).toMatchObject({ points: 400, guidance: null });
    expect(p.guidance!.routes.find(r => r.key === "34")).toMatchObject({ fit: "below", next: null });
    expect(JSON.stringify(board)).not.toContain("Other");
  });

  it.each(["TANK", "DPS", "DAMAGER"])("loads the shipped standalone toc and shows %s roles/scenarios without a guild", (role) => {
    const board = publicAddonBoard([run(role)], me, periods, now)!;
    const lua = newLuaSession();
    try {
      lua.run('NS={}; GuildedDungeonsDB=nil; function IsInGuild() return false end; function UnitLevel() return 20 end; C_AddOns={IsAddOnLoaded=function() return false end}');
      for (const file of tocFiles()) {
        const source = file === "Accepted.lua" ? personalResponseToLua({ acceptedRunRefs: ["r"], publicScore: board })
          : readFileSync(new URL(`../addon/GuildedDungeons/${file}`, import.meta.url), "utf8");
        lua.run(`loadaddon("GuildedDungeons", [=====[${source}]=====], NS)`);
      }
      lua.run(`fire_event("PLAYER_LOGIN"); M=NS.dungeonScorePanel.model("Tester",1,"15-29","month",${JSON.stringify(role)})`);
      expect(lua.run('return M.total')).toBe("200");
      expect(lua.run('return NS.scores.scoreOf("Tester",20)')).toBe("200");
      expect(lua.run('return tostring(NS.scores.scoreOf("Stranger",20))')).toBe("nil");
      expect(lua.run('return tostring(not NS.dungeonScorePanel.model("Tester",2,"15-29").guidance)')).toBe("true");
      lua.run('for _,c in ipairs(M.cards) do if c.name=="The Deadmines" then CARD=c end end');
      expect(lua.run('return NS.dungeonScorePanel.guidanceText(CARD)')).toContain("+5 points");
      lua.run('function GetLocale() return "frFR" end; NS.getSettings().language="fr"');
      expect(lua.run('return NS.dungeonScorePanel.guidanceText(CARD)')).toContain("Scénario");
      // No public scores may leak onto an alt or another realm after reload.
      lua.run('GuildedDungeonsPublicScore.character="Other"; fire_event("PLAYER_LOGIN")');
      expect(lua.run('return tostring(NS.getDb().dungeonBoard)')).toBe("nil");
      lua.run('GuildedDungeonsPublicScore.character="Tester"; GuildedDungeonsPublicScore.realm="Elsewhere"; fire_event("PLAYER_LOGIN")');
      expect(lua.run('return tostring(NS.getDb().dungeonBoard)')).toBe("nil");
      expect(lua.run('return tostring(GuildedDB)')).toBe("nil");
    } finally { lua.close(); }
  });
});
