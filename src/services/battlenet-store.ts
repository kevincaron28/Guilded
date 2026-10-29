import type { PrismaClient } from "../generated/prisma/client.js";
import { discoveredKey, type BattleNetDiscovery, type DiscoveredCharacter } from "./battlenet.js";

export interface LinkedBattleNet { subject: string; battleTag: string; characters: (DiscoveredCharacter & { isMain: boolean; verifiedAt: Date })[] }
export interface BattleNetStore {
  get(accountId: string): Promise<LinkedBattleNet | null>;
  save(accountId: string, discovery: BattleNetDiscovery, selected: string[], main: string | null): Promise<void>;
  unlink(accountId: string): Promise<void>;
}
export function selectDiscovered(discovery: BattleNetDiscovery, selected: string[], main: string | null) {
  const keys = new Set(selected);
  if (keys.size !== selected.length || keys.size > 500 || main && !keys.has(main)) throw new Error("Choose a main from the selected characters.");
  const rows = discovery.characters.filter(c => keys.has(discoveredKey(c)));
  if (rows.length !== keys.size) throw new Error("The character selection expired or is invalid. Discover characters again.");
  return rows;
}
export function prismaBattleNetStore(database: PrismaClient): BattleNetStore {
  return {
    async get(accountId) {
      const row = await database.battleNetIdentity.findUnique({ where: { accountId }, include: { characters: { orderBy: [{ isMain: "desc" }, { name: "asc" }] } } });
      return row as LinkedBattleNet | null;
    },
    async save(accountId, discovery, selected, main) {
      const rows = selectDiscovered(discovery, selected, main);
      await database.$transaction(async tx => {
        const byAccount = await tx.battleNetIdentity.findUnique({ where: { accountId } });
        const bySubject = await tx.battleNetIdentity.findUnique({ where: { subject: discovery.subject } });
        if (bySubject && bySubject.accountId !== accountId) throw new Error("This Battle.net account is already linked to another Guilded account.");
        if (byAccount && byAccount.subject !== discovery.subject) throw new Error("Disconnect the previous Battle.net account before choosing another.");
        const identity = await tx.battleNetIdentity.upsert({ where: { accountId }, create: { accountId, subject: discovery.subject, battleTag: discovery.battleTag }, update: { battleTag: discovery.battleTag } });
        const retained = await tx.battleNetCharacter.findMany({ where: { identityId: identity.id } });
        const previous = new Map(retained.map(c => [discoveredKey(c as DiscoveredCharacter), c]));
        if (main) await tx.battleNetCharacter.updateMany({ where: { identityId: identity.id, isMain: true }, data: { isMain: false } });
        // Replace only this identity's selected region/edition in two round trips.
        // Per-character reads/upserts exceed Prisma's transaction deadline over
        // a remote database. Preserve row IDs and the existing main on refresh.
        // The global character unique constraint rejects foreign ownership and
        // rolls back this whole transaction; never skip duplicates or transfer it.
        await tx.battleNetCharacter.deleteMany({ where: { identityId: identity.id, region: discovery.region, gameEdition: discovery.gameEdition } });
        if (rows.length) await tx.battleNetCharacter.createMany({ data: rows.map(c => {
          const old = previous.get(discoveredKey(c));
          return { ...c, ...(old ? { id: old.id } : {}), identityId: identity.id,
            isMain: main ? discoveredKey(c) === main : old?.isMain ?? false, verifiedAt: discovery.verifiedAt };
        }) });
      }, { isolationLevel: "Serializable" });
    },
    async unlink(accountId) { await database.battleNetIdentity.deleteMany({ where: { accountId } }); }
  };
}
