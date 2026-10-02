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
import { excludeHistoryBeforeReset } from "./import-reset.js";
import { enqueueDiscordJob } from "./discord-jobs.js";
import { queueCharacterDisplayRefresh } from "./character-display-refresh.js";

// Why a row is waiting (see AddonHeldEntry). Every reason clears by itself once the cause is
// fixed, because each upload carries the whole ledger again; a dismissed row is never imported.
export type HeldReason = "UNLINKED" | "NO_CORE" | "UNKNOWN_POOL" | "NO_CORE_RAID";
export interface HeldRow { kind: "EPGP" | "DKP" | "LOOT"; sourceRef: string; character: string; reason: HeldReason; detail: string }
const signed = (value: number) => `${value >= 0 ? "+" : ""}${value}`;

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
        const settings = await tx.guildSettings.findUnique({ where: { guildId }, select: { dataResetAt: true, dungeonLeaderboardChannelId: true, craftChannelId: true, coreLootOnly: true, characterSignups: true } });
        const resetAt = settings?.dataResetAt ?? null;
        const snapshot = excludeHistoryBeforeReset(parseAddonSnapshot(imported.payload), resetAt);
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
        const held: HeldRow[] = [];
        const importedRefs: string[] = [];
        const heldStore = (tx as Partial<Pick<typeof tx, "addonHeldEntry">>).addonHeldEntry;
        const knownHeld = heldStore ? await heldStore.findMany({ where: { guildId }, select: { kind: true, sourceRef: true, dismissedAt: true } }) : [];
        const dismissed = (kind: HeldRow["kind"]) => new Set(knownHeld.filter((row) => row.kind === kind && row.dismissedAt).map((row) => row.sourceRef));
        const dismissedDkp = dismissed("DKP"), dismissedEpgp = dismissed("EPGP");

        const transactions = [];
        for (const item of snapshot.transactions) {
          const sourceRef = ledgerRef(item);
          if (alreadyImported.has(sourceRef) || dismissedDkp.has(sourceRef)) { skipped++; continue; }
          const character = findCharacter(characters, item.character, item.realm);
          if (!character) { held.push({ kind: "DKP", sourceRef, character: item.character, reason: "UNLINKED", detail: `${signed(item.amount)} DKP - ${item.reason}` }); continue; }
          alreadyImported.add(sourceRef);
          importedRefs.push(sourceRef);
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
        const validPoolIds = new Set(validPools.map((pool) => pool.id));
        // Entries voided in game (/guilded void): one not imported yet never is; one already in
        // the ledger gets a reversal, once (the same guard /epgp reverse uses).
        const voidedRefs = snapshot.epgpTransactions.filter((item) => item.voided && item.sourceRef).map(ledgerRef);
        let voided = 0;
        if (voidedRefs.length) {
          const originals = await tx.epgpTransaction.findMany({ where: { guildId, sourceRef: { in: voidedRefs } } });
          const reversed = new Set((originals.length ? await tx.epgpTransaction.findMany({
            where: { guildId, sourceRef: { in: originals.map((row) => `reversal:${row.id}`) } }, select: { sourceRef: true }
          }) : []).map((row) => row.sourceRef));
          for (const original of originals) {
            if (reversed.has(`reversal:${original.id}`)) continue;
            await tx.epgpTransaction.create({
              data: {
                guildId, memberId: original.memberId, coreId: original.coreId ?? null,
                epAmount: -original.epAmount || 0, gpAmount: -original.gpAmount || 0,
                type: "REVERSAL", reason: `Voided in game: ${original.reason}`.slice(0, 200),
                sourceRef: `reversal:${original.id}`, createdBy: appliedBy
              }
            });
            voided++;
          }
        }
        for (const item of snapshot.epgpTransactions) {
          const sourceRef = ledgerRef(item);
          if (item.voided) { if (item.sourceRef) importedRefs.push(sourceRef); continue; }
          if (alreadyImported.has(sourceRef) || dismissedEpgp.has(sourceRef)) { skipped++; continue; }
          const detail = `${[item.epAmount ? `${signed(item.epAmount)} EP` : "", item.gpAmount ? `${signed(item.gpAmount)} GP` : ""].filter(Boolean).join(", ")} - ${item.reason}`;
          const hold = (reason: HeldReason) => held.push({ kind: "EPGP", sourceRef, character: item.character, reason, detail });
          if (item.coreId && !validPoolIds.has(item.coreId)) { hold("UNKNOWN_POOL"); continue; }
          if (settings?.coreLootOnly && !item.coreId) { hold("NO_CORE"); continue; }
          const character = findCharacter(characters, item.character, item.realm);
          if (!character) { hold("UNLINKED"); continue; }
          alreadyImported.add(sourceRef);
          importedRefs.push(sourceRef);
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
        const discovery = await applyDiscoveredCharacters(tx, guildId, [...(snapshot.character ? [snapshot.character] : []), ...snapshot.alts, ...snapshot.characters], characters);

        // Readiness is best-effort: an unlinked character shouldn't block the
        // DKP/EPGP transactions in the same import from being applied.
        const readinessSnapshots = [];
        for (const entry of snapshot.readiness) {
          const character = findCharacter(characters, entry.character, entry.realm);
          if (!character) continue;
          await touchLastSeen(tx, character.id, entry.inspectedAt ?? new Date(snapshot.exportedAt));

          await syncProfessionSnapshot(tx, guildId, character, entry.professions, entry.professionsComplete === true, entry.professionsAt ?? entry.inspectedAt ?? new Date(snapshot.exportedAt));

          // An officer's export repeats every guildmate's last digest on each upload: the same
          // check (same character, same moment) is stored once, not once per upload.
          if (entry.inspectedAt && typeof tx.inspectedCharacterSnapshot.findFirst === "function"
            && await tx.inspectedCharacterSnapshot.findFirst({ where: { characterId: character.id, inspectedAt: entry.inspectedAt, source: snapshot.source }, select: { id: true } })) continue;

          readinessSnapshots.push(await tx.inspectedCharacterSnapshot.create({
            data: {
              characterId: character.id,
              memberId: character.memberId,
              source: snapshot.source,
              inspectedAt: entry.inspectedAt ?? new Date(snapshot.exportedAt),
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
        const itemPrices = await applyAddonItemPrices(tx, guildId, snapshot.itemPrices, settings?.coreLootOnly ?? false);

        // Who can craft what, and profession cooldowns.
        const crafting = await applyRecipeData(tx, guildId, { recipes: snapshot.recipes, recipeNames: snapshot.recipeNames, cooldowns: snapshot.cooldowns });

        // In-game calendar events -> which Discord raid, who answered (the signups are made after this commits).
        const calendarPlan = await planCalendarSync(tx, guildId, snapshot.calendarEvents,
          characters.map((character) => ({ id: character.id, name: character.name, realm: character.realm, memberId: character.memberId })));

        // In-game raid presence -> Discord raid attendance (best effort, like
        // readiness: an unmatched raid or character doesn't block the import).
        const raids = await applyRaidAttendance(tx, guildId, snapshot.raids, characters, appliedBy);
        const raidIds = new Map(raids.filter((raid) => raid.matchedRaidId).map((raid) => [raid.ref, raid.matchedRaidId as string]));
        const loot = await applyAddonLoot(tx, guildId, snapshot.loot, characters, raidIds, appliedBy, settings?.coreLootOnly ?? false, dismissed("LOOT"));
        for (const row of loot.held) held.push({ kind: "LOOT", sourceRef: row.ref, character: row.character, reason: "NO_CORE_RAID", detail: `${row.item}${row.gp ? ` (${row.gp} GP)` : ""}`.slice(0, 200) });

        // What is waiting is remembered (and shown with /import held); what went through, or was
        // voided, leaves the list.
        const known = new Set(knownHeld.map((row) => `${row.kind}:${row.sourceRef}`));
        const newlyHeld = held.filter((row) => !known.has(`${row.kind}:${row.sourceRef}`));
        if (heldStore) {
          const now = new Date();
          for (const row of held) {
            const data = { character: row.character.slice(0, 100), reason: row.reason, detail: row.detail.slice(0, 200), lastSeenAt: now };
            await heldStore.upsert({
              where: { guildId_kind_sourceRef: { guildId, kind: row.kind, sourceRef: row.sourceRef } },
              create: { guildId, kind: row.kind, sourceRef: row.sourceRef, ...data }, update: data
            });
          }
          const cleared = [...importedRefs, ...loot.recordedRefs].filter((ref) => knownHeld.some((row) => row.sourceRef === ref && !row.dismissedAt));
          if (cleared.length) await heldStore.deleteMany({ where: { guildId, dismissedAt: null, sourceRef: { in: cleared } } });
        }
        const dungeons = await importDungeonRuns(tx, guildId, snapshot.dungeonRuns,
          characters.map((character) => ({ name: character.name, realm: character.realm, memberId: character.memberId })), appliedBy, importId);

        await tx.addonImport.update({
          where: { id: imported.id },
          data: { status: "APPLIED" }
        });
        // The import and its public refresh requests commit together. A process crash
        // between commit and followUpImport cannot leave the display stale forever.
        if (settings?.dungeonLeaderboardChannelId) await enqueueDiscordJob(tx, guildId, "dungeon-board", "DUNGEON_BOARD");
        if (settings?.craftChannelId) await enqueueDiscordJob(tx, guildId, "professions", "PROFESSIONS");
        if (settings?.characterSignups && (readinessSnapshots.length || discovery.refreshed)) {
          const ids = new Set(readinessSnapshots.map(row => row.characterId));
          for (const entry of [...(snapshot.character ? [snapshot.character] : []), ...snapshot.alts, ...snapshot.characters]) {
            const character = findCharacter(characters, entry.name, entry.realm);
            if (character) ids.add(character.id);
          }
          await queueCharacterDisplayRefresh(tx, guildId, [...ids]);
        }
        if (calendarPlan.matches.length) await enqueueDiscordJob(tx, guildId, `calendar:${imported.id}`, "CALENDAR", { plan: JSON.parse(JSON.stringify(calendarPlan)) });
        return {
          import: imported, transactions, epgpTransactions, readinessSnapshots, attunements, consumables, reserves, itemPrices, crafting, calendarPlan, discovery, raids, loot, dungeons, skipped,
          voided, held: { rows: held, fresh: newlyHeld.length }, rejected: snapshot.rejected
        };
      }, { timeout: 60_000, maxWait: 15_000 });
    }
  };
}
