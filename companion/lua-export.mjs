import { readFile } from "node:fs/promises";
import luaparse from "luaparse";

function evaluate(node) {
  if (!node) return null;
  if (node.type === "StringLiteral") {
    if (node.value !== null) return node.value;
    const raw = node.raw ?? "";
    if (raw.startsWith("\"")) return JSON.parse(raw);
    return raw.slice(1, -1).replace(/\\(['"])/g, "$1");
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

  const object = {};
  for (const [key, value] of entries) object[key] = value;
  return object;
}

function readDatabase(lua) {
  const ast = luaparse.parse(lua);
  const assignment = ast.body.find((statement) =>
    statement.type === "AssignmentStatement" &&
    statement.variables.some((variable) => variable.type === "Identifier" && variable.name === "GuildedDB")
  );
  if (!assignment) throw new Error("GuildedDB was not found in the SavedVariables file.");
  return evaluate(assignment.init[0]);
}

export async function readAddonExport(path, realm) {
  const database = readDatabase((await readFile(path, "utf8")).replace(/^\uFEFF/, ""));
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
      let reason = String(entry.reason ?? "").trim();
      if (reason.length < 3) reason = `Guilded addon ledger${reason ? `: ${reason}` : ""}`;
      if (usingEpgpLedger) {
        epgpTransactions.push({
          character,
          realm,
          epAmount: Number(entry.epAmount ?? 0),
          gpAmount: Number(entry.gpAmount ?? 0),
          type: entry.type ?? "ADJUSTMENT",
          reason,
          sourceRef
        });
      } else {
        transactions.push({
          character,
          realm,
          amount: Number(entry.amount),
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
  const peerReadiness = Object.entries(database.peerRoster ?? {}).map(([character, entry]) => {
    const professions = String(entry.professions ?? "")
      .split(",")
      .filter(Boolean)
      .map((part) => {
        const [name, skillLevel] = part.split(":");
        return { name, skillLevel: Number(skillLevel) || 0 };
      });
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
      realm,
      class: String(entry.identity.class),
      race: String(entry.identity.race ?? ""),
      level: Number(entry.identity.level) || 0,
      spec: String(entry.identity.spec ?? ""),
      professions: String(entry.professions ?? "").split(",").filter(Boolean).map((part) => {
        const [professionName, skill] = part.split(":");
        return { name: professionName, skillLevel: Number(skill) || 0 };
      })
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
      ...(row.boss ? { boss: row.boss } : {})
    });
  }

  // Dungeon runs (addon Modules/Dungeon.lua). The bot validates each run and
  // ignores ones it already has, so exporting all of them every time is safe.
  const dungeonRuns = [];
  for (const run of Object.values(database.dungeon?.runs ?? {})) {
    if (!run?.id || !run.state || !run.instanceId) continue;
    dungeonRuns.push({
      id: String(run.id),
      protocolVersion: Number(run.protocolVersion ?? 1),
      ...(run.addonVersion ? { addonVersion: String(run.addonVersion) } : {}),
      state: String(run.state),
      instanceId: Number(run.instanceId),
      name: String(run.name ?? "Unknown dungeon"),
      difficultyId: Number(run.difficultyId ?? 0),
      ...(run.startedAt ? { startedAt: Math.trunc(Number(run.startedAt)) } : {}),
      ...(run.endedAt ? { endedAt: Math.trunc(Number(run.endedAt)) } : {}),
      ...(run.completedBy ? { completedBy: String(run.completedBy) } : {}),
      ...(run.endReason ? { endReason: String(run.endReason) } : {}),
      ...(run.recorder ? { recorder: String(run.recorder) } : {}),
      reporters: Object.keys(run.reporters ?? {}).length || 1,
      // Who reported it, so the bot can check at least one of them was in the run.
      ...(run.reporters && Object.keys(run.reporters).length ? { reporterNames: Object.keys(run.reporters).slice(0, 10) } : {}),
      players: Object.entries(run.players ?? {}).map(([character, player]) => ({
        character,
        realm,
        ...(player.class ? { class: String(player.class) } : {}),
        ...(player.role ? { role: String(player.role) } : {}),
        deaths: typeof player.deaths === "number" ? player.deaths : null,
        presentSec: Math.max(0, Math.trunc(Number(player.presentSec) || 0)),
        inGuild: player.inGuild === true
      }))
    });
  }

  // Soft reserves (addon Modules/Reserve.lua): the whole list, replaced in Discord when newer.
  const reserves = buildReserves(database.reserves, realm);

  // Guild events from the in-game calendar and each member's answer (addon Modules/Calendar.lua).
  const calendarEvents = Object.values(database.calendarEvents?.events ?? {})
    .filter((event) => event && Number(event.startsAt) > 0 && event.title)
    .slice(0, 100)
    .map((event) => ({
      ref: String(event.ref).slice(0, 80),
      title: String(event.title).slice(0, 100),
      startsAt: new Date(Number(event.startsAt) * 1000).toISOString(),
      invites: Object.values(event.invites ?? {})
        .filter((invite) => invite?.name && ["ACCEPTED", "TENTATIVE", "DECLINED"].includes(invite.status))
        .slice(0, 200)
        .map((invite) => ({ character: String(invite.name), realm, status: String(invite.status) }))
    }));

  // Who can craft what, and profession cooldowns (addon Modules/Recipes.lua).
  const recipeData = buildRecipes(database.recipeBook, realm);

  // SavedVariables key order is arbitrary; the ISO timestamps sort correctly.
  const exportKeys = Object.keys(database.exports ?? {}).sort();
  const exportedAt = exportKeys.at(-1) ?? new Date().toISOString();
  return {
    source: "Guilded",
    exportedAt,
    // The WoW guild this saved data belongs to ("Guild Name-Realm").
    ...(database.guildKey ? { wowGuild: String(database.guildKey) } : {}),
    ...(database.character?.name ? {
      character: {
        name: String(database.character.name),
        realm: String(database.character.realm || realm),
        class: String(database.character.class ?? ""),
        race: String(database.character.race ?? ""),
        level: Number(database.character.level) || 0,
        spec: String(database.character.spec ?? ""),
        professions: Array.isArray(database.character.professions) ? database.character.professions : []
      }
    } : {}),
    transactions,
    epgpTransactions,
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
    raids,
    loot,
    dungeonRuns
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
  const iso = (epoch) => new Date(Number(epoch) * 1000).toISOString();
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
