# Guilded 9.0.7 — release notes (9 November 2026)

`/ginvite` works again with Guilded Dungeons installed, every WoW Forever achievement becomes a Guilded badge, and the
bot updates live since 9.0.6. Protocol 2, WoW Forever only.

Real-client checks: docs/V8_5_0_RELEASE_ACCEPTANCE.md.

## In game (addons)

- **`/ginvite` and other game slash commands work again.** Guilded Dungeons replaced the game's own slash-command
  table at load, which blocked `/ginvite` as a protected action. It now leaves that table alone, and a test fails if
  any addon file does that again. (#655)
- **Every in-game achievement is tracked.** Guilded records each WoW Forever achievement you earn and shows it as a
  generated badge next to the profession badges. (#649)

## Companion

- Uploads the new achievement data with the rest of your character. (#649)

## Discord bot, phone server and website (already live)

- Achievement badges on member profiles. (#649)
- The website serves the companion installer from the Guilded server in one piece, so downloads no longer stop
  partway; GitHub stays the fallback. (#653)
- Guilded Clash: the nine Champion paintings are bundled for the next phone app. (#652)

## Still owed

The achievement badges from a real client, and a Store companion updating itself on Windows 10/11.
