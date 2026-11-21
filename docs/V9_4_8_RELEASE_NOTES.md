# Guilded 9.4.8 release notes

Prepared 21 November 2026, not yet published. Protocol 2, WoW Forever only. Bot changes are already live.

Real-client checks: docs/V9_4_8_RELEASE_ACCEPTANCE.md.

## Addon

- `/guilded score <first last>` reads the whole name (#1234).
- After a guild data repair or switch, the companion's newer dungeon board is used at once (#1234).
- `/guilded score` shows your current level's bracket (#1236).
- More lines in French; wording polish.

## Companion

- A waiting update installs while WoW is open once it has waited two hours, never during an upload or with the window open (#1235).

## Bot (already live)

- Card posts retry a busy renderer before falling back to text (#1231).
- Crafter offers on by default (#1233).
