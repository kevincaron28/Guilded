# Loot-history import: preview foundation

The first slice is an offline preview for guilds moving from RCLootCouncil or
Gargul. It is not yet an in-game import command. It does not write SavedVariables,
contact Discord, upload files, award loot, or create EP/GP entries.

## Supported exports

- RCLootCouncil: **CSV** or **JSON** from Loot History → Export.
- Gargul: **JSON** (preferred) or **TMB CSV**, including the version with realms.
  JSON preserves original item IDs and timestamps. TMB CSV has day-only dates
  and Gargul substitutes certain token item IDs for TMB compatibility.

Other custom Gargul formats, compressed strings, Lua SavedVariables, and old
ambiguous day/month/year dates are rejected. Inputs are limited to 2 MB and
5,000 awards; oversize files are rejected, never truncated. Names keep their
realm suffixes. Local source dates have no implied UTC offset. Explicit JSON
server timestamps are retained as UTC.

## Try a preview

Create a local mapping file, for example `loot-mapping.json`:

```json
{
  "source": "rclootcouncil",
  "guild": "Example Guild",
  "realm": "Example Realm",
  "edition": "classic-era",
  "characterMap": {
    "Raider-ExampleRealm": "Raider-ExampleRealm"
  }
}
```

Use `gargul` for Gargul exports. Edition values are `forever`, `classic-era`,
`classic-tbc`, `classic-mists`, and `retail`. Guild and edition are explicit
officer selections: source exports do not prove either. Mapping values must
use `Name-Realm`. Leave `characterMap` empty to see the exact source names
needing review; unmapped names remain unresolved.

```sh
node companion/loot-history-import.mjs loot-export.csv loot-mapping.json loot-preview.json
```

The output must be a new file; existing files are never overwritten. Keep source
and preview files local because they contain character history. Private notes,
owner names, gold and scoring values are omitted. Retained fields are recipient,
item, date, source response, instance, boss and offspec, with source file hash and
row provenance.

Stable source IDs deduplicate identical rows within a preview. Conflicting
contents for the same source ID/character fail the entire preview. Missing IDs
are flagged for review; identical rows without IDs are retained because two
copies may be legitimate. Keys include destination guild, realm, edition and
source. Cross-format and previously imported history reconciliation is not yet
implemented.

## Next slices before enabling it in the addon

1. Companion file picker and readable preview with explicit guild/edition and
   character mapping, duplicate/conflict review and confirmation.
2. Versioned archive and officer-only addon acceptance into a separate local
   history archive. Recheck scope on commit; never replay awards or scoring.
3. Transactional merge, persistent deduplication, cancellation/recovery and
   filtered history display with source labels.
4. Real exported-file fixtures and in-game acceptance for supported clients.

Do not advertise a completed import feature before those slices are tested.

## Format evidence

Reviewed 29 October 2026 against pinned primary implementations:

- [RCLootCouncil export code](https://github.com/evil-morfar/RCLootCouncil2/blob/cdaee3c481895c932da9f3539c6a642bb30aa114/Modules/History/lootHistory.lua):
  `ExportCSV` and `ExportJSON`, including `servertime` and `id`.
- [Gargul export code](https://github.com/papa-smurf/Gargul/blob/7cc1fc1713ca74375398c36fb48d4dca2c7d32a6/Classes/Exporter.lua):
  `getLootEntries(true)` JSON and `transformEntriesToTMBFormat`.

The parser is independent code. Tests use synthetic export-shaped data, not
players' private histories. Actual game exports remain an acceptance follow-up.
