import { dungeonRole } from "./dungeon-role.mjs";
import luaparse from "luaparse";
import { editionMetadata, gameEditionOf, GAME_EDITIONS } from "./game-edition.mjs";
import { normalizeExportIdentities, characterReference } from "./character-identity.mjs";

const iso = (epoch) => new Date(Number(epoch) * 1000).toISOString();
export const MAX_SAVED_VARIABLE_CHARACTERS = 16_000_000;

// SavedVariables and compact backups may use Lua decimal byte escapes, which
// JSON.parse cannot decode. Decode their UTF-8 bytes without evaluating Lua.
function luaString(raw) {
  if (raw.startsWith('"')) { try { return JSON.parse(raw); } catch { /* Lua escapes below */ } }
  const long = /^\[(=*)\[/.exec(raw);
  if (long) return raw.slice(long[0].length, -(long[1].length + 2)).replace(/^\r?\n/, '');
  const body = raw.slice(1, -1).replace(/\\\r\n/g, '\\\n');
  const bytes = [], encoder = new TextEncoder();
  const append = text => { for (const byte of encoder.encode(text)) bytes.push(byte); };
  const escapes = { a:7, b:8, f:12, n:10, r:13, t:9, v:11, '\n':10, '\r':10 };
  let at = 0;
  for (const match of body.matchAll(/\\(\d{1,3}|[\s\S])/g)) {
    append(body.slice(at, match.index));
    const value = match[1];
    if (/^\d+$/.test(value)) bytes.push(Number(value));
    else if (Object.hasOwn(escapes, value)) bytes.push(escapes[value]); else append(value);
    at = match.index + match[0].length;
  }
  append(body.slice(at));
  return new TextDecoder().decode(new Uint8Array(bytes));
}

// "Alchemy:300,Mining:275" from a peer's digest. A part with no name or no number is dropped:
// the text came from another player's addon and one bad part must not spoil the upload.
function digestProfessions(text) {
  return String(text ?? "").split(",").filter(Boolean).flatMap((part) => {
    const [name, skill] = part.split(":");
    const skillLevel = Math.trunc(Number(skill));
    if (!name || !name.trim() || !Number.isFinite(skillLevel) || skillLevel < 0) return [];
    return [{ name: name.trim().slice(0, 40), skillLevel }];
  }).slice(0, 10);
}
const digestLevel = (value) => { const level = Math.trunc(Number(value)) || 0; return level >= 0 && level <= 100 ? level : 0; };

function evaluate(node) {
  if (!node) return null;
  if (node.type === "StringLiteral") {
    if (node.value !== null) return node.value;
    const raw = node.raw ?? "";
    return luaString(raw);
  }
  if (node.type === "NumericLiteral" || node.type === "BooleanLiteral") return node.value;
  if (node.type === "NilLiteral") return null;
  if (node.type === "UnaryExpression" && node.operator === "-") return -evaluate(node.argument);
  if (node.type !== "TableConstructorExpression") throw new Error(`Unsupported Lua value: ${node.type}`);

  // WoW's SavedVariables writer always serializes array-like tables with
  // explicit bracketed keys (e.g. `{ [1] = a, [2] = b }`), never the compact
  // `{ a, b }` literal form. Without detecting that, every array field the
  // addon exports (items, findings, professions, consumables, ledger
  // entries, ...) would come out as a plain object with numeric-string keys
  // instead of a real array, which fails every array schema on the bot
  // side. An empty table is ambiguous between "empty array" and "empty
  // object" — resolve it as an array, since every consumer of an object
  // result here only calls Object.entries/Object.values, which behave
  // identically on an empty array.
  if (node.fields.length === 0) return [];

  const entries = [];
  let index = 1;
  for (const field of node.fields) {
    if (field.type === "TableKeyString") entries.push([field.key.name, evaluate(field.value)]);
    else if (field.type === "TableKey") entries.push([String(evaluate(field.key)), evaluate(field.value)]);
    else entries.push([String(index++), evaluate(field.value)]);
  }

  const isArrayLike = entries.every(([key], position) => key === String(position + 1));
  if (isArrayLike) return entries.map(([, value]) => value);

  const object = Object.create(null);
  for (const [key, value] of entries) object[key] = value;
  return object;
}

// A SavedVariables table (GuildedDB by default; GuildedDungeonsDB for personal-runs.mjs). The
// spreadsheet export reads it too.
export function readDatabase(lua, name = "GuildedDB") {
  if (typeof lua !== "string" || lua.length > MAX_SAVED_VARIABLE_CHARACTERS) throw new Error("SavedVariables exceeds the 16-million-character parsing limit. Keep your original file and ask an officer for help.");
  let nodes = 0;
  const ast = luaparse.parse(lua.replace(/^\uFEFF/, ""), { onCreateNode() {
    if (++nodes > 500_000) throw new Error("SavedVariables contains too many Lua values. Keep your original file and ask an officer for help.");
  } });
  const assignment = ast.body.find((statement) =>
    statement.type === "AssignmentStatement" &&
    statement.variables.some((variable) => variable.type === "Identifier" && variable.name === name)
  );
  if (!assignment) throw new Error(`${name} was not found in the SavedVariables file.`);
  return evaluate(assignment.init[0]);
}

export function parseAddonExportText(text, realm) {
  const database = readDatabase(text.replace(/^\uFEFF/, ""));
  const edition = editionMetadata(database.character ?? {});
  if (edition.gameEdition !== "forever") realm = String(database.character?.realm || realm);
  const transactions = [];
  const epgpTransactions = [];
  // The addon migrates its legacy db.dkp ledger into db.epgp on login, so a
  // fresh SavedVariables file only ever has one or the other populated.
  const usingEpgpLedger = database.epgp !== undefined;
  const ledger = database.epgp ?? database.dkp ?? {};
  for (const [character, account] of Object.entries(ledger)) {
    for (const [index, entry] of Object.entries(account.ledger ?? {})) {
      // Every export carries the whole ledger, so this ref must be stable
      // across exports: the bot skips refs it already imported. Addon v1.2+
      // stamps a unique id on each entry; older entries fall back to
      // character + timestamp + position (the addon never trims the ledger).
      const sourceRef = entry.id
        ? `qg:${entry.id}`
        : `qg:${character}:${entry.at ?? "unknown"}:${entry.by ?? "unknown"}:${index}`;
      // An entry that changes nothing (older addons could write one) is not a ledger entry.
      if (usingEpgpLedger && !Number(entry.epAmount ?? 0) && !Number(entry.gpAmount ?? 0)) continue;
      let reason = String(entry.reason ?? "").trim();
      if (reason.length < 3) reason = `Guilded addon ledger${reason ? `: ${reason}` : ""}`;
      if (usingEpgpLedger) {
        epgpTransactions.push({
          character,
          realm,
          ...(entry.coreId ? { coreId: String(entry.coreId) } : {}),
          ...(entry.at ? { createdAt: typeof entry.at === "number" ? iso(entry.at) : String(entry.at) } : {}),
          epAmount: Number(entry.epAmount ?? 0),
          gpAmount: Number(entry.gpAmount ?? 0),
          type: entry.type ?? "ADJUSTMENT",
          reason,
          sourceRef,
          // /guilded void: the bot never imports it, or reverses it when it already did.
          ...(entry.voided ? { voided: true } : {})
        });
      } else {
        transactions.push({
          character,
          realm,
          amount: Number(entry.amount),
          ...(entry.at ? { createdAt: typeof entry.at === "number" ? iso(entry.at) : String(entry.at) } : {}),
          type: entry.type === "DEDUCTION" ? "DEDUCTION" : "AWARD",
          reason,
          sourceRef
        });
      }
    }
  }
  const attunements = [];
  for (const [character, entries] of Object.entries(database.attunements ?? {})) {
    for (const [name, entry] of Object.entries(entries ?? {})) {
      attunements.push({ character, realm, name, completed: entry.completed !== false });
    }
  }

  // Peer roster digests are compact status/profession summaries broadcast by
  // other online clients (see the addon README's "Automatic readiness sync"
  // section) rather than a full /guilded inspect. They carry no item list, so
  // they're converted into readiness entries with synthesized findings
  // instead of real gear data — this is what lets one officer's export
  // carry a readiness picture for the whole online guild, not just themselves.
  // (9.0) A digest a guildmate forwarded during catch-up (Modules/CatchUp.lua) is old news for
  // readiness: it still feeds the character list below, never a readiness row.
  const peerReadiness = Object.entries(database.peerRoster ?? {}).filter(([, entry]) => entry?.forwarded !== true).map(([character, entry]) => {
    const professions = digestProfessions(entry.professions);
    const findings = [];
    if ((entry.missing ?? 0) > 0) {
      findings.push({
        code: "PEER_MISSING_GEAR",
        severity: "ERROR",
        message: `${entry.missing} required gear slot(s) reported missing by peer sync.`
      });
    }
    if ((entry.minDurability ?? 100) < 50) {
      findings.push({
        code: "PEER_LOW_DURABILITY",
        severity: "WARNING",
        message: `Lowest reported equipment durability: ${entry.minDurability}%.`
      });
    }
    // Reason flags from the peer's digest (Core.lua): NOFLASK, NOFOOD, ENCH:Chest+Legs.
    for (const flag of String(entry.flags ?? "").split(",").filter(Boolean)) {
      if (flag === "NOFLASK") findings.push({ code: "NO_FLASK", severity: "WARNING", message: "No flask or elixir active." });
      else if (flag === "NOFOOD") findings.push({ code: "NO_FOOD", severity: "WARNING", message: "No food buff active." });
      else if (flag.startsWith("ENCH:")) findings.push({ code: "MISSING_ENCHANTS", severity: "WARNING", message: `Missing enchants: ${flag.slice(5).split("+").join(", ")}.` });
    }
    return {
      character,
      realm,
      professions,
      professionsComplete: entry.professionsComplete === true,
      ...(entry.professionsAt ? { professionsAt: iso(entry.professionsAt) } : {}),
      findings,
      inspectedAt: entry.updatedAt
    };
  });

  // Everyone who has told the guild who they are (class, race, level, spec),
  // so the bot can discover characters nobody has linked yet.
  const characters = Object.entries(database.peerRoster ?? {})
    .filter(([, entry]) => entry?.identity?.class)
    .map(([name, entry]) => ({
      name,
      ...(database.displayNames?.[name] ? { displayName: String(database.displayNames[name]) } : {}),
      realm,
      class: String(entry.identity.class),
      race: String(entry.identity.race ?? ""),
      level: digestLevel(entry.identity.level),
      spec: String(entry.identity.spec ?? ""),
      ...guildRankFields(database.roster?.[name]),
      professionsComplete: entry.professionsComplete === true,
      ...(entry.professionsAt ? { professionsAt: iso(entry.professionsAt) } : {}),
      professions: digestProfessions(entry.professions),
      // When this addon heard their digest (provenance: the bot prefers newer, first-hand data).
      ...(Number.isFinite(Number(entry.seenAt)) && Number(entry.seenAt) > 0 ? { observedAt: iso(entry.seenAt) } : {}),
      // Their /guilded verify code: the bot links this character to whoever owns the code.
      ...(typeof entry.verify === "string" && /^[A-Z]{8}$/.test(entry.verify) ? { verify: entry.verify } : {})
    }));

  // Finished in-game raids: explicit attendance marks plus everyone the addon
  // saw in the raid group (db.presence). Still-running raids wait for /guilded end.
  const raids = [];
  for (const raid of Object.values(database.raids ?? {})) {
    if (!raid?.id || !raid.startedAt || !raid.endedAt) continue;
    const marked = database.attendance?.[raid.id] ?? {};
    const seen = database.presence?.[raid.id] ?? {};
    const names = new Set([...Object.keys(marked), ...Object.keys(seen)]);
    raids.push({
      ref: raid.id,
      title: String(raid.title || "Raid"),
      ...(raid.coreId ? { coreId: String(raid.coreId) } : {}),
      startedAt: raid.startedAt,
      endedAt: raid.endedAt,
      players: [...names].sort().map((character) => ({
        character,
        realm,
        ...(marked[character]?.status ? { status: marked[character].status } : {}),
        seen: character in seen
      }))
    });
  }

  // Items given out in game. Rows from before loot ids existed fall back to
  // a ref built from who/what/when, which is just as stable.
  const loot = [];
  for (const row of Object.values(database.loot ?? {})) {
    if (!row?.player || !row.item) continue;
    const item = String(row.item).replace(/\|c[0-9a-fA-F]{8}\|H[^|]*\|h(\[[^\]]*\])\|h\|r/g, "$1");
    loot.push({
      ref: row.id ? `qg-loot:${row.id}` : `qg-loot:${row.player}:${row.at ?? "unknown"}:${item}`,
      character: row.player,
      realm,
      item,
      gp: Math.max(0, Math.trunc(Number(row.cost) || 0)),
      ...(row.at ? { awardedAt: row.at } : {}),
      ...(row.raid ? { raidRef: row.raid } : {}),
      ...(row.pricing ? { pricing: row.pricing } : {}),
      ...(row.boss ? { boss: row.boss } : {})
    });
  }

  const dungeonRuns = exportDungeonRuns(database, realm);
  const battlegroundReports = exportBattlegroundReports(database);
  const duelResults = exportDuelResults(database);
  const milestones = exportMilestones(database);
  const guildData = exportGuildData(database);
  const guildBank = exportGuildBank(database);
  const guildMap = exportGuildMap(database);

  // Soft reserves (addon Modules/Reserve.lua): the whole list, replaced in Discord when newer.
  const reserves = buildReserves(database.reserves, realm);

  // Guild events from the in-game calendar and each member's answer (addon Modules/Calendar.lua).
  const calendarEvents = Object.values(database.calendarEvents?.events ?? {})
    .filter((event) => event && Number(event.startsAt) > 0 && event.title)
    .slice(0, 100)
    .map((event) => ({
      ref: String(event.ref).slice(0, 80),
      ...(typeof event.botRaidId === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(event.botRaidId) ? { botRaidId: event.botRaidId } : {}),
      title: String(event.title).slice(0, 100),
      startsAt: new Date(Number(event.startsAt) * 1000).toISOString(),
      invites: Object.values(event.invites ?? {})
        .filter((invite) => invite?.name && ["ACCEPTED", "TENTATIVE", "DECLINED"].includes(invite.status))
        .slice(0, 200)
        .map((invite) => ({ character: String(invite.name), realm, status: String(invite.status) }))
    }));

  // Raid answers given in game (addon Modules/RaidSignup.lua): Sign up / Tentative / Can't per raid.
  const signupAnswers = Object.entries(database.signupAnswers ?? {})
    .filter(([raidId, answer]) => /^[a-zA-Z0-9_-]{1,80}$/.test(String(raidId)) && answer?.name && Number(answer.at) > 0
      && ["ACCEPTED", "TENTATIVE", "DECLINED"].includes(answer.status))
    .slice(0, 100)
    .map(([raidId, answer]) => ({
      raidId: String(raidId), character: String(answer.name), realm, status: String(answer.status),
      ...(["TANK", "HEALER", "DPS"].includes(answer.role) ? { role: String(answer.role) } : {}),
      at: new Date(Number(answer.at) * 1000).toISOString()
    }));

  // Who can craft what, and profession cooldowns (addon Modules/Recipes.lua).
  const recipeData = buildRecipes(database.recipeBook, realm);

  // SavedVariables key order is arbitrary; the ISO timestamps sort correctly.
  const alts = Object.values(database.myCharacters ?? {})
    .filter((entry) => entry?.name && entry.class)
    .slice(0, 50)
    .map((entry) => exportCharacter({ ...edition, ...entry }, realm, database.roster));
  // Item prices officers set in game (addon Modules/Loot.lua); the bot keeps the newer of this and Discord's.
  const itemPrices = Object.values(database.itemPrices ?? {})
    .filter((entry) => entry?.name && Number.isFinite(Number(entry.gp)) && entry.at)
    .slice(0, 500)
    .map((entry) => ({
      name: String(entry.name).slice(0, 100),
      ...(Number(entry.id) > 0 ? { id: Math.trunc(Number(entry.id)) } : {}),
      gp: Math.max(0, Math.min(100000, Math.trunc(Number(entry.gp)))),
      ...(entry.core ? { coreId: String(entry.core).slice(0, 40) } : {}),
      at: String(entry.at)
    }));
  const exportKeys = Object.keys(database.exports ?? {}).sort();
  const exportedAt = exportKeys.at(-1) ?? new Date().toISOString();
  const syncStats = exportSyncStats(database);
  const identities = normalizeExportIdentities({
    source: "Guilded",
    ...edition,
    exportedAt,
    // The WoW guild this saved data belongs to ("Guild Name-Realm").
    ...(database.guildKey ? { wowGuild: String(database.guildKey) } : {}),
    ...(database.character?.name ? { character: exportCharacter(database.character, realm, database.roster) } : {}),
    // Every character that logged in on this PC for this guild (addon Core.lua, myCharacters):
    // a paired companion links them all to the same Discord member.
    ...(alts.length ? { alts } : {}),
    ...(itemPrices.length ? { itemPrices } : {}),
    transactions,
    epgpTransactions,
    addonVersion: database.addonVersion ?? null,
    readiness: [
      ...Object.values(database.readiness ?? {}).map((entry) => ({ ...entry, realm })),
      ...peerReadiness
    ],
    attunements,
    ...(characters.length ? { characters } : {}),
    ...(database.consumeScan?.players ? {
      consumeScan: {
        at: String(database.consumeScan.at ?? exportedAt),
        by: String(database.consumeScan.by ?? ""),
        players: Object.values(database.consumeScan.players).map((player) => ({
          character: String(player.character),
          realm: String(player.realm || realm),
          flask: player.flask ? String(player.flask) : undefined,
          elixirs: Object.values(player.elixirs ?? {}).map(String),
          food: player.food ? String(player.food) : undefined,
          weapon: player.weapon ? String(player.weapon) : undefined
        }))
      }
    } : {}),
    ...(reserves ? { reserves: { ...reserves, at: reserves.at ?? exportedAt } } : {}),
    ...(recipeData.recipes.length ? { recipes: recipeData.recipes, recipeNames: recipeData.recipeNames } : {}),
    ...(recipeData.cooldowns.length ? { cooldowns: recipeData.cooldowns } : {}),
    ...(calendarEvents.length ? { calendarEvents } : {}),
    ...(signupAnswers.length ? { signupAnswers } : {}),
    raids,
    loot,
    dungeonRuns,
    ...(battlegroundReports.length ? { battlegroundReports } : {}),
    ...(duelResults.length ? { duelResults } : {}),
    ...(milestones.length ? { milestones } : {}),
    ...guildData,
    ...guildBank,
    ...guildMap
  }, edition.gameEdition, realm);
  return syncStats ? { ...identities, syncStats } : identities;
}

// Guild sync counters (addon Modules/CatchUp.lua, 9.0): numbers and two dates, never names. The
// companion shows them in its support summary and does not upload them (engine.mjs).
export function exportSyncStats(database) {
  const saved = database?.syncStats;
  if (!saved || typeof saved !== "object") return null;
  const count = (v) => Number.isSafeInteger(v) && v >= 0 && v < 1e12 ? v : 0;
  const epoch = (v) => Number.isSafeInteger(v) && v > 1_600_000_000 && v < 4_102_444_800;
  const fields = ["sent", "bytes", "received", "receivedBytes", "held", "relayedIn", "relayedOut", "rounds", "acksSent", "acksHeard"];
  const stats = Object.fromEntries(fields.map((field) => [field, count(saved[field])]));
  if (epoch(saved.since)) stats.since = new Date(saved.since * 1000).toISOString();
  if (epoch(saved.lastCatchUpAt)) stats.lastCatchUpAt = new Date(saved.lastCatchUpAt * 1000).toISOString();
  return stats;
}

// Private self-reports only: whitelist the protocol rather than forwarding arbitrary
// SavedVariables fields (which could contain other players or stale consent).
export function exportBattlegroundReports(database) {
  const edition = gameEditionOf(database.character ?? database);
  if (!GAME_EDITIONS.includes(edition)) return [];
  const d = database?.battleground;
  if (!d || typeof d.reports !== "object" || !d.reports) return [];
  const text = (v, max) => typeof v === "string" && v.length > 0 && v.length <= max;
  const integer = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max;
  return Object.values(d.reports).filter(r => r && r.version === 1 && r.edition === edition
    && r.adapter === `${edition}-postmatch-v1` && r.realmType === "normal" && r.postmatch === true && r.consent === true
    && text(r.character, 80) && text(r.realm, 100)
    && typeof r.reportId === "string" && /^[a-zA-Z0-9_:-]{8,100}$/.test(r.reportId)
    && ["casual", "rated", "blitz"].includes(r.mode) && text(r.bracket, 30)
    && integer(r.mapId, 1, 1000000) && integer(r.endedAt, 1, 4102444800)
    && integer(r.durationSeconds, 0, 14400) && ["win", "loss", "draw", "unknown"].includes(r.outcome)
    && ["complete", "backfill", "early-exit", "unknown"].includes(r.presence) && typeof r.reloaded === "boolean")
    .sort((a, b) => b.endedAt - a.endedAt).slice(0, 100).map(r => ({
      version: 1, reportId: r.reportId, adapter: r.adapter, edition: r.edition,
      character: r.character, realm: r.realm, realmType: "normal", mode: r.mode,
      mapId: r.mapId, bracket: r.bracket, endedAt: r.endedAt, durationSeconds: r.durationSeconds,
      outcome: r.outcome, presence: r.presence, reloaded: r.reloaded, postmatch: true, consent: true
    }));
}

// Guild duels the addon recorded (Modules/Duels.lua): who beat whom and when, nothing else. The bot checks that
// both are guild members and that the uploader is one of them. Whitelisted field by field.
export function exportDuelResults(database) {
  const results = database?.duels?.results;
  if (!results || typeof results !== "object") return [];
  // eslint-disable-next-line no-control-regex
  const name = (v) => typeof v === "string" && v.length > 0 && v.length <= 80 && !/[|\u0000-\u001f]/.test(v);
  return Object.values(results)
    .filter((r) => r && name(r.winner) && name(r.loser) && r.winner !== r.loser && Number.isSafeInteger(r.at) && r.at > 0 && r.at < 4102444800
      && (r.reason === "knockout" || r.reason === "retreat"))
    .sort((a, b) => b.at - a.at).slice(0, 200)
    .map((r) => ({ winner: r.winner, loser: r.loser, at: r.at, reason: r.reason }));
}

// The guild bank (addon Modules/GuildBank.lua, 9.0): the last contents and gold, the gold history
// and the game's item and money logs. Whitelisted field by field (docs/GUILD_BANK_LEDGER.md).
export function exportGuildBank(database) {
  const epoch = (v) => Number.isSafeInteger(v) && v > 1_600_000_000 && v < 4_102_444_800;
  const name = (v) => typeof v === "string" && v.length > 0 && v.length <= 80 && !/[|\p{Cc}]/u.test(v);
  const kind = (v) => typeof v === "string" && /^[A-Za-z]{1,20}$/.test(v);
  const copper = (v) => Number.isSafeInteger(v) && v >= 0 && v < 1e13;
  const label = (v, max) => typeof v === "string" && v.trim() ? v.trim().replace(/[|\p{Cc}]/gu, " ").slice(0, max) : undefined;
  const bank = {};
  const snap = database?.guildBank;
  if (snap && typeof snap === "object" && snap.tabs && typeof snap.tabs === "object") {
    const at = typeof snap.at === "string" ? Date.parse(snap.at) : NaN;
    const tabs = Object.entries(snap.tabs).flatMap(([tab, info]) => {
      const index = Math.trunc(Number(tab));
      if (!Number.isInteger(index) || index < 1 || index > 8 || !info || typeof info !== "object") return [];
      const items = Object.entries(info.items ?? {}).flatMap(([id, item]) => {
        const itemId = Math.trunc(Number(id)), count = Math.trunc(Number(item?.count));
        const quality = Number.isInteger(item?.q) && item.q >= 0 && item.q <= 7 ? { q: item.q } : {};
        return itemId > 0 && count > 0 ? [{ id: itemId, name: label(item?.name, 100) ?? `Item ${itemId}`, count: Math.min(count, 1_000_000), ...quality }] : [];
      }).slice(0, 200);
      return [{ tab: index, name: label(info.name, 40) ?? `Tab ${index}`, items }];
    });
    if (Number.isFinite(at) && tabs.length) bank.contents = { at: Math.floor(at / 1000), ...(copper(snap.money) ? { money: snap.money } : {}), tabs };
  }
  const log = database?.guildBankLog;
  const list = (value) => Object.values(value ?? {});
  const gold = list(log?.gold).filter((p) => p && epoch(p.at) && copper(p.money)).map((p) => ({ at: p.at, money: p.money })).slice(-400);
  if (gold.length) bank.gold = gold;
  const items = list(log?.items).filter((l) => l && kind(l.type) && name(l.name) && Number.isInteger(l.item) && l.item > 0 && epoch(Math.trunc(Number(l.at))))
    .map((l) => ({ type: l.type, name: l.name, itemId: l.item, ...(label(l.itemName, 100) ? { itemName: label(l.itemName, 100) } : {}),
      count: Math.max(1, Math.min(1_000_000, Math.trunc(Number(l.count)) || 1)), ...(Number.isInteger(l.tab) ? { tab: l.tab } : {}),
      ...(Number.isInteger(l.tab2) ? { tab2: l.tab2 } : {}), at: Math.trunc(Number(l.at)) }))
    .sort((a, b) => b.at - a.at).slice(0, 1000);
  if (items.length) bank.itemLog = items;
  const money = list(log?.money).filter((l) => l && kind(l.type) && name(l.name) && copper(l.amount) && epoch(Math.trunc(Number(l.at))))
    .map((l) => ({ type: l.type, name: l.name, amount: l.amount, at: Math.trunc(Number(l.at)) })).sort((a, b) => b.at - a.at).slice(0, 1000);
  if (money.length) bank.moneyLog = money;
  // 9.1: requests made in game (/guilded gbank request), this member's own; the bot keeps each ref once.
  const requests = list(database?.bankRequests).filter((r) => r && typeof r.ref === "string" && /^[A-Za-z0-9-]{6,40}$/.test(r.ref) && label(r.item, 100))
    .map((r) => ({ ref: r.ref, item: label(r.item, 100), ...(Number.isSafeInteger(r.itemId) && r.itemId > 0 ? { itemId: r.itemId } : {}),
      count: Math.max(1, Math.min(1000, Math.trunc(Number(r.count)) || 1)) })).slice(0, 10);
  return { ...(Object.keys(bank).length ? { guildBank: bank } : {}), ...(requests.length ? { bankRequests: requests } : {}) };
}

// Track M phone map (addon Modules/GuildMap.lua and Modules/CallForHelp.lua): this player's own
// last-seen outdoor positions (db.mapSeen, one per character, plus a short db.mapTrail) and their own
// calls for help (db.helpCalls). Whitelisted field by field; the bot keeps them only for the uploader
// and only while they share (src/services/guild-map.ts).
export function exportGuildMap(database) {
  const text = (v, max) => typeof v === "string" && v.trim() ? v.trim().replace(/[|\p{Cc}]/gu, " ").slice(0, max) : undefined;
  const share = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 ? Math.round(v * 10000) / 10000 : undefined;
  const id = (v) => Number.isInteger(v) && v > 0 && v < 100000 ? v : undefined;
  const at = (v) => Number.isInteger(v) && v > 1_600_000_000 && v < 4_000_000_000 ? v : undefined;
  const place = (row) => {
    const out = {};
    const mapId = id(row.m), x = share(row.x), y = share(row.y);
    if (mapId && x !== undefined && y !== undefined) Object.assign(out, { mapId, x, y });
    const continentId = id(row.c), cx = share(row.cx), cy = share(row.cy);
    if (out.mapId && continentId && cx !== undefined && cy !== undefined) Object.assign(out, { continentId, cx, cy, ...(text(row.cn, 60) ? { continent: text(row.cn, 60) } : {}) });
    return out;
  };
  const sightings = new Map();
  const add = (character, row) => {
    const name = text(character, 80), when = row && at(row.at), zone = row && text(row.z, 60);
    if (!name || !when || !zone) return;
    const where = place(row);
    if (!where.mapId) return;
    const key = `${name}|${when}`;
    if (!sightings.has(key)) sightings.set(key, { character: name, zone, ...where, at: when });
  };
  for (const [character, row] of Object.entries(database?.mapSeen ?? {})) add(character, row);
  for (const row of Object.values(database?.mapTrail ?? {})) if (row && typeof row === "object") add(row.n, row);
  const mapSightings = [...sightings.values()].sort((a, b) => a.at - b.at).slice(-60);
  const helpCalls = Object.values(database?.helpCalls ?? {}).flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const ref = typeof row.id === "string" && /^[A-Za-z0-9-]{1,40}$/.test(row.id) ? row.id : undefined;
    const character = text(row.n, 80), when = at(row.at);
    if (!ref || !character || !when) return [];
    const attackers = Object.values(row.a ?? {}).flatMap((a) => {
      const name = a && text(a.n, 40);
      if (!name) return [];
      const level = Number.isInteger(a.l) && a.l >= 0 && a.l <= 100 ? { level: a.l } : {};
      return [{ name, ...(text(a.c, 20) ? { class: text(a.c, 20) } : {}), ...level }];
    }).slice(0, 3);
    return [{ ref, character, zone: text(row.z, 60) ?? "", ...(text(row.sz, 60) ? { subzone: text(row.sz, 60) } : {}), ...place(row),
      attackers, at: when, ...(at(row.clr) ? { clearedAt: at(row.clr) } : {}) }];
  }).sort((a, b) => a.at - b.at).slice(-10);
  return { ...(mapSightings.length ? { mapSightings } : {}), ...(helpCalls.length ? { helpCalls } : {}) };
}

// What the game shows every member about the whole guild (addon Modules/GuildSnapshot.lua and
// Modules/GuildLog.lua): the roster with levels, classes, ranks and last online, the guild event
// log, the MOTD and info text. Whitelisted field by field; notes are never read by the addon.
export function exportGuildData(database) {
  const out = {};
  const name = (v) => typeof v === "string" && v.length > 0 && v.length <= 80 && !/[|\p{Cc}]/u.test(v);
  const epoch = (v) => Number.isSafeInteger(v) && v > 1_600_000_000 && v < 4_102_444_800;
  const snap = database?.guildSnapshot;
  if (snap && typeof snap === "object" && epoch(snap.at) && snap.members && typeof snap.members === "object") {
    const members = Object.entries(snap.members).filter(([key, m]) => name(key) && m && typeof m === "object").slice(0, 1000).map(([key, m]) => ({
      name: key,
      ...(Number.isInteger(m.level) && m.level >= 1 && m.level <= 100 ? { level: m.level } : {}),
      ...(typeof m.class === "string" && /^[A-Z]{1,20}$/.test(m.class) ? { class: m.class } : {}),
      ...(typeof m.rankName === "string" && m.rankName.trim() ? { rankName: m.rankName.trim().slice(0, 60) } : {}),
      ...(Number.isInteger(m.rankIndex) && m.rankIndex >= 0 && m.rankIndex < 20 ? { rankIndex: m.rankIndex } : {}),
      online: m.online === true,
      ...(epoch(m.lastOnline) ? { lastOnline: m.lastOnline } : {})
    }));
    if (members.length) out.guildRoster = { at: snap.at, complete: snap.complete === true, members };
    const text = (v, max) => typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;
    if (text(snap.motd, 255) !== undefined || text(snap.info, 1000) !== undefined) {
      out.guildInfo = { at: epoch(snap.textAt) ? snap.textAt : snap.at, ...(text(snap.motd, 255) !== undefined ? { motd: text(snap.motd, 255) } : {}), ...(text(snap.info, 1000) !== undefined ? { info: text(snap.info, 1000) } : {}) };
    }
  }
  const kinds = new Set(["invite", "join", "promote", "demote", "remove", "quit"]);
  const events = Object.values(database?.guildLog?.events ?? {})
    .filter((e) => e && kinds.has(e.type) && name(e.p1) && (e.p2 === undefined || e.p2 === null || name(e.p2)) && epoch(Math.trunc(Number(e.at))))
    .map((e) => ({ type: e.type, actor: e.p1, ...(name(e.p2) ? { target: e.p2 } : {}), ...(typeof e.rank === "string" && e.rank.trim() ? { rank: e.rank.trim().slice(0, 60) } : {}), at: Math.trunc(Number(e.at)) }))
    .sort((a, b) => b.at - a.at).slice(0, 500);
  if (events.length) out.guildEvents = events;
  return out;
}

// Personal milestones (Modules/Milestones.lua): level steps, first dungeon clears, honorable kills, duel wins. Own characters
// only, numbers and dates; the Discord echo is the server's own opt-in, never decided here.
export function exportMilestones(database) {
  const chars = database?.milestones?.chars;
  if (!chars || typeof chars !== "object") return [];
  const out = [];
  for (const entry of Object.values(chars)) {
    if (!entry || typeof entry.name !== "string" || !entry.name || entry.name.length > 80 || typeof entry.log !== "object" || !entry.log) continue;
    for (const row of Object.values(entry.log)) {
      if (!row || !["level", "dungeon", "hk", "duel"].includes(row.kind) || typeof row.ref !== "string"
        || !/^[a-z]{2,10}:[A-Za-z0-9_-]{1,30}$/.test(row.ref) || !Number.isSafeInteger(row.value) || row.value < 0 || row.value > 1000000
        || !Number.isSafeInteger(row.at) || row.at <= 0 || row.at >= 4102444800) continue;
      out.push({ character: entry.name, realm: typeof entry.realm === "string" ? entry.realm.slice(0, 100) : "", kind: row.kind, ref: row.ref, value: row.value, at: row.at });
    }
  }
  return out.sort((a, b) => b.at - a.at).slice(0, 300);
}

// The character's rank in the WoW guild the saved data belongs to: { guildRankName, guildRankIndex }
// or nothing. Optional and additive; a missing or malformed rank is simply left out. Index 0 is the guild master.
export function guildRankFields(...sources) {
  for (const source of sources) {
    const name = typeof source?.guildRankName === "string" ? source.guildRankName : source?.rankName;
    const index = source?.guildRankIndex ?? source?.rankIndex;
    if (typeof name === "string" && name.trim() && Number.isInteger(index) && index >= 0 && index < 20) {
      return { guildRankName: name.trim().slice(0, 60), guildRankIndex: index };
    }
  }
  return {};
}

// One character as the bot's addonCharacterSchema expects it.
function exportCharacter(entry, realm, roster) {
  return {
    ...guildRankFields(roster?.[String(entry.name)], entry),
    ...editionMetadata(entry),
    name: String(entry.name),
    ...(entry.displayName ? { displayName: String(entry.displayName) } : {}),
    realm: String(entry.realm || realm),
    class: String(entry.class ?? ""),
    race: String(entry.race ?? ""),
    level: digestLevel(entry.level),
    spec: String(entry.spec ?? ""),
    professions: Array.isArray(entry.professions) ? entry.professions : Object.values(entry.professions ?? {}),
    professionsComplete: entry.professionsComplete === true,
    ...(entry.professionsAt ? { professionsAt: entry.professionsAt } : {})
  };
}

// The addon keeps reserves as entries[player] = { itemId, ... } and names[itemId] = "Name".
// A cleared list (no keeper) is still sent, empty, so Discord forgets the old one.
function buildReserves(saved, realm) {
  if (!saved || typeof saved !== "object" || !saved.updatedAt) return null;
  const active = Boolean(saved.host);
  const entries = [];
  if (active) {
    for (const [player, ids] of Object.entries(saved.entries ?? {})) {
      for (const id of Object.values(ids ?? {})) {
        const itemId = Math.trunc(Number(id));
        if (!Number.isFinite(itemId) || itemId <= 0) continue;
        const name = saved.names?.[itemId] ?? saved.names?.[String(itemId)];
        entries.push({ character: String(player), realm, itemId, itemName: String(name || `Item ${itemId}`).slice(0, 100) });
      }
    }
  }
  return {
    at: String(saved.updatedAt),
    by: active ? String(saved.host) : "",
    title: active ? String(saved.title ?? "") : "",
    limit: Math.max(1, Math.min(5, Math.trunc(Number(saved.limit)) || 1)),
    open: active && saved.open === true,
    active,
    entries: entries.slice(0, 2000)
  };
}

// The addon keeps people[player][profession] = { v = epoch, keys = { id, ... } }, names[id] = "Name"
// and cooldowns[player] = { { prof, name, readyAt = epoch }, ... }. Recipe ids are item ids, or
// minus a spell id for enchants. Only cooldowns from the last week are sent.
function buildRecipes(saved, realm) {
  const out = { recipes: [], recipeNames: {}, cooldowns: [] };
  if (!saved || typeof saved !== "object") return out;
  const used = new Set();
  for (const [player, professions] of Object.entries(saved.people ?? {})) {
    for (const [profession, entry] of Object.entries(professions ?? {})) {
      const keys = Object.values(entry?.keys ?? {}).map(Number).filter((key) => Number.isInteger(key) && key !== 0).slice(0, 800);
      if (!entry?.v || keys.length === 0) continue;
      out.recipes.push({ character: String(player), realm, profession: String(profession).slice(0, 40), at: iso(entry.v), keys });
      for (const key of keys) used.add(key);
    }
  }
  out.recipes = out.recipes.slice(0, 400);
  for (const key of used) {
    const name = saved.names?.[key] ?? saved.names?.[String(key)];
    if (typeof name === "string" && name) out.recipeNames[String(key)] = name.slice(0, 100);
  }
  const weekAgo = Date.now() / 1000 - 7 * 24 * 3600;
  for (const [player, list] of Object.entries(saved.cooldowns ?? {})) {
    const entries = Object.values(list ?? {})
      .filter((cooldown) => cooldown && Number(cooldown.readyAt) > weekAgo)
      .slice(0, 20)
      .map((cooldown) => ({ profession: String(cooldown.prof).slice(0, 40), name: String(cooldown.name).slice(0, 60), readyAt: iso(cooldown.readyAt) }));
    if (entries.length === 0) continue;
    out.cooldowns.push({ character: String(player), realm, at: iso(saved.cooldownAt?.[player] ?? Date.now() / 1000), entries });
  }
  out.cooldowns = out.cooldowns.slice(0, 300);
  return out;
}

// Dungeon runs (addon Modules/Dungeon.lua) in the bot's dungeonRunSchema shape. Shared by the
// guild upload and the personal one (personal-runs.mjs, GuildedDungeonsDB has the same shape).
export function exportDungeonRuns(database, realm, options = {}) {
  const dungeonRuns = [];
  // Dungeon runs (addon Modules/Dungeon.lua). The bot validates each run and
  // ignores ones it already has, so exporting all of them every time is safe.
  for (const run of Object.values(database.dungeon?.runs ?? {})) {
    if (options.skipSynced && run?.synced) continue;
    if (!run?.id || !run.state || !run.instanceId) continue;
    dungeonRuns.push({
      id: String(run.id),
      protocolVersion: Number(run.protocolVersion ?? 1),
      ...(run.addonVersion ? { addonVersion: String(run.addonVersion) } : {}),
      ...(run.gameBuild ? { gameBuild: String(run.gameBuild) } : {}),
      ...editionMetadata(run.interface !== undefined || run.gameEdition !== undefined ? run : { gameEdition: gameEditionOf(database.character ?? {}) }),
      ...(run.startTrigger ? { startTrigger: String(run.startTrigger) } : {}),
      ...(run.integrity?.version === 2 ? { integrity: { version: 2, startWitness: run.integrity.startWitness,
        startTrigger: run.integrity.startTrigger, continuous: run.integrity.continuous,
        ...(run.integrity.observer ? { observer: String(run.integrity.observer) } : {}),
        ...(run.integrity.detectedAt ? { detectedAt: run.integrity.detectedAt } : {}),
        ...(run.integrity.combatAt ? { combatAt: run.integrity.combatAt } : {}),
        ...(run.integrity.witnessAt ? { witnessAt: run.integrity.witnessAt } : {}) } } : {}),
      ...(typeof run.challengeMode === "boolean" ? { challengeMode: run.challengeMode } : {}),
      ...(run.challenge ? { challenge: { ...run.challenge, affixIds: Object.values(run.challenge.affixIds ?? {}) } } : {}),
      state: String(run.state),
      instanceId: Number(run.instanceId),
      name: String(run.name ?? "Unknown dungeon"),
      difficultyId: Number(run.difficultyId ?? 0),
      ...(run.startedAt ? { startedAt: Math.trunc(Number(run.startedAt)) } : {}),
      ...(run.endedAt ? { endedAt: Math.trunc(Number(run.endedAt)) } : {}),
      ...(run.completedBy ? { completedBy: String(run.completedBy) } : {}),
      ...(run.endReason ? { endReason: String(run.endReason) } : {}),
      ...(run.recorder ? { recorder: String(run.recorder) } : {}),
      encounters: Object.values(run.encounters ?? {}).slice(0, 100).flatMap(encounter => {
        if (!encounter || !Number.isInteger(encounter.id) || encounter.id <= 0 || typeof encounter.success !== "boolean") return [];
        return [{ id: encounter.id, success: encounter.success,
          ...(encounter.kind === "npc" ? { kind: "npc" } : {}),
          ...(typeof encounter.name === "string" ? { name: encounter.name.slice(0, 100) } : {}),
          ...(["native", "combat-log"].includes(encounter.source) ? { source: encounter.source } : {}),
          ...(Number.isInteger(encounter.at) && encounter.at > 0 ? { at: encounter.at } : {}),
          ...(Number.isInteger(encounter.startedAt) && encounter.startedAt > 0 ? { startedAt: encounter.startedAt } : {}) }];
      }),
      // Death positions (9.1): fractions of a map, per uiMapID, at most 60 per run; anything out of range is dropped.
      ...(run.deathPoints ? { deathPoints: Object.values(run.deathPoints).slice(0, 60).flatMap(point => {
        if (!point || typeof point !== "object") return [];
        const x = Number(point.x), y = Number(point.y), map = Number(point.map);
        if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1) || !Number.isInteger(map) || map <= 0 || map > 100000) return [];
        return [{ x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000, map, ...(typeof point.name === "string" && point.name ? { character: point.name.slice(0, 40) } : {}) }];
      }) } : {}),
      reporters: Object.keys(run.reporters ?? {}).length || 1,
      // Who reported it, so the bot can check at least one of them was in the run.
      ...(run.reporters && Object.keys(run.reporters).length ? { reporterNames: Object.keys(run.reporters).slice(0, 10) } : {}),
      players: Object.entries(run.players ?? {}).map(([character, player]) => ({
        ...characterReference(character, realm, gameEditionOf(run.gameEdition !== undefined || run.interface !== undefined ? run : database.character ?? {})),
        ...(database.displayNames?.[character] ? { displayName: String(database.displayNames[character]) } : {}),
        ...(player.class ? { class: String(player.class) } : {}),
        ...(dungeonRole(player.role) ? { role: dungeonRole(player.role) } : {}),
        ...(player.integrity ? { integrity: { knownSec: player.integrity.knownSec, unknownSec: player.integrity.unknownSec,
          ...(player.integrity.knownIntervals ? { knownIntervals: Object.values(player.integrity.knownIntervals).map(interval => Object.values(interval)) } : {}),
          mixedRole: player.integrity.mixedRole, ...(dungeonRole(player.integrity.lockedRole) ? { lockedRole: dungeonRole(player.integrity.lockedRole) } : {}) } } : {}),
        ...(player.spec ? { spec: String(player.spec).slice(0, 40) } : {}),
        deaths: typeof player.deaths === "number" ? player.deaths : null,
        ...(Number.isInteger(player.level) && player.level >= 1 && player.level <= 100 ? { level: player.level } : {}),
        ...(Number.isInteger(player.minLevel) && player.minLevel >= 1 && player.minLevel <= 100 ? { minLevel: player.minLevel } : {}),
        presentSec: Math.max(0, Math.trunc(Number(player.presentSec) || 0)),
        inGuild: player.inGuild === true
      }))
    });
  }
  return dungeonRuns;
}
