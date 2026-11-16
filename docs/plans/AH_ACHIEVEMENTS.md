# Auction House achievements (built, 16 November 2026)

Owner decision, 16 November 2026: Auction House achievements are **sales and profit, no "Flipper"**. Only a **tier** ever travels to
the bot, never a count of sales or an amount of gold (same privacy rule as the gold-held achievements, #1027).

## What the real client probe found (WoW Forever, build 16001, English client, 16 November 2026)

- `GetStatistic` and `GetStatisticsCategoryList` exist. Money statistics (all "value"): 328 Total gold acquired, 333 Gold looted,
  326 Gold from quest rewards, **919 Gold earned from auctions**, 329 Auctions posted, 330 Auction purchases, 331 Most expensive bid
  on auction, 332 Most expensive auction sold, 921 Gold from vendors, **334 Most gold ever owned**.
- There is **no "auctions sold" statistic**, so sales before install cannot be known: the sold count starts at 0, silently.
- Events: `CHAT_MSG_SYSTEM`, `MAIL_INBOX_UPDATE`, `AUCTION_HOUSE_SHOW`, `AUCTION_HOUSE_AUCTION_CREATED` and `PLAYER_MONEY` exist;
  `AUCTION_OWNED_LIST_UPDATE` does not. `GetAuctionItemInfo` / `GetNumAuctionItems` do not exist (the client uses the modern
  `C_AuctionHouse`), so the old owned-list approach is not available. `GetInboxInvoiceInfo` exists but is not needed.
- The global `ERR_AUCTION_SOLD_S` ("A buyer has been found for your auction of %s.") exists and is localised per client.

## What shipped

Per character, tiers only (`addon/Guilded/Modules/Milestones.lua`, kind `auction`):

| Ladder | Rule | Tiers (names EN / FR) |
| --- | --- | --- |
| Auctions sold (`auction:sold-<tier>`) | counted from the system line matching `ERR_AUCTION_SOLD_S`, from install on | 1 First Sale / Première vente (1), 2 Market Regular / Habitué du marché (100), 3 Auction Baron / Baron des enchères (1,000) |
| Auction profit (`auction:profit-<tier>`) | statistic 919 "Gold earned from auctions" | 1 Profit Margin I (100 g), 2 Profit Margin II (1,000 g), 3 Profit Margin III (10,000 g) / Marge bénéficiaire I-III |

- **Sold line:** the pattern is built from the client's own global (magic characters escaped, `%s` and `%1$s` become `.+`), so it works in
  every client language. The running count lives on the character's record in the saved variables (`auctionSold`) and is never uploaded.
  Counting starts at the character's first run of the module (silent baseline); a sale mid-fight is still counted, the tier check waits.
- **Statistic parsing (`ms.parseMoney`):** accepts a number, `12g 34s 56c`, thousands separators (`,` `.` space, no-break space), colour codes,
  gold/silver/copper icon textures, localised units (`po` / `pa` / `pc`), or a plain digit string (read as copper). `--`, empty, nil, negative or
  anything unreadable gives nothing.
- **When it looks:** at login and (debounced 5 s, never in combat) on `PLAYER_MONEY`, `MAIL_INBOX_UPDATE` and each counted sold line.
- **Gold held (#1027) improved:** the tier now comes from `max(GetMoney(), statistic 334)`, so a character that once held the gold earns the
  tier. Same kind (`gold`), same ids.
- **Existing characters:** a character baselined by an older addon gets the new statistics read once, silently (`statsBaselined`), so nothing old is announced.
- **Announcements:** follow the gold kind: **OFF by default**, `/guilded announce auction on|off` (shown in `/guilded announce`), the member's
  master switch and an officer's guild-wide switch still win. Only the newest tier of a jump is said, once.
- **Bot / companion:** milestone kind `auction` is accepted by `milestoneSchema`, `importMilestones` and the companion's `exportMilestones`, row by row
  (value 1-3 and the ref must be `auction:sold-<value>` or `auction:profit-<value>`; anything else is dropped). The ref uses `-` before the tier
  (not a second `:`) because the shared ref pattern `^[a-z]{2,10}:[A-Za-z0-9_-]{1,30}$` allows one colon, and that pattern is part of the wire shape.
  Facts `auctionSoldTier` / `auctionProfitTier` (max tier reported by any character), six catalogue rows (`auction-sold-1..3`, `auction-profit-1..3`,
  English and French), glyphs `gavel` and `chart`, family `guild` (the painted family emblem is used until dedicated art exists).
- Tests: `tests/lua/auction-milestones.test.ts`, `tests/auction-achievements.test.ts`.

## Still owed

- A real-client check that a real sale increments the count and that statistic 919 / 334 read as expected in the player's language
  (the probe only confirmed they exist). Run `/guilded probe auctions` after a sale if a shape differs.
- Dedicated painted emblems for the two ladders (they use the guild family emblem), and a settings checkbox next to "Gold milestones" if wanted
  (the command switch exists).
