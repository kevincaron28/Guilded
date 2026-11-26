<p class="eyebrow">OFFICERS · ONE RAID NIGHT</p>

# Raid night

One page for the officer running the raid: before, during and after. The loot rules are in the
[EP/GP guide](/guide/epgp/).

## Before

1. **Once:** `/core setup` creates the raid core and its weekly raid nights.
2. **Post the raid:** `/lead create`, with a time such as `friday 8pm`. Members sign up with the buttons
   on the post. `/raid roster` shows who is coming.
3. **Check readiness:** `/lead readiness-raid` shows who is ready for tonight.
4. **Soft reserves (if you use them),** in game: an officer types
   `/guilded reserve open`. Members type `/guilded reserve` followed by a shift-clicked item link, or
   whisper `res` and the item link to that officer. That officer’s game keeps the list, so they need to be
   online. Type `/guilded reserve lock` when the raid starts.
5. **Update everyone:** the addon and the companion should be on the current version.

## During

1. In game, `/guilded start` with a title records attendance, loot, EP and GP. `/lead start` marks the
   Discord raid as started.
2. Record who is there with `/guilded attendance group`, and kills with `/guilded boss` and the boss name.
3. Loot: use your guild’s method. With soft reserves, `/guilded reserve who` with the item shows who
   reserved it, `/guilded reserve roll` rolls between them, and `/guilded reserve award` records the
   winner.
4. Discord loot auctions: `/lead loot auction`, then `/lead loot close` when bidding ends.

## After

1. In game, `/guilded end`, then `/reload` (or log out) so the data is saved. The companion sends it.
2. If your server reviews addon data first, check `/setup import held`.
3. In Discord, `/lead end` closes the raid and shows the EP to approve.
4. Link the combat log with `/lead wcl-report`, and share `/raid report`.

## First raid night checklist

- One officer is the loot keeper and is online with the addon on.
- At least one officer runs the companion.
- After the first boss, `/guilded diag` shows no recorded problem. If it does, send it with
  `/report bug`.
