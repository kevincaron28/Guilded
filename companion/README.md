# Guilded Companion

**Easiest: the desktop app** (`companion-app/`): a window with status, settings
and an activity log, plus a tray icon (green = running, red = a problem, amber =
setup needed). Closing the window keeps it running in the tray; it can start
with Windows. Double-click `start-companion-app.bat` (first run installs it),
or run `npm run companion:app`. Settings are stored in the app's own folder; the
first run picks up an existing `companion.config.json`. To build a normal
Windows installer: `cd companion-app`, `npm install`, `npm run dist` (needs
about 1 GB free disk; the installer lands in `dist/companion/`).

The command-line watcher below does the same job without a window; both use
`companion/engine.mjs`.

This lightweight companion watches a normalized addon export file and sends new exports to the bot. It runs on the same Windows computer as WoW; the bot may run on Oracle.

## One-time setup

1. Copy `companion.config.example.json` to `companion.config.json`.
2. Set the bot URL, server ID and saved-data path. Run `/character pair` and enter its code as `pairingCode`.
3. Ensure the existing bot is running (do not start a second instance).
4. Run `node companion/watcher.mjs`.

To link this companion to your own Discord account, run `/character pair` in
Discord and put the one-time code in `pairingCode` in `companion.config.json`.
Start the watcher once; it exchanges the code, clears it, and stores the
companion credential in that config. Future uploads link the exporter's own
character immediately; the rest of the guild import still waits for an officer
unless auto-import is enabled. Personal uploads contain only owned character data and auto-apply. The desktop app has the same flow in Settings.

The watcher can read the addon's Lua SavedVariables directly. It also accepts
a normalized JSON export matching the bot import contract:

```json
{
  "source": "Guilded",
  "exportedAt": "2026-09-24T00:00:00.000Z",
  "transactions": [
    {
      "character": "Player",
      "realm": "Realm",
      "amount": 10,
      "type": "AWARD",
      "reason": "Raid attendance"
    }
  ]
}
```

For a Lua file, the watcher converts the addon's append-only DKP ledger into
normalized transactions. Set `realm` in the companion config because the WoW
SavedVariables file does not reliably contain a realm identifier.

## EPGP standings written into the addon

On start and every 15 minutes the watcher also asks the bot for EPGP
standings (`GET /api/v1/standings`, same token) and writes them to
`Interface\AddOns\Guilded\Standings.lua`. The path is worked out from
`watchFile` (the folder that contains `WTF`); if your install is laid out
differently, add `"standingsFile": "<full path to Standings.lua>"` to
`companion.config.json`. The game reads it on login or `/reload`, and the
officer's client then shares it with online guildmates.

## Optional Path of Exile 2 mapping

The desktop app can track PoE2 independently or alongside WoW. Enable it in
Settings, select your PoE2 `logs/Client.txt`, declare your character/league/mode
and keep your existing Discord pairing (or get a code with `/poe pair`). An
officer must enable `/poe setup enabled:true` after updating the bot. For a
PoE2-only setup, turn off WoW tracking. `/poe runs` and `/poe summary` show map
observations; clears, deaths and loot are not inferred. Chat stays local.

The CLI uses `poeEnabled`, `poeLogFile`, `poeCharacter`, `poeLeague`, `poeMode`
and `wowEnabled` in its config. See [the mapping guide](../docs/POE2_MAPPING.md)
for consent, queue recovery, limitations and the real-client checklist.

## Branded desktop and online companion

The redesigned companion uses the owner's Guilded logo, individual WoW and
PoE2 pages, guided setup, light/dark themes, personal map history and searchable
activity. `npm run companion:build` builds the shared browser interface.

After the approved server release, members can visit `/companion/` on the
bot's HTTPS hostname without installing the companion. WoW uses a manually
selected Guilded.lua and a standings download; the WoW addon is still needed.
PoE2 manually imports recent log observations. Reselect updated files after
playing. Personal pairing replaces the previous desktop/browser link.
See [delivery modes, privacy and release steps](../docs/COMPANION_EXPERIENCE.md).
