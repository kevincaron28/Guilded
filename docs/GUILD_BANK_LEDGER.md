# Guild bank ledger (9.0)

The owner confirmed on 6 November 2026 that WoW Forever has a guild bank. Guilded now keeps a
read-only ledger of it: what it holds, the gold over time, and who deposited or withdrew what.
Nothing here can change the bank, EP/GP or anyone's rank.

## How it gets there

1. **In game** (`Modules/GuildBank.lua`): whenever anyone with access opens the guild bank with
   Guilded on, the addon reads the tabs they may view, the gold, and asks the server for each tab's
   item log and the money log (`QueryGuildBankLog`, tab `MAX_GUILDBANK_TABS + 1` for money). When
   the server answers (`GUILDBANKLOG_UPDATE`) it keeps every line in `GuildedDB.guildBankLog`:
   type, the member's full Forever name, item, count, tab, gold amount. The game gives each line's
   age in hours, so a line read again within 3 hours is the same line. Up to 2000 lines of each
   kind and 400 gold readings (one per visit, 10 minutes apart). Every API is checked first; a
   client without them records nothing.
2. **Companion** (`exportGuildBank` in `companion/lua-export-content.mjs`): uploads the contents,
   the gold history and the logs, field by field, with the next sync.
3. **Bot** (`src/services/guild-bank.ts`, called for every paired upload, members and officers):
   - contents (`GuildBankContents`): the newest reading wins;
   - gold history (`GuildBankGold`): a reading within 5 minutes of a stored one is the same;
   - logs (`GuildBankTransaction`): the same kind, type, name, item, count, tab and amount within
     3 hours of a stored line is the same line, whoever uploads it. Nothing in the future is kept.
   Each row records which member's companion brought it.

## Where to see it

- **Guild bank page** on the guild tools site: `/me/guild-bank` (linked from Statistics).
  Officers only, the same check as Statistics. Contents per tab, a gold chart, a per-member summary
  and the ledger for 7, 30, 90 or 365 days. Times are about an hour accurate (the game's own
  rounding).
- **Weekly summary**: once a week in the officer log channel, only when the bank moved: gold now
  and the week's change, and per member gold in or out and items in or out. On by default (owner
  decision for 9.0 features), gated by the preview server list while `FEATURE_PREVIEW_GUILD_IDS`
  is set. Off switch: `/officer stats bank on:False`.

## Limits

- Only what someone with Guilded saw: a member who never opens the bank adds nothing. Tabs a
  viewer may not see are not read.
- The game keeps only the latest lines per tab (about 25); lines that scrolled away before anyone
  with Guilded opened the bank are lost.
- Uploaded by members' companions, like the rest of the guild data: a hand-edited saved file could
  add a fake line. Each line keeps who reported it.

## Needs a real client

1. Open the guild bank with Guilded on, `/reload`: `GuildedDB.guildBankLog` has lines with full
   names and the gold history has one point.
2. After a companion sync, the Guild bank page shows the contents, the chart and the ledger.
3. Two members open the bank the same hour: every line appears once.
4. After a week with activity, the summary appears once in the log channel.

## 9.1 additions (docs/plans/GUILD_BANK.md, owner approved 7 November 2026)

Built in the plan's order: member search with item links, then requests, then minimum stock. All on
by default; officers turn each off with `/bank settings`.

- **Member search.** `/bank search item:` (autocomplete from the last contents) answers privately with
  the count, the tabs and how old the contents are. Members also see the contents and a search box on
  the Guild bank page (`/me/guild-bank`); the gold chart, the ledger and who moved what stay officers
  only. In game, `/guilded gbank <item>` searches the newer of this PC's own snapshot and the guild's
  contents the companion writes next to the standings (`GuildedBank`), so members who never open the
  bank can search it too. Off switch: `/bank settings member_search:False` (officers still see it).
- **Item links and quality.** Item names on the page, in Discord answers and on request cards link to
  their Wowhead page; the addon reads each item's quality from its link colour (`q`), and the page
  shows uncommon and better in their colour. No icons: Guilded has no item database to take them from.
- **Requests.** `/bank request` now matches the bank's item when it can. In game:
  `/guilded gbank request [count] <item>` saves the request in `db.bankRequests`; the member's own
  companion uploads it (only with their pairing) and the bot keeps each `ref` once. Every new request
  gets a card with Approve / Fulfilled / Deny buttons in the request channel
  (`/bank settings request_channel:`, else the log channel); the card updates when handled and the
  member gets a DM (closed DMs are skipped). `/guilded gbank requests` and the Info and data page's
  "My bank requests" button show the status in game. Off switch for the cards:
  `/bank settings request_posts:False` (`/bank list` and `/bank handle` keep working).
- **Minimum stock.** Officers set `/bank stock item: min:` (0 removes); `/bank stock` lists what is
  below target. After an upload shows an item below its minimum, the log channel gets one alert; it
  can alert again only after the item was back at target. The weekly summary adds top depositors,
  items below minimum and the open request count. In game: `/guilded gbank low`. Off switch for
  alerts: `/bank settings stock_alerts:False`.

Not built (the plan holds them): withdrawal watch, bank alts and mailbox, donation recognition, gold
goals, item assignment, mail-draft helper. The plan's dedicated "Bank requests" channel created by
`/setup` is replaced by an optional officer-chosen channel, to stay clear of `/setup`'s size limit.

### Needs a real client (9.1)

5. `/guilded gbank request 2 <item>`, sync: a card appears for officers; Fulfilled sends the DM and
   `/guilded gbank requests` shows "fulfilled" after the next standings download.
6. On a PC that never opened the bank, `/guilded gbank <item>` answers from Discord's contents.
7. Set `/bank stock` above what the bank holds, open the bank, sync: one alert in the log channel.
