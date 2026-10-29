# RCLootCouncil and Gargul loot-history import

The desktop companion converts an export into a local GLH1 archive. An officer then previews and confirms it in-game. Historical records are stored separately from live loot and EP/GP; importing never replays awards, changes points, or uploads the source history to Discord.

## Supported exports and limits

- RCLootCouncil: CSV or JSON from Loot History → Export.
- Gargul: JSON (preferred) or TMB CSV, including the version with realms. JSON preserves original item IDs and timestamps. TMB CSV has day-only dates and Gargul substitutes certain token item IDs for TMB compatibility.

Custom Gargul formats, compressed strings, Lua SavedVariables, and ambiguous old day/month/year dates are rejected. Source files are limited to 2 MB and 5,000 awards. The encoded archive payload is limited to 290,000 bytes to fit WoW's paste window; split large exports into smaller date ranges. Oversize inputs fail without truncation. Each local guild archive holds at most 10,000 awards and 2 MB of encoded records, including provenance.

Local source dates keep their original precision and an unknown timezone. Explicit JSON server timestamps are UTC. Private notes, owner names, gold and scoring values are omitted. Recipient, item, date, response, instance, boss and offspec are retained with source file hash, row, award ID and importing officer.

## Desktop companion

1. Open World of Warcraft → Import loot history. Choose RCLootCouncil or Gargul, the destination guild and realm, and the correct WoW edition.
2. Choose the exported CSV/JSON file. Review the source records and every character mapping. Destination characters must use Name-Realm; short source names require an explicit realm. Guild and edition cannot be inferred from the source export.
3. If awards lack stable IDs, review the warning and explicitly acknowledge that different exports may overlap. Genuine repeated awards are retained.
4. Select Review and save archive, approve the local save summary, and choose a new text filename. Existing files are never overwritten.
5. Copy the saved GLH1 code and continue in-game below.

This converter is in the installed desktop companion. The browser companion does not provide the native file workflow; the offline CLI is an alternative.

## In-game preview, confirmation and history

Enable Guilded's loot import module and use an officer character in the matching guild, realm and edition.

- `/guilded import history`: paste the GLH1 code and click Preview. Read the mappings, dates and counts of new/already stored awards.
- `/guilded import history confirm`: type `IMPORT` exactly to commit the preview. Officer access, destination and history revision are checked again.
- `/guilded import history cancel`: discard the pending preview.
- `/guilded import history show`: display imported source records. Append a character, item ID, response or boss to filter; at most 200 matches display.
- `/guilded import history undo`: type `UNDO IMPORT` to remove the last added batch only. Earlier history remains. A duplicate-only import keeps that undo.

Storage is per character in `GuildedRosterToolsDB`, isolated by guild, realm and edition. It persists through reload/logout and is not shared by addon sync or Discord. Back up the character's WTF/Account/.../realm/character/SavedVariables/Guilded.lua after a clean logout before managing old archives. The existing GuildedDB backup command does not include this separate history store.

Identical stable source IDs for the same source character deduplicate across imports. Changed contents for an existing identity reject the entire batch; nothing is partially committed. CSV and JSON may express different time precision, timezones or token item IDs, so keep using one export format for an overlapping history. Such differences are reported as conflicts, not guessed.

Without stable IDs, repeating the exact file deduplicates by source hash and row; overlapping different files cannot be safely reconciled automatically. Changing a mapping for a previously stored stable award also requires resolving the conflict, rather than silently replacing historical recipients.

## Offline CLI

Create a mapping file:

```json
{"source":"rclootcouncil","guild":"Example Guild","realm":"Example Realm","edition":"classic-era","characterMap":{"Raider-ExampleRealm":"Raider-ExampleRealm"}}
```

Use source `gargul` for Gargul. Editions: `forever`, `classic-era`, `classic-tbc`, `classic-mists`, `retail`. An empty characterMap creates a preview listing unresolved names; an archive requires every mapping.

```sh
node companion/loot-history-import.mjs loot-export.csv loot-mapping.json loot-preview.json
node companion/loot-history-import.mjs loot-export.csv loot-mapping.json Guilded-loot-history.txt --archive
```

Add `--allow-unidentified` only after reviewing awards without stable IDs. Outputs must be new files. Keep exports, previews and archives local because they contain character history.

## Verification and remaining acceptance

Automated tests exercise native file-dialog boundaries, mapping validation, source parsing, JavaScript-to-Lua archive compatibility, typed confirmation, SavedVariables reload persistence, all five edition scopes, permission changes, deduplication, conflicts, cancellation, undo and capacity/malformed input refusal. They use synthetic export-shaped data, never players' private histories.

Actual WoW client gameplay and real exported-file acceptance remain follow-ups; the owner's earlier waiver is not a claim that those checks passed. This source change does not replace published 8.0.2 release artifacts.

## Format evidence

Reviewed 29 October 2026 against pinned primary implementations:

- [RCLootCouncil export code](https://github.com/evil-morfar/RCLootCouncil2/blob/cdaee3c481895c932da9f3539c6a642bb30aa114/Modules/History/lootHistory.lua): ExportCSV and ExportJSON, including servertime and id.
- [Gargul export code](https://github.com/papa-smurf/Gargul/blob/7cc1fc1713ca74375398c36fb48d4dca2c7d32a6/Classes/Exporter.lua): getLootEntries(true) JSON and transformEntriesToTMBFormat.

The parser and archive implementation are independent code.
