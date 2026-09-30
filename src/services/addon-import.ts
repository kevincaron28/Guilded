import { createHash } from "node:crypto";
import { DkpTransactionType, type EpgpTransactionType, type Prisma, type PrismaClient } from "@prisma/client";
import { normalizeAddonSnapshot, parseAddonSnapshot, type AddonSnapshot } from "../integrations/addon.js";
import { deriveReadinessStatus } from "./readiness.js";
import { applyAddonLoot, applyRaidAttendance, touchLastSeen } from "./raid-import.js";
import { importDungeonRuns } from "./dungeon-import.js";
import { applyDiscoveredCharacters } from "./roster-discovery.js";
import { findCharacter } from "./character-match.js";
import { applyReserves } from "./reserves.js";
import { applyAddonItemPrices } from "./item-values.js";
import { syncProfessionSnapshot } from "./profession-snapshot.js";
import { applyRecipeData } from "./recipes.js";
import { planCalendarSync } from "./calendar-sync.js";
import { createSelfCharacter } from "./character-pairing.js";

export function createAddonImportService(database: PrismaClient) {
  return {
    parse(payload: unknown): AddonSnapshot {
      return normalizeAddonSnapshot(parseAddonSnapshot(payload));
    },

    async preview(guildId: string, payload: unknown, createdBy: string) {
      const snapshot = this.parse(payload);
      const checksum = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
      const existing = await database.addonImport.findFirst({ where: { guildId, checksum } });
      return {
        snapshot,
        checksum,
        duplicate: existing !== null,
        existingImport: existing ? { id: existing.id, status: existing.status } : null,
        transactionCount: snapshot.transactions.length + snapshot.epgpTransactions.length,
        createdBy
      };
    },

    async record(guildId: string, snapshot: AddonSnapshot, checksum: string, createdBy: string, pairedMemberId?: string) {
      return database.addonImport.create({
        data: {
          guildId,
          source: snapshot.source,
          checksum,
          status: "PREVIEWED",
          // Parsed from a JSON upload, so it is JSON (dungeonRuns stay unvalidated until apply).
          payload: snapshot as unknown as Prisma.InputJsonValue,
          createdBy,
          ...(pairedMemberId ? { pairedMemberId } : {})
        }
      });
    },

    async apply(guildId: string, importId: string, appliedBy: string) {
      return database.$transaction(async (tx) => {
        // All imports for one guild serialize, including different snapshots of the same
        // ledger. Transaction-scoped lock releases automatically on rollback/crash.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${guildId}, 0))`;
        const imported = await tx.addonImport.findFirst({ where: { id: importId, guildId } });
        if (!imported) throw new Error("Addon import not found.");
        if (imported.status === "APPLIED") throw new Error("Addon import has already been applied.");
        const snapshot = parseAddonSnapshot(imported.payload);
        const characters = await tx.character.findMany({
          where: { member: { guildId } },
          include: { member: true }
        });

        // A paired companion attests only to the exporter's own character;
        // guildmate characters in the same digest still use the normal claim flow.
        // (Ordinarily already linked at upload time by linkPairedCharacter; this
        // is a safety net for e.g. a name that was owned by someone else then,
        // freed since, and only now being applied.)
        const self = snapshot.character;
        if (imported.pairedMemberId && self?.class && !findCharacter(characters, self.name, self.realm)) {
          const linked = await createSelfCharacter(tx, guildId, imported.pairedMemberId, self);
          characters.push({ ...linked, member: await tx.member.findUniqueOrThrow({ where: { id: linked.memberId } }) });
        }

        // Each addon export carries the officer's WHOLE ledger, not just new
        // entries. Entries with a stable ref are keyed `addon:<ref>` and skipped
        // when already imported, so re-importing next week doesn't double
        // everyone's EP/GP. Entries without a ref keep the old per-import key.
        const ledgerRef = (item: { sourceRef?: string | undefined; character: string }) =>
          item.sourceRef ? `addon:${item.sourceRef}` : `addon:${importId}:${item.character}`;
        const candidateRefs = [...snapshot.transactions, ...snapshot.epgpTransactions]
          .filter((item) => item.sourceRef)
          .map(ledgerRef);
        const [existingDkp, existingEpgp] = await Promise.all([
          tx.dkpTransaction.findMany({ where: { guildId, sourceRef: { in: candidateRefs } }, select: { sourceRef: true } }),
          tx.epgpTransaction.findMany({ where: { guildId, sourceRef: { in: candidateRefs } }, select: { sourceRef: true } })
        ]);
        const alreadyImported = new Set([...existingDkp, ...existingEpgp].map((row) => row.sourceRef));
        let skipped = 0;

        const transactions = [];
        for (const item of snapshot.transactions) {
          const sourceRef = ledgerRef(item);
          if (alreadyImported.has(sourceRef)) { skipped++; continue; }
          alreadyImported.add(sourceRef);
          const character = findCharacter(characters, item.character, item.realm);
          if (!character) throw new Error(`No linked character found for ${item.character} (${item.realm}).`);
          transactions.push(await tx.dkpTransaction.create({
            data: {
              guildId,
              memberId: character.memberId,
              amount: item.amount,
              type: DkpTransactionType.IMPORT,
              reason: item.reason,
              sourceRef,
              createdBy: appliedBy
            }
          }));
        }
        const epgpTransactions = [];
        const poolIds = [...new Set(snapshot.epgpTransactions.flatMap((item) => item.coreId ? [item.coreId] : []))];
        const validPools = poolIds.length ? await tx.raidCore.findMany({ where: { guildId, id: { in: poolIds }, separatePool: true }, select: { id: true } }) : [];
        if (poolIds.some((id) => !validPools.some((pool) => pool.id === id))) throw new Error("Unknown or inactive core point pool. Ask an officer to review this import.");
        for (const item of snapshot.epgpTransactions) {
          const sourceRef = ledgerRef(item);
          if (alreadyImported.has(sourceRef)) { skipped++; continue; }
          alreadyImported.add(sourceRef);
          const character = findCharacter(characters, item.character, item.realm);
          if (!character) throw new Error(`No linked character found for ${item.character} (${item.realm}).`);
          epgpTransactions.push(await tx.epgpTransaction.create({
            data: {
              guildId,
              memberId: character.memberId,
              coreId: item.coreId ?? null,
              epAmount: item.epAmount,
              gpAmount: item.gpAmount,
              type: item.type as EpgpTransactionType,
              reason: item.reason,
              sourceRef,
              createdBy: appliedBy
            }
          }));
        }

        // Everyone the addons have revealed (the exporter and every guildmate
        // whose digest reached them): linked characters are refreshed (class,
        // race, level, spec, professions), the rest are remembered as
        // unclaimed until they are linked. Never creates a linked character.
        const discovery = await applyDiscoveredCharacters(tx, guildId, [...(snapshot.character ? [snapshot.character] : []), ...snapshot.characters], characters);

        // Readiness is best-effort: an unlinked character shouldn't block the
        // DKP/EPGP transactions in the same import from being applied.
        const readinessSnapshots = [];
        for (const entry of snapshot.readiness) {
          const character = findCharacter(characters, entry.character, entry.realm);
          if (!character) continue;
          await touchLastSeen(tx, character.id, entry.inspectedAt ?? new Date(snapshot.exportedAt));

          await syncProfessionSnapshot(tx, guildId, character, entry.professions, entry.professionsComplete === true, entry.professionsAt ?? entry.inspectedAt ?? new Date(snapshot.exportedAt));

          readinessSnapshots.push(await tx.inspectedCharacterSnapshot.create({
            data: {
              characterId: character.id,
              memberId: character.memberId,
              source: snapshot.source,
              status: deriveReadinessStatus(entry.findings),
              itemLevel: entry.itemLevel ?? null,
              rawPayload: JSON.parse(JSON.stringify(entry)),
              items: {
                create: entry.items.map((item) => ({
                  slot: item.slot,
                  itemName: item.itemName,
                  itemId: item.itemId ?? null,
                  itemLevel: item.itemLevel ?? null,
                  durability: item.durability ?? null,
                  enchants: {
                    create: item.enchants.map((enchant) => ({
                      slot: enchant.slot,
                      name: enchant.name,
                      enchantId: enchant.enchantId ?? null
                    }))
                  }
                }))
              },
              consumables: {
                create: entry.consumables.map((consumable) => ({
                  name: consumable.name,
                  quantity: consumable.quantity,
                  category: consumable.category ?? null
                }))
              },
              findings: {
                create: entry.findings.map((finding) => ({
                  code: finding.code,
                  severity: finding.severity,
                  message: finding.message
                }))
              }
            }
          }));
        }

        // Attunements are self- or officer-reported, not financial — same
        // best-effort matching as readiness.
        const attunements = [];
        for (const entry of snapshot.attunements) {
          const character = findCharacter(characters, entry.character, entry.realm);
          if (!character) continue;
          attunements.push(await tx.characterAttunement.upsert({
            where: { characterId_name: { characterId: character.id, name: entry.name } },
            create: { characterId: character.id, name: entry.name, completed: entry.completed, source: snapshot.source, completedAt: new Date() },
            update: { completed: entry.completed, source: snapshot.source, completedAt: new Date() }
          }));
        }

        // The officer's last /guilded consumes scan: newest result per character wins.
        let consumables = 0;
        if (snapshot.consumeScan) {
          const scan = snapshot.consumeScan;
          for (const player of scan.players) {
            const existing = await tx.consumableCheck.findUnique({
              where: { guildId_character_realm: { guildId, character: player.character, realm: player.realm } }
            });
            if (existing && existing.scannedAt >= scan.at) continue;
            const data = {
              flask: player.flask ?? null, elixirs: player.elixirs, food: player.food ?? null,
              weapon: player.weapon ?? null, scannedAt: scan.at, scannedBy: scan.by
            };
            await tx.consumableCheck.upsert({
              where: { guildId_character_realm: { guildId, character: player.character, realm: player.realm } },
              create: { guildId, character: player.character, realm: player.realm, ...data },
              update: data
            });
            consumables++;
          }
        }

        // The soft-reserve list from the addon replaces the bot's copy when it is newer.
        const reserves = await applyReserves(tx, guildId, snapshot.reserves);

        // Prices officers set in game: kept unless Discord changed that price more recently.
        const itemPrices = await applyAddonItemPrices(tx, guildId, snapshot.itemPrices);

        // Who can craft what, and profession cooldowns.
        const crafting = await applyRecipeData(tx, guildId, { recipes: snapshot.recipes, recipeNames: snapshot.recipeNames, cooldowns: snapshot.cooldowns });

        // In-game calendar events -> which Discord raid, who answered (the signups are made after this commits).
        const calendarPlan = await planCalendarSync(tx, guildId, snapshot.calendarEvents,
          characters.map((character) => ({ id: character.id, name: character.name, realm: character.realm, memberId: character.memberId })));

        // In-game raid presence -> Discord raid attendance (best effort, like
        // readiness: an unmatched raid or character doesn't block the import).
        const raids = await applyRaidAttendance(tx, guildId, snapshot.raids, characters, appliedBy);
        const raidIds = new Map(raids.filter((raid) => raid.matchedRaidId).map((raid) => [raid.ref, raid.matchedRaidId as string]));
        const loot = await applyAddonLoot(tx, guildId, snapshot.loot, characters, raidIds, appliedBy);
        const dungeons = await importDungeonRuns(tx, guildId, snapshot.dungeonRuns,
          characters.map((character) => ({ name: character.name, realm: character.realm, memberId: character.memberId })), appliedBy, importId);

        await tx.addonImport.update({
          where: { id: imported.id },
          data: { status: "APPLIED" }
        });
        return { import: imported, transactions, epgpTransactions, readinessSnapshots, attunements, consumables, reserves, itemPrices, crafting, calendarPlan, discovery, raids, loot, dungeons, skipped };
      }, { timeout: 60_000, maxWait: 15_000 });
    }
  };
}
