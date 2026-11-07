# Guild bank plan (ROADMAP item 10)

Status: **7 November 2026: ranks 1, 5, 2 and 3 built (see docs/GUILD_BANK_LEDGER.md, "9.1 additions"); the rest is still a plan.**

## What Guilded has now (9.0)

From `docs/GUILD_BANK_LEDGER.md`, `addon/Guilded/Modules/GuildBank.lua` and `src/services/guild-bank*.ts`:

| Piece | What it does |
| --- | --- |
| Addon scan | When anyone opens the bank with Guilded on: reads viewable tabs (item id, name, count), gold, and asks for each tab's item log and the money log. Stores up to 2000 lines per kind and 400 gold readings. |
| `/guilded gbank [item] \| copy` | Search the last snapshot in chat; copy a tab-separated list for a spreadsheet. |
| Companion upload | Contents, gold history and logs ride the normal sync. |
| Bot ingestion | `GuildBankContents` (newest wins), `GuildBankGold` (history), `GuildBankTransaction` (de-duplicated within 3 h, because the game gives line ages in hours). |
| Website | `/me/guild-bank`, **officers only**: contents per tab, gold chart, per-member summary, ledger for 7/30/90/365 days. |
| Discord | A weekly officer-log summary of gold change and who put in or took out what (`/officer stats bank`). |

Limits we already know: only what someone with Guilded saw; the game keeps about 25 log lines per tab; tabs a viewer cannot see are not read; no item icons or links; no member-facing view; no requests; no alerts.

## What other guild bank addons offer

Researched on CurseForge (Classic-era addons):

- **GBankClassic - Revived** ([page](https://www.curseforge.com/wow/addons/gbankclassic-revived)): aggregates the inventories of several bank alts, a `/bank` browser anyone in the guild can search, scans when bags/bank close, syncs between guildmates every 10 minutes, and has a **Request fulfillment** tab for bank owners (paste an import code, see exactly what to take from which alt, draft outgoing mail).
- **TOGBankClassic** ([page](https://www.curseforge.com/wow/addons/togbankclassic)): members **request items inside the addon** (no whispers), and a Requests window shows pending, fulfilled and completed orders; also tracks mailbox contents as part of inventory.
- **Guild Bank Classic and similar**: guild-wide search of the bank without visiting it, plus tab-by-tab snapshots.
- Common themes across older bank addons (Guild Bank Ledger style): per-player deposit/withdraw totals, "who took the flask" lookups, gold-over-time graphs, minimum-stock lists, and officer-only withdrawal audits.

Gap summary: the common member-facing features are **search the bank from anywhere**, **request an item**, and **bank-alt/mailbox inventory**. The officer-facing ones (ledger, audit) Guilded already has and goes beyond with Discord and gold history.

## Ranked list of what to add

Ranked by value for Québec Gold-size guilds against effort. Effort: S under 2 days, M 3-5, L 1-2 weeks.

| Rank | Feature | Why | Effort |
| --- | --- | --- | --- |
| 1 | **Member-facing bank search** (in the Guilded window and `/bank search <item>` in Discord): "does the bank have X, how many, which tab". Data already exists; add a read-only member view with officer-chosen visibility (default: members can search contents, not who withdrew). | The most-used feature of every competitor; zero new capture work. | S |
| 2 | **Item requests**: a member asks for an item from the addon, Discord (`/bank request`) or the phone app; officers see a queue (pending, fulfilled, declined); the member gets a Discord DM or a card when fulfilled. | TOGBankClassic's selling point; replaces whispers. Needs a table and a small officer UI. | M |
| 3 | **Minimum-stock list and low-stock alert** (e.g. flasks, bandages, potions): officers set targets; weekly post and a Discord alert when below target. Opt-in per server, officer off switch. | Turns the ledger into a to-do list; matches the repo's "alerts on, officer can disable" rule. | M |
| 4 | **Withdrawal watch**: flag unusual withdrawals (large gold, many items, rank below threshold) in the officer log channel, not a public one. | Trust and theft detection; the data is in `GuildBankTransaction`. Needs careful wording (suspicion is awkward). | S |
| 5 | **Item links, icons and quality colours** on the website page and Discord cards (item id is already stored; add a Wowhead-style tooltip link or the game's icon via the item DB the addon uses). | Makes the page legible; mostly front-end. | S |
| 6 | **Bank alts and mailbox inventory** (a bank character's bags and mail as part of "the bank"). | Real guilds keep a bank alt; the 8.5 "bank alt" idea; needs the addon to read bags and mail for flagged characters, plus a privacy opt-in. | L |
| 7 | **Donation recognition**: "most generous depositors this month" board and a milestone card, fed from the ledger, opt-in. Pairs with community points only if the owner wants to reward donations (never EP/GP). | Encourages contributions; careful about fairness and automatic awards. | M |
| 8 | **Gold goal tracker** ("saving 500g for the guild bank tab"), progress bar in Discord and the website. | Fun, low risk. | S |
| 9 | **Officer item assignment**: tag items in the bank as "reserved for raid/consumable/crafting" and show per-purpose counts. | Useful but needs officer upkeep. | M |
| 10 | **Mail-draft helper** for fulfilling requests (copy a list of "send X to Y"). | Nice companion to #2; only worth it after requests exist. | S |

## Discord integration ideas

- `/bank search item:` (autocomplete from contents): replies with count and tab; ephemeral by default.
- `/bank request item: count: note:` creating a request; a "Bank requests" channel (created by `/setup`, named in `src/setup-names.ts`) where officers fulfil with buttons; the requester gets a DM on fulfilment, skipped quietly when DMs are closed.
- Weekly post gains: top depositors, items low vs target, open request count.
- A pinned "Bank snapshot" embed updated after each upload (top 10 consumables, gold, last updated by whom).
- Gold goal and milestone cards in the existing WoW card theme (`score-card.ts`), queued with the existing card definitions.
- Everything on by default per the 9.0 rule (owner off switch + member opt-out for DMs), except the withdrawal watch, which is officer-channel only.

## Data and privacy notes

- A member view must not expose who withdrew what unless officers allow it; keep the current officer-only ledger as the default.
- New tables: `GuildBankRequest` (guild, requester, itemId, count, status, handledBy, timestamps) and `GuildBankTarget` (guild, itemId, minCount). Migration hand-written per CLAUDE.md.
- French copy needed for any new `tx()` strings in files on the enforced list.

## Recommendation

Build in this order: **1 (search) + 5 (item links)** as a quick 9.1 win, then **2 (requests)** with Discord queue and DM, then **3 (minimum stock)**. Hold 6 (bank alts) until a real guild asks; it needs a game-side privacy design. Do not build 7 as points until the owner decides how donations should be rewarded.

## Real-client checks owed

The 9.0 ledger itself still needs an in-game verification (open the bank, `/reload`, check `GuildedDB.guildBankLog`); do that before building on it.

## Sources

- [GBankClassic - Revived](https://www.curseforge.com/wow/addons/gbankclassic-revived)
- [TOGBankClassic](https://www.curseforge.com/wow/addons/togbankclassic)
- [GBankClassic](https://www.curseforge.com/wow/addons/gbankclassic)
