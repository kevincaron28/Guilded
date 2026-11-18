# Guilded 9.3.10 — release notes (18 November 2026)

**Direct party invites and layer auto-invite.** Published 18 November 2026. Protocol 2, WoW Forever only. No new bot migrations in this release (the bot changes are already live).

Real-client checks: docs/V9_3_10_RELEASE_ACCEPTANCE.md. 9.3.10 is not yet confirmed on real clients.

## What changes for members

- **Invites without copy and paste:** Invite buttons for layer changes and calls for help now invite the player directly.
- **Layer auto-invite (opt-in):** turn on "Auto-invite layer requests on my continent" and guildmates asking for your layer are invited automatically.
- **Guild invites from the minimap:** officers who can invite open the invite panel from the minimap right-click menu.
- **Already live on Discord:** link a character by DMing the bot its full name, instant nicknames, every dungeon counts in Season 1, brighter cards.

## In short (English)

Guilded 9.3.10: one-click party invites, an opt-in layer auto-invite, and guild invites from the minimap.

## En bref (français)

Guilded 9.3.10 : invitations de groupe en un clic, invitation automatique de couche (au choix) et invitations de guilde depuis la minicarte.

## Technical

- Addon: #1097 (Util.lua `partyInvite`, LayerInvite.lua, Minimap.lua, SettingsPage.lua). Bot changes since 9.3.9 are already live (#1093–#1096). No migrations since the last deploy.
