# CurseForge copy-paste sheet: Guilded 6.0.0

Each block below is one field. Copy the block, paste it in.

---

## Project name
```
Guilded
```

## Summary (one line)
```
Raid attendance, EPGP, loot and guild tools for WoW Forever, with an optional hosted Discord bot. Small free pilot; KCaron's approval is required for each server.
```

## Category
Raid & Instance (secondary: Guild, Miscellaneous)

## Logo
`docs/branding/guilded-logo-400.png` (400x400). Full size: `docs/branding/guilded-logo.png`.

## File to upload
For the 9 October setup-only refresh: `dist/Guilded-v6.0.0-hosted-pilot.zip`
(top folder inside is `Guilded`). Display name: **Guilded 6.0.0 - Hosted pilot setup**.
Release type: **Release**, as explicitly directed by the owner on 5 October 2026.
Preserve the approved published game code; update only bundled `INSTALL.md`.
See [RELEASE_CURSEFORGE.md](RELEASE_CURSEFORGE.md) before building from newer main.
Game versions: retain the project's existing verified Forever-compatible selection. The addon declares interfaces 16001 and 20506; do not claim untested client compatibility.

## License
Select **Custom License**, name it:
```
PolyForm Noncommercial 1.0.0
```
Then paste the full text of the `LICENSE` file in the project root (the first line is the
Required Notice, the rest is the official text). Optional link:
https://polyformproject.org/licenses/noncommercial/1.0.0

## Description (Markdown)
```markdown
# Guilded — Raid & Guild Management for WoW Forever

**Organize raid nights, manage loot, and keep your guild connected—all from one in-game window.**

Guilded brings raid tracking, EPGP, four loot systems, readiness checks, and everyday guild tools together. Use the addon on its own, or connect your guild’s optional Discord bot for signups, shared standings, and reports.

**Currently available as 6.0.0 Release.**

## Add the Discord bot — KCaron's approval required

**[Add Guilded — request owner approval](https://discord.com/oauth2/authorize?client_id=1552633893587394590&scope=bot+applications.commands&integration_type=0&permissions=2269718703631440)**

A small number of guilds can join the free hosted pilot. **KCaron must approve your Discord server before the bot works there.** Adding Guilded sends a request; it does not guarantee a place or immediate access. After approval, run **`/setup start`** in your server. You do not need your own hosting or database.

[Hosted pilot guide](https://guilded-wow.kcaron.workers.dev/docs/HOSTED_PILOT/) · [Online companion](https://guilded-wow.kcaron.workers.dev/companion/) · [Member installation](https://guilded-wow.kcaron.workers.dev/docs/MEMBER_INSTALL/)

Use your own Discord server ID and personal `/character pair` code. Independent hosting remains available.


***

## Raid Management & Readiness

*   **Raid journal:** Start and end raids, record attendance and bench credit, mark boss kills, and keep raid notes.
*   **Readiness dashboard:** Officers and group leaders can review available gear, enchant, durability, flask, and food information, request refreshed checks, and run a ready check.
*   **Personal gear checks:** Spot empty equipment slots, missing enchants, and other preparation issues.
*   **Attunement tracking:** Record completed attunements for yourself or, with officer permissions, your raiders.
*   **Persistent records:** Keep your active raid and saved records through reloads and disconnects.

## Four Loot Systems

Choose the approach that fits your raid:

*   **GP Bidding** — Let players bid GP on an item.
*   **Loot Council** — Collect BiS, upgrade, and off-spec responses to help your council decide.
*   **Soft Reserves** — Roll between reservers, with SR+ support for reserves that went unwon.
*   **EPGP Priority** — Award priced items to the interested player with the highest priority, with configurable off-spec pricing.

Start a loot session with **`/guilded drop <item>`**. Addon users receive a response popup; whisper responses support players without Guilded.

**EPGP management** includes EP and GP awards, deductions, loot records, and priority standings. Officers can publish in-game standings without Discord; connected guilds can use bot-managed raid cores, rules, and item prices.

## Soft Reserves & Item Information

*   **In-game reservations:** Reserve linked items without visiting a website.
*   **Shared reserve lists:** Share reservations with online Guilded users and see them on item tooltips.
*   **Officer controls:** Open, lock, and manage the reserve list.
*   **Loot tooltips:** Display available wishlist, historical GP cost, and priority information when supplied through the optional Discord integration.

## Professions & Guild Tools

*   **Recipe sharing:** Open your professions to share known recipes with online Guilded users.
*   **Crafter lookup:** Find who can make an item with `/guilded recipes who <item>`.
*   **Profession cooldowns:** Share supported cooldown information, including transmutes.
*   **Materials lists:** Build a shopping list for your crafting plans.
*   **Guild map:** See participating Guilded users on the world map and minimap, with controls to stop sharing or hide markers.
*   **Dungeon tracking & scores:** Record runs and view scores on player tooltips and the Scores page—no Discord required.
*   **Roll games:** Play high roll, deathroll, and 1v1 duels, with built-in explanations. No wagers or debts.

## One Convenient Window

Click the **gold coin on your minimap** to open Guilded.

*   A Home page for your standings, activity, and available sync status.
*   Pages organized around raid night, guild activities, and settings.
*   Optional modules you can switch off.
*   A dedicated Guilded chat tab for addon messages.
*   English and French localization.
*   Separate saved data for each guild, with backup, restore, and restore undo.

***

## Optional Discord Integration

Extend Guilded beyond the game with a **free hosted pilot (owner approval first), or an independently hosted Discord bot**:

*   **Raid planning:** Role-based signups, waitlists, recurring raids, and core rosters.
*   **Loot management:** Core-specific loot systems, item prices, wishlists, and soft reserves.
*   **Guild coordination:** Crafting requests, crafter searches, readiness boards, and polls.
*   **Reports:** Attendance history, raid seasons, Warcraft Logs integration, and weekly reports.
*   **Dungeon activities:** Challenges and leaderboards.
*   **Calendar sync:** Connect Discord raids and in-game events where the client supports the required calendar APIs.
*   **Raid invitations:** Invite players from synced Discord signups with `/guilded invite raid`.

Use the **Windows companion** to upload saved data after a reload or logout, or the **browser companion** for manual syncing. Discord integration requires your guild’s configured bot and personal pairing.

**The addon works independently.** Approved hosted-pilot guilds do not need to run their own bot or database. Independent hosting requires your own infrastructure.

***

## Getting Started

1.  Extract the **Guilded** folder into your WoW client’s `Interface/AddOns` folder.
2.  Log in and click the **gold minimap coin**. Type `/guilded` or `/gd` for commands.
3.  Officers can open the **Raid** page to begin tracking a raid.
4.  For Discord integration, use the hosted invitation above, wait for KCaron’s approval, then run `/setup start`. See the [hosted pilot guide](https://guilded-wow.kcaron.workers.dev/docs/HOSTED_PILOT/).

## Compatibility & Release Status

Designed for **WoW Forever**. Declared interface versions: **16001 and 20506**. Feature availability depends on the game client and its addon APIs.

**6.0.0 is the full release. The next planned version is 6.1.0.** Fresh-guild setup, Windows installation and recovery, concurrent award workflows, and full raid acceptance testing remain in progress. Back up SavedVariables before upgrading.

Guild map and shared information depend on participating addon users and available data. Raid markers, tank marking, and boss plans are not included in v6.

Free for noncommercial use under the **PolyForm Noncommercial 1.0.0** license. Not affiliated with or endorsed by Blizzard Entertainment.

## Optional support

The addon and approved hosted pilot are free. Voluntary support helps with hosting, maintenance and future capacity. It never buys approval, priority or extra permissions. The official payment link is not available yet; [Support Guilded](https://guilded-wow.kcaron.workers.dev/docs/SUPPORT_GUILDED/) will carry it when ready. No payment is required to request access.

**Français :** ajoutez Guilded pour demander l’accès au pilote gratuit. **KCaron doit approuver votre serveur Discord avant son activation.** Après son accord, lancez `/setup start`. Le soutien financier est facultatif et ne donne aucune priorité.

```

## Changelog (paste for the file upload)
```markdown
## 6.0.0 Release — 5 October 2026

The owner has promoted 6.0.0 to full Release. Back up SavedVariables before upgrading.

- Loot responses show pending/confirmed feedback for raiders and visible responses for officers.
- Includes the tested off-spec pricing, GP import/reversal, personal pairing and standings workflows from the 5.0 beta stabilization work.
- Removes Raid tools entirely: target/floor markers, tank marking and boss plans will be developed later as an optional standalone addon. Saved plans and settings are preserved.
- Includes guild map diagnostics, automatic recipe sharing, and clearer member/owner setup guides.
- Bot, addon and companion source versions are aligned at 6.0.0; synchronization protocol remains 2.
- 5 October setup follow-up: fixes blank optional bot configuration fields, adds an offline owner setup check, refreshes the independent hosting/quick-start guides, and includes installation instructions in the addon ZIP. A clean local rehearsal is documented; live fresh-guild acceptance remains pending.

Remaining live acceptance includes fresh Alliance guild setup, Windows clean install/upgrade and recovery on a non-developer PC, competing/consecutive awards, concurrent officer uploads, permission revocation and a full real raid. Calendar and other game APIs depend on client support. Do not treat these pending checks as passes.

Install the complete Guilded folder, including Guilded.toc. Do not delete your saved data. For addon-only testing, keep WoW companion syncing paused. Discord integration needs the guild owner's configured bot and personal pairing; no database or Discord reset is part of this release package.
```
