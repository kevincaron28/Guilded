# Crafter offers

A crafter can offer to make something; members buy it or ask for it from the same craft board.
Off until an officer turns it on for the Discord server. Guilded never handles gold: the price is
free text and the trade happens in game.

## Turn it on or off

An officer runs `/craft offer-setting enabled:true` (or `false`). Default is off. When off, nobody
can post or answer offers; existing posts stay readable until they end. Nothing runs for servers
that never turned it on (the 10-minute expiry sweep finds no rows).

## For crafters

- `/craft offer item:<from your recipes> price:<free text> materials:<buyer brings them> note: days:<1-30, default 7>`.
  The item list is autocompleted from recipes recorded for **your own** characters (the data behind
  `/craft who`). A recipe none of your characters was seen with is refused, unless you add
  `unverified:true` (and optionally `profession`): the post then says
  "Unverified: typed by the crafter, no recorded recipe".
- `/craft offers` lists active offers. `/craft withdraw id:` or the **Withdraw offer** button ends
  yours early; officers can withdraw any.
- Limits: 3 active offers per crafter, 6 new offers per 24 hours, no duplicate active offer for the
  same item, offers last at most 30 days.

## For members

Each offer is a post in the existing craft forum (same status and profession tags; title starts with
"💰 Offer:"). **I'd like this** creates a normal craft request (quantity 1, linked to the offer by
`CraftRequest.offerId`, materials flag copied) and posts it as usual, and the crafter gets a DM.
From there claim, status and completion are unchanged. To ask for something nobody offered, use
`/craft request` or the pinned **Request a craft** button as before.

## Behaviour notes

- Posts and messages use `allowedMentions: { parse: [] }`: no `@everyone`, no role pings.
- Every query is scoped by the Guilded guild id, so one Discord server (or in-game guild) never sees
  another's offers. Edition-aware: Forever shows character names without a realm; other editions show
  `Name-Realm`.
- Expired offers: a 10-minute job marks them `EXPIRED`, closes and locks the post, and refreshes the
  pinned profession directory, which lists active offers (marked `[unverified]` when applicable).
- English and French: post text is in `src/i18n-fr.ts`; slash-command descriptions are English like
  the rest of `/craft`.

## Data

Migration `20261215000000_craft_offers`: `CraftOffer` table, `CraftOfferStatus` enum,
`GuildSettings.craftOffersEnabled` (default false), `CraftRequest.offerId`. Deploying it needs
`npm run db:update` as usual.

## Not accepted yet

Needs a real-server pass before turning it on: post an offer, press **I'd like this** from a second
account, claim and finish the request, let one offer expire, check the directory post and French.
Related: `npm run professions:reset` clears beta profession rows before a fresh start.
