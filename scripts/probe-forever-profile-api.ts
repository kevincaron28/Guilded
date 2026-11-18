// Battle.net WoW Forever profile watch (docs/plans/BATTLENET_FOREVER_PROFILES.md). Read-only: asks Blizzard's API which Forever
// namespaces and routes answer, and reports "still closed" or "open: build the profile features". Run it by hand or from a schedule:
//   npx tsx scripts/probe-forever-profile-api.ts [character-slug]
// Uses the bot's existing Battle.net application (BATTLENET_CLIENT_ID / BATTLENET_CLIENT_SECRET, docs/BATTLENET_SETUP.md) from the
// environment or .env.local. Never prints the client id, the secret or the token, and never writes anything.
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: ".env.local", quiet: true });
const id = process.env["BATTLENET_CLIENT_ID"];
const secret = process.env["BATTLENET_CLIENT_SECRET"];
if (!id || !secret) {
  console.log("No BATTLENET_CLIENT_ID / BATTLENET_CLIENT_SECRET in the environment or .env.local (docs/BATTLENET_SETUP.md). Nothing was checked.");
  process.exit(2);
}
const slug = (process.argv[2] ?? "lebowski-holyroller").toLowerCase();
const HOST = "https://us.api.blizzard.com";

const tokenResponse = await fetch("https://oauth.battle.net/token", { method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}` }, body: "grant_type=client_credentials" });
const token = ((await tokenResponse.json().catch(() => ({}))) as { access_token?: string }).access_token;
console.log(`token (client credentials): ${tokenResponse.status}${token ? " ok" : " missing"}`);
if (!token) process.exit(2);

interface Answer { status: number; body: unknown }
async function api(path: string, namespace: string, extra: Record<string, string> = {}): Promise<Answer> {
  const url = new URL(path, HOST);
  url.search = new URLSearchParams({ namespace, locale: "en_US", ...extra }).toString();
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } }).catch(() => null);
  if (!response) return { status: 0, body: null };
  return { status: response.status, body: await response.json().catch(() => null) };
}
const rows: { label: string; status: number; note: string }[] = [];
const record = (label: string, answer: Answer, note = "") => { rows.push({ label, status: answer.status, note: answer.status === 200 ? note : "" }); return answer; };
const field = (body: unknown, ...path: string[]) => path.reduce<unknown>((value, key) => (value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined), body);

record("static item (static-forever-us)", await api("/data/wow/item/19019", "static-forever-us"), "works (item previews use it)");
record("region index (dynamic-forever-us)", await api("/data/wow/region/index", "dynamic-forever-us"));
const realmIndex = record("realm index (dynamic-forever-us)", await api("/data/wow/realm/index", "dynamic-forever-us"), "lists realms");
record("connected realm index (dynamic-forever-us)", await api("/data/wow/connected-realm/index", "dynamic-forever-us"));
const search = record("realm search (profile-forever-us)", await api("/data/wow/search/realm", "profile-forever-us"));
const realms = [...((field(realmIndex.body, "realms") as { slug?: string }[] | undefined) ?? []), ...((field(search.body, "results") as { data?: { slug?: string } }[] | undefined)?.map((r) => r.data ?? {}) ?? [])]
  .map((realm) => realm.slug).filter((value): value is string => typeof value === "string");
const realmList = [...new Set(realms)].slice(0, 5);
let profileOpen = false;
for (const realm of realmList) {
  const base = `/profile/wow/character/${realm}/${encodeURIComponent(slug)}`;
  const profile = record(`character ${realm}/${slug} (profile-forever-us)`, await api(base, "profile-forever-us"), "answers");
  if (profile.status === 200) profileOpen = true;
  for (const part of ["equipment", "specializations", "professions", "achievements"]) record(`  ${part}`, await api(`${base}/${part}`, "profile-forever-us"));
  record(`guild lookup via realm ${realm}`, await api(`/data/wow/guild/${realm}/quebec-gold`, "profile-forever-us"));
}
if (!realmList.length) rows.push({ label: "character and guild routes", status: 0, note: "not tried: no Forever realm is listed to address them" });
// The member's own list needs a signed-in user's token, so it cannot be tried here: it is the first call to test once the above opens.
rows.push({ label: "account profile (/profile/user/wow?namespace=profile-forever-us)", status: 0, note: "needs a member's Battle.net sign-in; not tried" });

for (const row of rows) console.log(`${row.label.padEnd(64)} ${row.status ? row.status : "-"}${row.note ? `  ${row.note}` : ""}`);
const opened = profileOpen || realmList.length > 0;
console.log(opened
  ? "\nOPEN: Forever realms or profiles answer. Follow docs/plans/BATTLENET_FOREVER_PROFILES.md (ownership check first)."
  : "\nCLOSED: Blizzard still has no Forever profile data. Nothing to build yet; check again after the next client patch or on 9 December.");
process.exit(opened ? 0 : 1);
