import { describe, expect, it, vi, afterEach } from "vitest";
import { ClashClient, parseCollection, parseMatchResponse, parsePve } from "./api";
import { MockClash } from "./mock";
import { SET1 } from "./set1";
import {
  cardOf, classOfKey, rulesText, craftable, describeEvents, groupCollection, immediate, initialMatchUi, matchUiReducer, modesOf, packReducer, packStart,
  resolveTap, revealOrder, targetsFor, type MatchUi
} from "./state";
import type { CollectionCard, Intent, MatchResponse } from "./types";

afterEach(() => { vi.unstubAllGlobals(); });

const legal: Intent[] = [
  { t: "play", hand: 0 },
  { t: "play", hand: 1, target: { unit: 7 } }, { t: "play", hand: 1, target: { champ: 1 } },
  { t: "play", hand: 2, mode: 0, target: { unit: 7 } }, { t: "play", hand: 2, mode: 1, target: { unit: 3 } },
  { t: "attack", unit: 3, target: { unit: 7 } },
  { t: "power" },
  { t: "end" }
];

function response(over: Partial<MatchResponse["view"]> = {}, events: MatchResponse["events"] = []): MatchResponse {
  const sideBase = { cls: "warrior" as const, hp: 20, maxHp: 20, armor: 0, board: [], standard: null, mana: 3, turns: 3, powerUsed: false, deckCount: 18, secondWind: false };
  return {
    match: { id: "m1", kind: "ai", aiLevel: "normal", boss: null, status: "active", reason: null, round: 3, version: 5, turnSeconds: 86400, turnDeadlineAt: null, createdAt: "", finishedAt: null, rewards: null },
    view: { phase: "main", turn: 5, round: 3, active: 0, actor: 0, yourTurn: true, first: 0, mulligan: [true, true], zone: null,
      me: { ...sideBase, hand: ["001", "068", "095"] }, opponent: { ...sideBase, cls: "mage", handCount: 4 }, pending: null, opponentChoosing: false, winner: null, reason: null, legal, ...over },
    events, rewards: null
  };
}
const loaded = (res = response()): MatchUi => matchUiReducer(initialMatchUi, { type: "loaded", res });

describe("card data", () => {
  it("has the 150 set cards plus tokens, and blanks unknown ids", () => {
    expect(SET1.filter((c) => !c.token)).toHaveLength(150);
    expect(cardOf("001").name).toBe("Gate Brawler");
    expect(cardOf("nope")).toMatchObject({ id: "nope", name: "nope", cost: 0 });
  });

  it("drops the keyword line from the rules text and keeps sentences intact", () => {
    expect(rulesText({ text: "Deal 3 damage to a unit. If it survives, it deals 2 damage to your Champion.", flavour: "f" }, "")).toBe("Deal 3 damage to a unit. If it survives, it deals 2 damage to your Champion.");
    expect(rulesText({ text: "Guard, Shield. Last Stand: your Champion gains 10 Armor.", flavour: "f" }, "Guard, Shield")).toBe("Last Stand: your Champion gains 10 Armor.");
    expect(rulesText({ text: "Guard", flavour: "Stand where you are told." }, "Guard")).toBe("Stand where you are told.");
  });
});

describe("match selection", () => {
  it("plays a no-target card at once and asks for a target otherwise", () => {
    expect(immediate({ k: "hand", hand: 0 }, legal)).toEqual({ t: "play", hand: 0 });
    expect(immediate({ k: "hand", hand: 1 }, legal)).toBeNull();
    expect([...targetsFor({ k: "hand", hand: 1 }, legal)].sort()).toEqual(["c:1", "u:7"]);
    expect(resolveTap({ k: "hand", hand: 1 }, legal, { champ: 1 })).toEqual({ t: "play", hand: 1, target: { champ: 1 } });
    expect(resolveTap({ k: "hand", hand: 1 }, legal, { unit: 99 })).toBeNull();
  });

  it("asks for the mode of a modal card first, then its targets", () => {
    expect(modesOf(legal, 2)).toEqual([0, 1]);
    expect(immediate({ k: "hand", hand: 2 }, legal)).toBeNull();
    expect([...targetsFor({ k: "hand", hand: 2, mode: 1 }, legal)]).toEqual(["u:3"]);
  });

  it("picks attack targets and the class power", () => {
    expect([...targetsFor({ k: "attacker", unit: 3 }, legal)]).toEqual(["u:7"]);
    expect(immediate({ k: "power" }, legal)).toEqual({ t: "power" });
  });

  it("selects only what is legal and toggles off on a second tap", () => {
    let s = loaded();
    s = matchUiReducer(s, { type: "selectHand", hand: 9 });
    expect(s.selection).toEqual({ k: "none" });
    s = matchUiReducer(s, { type: "selectHand", hand: 1 });
    expect(s.selection).toEqual({ k: "hand", hand: 1 });
    s = matchUiReducer(s, { type: "selectHand", hand: 1 });
    expect(s.selection).toEqual({ k: "none" });
    s = matchUiReducer(s, { type: "selectAttacker", unit: 3 });
    expect(s.selection).toEqual({ k: "attacker", unit: 3 });
    s = matchUiReducer(s, { type: "failed", message: "Nope" });
    expect(s).toMatchObject({ busy: false, error: "Nope", selection: { k: "none" } });
  });

  it("collects mulligan picks during the mulligan", () => {
    let s = loaded(response({ phase: "mulligan", legal: [{ t: "mulligan", replace: [] }] }));
    expect(s.selection).toEqual({ k: "mulligan", replace: [] });
    s = matchUiReducer(s, { type: "toggleMulligan", hand: 2 });
    s = matchUiReducer(s, { type: "toggleMulligan", hand: 0 });
    s = matchUiReducer(s, { type: "toggleMulligan", hand: 2 });
    expect(s.selection).toEqual({ k: "mulligan", replace: [0] });
    expect(matchUiReducer(s, { type: "cancel" }).selection).toEqual({ k: "mulligan", replace: [0] });
  });

  it("keeps a short battle log from the events", () => {
    const s = loaded(response({}, [{ t: "play", p: 0, card: "001" }, { t: "damage", champ: 1, n: 3 }, { t: "over", winner: 0 }]));
    expect(s.log).toEqual(["You played Gate Brawler.", "Foe's Champion took 3.", "Victory!"]);
    expect(describeEvents([{ t: "draw", p: 0 }])).toEqual([]);
  });
});

describe("pack opening", () => {
  it("tears, fans, flips each card and ends when all are face up", () => {
    let s = packStart(3);
    s = packReducer(s, { type: "flip", index: 0 });
    expect(s.flipped).toEqual([false, false, false]);
    s = packReducer(packReducer(s, { type: "tear" }), { type: "fan" });
    s = packReducer(s, { type: "flip", index: 1 });
    s = packReducer(s, { type: "flip", index: 1 });
    expect(s).toEqual({ stage: "fanned", flipped: [false, true, false] });
    s = packReducer(packReducer(s, { type: "flip", index: 0 }), { type: "flip", index: 2 });
    expect(s.stage).toBe("done");
    expect(packReducer(packStart(5), { type: "flipAll" }).stage).toBe("sealed");
  });

  it("reveals the best card last", () => {
    expect(revealOrder(["rare", "common", "epic", "common", "uncommon"])).toEqual([1, 3, 4, 0, 2]);
  });
});

describe("collection", () => {
  const card = (key: string, rarity: CollectionCard["rarity"], owned: boolean, craftCost: number | null = null): CollectionCard => ({
    key, family: key.startsWith("badge") ? "badge" : "class", rarity, rarityLabel: rarity, set: "classes", name: key, flavour: null, owned, count: owned ? 1 : 0, firstSeenAt: null, craftCost, artUrl: null
  });
  const cards = [card("class:mage:epic", "epic", false), card("badge:a", "rare", true), card("class:mage:common", "common", true), card("class:warrior:rare", "rare", false, 150)];

  it("groups by class in class order, badges last, rarest last", () => {
    const groups = groupCollection(cards, "all");
    expect(groups.map((g) => g.key)).toEqual(["warrior", "mage", "badges"]);
    expect(groups[1]!.cards.map((c) => c.key)).toEqual(["class:mage:common", "class:mage:epic"]);
    expect(groups[1]!.owned).toBe(1);
    expect(groupCollection(cards, "missing", "rare").map((g) => g.key)).toEqual(["warrior"]);
    expect(classOfKey("badge:x")).toBeNull();
  });

  it("knows what dust can craft", () => {
    expect(craftable(cards[3]!, 149)).toBe(false);
    expect(craftable(cards[3]!, 150)).toBe(true);
    expect(craftable(cards[0]!, 9999)).toBe(false);
  });
});

describe("api parsing and client", () => {
  it("rejects a malformed answer and fills safe defaults", () => {
    expect(() => parseMatchResponse({ match: { id: "x" } })).toThrow("not understood");
    expect(parseCollection({ cards: [{ key: "class:mage:rare", name: "Mage", rarity: "weird" }, { name: "no key" }] }).cards).toEqual([
      expect.objectContaining({ key: "class:mage:rare", rarity: "common", owned: false, artUrl: null })
    ]);
    expect(parsePve({ bosses: [{ id: "boss-1", cls: "nobody" }] }).bosses[0]).toMatchObject({ cls: "warrior", health: 20, unlocked: false });
  });

  it("sends intents with the credential, the language and the match id", async () => {
    const body = response();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new ClashClient("https://guilded.kcaron.top", "c".repeat(40), "fr");
    await client.intent("m1", { t: "attack", unit: 3, target: { champ: 1 } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("https://guilded.kcaron.top/api/v1/companion/clash/intent?lang=fr");
    expect(JSON.parse(String(init.body))).toEqual({ id: "m1", action: { t: "attack", unit: 3, target: { champ: 1 } } });
    expect((init.headers as Record<string, string>)["x-companion-credential"]).toBe("c".repeat(40));
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "That match just changed somewhere else." }), { status: 409 }));
    await expect(client.match("m1")).rejects.toMatchObject({ status: 409, message: "That match just changed somewhere else." });
  });
});

describe("sample game", () => {
  it("plays a whole match through the same interface: mulligan, moves from the legal list, a result", async () => {
    const api = new MockClash();
    let res = await api.start({ mode: "pve", cls: "warrior", boss: "boss-1" });
    expect(res.view.phase).toBe("mulligan");
    res = await api.intent(res.match.id, { t: "mulligan", replace: [0] });
    for (let step = 0; step < 400 && res.view.phase !== "over"; step++) {
      const move = res.view.legal.find((i) => i.t === "attack" && "champ" in i.target) ?? res.view.legal.find((i) => i.t === "play") ?? { t: "end" as const };
      res = await api.intent(res.match.id, move);
    }
    expect(res.view.phase).toBe("over");
    expect(["won", "lost", "draw"]).toContain(res.match.status);
    await expect(api.intent(res.match.id, { t: "end" })).rejects.toMatchObject({ status: 409 });
    expect((await api.matches())[0]!.id).toBe(res.match.id);
  });

  it("opens banked packs until none is left and crafts with dust", async () => {
    const api = new MockClash();
    const first = await api.openPack();
    expect(first.cards).toHaveLength(5);
    await api.openPack();
    await expect(api.openPack()).rejects.toMatchObject({ status: 409 });
    const before = await api.collection();
    const target = before.cards.find((c) => craftable(c, before.dust))!;
    const after = await api.craft(target.key);
    expect(after.dust).toBe(before.dust - target.craftCost!);
  });
});
