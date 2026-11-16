import { beforeEach, describe, expect, it } from "vitest";
import { createLeaderboardPages, hideRunPlayers, prismaLeaderboardStore, type LeaderboardStore, type LeaderRun } from "../src/services/public-leaderboard.js";
import { HIDDEN_MARK, NOBODY_HIDDEN, hiddenLookup, isHiddenPlayer, loadHiddenIdentity, privacyReply, setProfileHidden, showHiddenMarks } from "../src/services/profile-privacy.js";
import { clearLeaderboardCaches } from "../src/services/leaderboard-cache-hooks.js";
import { characterScores, publicRules } from "../src/services/public-score.js";
import { buildGlobalBoard } from "../src/services/duel-global.js";
import { buildDuelBoard } from "../src/services/public-duels.js";
import { createWebApp, type WebResponse } from "../src/services/web-app.js";
import { createPrivacyWeb } from "../src/services/profile-privacy-web.js";
import { memoryWebStore } from "./helpers/memory-web-store.js";

const NOW = new Date("2026-11-10T20:00:00Z");
const P = (character: string, role = "DPS", extra: Record<string, unknown> = {}) => ({ character, realm: "Doomhowl", className: "Warrior", role, level: 16, minLevel: 16, presentSec: 1400, ...extra });
const run = (id: string, sec: number, players: ReturnType<typeof P>[]): LeaderRun => ({
  runId: id, instanceId: 389, dungeonName: "Ragefire Chasm", durationSec: sec, endedAt: new Date(NOW.getTime() - sec * 1000), deaths: 0, bracket: "15-29", season: "2026-Q4", confirmations: 2, routeKey: null, difficultyId: 0,
  evidence: { startedAt: new Date(NOW.getTime() - 2 * sec * 1000), completedBy: "final boss", encounters: [] }, players } as unknown as LeaderRun);

// A fake database holding only what the public store reads. `hidden` is the table of Discord users who hid their profile.
function fakeDatabase(hidden: Set<string>, runs: LeaderRun[] = [], extra: Record<string, unknown> = {}) {
  const owners: Record<string, string[]> = { u1: ["Brenna"], u2: ["Zed Zimmer"] };
  const rows = () => runs.map((r) => ({ ...r, id: r.runId, startedAt: r.evidence!.startedAt, evidenceVersion: 1, completedBy: "final boss", encounters: [], challenge: null, integrity: null, evidenceReceivedAt: null }));
  const charactersOf = (ids: string[]) => ids.flatMap((id) => (owners[id] ?? []).map((name) => ({ name, displayName: null, realm: "Doomhowl" })));
  return {
    publicProfileHidden: { findMany: async () => [...hidden].map((discordUserId) => ({ discordUserId })) },
    character: { findMany: async (args: { where: { member?: { discordUserId?: { in: string[] } } } }) => charactersOf(args.where.member?.discordUserId?.in ?? []) },
    webCharacter: { findMany: async () => [] },
    deviceCharacter: { findMany: async () => [] },
    publicRun: { findMany: async () => rows(), findFirst: async () => rows()[0] ?? null },
    guildSettings: { findMany: async () => [] },
    publicRunPlayer: { findMany: async () => ["Aldric", "Brenna", "Corvin"].map((character) => ({ guild: "Moonwell Vanguard", realm: "Doomhowl", character, faction: "ALLIANCE" })) },
    ...extra
  };
}

describe("hide my profile: who is hidden", () => {
  const hiddenOf = async (...users: string[]) => loadHiddenIdentity(fakeDatabase(new Set(users)) as never);

  it("matches the full name, the older first-name spelling and a missing realm, and nobody else", async () => {
    const h = await hiddenOf("u2");
    expect(isHiddenPlayer(h, "Zed Zimmer", "Doomhowl")).toBe(true);
    expect(isHiddenPlayer(h, "zed zimmer", "doom-howl")).toBe(true);
    expect(isHiddenPlayer(h, "Zed", "Doomhowl")).toBe(true);
    expect(isHiddenPlayer(h, "Zed Zimmer", "")).toBe(true);
    expect(isHiddenPlayer(h, "Zed Other", "Doomhowl")).toBe(false);
    expect(isHiddenPlayer(h, "Aldric", "Doomhowl")).toBe(false);
    expect(isHiddenPlayer(NOBODY_HIDDEN, "Zed Zimmer", "Doomhowl")).toBe(false);
  });

  it("covers every linked character, including one linked later", async () => {
    const database = fakeDatabase(new Set(["u1"]));
    expect(isHiddenPlayer(await loadHiddenIdentity(database as never), "Newalt", "Doomhowl")).toBe(false);
    (database as unknown as { character: { findMany: unknown } }).character.findMany = async () => [{ name: "Brenna", displayName: null, realm: "Doomhowl" }, { name: "Newalt", displayName: null, realm: "Doomhowl" }];
    expect(isHiddenPlayer(await loadHiddenIdentity(database as never), "Newalt", "Doomhowl")).toBe(true);
  });
});

describe("hide my profile: runs and rankings", () => {
  const party = [P("Aldric", "TANK"), P("Brenna", "HEALER"), P("Corvin"), P("Dara"), P("Edda")];
  const group = run("r1", 1400, party);

  it("replaces a hidden player by a placeholder, keeps the party and leaves the others unchanged", async () => {
    const h = await loadHiddenIdentity(fakeDatabase(new Set(["u1"])) as never);
    const shown = hideRunPlayers(group, h);
    expect(shown.players).toHaveLength(5);
    const brenna = shown.players[1]!;
    expect(brenna).toMatchObject({ hidden: true, displayName: HIDDEN_MARK, role: "HEALER", className: "Warrior", level: 16 });
    expect(brenna.character).not.toContain("Brenna");
    expect(shown.players.filter((p) => p.hidden)).toHaveLength(1);
    expect(shown.players.map((p) => p.character).filter((c) => !c.startsWith("~"))).toEqual(["Aldric", "Corvin", "Dara", "Edda"]);
    expect(hideRunPlayers(group, NOBODY_HIDDEN)).toBe(group);
  });

  it("never scores or ranks a hidden player, and the other players' scores do not change", async () => {
    const h = await loadHiddenIdentity(fakeDatabase(new Set(["u1"])) as never);
    const before = characterScores([group], publicRules());
    const after = characterScores([hideRunPlayers(group, h)], publicRules());
    expect(before.map((row) => row.player.character)).toContain("Brenna");
    expect(after.map((row) => row.player.character)).not.toContain("Brenna");
    expect(after.some((row) => row.player.character.startsWith("~"))).toBe(false);
    const points = (rows: typeof before, name: string) => rows.find((row) => row.player.character === name)?.points;
    expect(points(after, "Aldric")).toBe(points(before, "Aldric"));
    expect(after).toHaveLength(before.length - 1);
  });
});

describe("hide my profile: the public store", () => {
  beforeEach(() => clearLeaderboardCaches());

  it("anonymises a hidden player in listed runs, and unhiding restores the name", async () => {
    const hidden = new Set(["u1"]);
    const store = prismaLeaderboardStore(fakeDatabase(hidden, [run("r1", 1400, [P("Aldric"), P("Brenna"), P("Corvin")])]) as never, () => true, { hideProfiles: true });
    const names = async () => (await store.runs({ from: null, to: null }))[0]!.players.map((p) => p.displayName ?? p.character);
    expect(await names()).toEqual(["Aldric", HIDDEN_MARK, "Corvin"]);
    hidden.delete("u1");
    clearLeaderboardCaches();
    expect(await names()).toEqual(["Aldric", "Brenna", "Corvin"]);
  });

  it("is untouched for internal readers (no hideProfiles)", async () => {
    const store = prismaLeaderboardStore(fakeDatabase(new Set(["u1"]), [run("r1", 1400, [P("Brenna"), P("Corvin")])]) as never);
    expect((await store.runs({ from: null, to: null }))[0]!.players.map((p) => p.character)).toEqual(["Brenna", "Corvin"]);
  });

  it("leaves a hidden player out of the guild directory's member list", async () => {
    const hidden = new Set<string>();
    const store = prismaLeaderboardStore(fakeDatabase(hidden, [], { publicRunPlayer: { findMany: async () => ["Aldric", "Brenna", "Corvin", "Dara"].map((character) => ({ guild: "Moonwell Vanguard", realm: "Doomhowl", character, faction: "ALLIANCE" })) } }) as never, () => true, { hideProfiles: true });
    const memberCount = async () => { const [guild] = await store.guilds(); return (await store.guildRoster(guild!.id)).length; };
    expect(await memberCount()).toBe(4);
    hidden.add("u1");
    clearLeaderboardCaches();
    expect(await memberCount()).toBe(3);
    expect((await store.guildRoster((await store.guilds())[0]!.id)).some((key) => key.includes("brenna"))).toBe(false);
  });

  it("anonymises a hidden duel side, keeps the duel for the opponent and lists the hidden player nowhere", async () => {
    const duel = (winnerName: string, loserName: string, at: number) => ({ winnerKey: `${winnerName.toLowerCase()}-doomhowl`, loserKey: `${loserName.toLowerCase()}-doomhowl`, winnerName, loserName, winnerRealm: "Doomhowl", loserRealm: "Doomhowl", winnerClass: "Mage", loserClass: "Priest",
      winnerLevel: 30, loserLevel: 30, winnerGuild: "Moonwell Vanguard", loserGuild: "Moonwell Vanguard", winnerMemberId: null, loserMemberId: null, endedAt: new Date(NOW.getTime() - at), reason: "duel", zone: null, durationSec: 30,
      reports: [{ reporterCharacterKey: `${winnerName.toLowerCase()}-doomhowl`, deviceId: null, guildId: null }] });
    const rows = [duel("Aldric", "Brenna", 3000), duel("Corvin", "Aldric", 2000), duel("Brenna", "Corvin", 1000)];
    const database = fakeDatabase(new Set(["u1"]), [], { publicDuel: { findMany: async () => rows }, publicDuelExclusion: { findMany: async () => [] }, member: { findMany: async () => [] },
      guildSettings: { findMany: async () => [] } });
    const store = prismaLeaderboardStore(database as never, () => true, { hideProfiles: true });
    // Only the duel rows matter here: the guild list query is a different call.
    (database.guildSettings as { findMany: unknown }).findMany = async () => [{ guildId: "g1" }];
    const duels = await store.globalDuelRows!();
    expect(duels).toHaveLength(3);
    const text = JSON.stringify(duels);
    expect(text).not.toContain("Brenna");
    expect(text).not.toContain("brenna");
    expect(duels.find((d) => d.loserHidden)).toMatchObject({ winner: "Aldric", loser: HIDDEN_MARK, loserHidden: true, loserRealm: "", loserGuild: null });
    expect(duels.find((d) => d.winnerHidden)).toMatchObject({ winner: HIDDEN_MARK, loser: "Corvin", winnerRealm: "" });
    const board = buildGlobalBoard(duels, "2026-11", new Date("2026-11-01T00:00:00Z"), { className: null, levels: null }, 20);
    expect(board.rows.map((row) => row.name).sort()).toEqual(["Aldric", "Corvin"]);
    expect(board.rows.every((row) => !row.key.startsWith("h:"))).toBe(true);
    expect(board.recent.length).toBe(3);
    expect(board.rows.find((row) => row.name === "Aldric")).toMatchObject({ wins: 1, losses: 1 });
  });

  it("guild duel boards keep the opponent's record when a member hid their profile", () => {
    const duel = (w: string, l: string, hiddenSide: "winner" | "loser" | null, at: number) => ({ winnerKey: w, loserKey: l, winner: hiddenSide === "winner" ? HIDDEN_MARK : w, loser: hiddenSide === "loser" ? HIDDEN_MARK : l, winnerLevel: 30, loserLevel: 30, winnerClass: null, loserClass: null,
      winnerShown: hiddenSide !== "winner", loserShown: hiddenSide !== "loser", ...(hiddenSide === "winner" ? { winnerHidden: true } : {}), ...(hiddenSide === "loser" ? { loserHidden: true } : {}), endedAt: new Date(NOW.getTime() - at), reason: "duel" });
    const board = buildDuelBoard([duel("A", "B", "loser", 2000), duel("A", "C", null, 1000)], { since: null, until: null, className: null, levels: null });
    expect(board.rows.map((row) => row.name).sort()).toEqual(["A", "C"]);
    expect(board.rows.find((row) => row.name === "A")).toMatchObject({ wins: 2 });
    expect(board.recent).toHaveLength(2);
  });

  it("caches the hidden set only briefly and drops it with the leaderboard caches", async () => {
    const hidden = new Set<string>();
    let at = 0;
    const lookup = hiddenLookup(fakeDatabase(hidden) as never, 30_000, () => at);
    expect((await lookup.get()).users.size).toBe(0);
    hidden.add("u1");
    expect((await lookup.get()).users.size).toBe(0);
    at = 31_000;
    expect((await lookup.get()).users.size).toBe(1);
    hidden.delete("u1");
    clearLeaderboardCaches();
    expect((await lookup.get()).users.size).toBe(0);
  });
});

describe("hide my profile: the pages", () => {
  const group = run("r1", 1400, [P("Aldric", "TANK"), P("Brenna", "HEALER"), P("Corvin"), P("Dara"), P("Edda")]);
  async function pageFor(path: string) {
    // The real public store over a fake database: the page sees exactly what the site sees.
    const store: LeaderboardStore = prismaLeaderboardStore(fakeDatabase(new Set(["u1"]), [group]) as never, () => true, { hideProfiles: true });
    const pages = createLeaderboardPages({ store, personal: null, now: () => NOW });
    const app = createWebApp({ store: memoryWebStore().store, auth: { clientId: "1", clientSecret: "x", siteUrl: "https://guildedwow.com", sessionSecret: "s".repeat(40) }, allows: () => true, postApplication: async () => null,
      routes: [pages.route], now: () => NOW, fetch: fetch });
    const url = new URL(path, "https://guildedwow.com");
    return await app.respond({ method: "GET", path: url.pathname, query: url.searchParams, headers: {} }) as WebResponse;
  }

  it("shows a hidden player as Hidden player (English) or Joueur masqué (French) on the run page, without a character link", async () => {
    const en = await pageFor("/leaderboards/run/r1");
    expect(en.status).toBe(200);
    expect(en.body).toContain("Hidden player");
    expect(en.body).not.toContain("Brenna");
    expect(en.body).not.toContain(HIDDEN_MARK);
    expect(en.body).not.toContain("~hidden");
    expect(en.body).toContain("Aldric");
    const fr = await pageFor("/leaderboards/run/r1?lang=fr");
    expect(fr.body).toContain("Joueur masqué");
  });

  it("gives the hidden character no ranking row and no page", async () => {
    const ranking = await pageFor("/leaderboards/characters/");
    expect(ranking.body).not.toContain("Brenna");
    expect(ranking.body).not.toContain("Hidden player");
    expect(ranking.body).toContain("Aldric");
    expect((await pageFor("/leaderboards/character/Brenna-Doomhowl")).status).toBe(404);
  });

  it("replaces the marks in text too", () => {
    expect(showHiddenMarks(`a ${HIDDEN_MARK} b`, "en")).toBe("a Hidden player b");
    expect(showHiddenMarks(`a ${HIDDEN_MARK} b`, "fr")).toBe("a Joueur masqué b");
  });
});

describe("hide my profile: toggling", () => {
  it("hides and shows per Discord user, changing only when needed", async () => {
    const rows = new Set<string>();
    const db = { publicProfileHidden: {
      findUnique: async ({ where }: { where: { discordUserId: string } }) => rows.has(where.discordUserId) ? { discordUserId: where.discordUserId } : null,
      upsert: async ({ create }: { create: { discordUserId: string } }) => { rows.add(create.discordUserId); return create; },
      deleteMany: async ({ where }: { where: { discordUserId: string } }) => ({ count: rows.delete(where.discordUserId) ? 1 : 0 })
    } };
    expect(await setProfileHidden(db as never, "123456789012345678", true)).toBe(true);
    expect(await setProfileHidden(db as never, "123456789012345678", true)).toBe(false);
    expect(rows.has("123456789012345678")).toBe(true);
    expect(await setProfileHidden(db as never, "123456789012345678", false)).toBe(true);
    expect(rows.size).toBe(0);
    await expect(setProfileHidden(db as never, "not-an-id", true)).rejects.toThrow();
  });

  it("answers in English and French and says how long the pages take", () => {
    expect(privacyReply("en", "hide", true)).toMatch(/Hidden player.*within about 3 minutes/s);
    expect(privacyReply("fr", "show", false)).toMatch(/de nouveau public.*3 minutes/s);
    expect(privacyReply("en", "status", true)).toContain("hidden");
    expect(privacyReply("fr", "status", false)).toContain("public");
  });

  it("the website switch posts to /me/privacy and flips the state", async () => {
    const rows = new Set<string>();
    const db = { publicProfileHidden: {
      findUnique: async ({ where }: { where: { discordUserId: string } }) => rows.has(where.discordUserId) ? { discordUserId: where.discordUserId } : null,
      upsert: async ({ create }: { create: { discordUserId: string } }) => { rows.add(create.discordUserId); return create; },
      deleteMany: async ({ where }: { where: { discordUserId: string } }) => ({ count: rows.delete(where.discordUserId) ? 1 : 0 })
    } };
    const web = createPrivacyWeb(db as never);
    const ctx = (hidden: string | null, query = "") => ({ request: { method: hidden === null ? "GET" : "POST", path: hidden === null ? "/me/" : "/me/privacy", query: new URLSearchParams(query), headers: {} }, lang: "en", t: (en: string) => en, csrf: "tok",
      account: { id: "a", discordUserId: "123456789012345678" }, form: hidden === null ? null : new URLSearchParams({ hidden }) });
    const kit = { redirect: (location: string) => ({ status: 302, headers: { location }, body: "" }) };
    expect(await web.meSection(ctx(null) as never)).toContain("Hide my profile");
    const answer = await web.route(ctx("1") as never, kit as never) as { status: number };
    expect(answer.status).toBe(302);
    expect(rows.has("123456789012345678")).toBe(true);
    expect(await web.meSection(ctx(null, "done=privacy") as never)).toContain("Show my profile again");
    await web.route(ctx("0") as never, kit as never);
    expect(rows.size).toBe(0);
  });
});
