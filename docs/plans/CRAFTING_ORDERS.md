# Crafting orders in game (plan and what shipped)

Owner request (7 November 2026): "crafting orders in game based on retail crafting orders, linked
with Discord: people request a craft in Discord, crafters in game with the addon see the request.
Make this very nice."

Status: built in one PR (bot, companion and addon together). Real-client checks are owed (see the
end of this file).

## What retail does, and what we take from it (ideas only)

Retail's crafting orders (Dragonflight onward) live at a Crafting Orders NPC in the capitals. We
copy none of its art, names or layout; these are the ideas worth borrowing:

| Retail idea | Guilded version |
| --- | --- |
| Three order types: public, guild, personal (one named crafter). | Every Discord request is a guild order. A request made for one crafter (the crafter menu under a profession post's Details) is a **personal** order: it shows first, marked "For you", on that crafter's Orders page. |
| The crafter's list is filtered to recipes they can craft, with a "show all" switch. | The Orders page shows only orders whose recipe this character knows (from the addon's own profession scan). "Show all open orders" shows the rest, greyed. |
| Each order shows the reagents, who provides them, and whether you have them. | Each order shows the recipe's reagents with what is in your bags (`have / need`, green when enough) and "Customer brings the materials" when the requester said so. |
| A note from the customer, a commission (tip). | The request's note (materials, deadline, tip) shows in full under the order. Gold never goes through Guilded. |
| Claim the order (it is yours for a while), then craft it, then it is delivered. | **Claim** in game (the same as "I'll craft it" in Discord), **Done** when it is made, **Give back** to release it. The Discord post, its tags and the requester's DM follow. |
| The customer sees the state of their order. | The Discord post already shows it; the requester gets a DM when it is claimed and when it is done, with the crafter's in-game name so they know whom to trade or mail. |

Not taken: order expiry timers, the crafting quality system and the in-game mail delivery (none
exist in Forever's client), and any automatic crafting.

## The flow

```
Discord request (form, /craft request, Details menu)
  -> CraftRequest row (item, itemKey when known, asked character)
  -> standings feed: craftOrders (shared; open, claimed, and done in the last day)
  -> companion writes GuildedOrders next to the standings
  -> addon "Orders" page (Guild group): filtered to this character's recipes, reagents shown
  -> Claim / Done / Give back in game: saved in db.craftOrders.actions and said on GUILD
  -> the member's companion uploads it (craftOrderActions); a guildmate's companion carries it
     for members without one (craftOrderRelayActions, the sender as the game reported it)
  -> bot applies it like the Discord buttons (same rules), updates the forum post, DMs the
     requester, and marks the guild changed so every addon sees the new state
```

Members without the companion still see orders: a member whose copy came from the companion shares
it on GUILD (compact lines, at most once a minute, the same way as the guild board).

## Rules

- **On by default** (ROADMAP rule 5). Officer off switch for the server: `/craft orders-setting
  enabled:False` (the feed then says `off`, and the addon shows the page as turned off). Member
  switch: the "Order alerts" button on the page or `/guilded orders alerts off` (the login line
  "N craft orders you can make").
- **Same permissions as the buttons**: anyone except the requester claims an open order; only the
  crafter (or an officer) marks it done or gives it back. A relayed action counts only for a
  character linked to an active member of this server, never for the uploader themself (their own
  actions come through their pairing), and never for the requester.
- **Idempotent**: an action already reflected (claimed by you, already done) changes nothing, so a
  resent upload or two guildmates carrying the same action is harmless. The addon drops a waiting
  action once the feed shows it (or shows the order taken by someone else, which it says).
- **Item ids**: a request knows its recipe (`itemKey`, an item id or minus an enchant's spell id,
  the addon's own key) when made from a recipe button, or when its item name matches exactly one
  recorded recipe. Requests without one still appear under "Show all".
- **No new Discord messages**: only the existing post edit and the existing requester DMs.

## Data

Migration `20270115000000_craft_orders_in_game`:

- `CraftRequest.itemKey` (int, nullable), `askedCharacter` (text), `crafterCharacter` (text, the
  character that claimed it in game), `claimSource` (`discord` or `game`).
- `GuildSettings.craftOrdersInGame` (boolean, default true).

Feed (`craftOrders` in the shared part): `{ enabled, orders: [{ id, key, item, qty, prof, status,
by, crafter, character, asked, mats, note, at, claimedAt, doneAt }] }`, at most 40 open or claimed
(oldest first) and 10 done in the last 24 hours.

## Later ideas (not built)

- A tip field of its own (today it is part of the note) and a "fulfil by" date.
- Requests made in game (the requester side of the Orders page), uploaded like bank requests.
- A Discord "Orders for me" view in `/craft mine` for crafters, using the same recipe filter.

## Owed real-client checks

1. An officer turns orders off and on (`/craft orders-setting`); the page follows after a sync.
2. A crafter with the recipe sees the order, its reagents and bag counts; Claim, then Done.
3. The forum post's tag, title, crafter field and the requester's two DMs follow.
4. A crafter without the companion claims; a guildmate's companion carries it.
5. French, German and Spanish clients show the page translated.
