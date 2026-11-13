import { creditHeldRunPlayers } from "./dungeon-held-credit.js";
import { withEdition } from "./edition-context.js";
import { assertAddonGuildScope } from "./addon-scope.js";
import { createHash } from "node:crypto";
import { DkpTransactionType, type DkpTransaction, type EpgpTransaction, type EpgpTransactionType, type Prisma, type PrismaClient } from "../generated/prisma/client.js";
import { normalizeAddonSnapshot, parseAddonSnapshot, type AddonSnapshot } from "../integrations/addon.js";
import { deriveReadinessStatus } from "./readiness.js";
import { applyAddonLoot, applyRaidAttendance, touchLastSeen } from "./raid-import.js";
import { importDungeonRuns } from "./dungeon-import.js";
import { importBattlegroundReports } from "./battleground-records.js";
import { importDuelResults, importMilestones } from "./duels.js";
import { queueDuelCards } from "./duel-card.js";
import { buildClassBook } from "./ladder-classes.js";
import { fullNameBook } from "./character-display.js";
import { asLang } from "../i18n.js";
import { applyDiscoveredCharacters } from "./roster-discovery.js";
import { findCharacter, ledgerOwner } from "./character-match.js";
import { applyReserves } from "./reserves.js";
import { applyAddonItemPrices } from "./item-values.js";
import { syncProfessionSnapshot } from "./profession-snapshot.js";
import { applyRecipeData } from "./recipes.js";
import { planCalendarSync } from "./calendar-sync.js";
import { createSelfCharacter } from "./character-pairing.js";
import { excludeHistoryBeforeReset } from "./import-reset.js";
import { enqueueDiscordJob } from "./discord-jobs.js";
import { planSignupAnswers } from "./signup-answers.js";
import { queueCharacterDisplayRefresh } from "./character-display-refresh.js";
import { assertSnapshotEdition, gameEditionOf } from "./game-edition.js";
import { characterKey } from "../../companion/character-identity.mjs";

// Why a row is waiting (see AddonHeldEntry). Every reason clears by itself once the cause is
// fixed, because each upload carries the whole ledger again; a dismissed row is never imported.
export type HeldReason = "UNLINKED" | "NO_CORE" | "UNKNOWN_POOL" | "NO_CORE_RAID" | "SHARED_FIRST_NAME";
export interface HeldRow { kind: "EPGP" | "DKP" | "LOOT"; sourceRef: string; character: string; reason: HeldReason; detail: string }
const signed = (value: number) => `${value >= 0 ? "+" : ""}${value}`;

// Parts of an upload that only describe the present (gear digests, attunements, recipes, who is
// who) are applied again only when they changed. An officer's upload repeats every guildmate's
// digest each time, and re-applying an identical one costs hundreds of queries for nothing.
// The key includes who is linked to whom, so a newly linked character is picked up at once;
// after SECTION_MEMORY_MS everything is applied again anyway. Ledger, loot and raids are never
// skipped: they are re-checked on every upload (held rows clear themselves that way).
const SECTION_MEMORY_MS = 6 * 60 * 60_000;
const MAX_SECTION_MEMORY = 2_000;
const sectionMemory = new Map<string, { hash: string; at: number }>();
const sectionHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function forgetAppliedSections(): void { sectionMemory.clear(); }

// What stays of an applied upload: who sent it and when, plus how many rows each part held.
// retention.ts writes the same shape for older rows in SQL (without counts).
export function compactPayload(payload: unknown): Prisma.InputJsonValue {
  const source = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const counts: Record<string, number> = {};
  for (const [key, value] of Object.entries(source)) if (Array.isArray(value) && value.length) counts[key] = value.length;
  const text = (value: unknown) => typeof value === "string" || typeof value === "number" ? value : null;
  return { compacted: true, source: text(source["source"]), exportedAt: text(source["exportedAt"]) ?? (source["exportedAt"] instanceof Date ? source["exportedAt"].toISOString() : null), gameEdition: text(source["gameEdition"]), counts };
}

// Prisma's createManyAndReturn, or one create per row where it is not available (test doubles).
async function createRows<Row, Out>(store: { create: (args: { data: Row }) => Promise<Out>; createManyAndReturn?: (args: { data: Row[] }) => Promise<Out[]> }, rows: Row[]): Promise<Out[]> {
  if (rows.length === 0) return [];
  if (typeof store.createManyAndReturn === "function") return store.createManyAndReturn({ data: rows });
  const created = [];
  for (const data of rows) created.push(await store.create({ data }));
  return created;
}

/**
 * The fingerprint that decides "this export was already received". What the import itself does not use is left out, so an
 * unchanged saved file dedupes: the export stamp, and the guild roster, event log and MOTD (applied straight away by
 * guild-data.ts, whose `lastOnline` is "now minus age" and moves on every save). Everything else counts.
 */
export function snapshotChecksum(snapshot: AddonSnapshot): string {
  const rest: Record<string, unknown> = { ...snapshot };
  for (const volatile of ["exportedAt", "guildRoster", "guildEvents", "guildInfo"]) delete rest[volatile];
  return createHash("sha256").update(JSON.stringify(rest)).digest("hex");
}

export function createAddonImportService(database: PrismaClient) {
  return {
    parse(payload: unknown): AddonSnapshot {
      return normalizeAddonSnapshot(parseAddonSnapshot(payload));
    },

    async preview(guildId: string, payload: unknown, createdBy: string) {
      return this.previewSnapshot(guildId, this.parse(payload), createdBy);
    },

    // The same for a snapshot already parsed (a member's upload narrowed to their own characters).
    async previewSnapshot(guildId: string, snapshot: AddonSnapshot, createdBy: string) {
      const guild = await database.guild.findUnique({ where: { id: guildId }, select: { gameEdition: true, wowSpace: { select: { name: true, realm: true } } } });
      assertSnapshotEdition(snapshot, gameEditionOf(guild ?? {}));
      assertAddonGuildScope(snapshot, guild);
      const checksum = snapshotChecksum(snapshot);
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
      // Keep only the authenticated reporter's own battleground reports (their paired member and characters).
      const persist = async (tx: Pick<Prisma.TransactionClient, "addonImport" | "character" | "member">) => {
        let battlegroundReports: AddonSnapshot["battlegroundReports"] = [];
        if (pairedMemberId && snapshot.battlegroundReports.length) {
          const member = await tx.member.findFirst({ where: { id: pairedMemberId, guildId, status: "ACTIVE" }, select: { id: true } });
          if (member) {
            const own = await tx.character.findMany({ where: { guildId, memberId: pairedMemberId } });
            battlegroundReports = snapshot.battlegroundReports.filter(row => own.some(c => c.gameEdition === row.edition && findCharacter([c], row.character, row.realm, row.edition)));
          }
        }
        return tx.addonImport.create({
        data: {
          guildId,
          source: snapshot.source,
          checksum,
          status: "PREVIEWED",
          // Parsed from a JSON upload, so it is JSON (dungeonRuns stay unvalidated until apply).
          payload: { ...snapshot, battlegroundReports } as unknown as Prisma.InputJsonValue,
          createdBy,
          ...(pairedMemberId ? { pairedMemberId } : {})
        }
        });
      };
      if (pairedMemberId && snapshot.battlegroundReports.length) return database.$transaction(async tx => {
        // Consent changes and staging use the same guild lock; a revoke cannot
        // commit between checking permission and persisting this sensitive payload.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${guildId}, 0))`;
        return persist(tx);
      });
      return persist(database);
    },

    async apply(guildId: string, importId: string, appliedBy: string) {
      // Sections remembered as applied once the transaction has committed.
      const applied: [string, string][] = [];
      const result = await database.$transaction(async (tx) => {
        // All imports for one guild serialize, including different snapshots of the same
        // ledger. Transaction-scoped lock releases automatically on rollback/crash.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${guildId}, 0))`;
        const imported = await tx.addonImport.findFirst({ where: { id: importId, guildId } });
        if (!imported) throw new Error("Addon import not found.");
        if (imported.status === "APPLIED") throw new Error("Addon import has already been applied.");
        if (imported.status === "SUPERSEDED") throw new Error("This import was superseded by a newer upload from the same member; apply the newer one, or send this file again.");
        const applyStarted = Date.now();
        let lastSection = applyStarted;
        const sections: string[] = [];
        // Where a slow apply spends its time: one journal line (sections over 300 ms) when the whole apply takes over 3 s.
        const sec = (name: string) => { const now = Date.now(); if (now - lastSection > 300) sections.push(`${name}:${now - lastSection}`); lastSection = now; };
        const settings = await tx.guildSettings.findUnique({ where: { guildId }, select: { dataResetAt: true, dungeonLeaderboardChannelId: true, duelBoardEnabled: true, duelBoardChannelId: true, language: true, craftChannelId: true, coreLootOnly: true, characterSignups: true } });
        const resetAt = settings?.dataResetAt ?? null;
        const snapshot = excludeHistoryBeforeReset(parseAddonSnapshot(imported.payload), resetAt);
        const guild = await tx.guild.findUnique({ where: { id: guildId }, select: { gameEdition: true, wowSpace: { select: { name: true, realm: true } } } });
        assertSnapshotEdition(snapshot, gameEditionOf(guild ?? {}));
        assertAddonGuildScope(snapshot, guild);
        return withEdition(gameEditionOf(guild ?? {}), async () => {
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
        // Not for a character this member unlinked or an officer took from them: an unlink sticks.
        const declined = imported.pairedMemberId && self ? await tx.characterVerifyClaim.findFirst({
          where: { guildId, memberId: imported.pairedMemberId, nameKey: characterKey(self.name, self.realm, gameEditionOf(self)), status: { in: ["BLOCKED", "REMOVED"] } }, select: { id: true }
        }) : null;
        if (imported.pairedMemberId && self?.class && !declined && !findCharacter(characters, self.name, self.realm)) {
          const linked = await createSelfCharacter(tx, guildId, imported.pairedMemberId, self, true);
          characters.push({ ...linked, member: await tx.member.findUniqueOrThrow({ where: { id: linked.memberId } }) });
        }

        // Who uploaded and who is linked to whom: an unchanged section is skipped only while both hold.
        const uploader = imported.pairedMemberId ?? imported.createdBy;
        const links = sectionHash([resetAt?.toISOString() ?? null, ...characters.map((character) => `${character.id}:${character.memberId}:${character.name}:${character.realm}`).sort()]);
        const unchangedSections: string[] = [];
        const changed = (section: string, value: unknown) => {
          const key = `${guildId}|${uploader}|${section}`;
          const hash = sectionHash([links, value]);
          const last = sectionMemory.get(key);
          if (last && last.hash === hash && Date.now() - last.at < SECTION_MEMORY_MS) { unchangedSections.push(section); return false; }
          applied.push([key, hash]);
          return true;
        };

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

        const dkpRows: Prisma.DkpTransactionCreateManyInput[] = [];
        for (const item of snapshot.transactions) {
          const sourceRef = ledgerRef(item);
          if (alreadyImported.has(sourceRef) || dismissedDkp.has(sourceRef)) { skipped++; continue; }
          const character = ledgerOwner(characters, item.character, item.realm);
          if (character === "shared") { held.push({ kind: "DKP", sourceRef, character: item.character, reason: "SHARED_FIRST_NAME", detail: `${signed(item.amount)} DKP - ${item.reason}` }); continue; }
          if (!character) { held.push({ kind: "DKP", sourceRef, character: item.character, reason: "UNLINKED", detail: `${signed(item.amount)} DKP - ${item.reason}` }); continue; }
          alreadyImported.add(sourceRef);
          importedRefs.push(sourceRef);
          dkpRows.push({
            guildId,
            memberId: character.memberId,
            amount: item.amount,
            type: DkpTransactionType.IMPORT,
            reason: item.reason,
            sourceRef,
            createdBy: appliedBy
          });
        }
        // One insert for all new rows, not one per row.
        const transactions = await createRows<Prisma.DkpTransactionCreateManyInput, DkpTransaction>(tx.dkpTransaction as never, dkpRows);
        const epgpTransactions = [];
        const poolIds = [...new Set(snapshot.epgpTransactions.flatMap((item) => item.coreId ? [item.coreId] : []))];
        const validPools = poolIds.length ? await tx.raidCore.findMany({ where: { guildId, id: { in: poolIds }, separatePool: true }, select: { id: true } }) : [];
        const validPoolIds = new Set(validPools.map((pool) => pool.id));
        // Entries voided in game (/guilded void): one not imported yet never is; one already in
        // the ledger gets a reversal, once (the same guard /officer epgp reverse uses).
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
        const epgpRows: Prisma.EpgpTransactionCreateManyInput[] = [];
        for (const item of snapshot.epgpTransactions) {
          const sourceRef = ledgerRef(item);
          if (item.voided) { if (item.sourceRef) importedRefs.push(sourceRef); continue; }
          if (alreadyImported.has(sourceRef) || dismissedEpgp.has(sourceRef)) { skipped++; continue; }
          const detail = `${[item.epAmount ? `${signed(item.epAmount)} EP` : "", item.gpAmount ? `${signed(item.gpAmount)} GP` : ""].filter(Boolean).join(", ")} - ${item.reason}`;
          const hold = (reason: HeldReason) => held.push({ kind: "EPGP", sourceRef, character: item.character, reason, detail });
          if (item.coreId && !validPoolIds.has(item.coreId)) { hold("UNKNOWN_POOL"); continue; }
          if (settings?.coreLootOnly && !item.coreId) { hold("NO_CORE"); continue; }
          // WoW Forever, 8.5: a pre-8.5 first name goes to the member when all its characters are theirs.
          const character = ledgerOwner(characters, item.character, item.realm);
          if (character === "shared") { hold("SHARED_FIRST_NAME"); continue; }
          if (!character) { hold("UNLINKED"); continue; }
          alreadyImported.add(sourceRef);
          importedRefs.push(sourceRef);
          epgpRows.push({
            guildId,
            memberId: character.memberId,
            coreId: item.coreId ?? null,
            epAmount: item.epAmount,
            gpAmount: item.gpAmount,
            type: item.type as EpgpTransactionType,
            reason: item.reason,
            sourceRef,
            createdBy: appliedBy
          });
        }
        epgpTransactions.push(...await createRows<Prisma.EpgpTransactionCreateManyInput, EpgpTransaction>(tx.epgpTransaction as never, epgpRows));

        // Everyone the addons have revealed (the exporter and every guildmate
        // whose digest reached them): linked characters are refreshed (class,
        // race, level, spec, professions), the rest are remembered as
        // unclaimed until they are linked. Never creates a linked character.
        const discoveredEntries = [...(snapshot.character ? [snapshot.character] : []), ...snapshot.alts, ...snapshot.characters];
        const discovery = changed("characters", discoveredEntries)
          ? await applyDiscoveredCharacters(tx, guildId, discoveredEntries, characters)
          : { refreshed: 0, discovered: 0 };

        // Readiness is best-effort: an unlinked character shouldn't block the
        // DKP/EPGP transactions in the same import from being applied.
        sec("ledger-discovery");
        const readinessSnapshots = [];
        const readiness = changed("readiness", snapshot.readiness) ? snapshot.readiness : [];
        // Which of these checks are stored already, in one query instead of one per entry.
        const readinessIds = [...new Set(readiness.flatMap((entry) => { const character = findCharacter(characters, entry.character, entry.realm); return character && entry.inspectedAt ? [character.id] : []; }))];
        const storedChecks = readinessIds.length && typeof tx.inspectedCharacterSnapshot.findMany === "function"
          ? new Set((await tx.inspectedCharacterSnapshot.findMany({ where: { characterId: { in: readinessIds }, source: snapshot.source }, select: { characterId: true, inspectedAt: true } }) ?? [])
            .map((row) => `${row.characterId}|${row.inspectedAt.toISOString()}`))
          : null;
        for (const entry of readiness) {
          const character = findCharacter(characters, entry.character, entry.realm);
          if (!character) continue;
          await touchLastSeen(tx, character.id, entry.inspectedAt ?? new Date(snapshot.exportedAt));

          await syncProfessionSnapshot(tx, guildId, character, entry.professions, entry.professionsComplete === true, entry.professionsAt ?? entry.inspectedAt ?? new Date(snapshot.exportedAt));

          // An officer's export repeats every guildmate's last digest on each upload: the same
          // check (same character, same moment) is stored once, not once per upload.
          if (entry.inspectedAt && storedChecks?.has(`${character.id}|${entry.inspectedAt.toISOString()}`)) continue;
          if (entry.inspectedAt && !storedChecks && typeof tx.inspectedCharacterSnapshot.findFirst === "function"
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

        sec("readiness");
        // Attunements are self- or officer-reported, not financial — same
        // best-effort matching as readiness.
        const attunements = [];
        for (const entry of changed("attunements", snapshot.attunements) ? snapshot.attunements : []) {
          const character = findCharacter(characters, entry.character, entry.realm);
          if (!character) continue;
          attunements.push(await tx.characterAttunement.upsert({
            where: { characterId_name: { characterId: character.id, name: entry.name } },
            create: { characterId: character.id, name: entry.name, completed: entry.completed, source: snapshot.source, completedAt: new Date() },
            update: { completed: entry.completed, source: snapshot.source, completedAt: new Date() }
          }));
        }

        sec("attunements");
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

        sec("consumables");
        // The soft-reserve list from the addon replaces the bot's copy when it is newer.
        const reserves = await applyReserves(tx, guildId, snapshot.reserves);

        // Prices officers set in game: kept unless Discord changed that price more recently.
        const itemPrices = await applyAddonItemPrices(tx, guildId, snapshot.itemPrices, settings?.coreLootOnly ?? false);

        // Who can craft what, and profession cooldowns.
        const recipeInput = { recipes: snapshot.recipes, recipeNames: snapshot.recipeNames, cooldowns: snapshot.cooldowns };
        const crafting = changed("recipes", recipeInput)
          ? await applyRecipeData(tx, guildId, recipeInput)
          : { recipeSets: 0, recipes: 0, cooldownSets: 0 };

        sec("reserves-prices-recipes");
        // In-game calendar events -> which Discord raid, who answered (the signups are made after this commits).
        const calendarPlan = await planCalendarSync(tx, guildId, snapshot.calendarEvents,
          characters.map((character) => ({ id: character.id, name: character.name, realm: character.realm, memberId: character.memberId })));

        // Raid answers given in game (Signups page): only for the exporter's own characters, applied after
        // this commits. The latest change wins per member (services/signup-answers).
        const own = [...(snapshot.character ? [snapshot.character] : []), ...snapshot.alts].map(character => ({ name: character.name, realm: character.realm }));
        const signupJobs = planSignupAnswers(snapshot.signupAnswers.filter(answer => findCharacter(own, answer.character, answer.realm)),
          characters.map((character) => ({ id: character.id, name: character.name, realm: character.realm, memberId: character.memberId })));

        // In-game raid presence -> Discord raid attendance (best effort, like
        // readiness: an unmatched raid or character doesn't block the import).
        const raids = await applyRaidAttendance(tx, guildId, snapshot.raids, characters, appliedBy);
        const raidIds = new Map(raids.filter((raid) => raid.matchedRaidId).map((raid) => [raid.ref, raid.matchedRaidId as string]));
        const loot = await applyAddonLoot(tx, guildId, snapshot.loot, characters, raidIds, appliedBy, settings?.coreLootOnly ?? false, dismissed("LOOT"));
        for (const row of loot.held) held.push({ kind: "LOOT", sourceRef: row.ref, character: row.character, reason: "NO_CORE_RAID", detail: `${row.item}${row.gp ? ` (${row.gp} GP)` : ""}`.slice(0, 200) });

        sec("calendar-raids-loot");
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
        // Guildmates who linked since their run was stored get their credit now (held credit).
        await creditHeldRunPlayers(tx, guildId, characters, appliedBy);
        const dungeons = await importDungeonRuns(tx, guildId, snapshot.dungeonRuns,
          characters.map((character) => ({ name: character.name, realm: character.realm, memberId: character.memberId, spec: character.spec, discordId: character.member?.discordUserId ?? null, displayName: (character as { displayName?: string | null }).displayName ?? null })), appliedBy, importId);
        const battlegrounds = await importBattlegroundReports(tx, guildId, imported.pairedMemberId, snapshot.battlegroundReports);
        // Duels and milestones come only from a paired member's own companion (never an officer's whole-guild upload).
        const guildEdition = gameEditionOf(guild ?? {});
        const duels = await importDuelResults(tx, guildId, guildEdition, imported.pairedMemberId, characters.map((character) => ({ id: character.id, name: character.name, realm: character.realm, memberId: character.memberId, level: character.level })), snapshot.duelResults);
        const milestones = await importMilestones(tx, guildId, guildEdition, imported.pairedMemberId, characters.filter((character) => character.memberId === imported.pairedMemberId), snapshot.milestones);

        sec("held-dungeons-duels");
        await tx.addonImport.update({
          where: { id: imported.id },
          // Everything in the payload is now in the ledger tables; only a summary stays (checksum and source
          // remain on the row for duplicate detection). Raw payloads were ~97% of the database JSON (9 Nov 2026).
          data: { status: "APPLIED", payload: compactPayload(imported.payload) }
        });
        // The import and its public refresh requests commit together. A process crash
        // between commit and followUpImport cannot leave the display stale forever.
        if (settings?.dungeonLeaderboardChannelId) await enqueueDiscordJob(tx, guildId, "dungeon-board", "DUNGEON_BOARD");
        if (duels.recorded && settings?.duelBoardEnabled && settings.duelBoardChannelId) await enqueueDiscordJob(tx, guildId, "duel-board", "DUEL_BOARD");
        // 9.3: one card per newly counted duel, in the duel channel (same switch as the board).
        if (duels.fresh.length && settings?.duelBoardEnabled && settings.duelBoardChannelId) {
          await queueDuelCards(tx, guildId, guildEdition, settings.duelBoardChannelId, asLang(settings.language), duels.fresh, buildClassBook(characters), fullNameBook(characters));
        }
        if (settings?.craftChannelId) await enqueueDiscordJob(tx, guildId, "professions", "PROFESSIONS");
        if (settings?.characterSignups && (readinessSnapshots.length || discovery.refreshed)) {
          const ids = new Set(readinessSnapshots.map(row => row.characterId));
          for (const entry of [...(snapshot.character ? [snapshot.character] : []), ...snapshot.alts, ...snapshot.characters]) {
            const character = findCharacter(characters, entry.name, entry.realm);
            if (character) ids.add(character.id);
          }
          await queueCharacterDisplayRefresh(tx, guildId, [...ids]);
        }
        if (signupJobs.length) await enqueueDiscordJob(tx, guildId, `signup-answers:${imported.id}`, "SIGNUP_ANSWERS", { answers: JSON.parse(JSON.stringify(signupJobs)) });
        if (calendarPlan.matches.length) await enqueueDiscordJob(tx, guildId, `calendar:${imported.id}`, "CALENDAR", { plan: JSON.parse(JSON.stringify(calendarPlan)) });
        if (Date.now() - applyStarted > 3_000) { sec("enqueue"); console.info(`import-apply-sections import=${imported.id.slice(-8)} total=${Date.now() - applyStarted} ${sections.join(",") || "-"}`); }
        return {
          import: imported, transactions, epgpTransactions, readinessSnapshots, attunements, consumables, reserves, itemPrices, crafting, calendarPlan, discovery, raids, loot, dungeons, battlegrounds, duels, milestones, skipped,
          voided, held: { rows: held, fresh: newlyHeld.length }, rejected: snapshot.rejected, unchangedSections
        };
        });
      }, { timeout: 60_000, maxWait: 15_000 });
      const now = Date.now();
      for (const [key, hash] of applied) {
        sectionMemory.delete(key);
        sectionMemory.set(key, { hash, at: now });
      }
      while (sectionMemory.size > MAX_SECTION_MEMORY) {
        const oldest = sectionMemory.keys().next().value;
        if (oldest === undefined) break;
        sectionMemory.delete(oldest);
      }
      return result;
    }
  };
}
