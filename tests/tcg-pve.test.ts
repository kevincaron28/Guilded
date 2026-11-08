import { describe, expect, it } from "vitest";
import { cardOf, deckProblem, starterDeck } from "../src/services/tcg-cards-set1.js";
import { GAUNTLET, createGauntletMatch, featuredRun, runReward } from "../src/services/tcg-pve.js";
import { playGame } from "../src/services/tcg-sim.js";
import { applyMut, replay, stateHash } from "../src/services/tcg-engine.js";
import { chooseAction } from "../src/services/tcg-ai.js";
import type { Action } from "../src/services/tcg-engine-types.js";

const player = { cls: "paladin" as const, cards: starterDeck("paladin") };

describe("dungeon gauntlet data", () => {
  it("has five bosses with legal decks, a real Zone each and rising Health and rewards", () => {
    expect(GAUNTLET).toHaveLength(5);
    expect(new Set(GAUNTLET.map(b => b.id)).size).toBe(5);
    let health = 0, dust = 0;
    for (const boss of GAUNTLET) {
      expect(deckProblem(boss.cls, [...boss.deck]), boss.name).toBeNull();
      expect(cardOf(boss.zone).type).toBe("zone");
      expect(boss.health).toBeGreaterThanOrEqual(health);
      expect(boss.reward.dust).toBeGreaterThan(dust);
      health = boss.health;
      dust = boss.reward.dust;
    }
    expect(new Set(GAUNTLET.map(b => b.zone)).size).toBe(5);
  });
  it("starts the boss with its Zone and Health, and the boss's Health is its maximum", () => {
    const boss = GAUNTLET[4]!;
    const s = createGauntletMatch(3, player, boss);
    expect(s.zone).toEqual({ card: boss.zone, owner: 1 });
    expect(s.players[1].hp).toBe(30);
    expect(s.players[1].maxHp).toBe(30);
    expect(s.players[0].hp).toBe(20);
  });
  it("replays a boss match from its set-up to the same state", () => {
    const boss = GAUNTLET[1]!;
    const s = createGauntletMatch(21, player, boss);
    const actions: Action[] = [];
    for (let i = 0; i < 400 && s.phase !== "over"; i++) {
      const a = chooseAction(s, i % 2 ? "normal" : boss.level);
      actions.push(a);
      applyMut(s, a);
    }
    const again = replay(21, player, { cls: boss.cls, cards: [...boss.deck] }, actions, { zone: { card: boss.zone, owner: 1 }, hp: [20, boss.health] });
    expect(stateHash(again)).toBe(stateHash(s));
  });
  it("plays every boss to a finish against the hard AI", () => {
    for (const boss of GAUNTLET) {
      const r = playGame(70, player, { cls: boss.cls, cards: [...boss.deck] }, ["hard", boss.level], { zone: { card: boss.zone, owner: 1 }, hp: [20, boss.health] });
      expect(r.stuck, boss.name).toBe(false);
    }
  }, 60_000);
  it("adds up run rewards and doubles dust on the featured run", () => {
    expect(runReward(0)).toEqual({ dust: 0, packs: 0 });
    expect(runReward(5)).toEqual({ dust: 230, packs: 3 });
    expect(runReward(5, true)).toEqual({ dust: 460, packs: 4 });
    expect(runReward(2, true)).toEqual({ dust: 100, packs: 0 });
  });
  it("rotates the featured boss weekly", () => {
    expect(featuredRun(new Date("2026-11-03T00:00:00Z")).boss.id).toBe("boss-1");
    expect(featuredRun(new Date("2026-11-10T00:00:00Z")).boss.id).toBe("boss-2");
    expect(featuredRun(new Date("2026-11-30T00:00:00Z")).boss.id).toBe("boss-5");
    expect(featuredRun(new Date("2026-12-07T00:00:00Z")).boss.id).toBe("boss-1");
  });
});
