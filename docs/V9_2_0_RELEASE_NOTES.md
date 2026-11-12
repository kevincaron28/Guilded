# Guilded 9.2.0 — release notes (12 November 2026)

**The simpler addon and companion, plus the Crafting page.** Protocol 2, WoW Forever only. No bot migration; the bot items below are already live.

Real-client checks: docs/V8_5_0_RELEASE_ACCEPTANCE.md and docs/ZERO_SETUP_COMPANION.md. Not yet verified in a real client: the single addon window and tabs, the Crafting page requests and relay, Layer invite, the call-for-help toast, and the companion's single window, tray menu and Advanced view.

## What changes for members

- **One addon window:** Home, Guild, Dungeons, Crafting, Raids, plus Officer (officers) and Settings. Short `/guilded help`; `/guilded help all` lists everything.
- **Removed:** the guild-message feature and blocked or dead parts.
- **Layer invite** replaces levelling partners.
- **Crafting page:** Request an item in game, cancel your requests, claim and finish orders for your recipes.
- **Call for help** is a small closable toast, quiet in combat.
- **No more "messages are limited" spam:** one global send budget with back-off.
- **Companion:** one simple window with an Advanced view, a four-item tray menu, Store name "Guild Sync Companion".

## Bot (already live)

Character panel, invite-channel cleanup, game reminders by private message, World PvP extras, painted dungeon cards, craft requests made in game.

## Technical

- #771-#807 since 9.1.6 (see CHANGELOG.md).
