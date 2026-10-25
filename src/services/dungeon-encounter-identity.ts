import { dungeonCatalog } from "../../companion/dungeon-catalog.mjs";

const identities = new Map<string, string | null>();
for (const route of dungeonCatalog.routes) for (const raw of [...route.requiredEncounters,route.completion]) {
  const boss = raw as {ids:number[];npcIds?:number[]};
  const canonical = boss.ids.length ? `encounter:${boss.ids[0]}` : `npc:${boss.npcIds![0]}`;
  for (const [kind,ids] of [["encounter",boss.ids],["npc",boss.npcIds ?? []]] as const) for (const id of ids) {
    const key = `${route.edition}/${route.instanceId}/${route.difficultyId}/${kind}:${id}`;
    if (!identities.has(key)) identities.set(key,canonical);
    else if (identities.get(key) !== canonical) identities.set(key,null);
  }
}
/** Reconcile Classic NPC-death and encounter notifications without crossing ID namespaces. */
export function encounterKey(e: { id: number; kind?: "npc" }, run: { instanceId: number; difficultyId: number }, edition: string): string {
  const fallback = `${e.kind ?? "encounter"}:${e.id}`;
  return identities.get(`${edition}/${run.instanceId}/${run.difficultyId}/${fallback}`) ?? fallback;
}
