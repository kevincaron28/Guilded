// Read-only re-check of Blizzard's API for WoW Forever profiles (docs/FOREVER_ARMORY.md, "API probe").
// Run on a machine that has the bot's Battle.net app in the environment, for example on the server:
//   sudo node scripts/forever-armory-probe.mjs /opt/guilded/.env.local [character-slug]
// Prints HTTP statuses, field names and public fields only. Never prints the client id, secret or token.
import { readFileSync } from "node:fs";

const envFile = process.argv[2];
const slug = process.argv[3] ?? "lebowski-holyroller";
const fromFile = envFile ? Object.fromEntries(readFileSync(envFile, "utf8").split(/\r?\n/).filter(line => /^[A-Z_]+=/.test(line))
  .map(line => { const at = line.indexOf("="); return [line.slice(0, at), line.slice(at + 1).trim().replace(/^"|"$/g, "")]; })) : {};
const id = process.env.BATTLENET_CLIENT_ID || fromFile.BATTLENET_CLIENT_ID;
const secret = process.env.BATTLENET_CLIENT_SECRET || fromFile.BATTLENET_CLIENT_SECRET;
if (!id || !secret) { console.log("No BATTLENET_CLIENT_ID / BATTLENET_CLIENT_SECRET found."); process.exit(1); }

const tokenResponse = await fetch("https://oauth.battle.net/token", { method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}` },
  body: "grant_type=client_credentials" });
const token = (await tokenResponse.json()).access_token;
console.log("token", tokenResponse.status, token ? "ok" : "missing");
if (!token) process.exit(1);

async function api(path, namespace, extra = {}) {
  const url = new URL(path, "https://us.api.blizzard.com");
  url.search = new URLSearchParams({ namespace, locale: "en_US", ...extra }).toString();
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  let body = null;
  try { body = await response.json(); } catch { /* not json */ }
  return { status: response.status, body };
}
const show = (label, { status, body }, pick = value => Object.keys(value ?? {})) =>
  console.log(label.padEnd(44), status, status === 200 ? JSON.stringify(pick(body)).slice(0, 300) : "");

show("static item 19019", await api("/data/wow/item/19019", "static-forever-us"), body => body.name);
show("region index (dynamic)", await api("/data/wow/region/index", "dynamic-forever-us"), body => body.regions?.length);
show("realm index (dynamic)", await api("/data/wow/realm/index", "dynamic-forever-us"), body => (body.realms ?? []).map(realm => realm.slug));
show("realm search (dynamic)", await api("/data/wow/search/realm", "dynamic-forever-us"), body => body.results?.length);
const realms = (await api("/data/wow/realm/index", "dynamic-forever-us")).body?.realms ?? [];
for (const realm of realms.slice(0, 5)) {
  const base = `/profile/wow/character/${realm.slug}/${encodeURIComponent(slug)}`;
  show(`profile ${realm.slug}/${slug}`, await api(base, "profile-forever-us"), body => ({ level: body.level, class: body.character_class?.name, guild: body.guild?.name }));
  for (const part of ["equipment", "character-media", "achievements", "professions"]) show(`  ${part}`, await api(`${base}/${part}`, "profile-forever-us"));
}
if (!realms.length) console.log("No Forever realm is listed, so character profiles cannot be addressed yet.");
