# Guilded 9.3.3 — release notes (15 November 2026)

**Fixes after 9.3.2.** Not yet published. Protocol 2, WoW Forever only. The two phone-alert migrations (`mobile_devices` and `mobile_receipts`) were already applied on production on 14 November 2026.

Real-client checks: docs/V9_3_3_RELEASE_ACCEPTANCE.md. 9.3.3 is not yet confirmed on real clients.

## What changes for members

- **Duel card:** the result card shows the character you dueled. It could show another character with the same first name.
- **Stopped companion:** the companion tells the addon it is alive, so a stopped companion no longer holds other players' records for days.
- **Carried records:** clearer counts, receipts sooner, the opponent's real realm, and a line in the companion's Activity list.
- **Duels and invites:** a waiting duel or invite can no longer loop, and invite replies are matched by whole name.
- **Group runs:** fewer repeated offers, and a run that was sent but not confirmed yet says so.
- **Companion updates:** a waiting addon update installs the moment WoW is closed, and an unfinished companion update shows Try again.
- **Start with Windows:** the box shows and changes the real startup entry.
- **Parked guilds:** runs are no longer sent twice.
- **Companion clock:** the update marker no longer depends on a wrong PC clock, and the heartbeat stops when you sign out.

## Discord and website (already live)

- Carried records of guildmates were dropped; this is fixed.
- The World PvP position import is fixed.
- The standings feed uses less memory.
- The PvP map keeps the newest points and marks small zones.
- Better French wording and new website pictures.

## In short (English)

Guilded 9.3.3: the duel card shows the character you dueled, a stopped companion no longer holds other players' records for days, carried records show clearer counts and arrive sooner, waiting duels and invites no longer loop, an addon update waits for WoW to close and then installs, and Start with Windows shows the real setting.

## En bref (français)

Guilded 9.3.3 : la carte de duel montre le personnage que vous avez affronté, un companion arrêté ne retient plus les duels des autres joueurs pendant des jours, les duels transportés affichent des compteurs plus clairs et arrivent plus vite, un duel ou une invitation en attente ne tourne plus en boucle, une mise à jour de l'addon s'installe dès que WoW est fermé, et « Démarrer avec Windows » montre le vrai réglage.

## Technical

- #928, #930, #931, #938, #939, #941, #944, #947 (addon and companion); #927, #929, #934, #940, #942 (bot and website, already live) since 9.3.2 (see CHANGELOG.md).
