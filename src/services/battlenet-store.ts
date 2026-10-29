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
        const removed = retained.filter(c => c.region === discovery.region && c.gameEdition === discovery.gameEdition && !selected.includes(discoveredKey(c as DiscoveredCharacter)));
        if (removed.length) await tx.battleNetCharacter.deleteMany({ where: { identityId: identity.id, id: { in: removed.map(c => c.id) } } });
        if (main) await tx.battleNetCharacter.updateMany({ where: { identityId: identity.id, isMain: true }, data: { isMain: false } });
        for (const c of rows) {
          const key = { region: c.region, gameEdition: c.gameEdition, realmId: c.realmId, characterId: c.characterId };
          const existing = await tx.battleNetCharacter.findUnique({ where: { region_gameEdition_realmId_characterId: key } });
          if (existing && existing.identityId !== identity.id) throw new Error("A selected character belongs to another Guilded account. Resolve ownership before linking it.");
          await tx.battleNetCharacter.upsert({ where: { region_gameEdition_realmId_characterId: key },
            create: { ...c, identityId: identity.id, isMain: discoveredKey(c) === main, verifiedAt: discovery.verifiedAt },
            update: { name: c.name, realm: c.realm, verifiedAt: discovery.verifiedAt, ...(main ? { isMain: discoveredKey(c) === main } : {}) } });
        }
      }, { isolationLevel: "Serializable" });
    },
    async unlink(accountId) { await database.battleNetIdentity.deleteMany({ where: { accountId } }); }
  };
}
