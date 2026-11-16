# Auction House achievements (planned, waiting for the in-game probe)

Owner decision, 16 November 2026: Auction House achievements are sales and profit, with no "Flipper". They are **not built yet**:
the catalogue has no rows for them (the catalogue has no inactive or hidden-until-enabled flag, and a row nobody can earn would
show as locked on every card and web page). Build them only after the probe below confirms the client exposes what they need.

## Planned rows (ids stable once added; English / French)

| Id (proposed)    | Name / Nom                                | Rule                                  | Tier suggestion |
| ---------------- | ----------------------------------------- | ------------------------------------- | --------------- |
| `ah-sold-1`      | First Sale / Première vente               | 1 auction sold                        | bronze          |
| `ah-sold-100`    | Market Regular / Habitué du marché        | 100 auctions sold                     | silver          |
| `ah-sold-1000`   | Auction Baron / Baron des enchères        | 1,000 auctions sold                   | epic            |
| `ah-profit-*`    | Profit Margin / Marge bénéficiaire        | profit tiers (thresholds to decide)   | bronze to epic  |

Same privacy rule as the gold achievements: only a **tier or a count of sales** may travel to the bot, never a gold amount. Profit tiers
would be computed on the client and reported as a tier number (like `gold:<tier>`), never as copper.

## What `/guilded probe auctions` checks (built in this change)

Read-only; it prints one chat line and saves `probes.auctions` in the saved variables (dropped at the next login, like `probes.maps`;
the companion does not upload probes, so read the saved file after `/reload`). It stores shapes and yes/no answers only: no amounts,
item names or player names.

1. **Functions exist:** `GetInboxNumItems`, `GetInboxHeaderInfo`, `GetInboxInvoiceInfo`, `GetNumAuctionItems`, `GetAuctionItemInfo`,
   `GetStatistic`, `GetStatisticsCategoryList`, `GetMoney`, and whether `C_AuctionHouse` exists (the retail-style API).
2. **Inbox:** how many values `GetInboxHeaderInfo` and `GetInboxInvoiceInfo` return and their types, which invoice types appear
   (`seller` / `buyer`), and how many subjects match `AUCTION_SOLD_MAIL_SUBJECT`. Needs at least one auction mail in the box to be conclusive.
3. **Chat line:** the value of `ERR_AUCTION_SOLD_S` (and the won / expired strings) and whether `CHAT_MSG_SYSTEM` can be registered.
4. **Owned list:** whether `AUCTION_OWNED_LIST_UPDATE` registers and whether `GetAuctionItemInfo("owner", i)` returns a numeric
   `saleStatus` (the 16th return of the API). Needs the auction house window
   open; the command says so when it is closed.
5. **Statistics:** any statistic whose name mentions gold, auction, coin or sold, with its id and whether the client has a value
   ("value" or "none"). A "gold gained from auctions" style statistic would give a lifetime total without watching mail.

## What the probe must confirm before building

- **Sales counting without double counting:** either the sold chat line (`ERR_AUCTION_SOLD_S`) is delivered and unique per sale, or the
  inbox sold mails (header subject + invoice type `seller`) can be counted once per mail (mails are deleted or expire, so a running total
  has to be kept in saved variables with a de-duplication key such as the invoice's item and a timestamp bucket).
- **Profit:** the invoice returns the sale price, deposit and consignment (so profit = sale - deposit - consignment is knowable), or a
  statistic gives a lifetime figure. If neither exists, profit tiers are dropped.
- **Lifetime history:** whether a statistic gives a lifetime sold count so a first run can record silently what already happened
  (like the other milestones); without it, counts start from install.
- **Classic vs retail API:** if only `C_AuctionHouse` exists (no `GetAuctionItemInfo`), the owned-list approach changes.

## Build plan once confirmed

1. Addon: a `sale` milestone kind in `Modules/Milestones.lua` (value = count or tier), recorded outside combat, silent first run,
   announcements OFF by default (like `gold`), `/guilded announce sale on|off`.
2. Bot: add `"sale"` to `milestoneSchema` and the companion export, a metric (`auctionsSold`, max value), rows in
   `src/services/achievements-catalogue.ts` with the names above, and a badge glyph.
3. Tests mirroring `tests/lua/gold-milestones.test.ts` and `tests/gold-achievements.test.ts`.
