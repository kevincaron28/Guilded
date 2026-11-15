# Google Play closed test: build facts, audience answers and release notes

Updated 14 November 2026 for the closed test run with Testers Community. The steps, in order and with who does each
one, are in [play-console-checklist.md](play-console-checklist.md) (French:
[play-console-checklist.fr.md](play-console-checklist.fr.md)). Agents may save drafts only; the owner ticks every
declaration.

## Build facts

- Version `0.3.0`, package `top.kcaron.guilded` (`mobile/app.json`). **Every upload to Play needs a higher
  versionCode than the last one.** EAS does this by itself: `eas.json` uses the remote version source with
  `autoIncrement` on the `production` profile, which is what EAS recommends
  ([app versions](https://docs.expo.dev/build-reference/app-versions/)). The number starts from the 3 in
  `app.json` and goes up by one on each store build; the build page on expo.dev shows the one it used. Nobody edits it
  by hand. The version name (`0.3.0`) still changes in a reviewed PR.
- **Guilded Clash is not in the build.** The card game is on hold: `mobile/metro.config.js` leaves it and its card art
  out unless a build sets `EXPO_PUBLIC_GUILDED_CLASH=1`, and no build profile sets it. Nothing in the listing, the
  forms or the release notes mentions it.
- `eas.json` profile `production` builds an **app bundle (.aab)** for the store, channel `production`. It needs the
  Firebase file (`GOOGLE_SERVICES_JSON`) for push. Profile `production-no-push` builds the same bundle without
  Firebase: raid reminders are scheduled on the phone, and the Alerts tab says push is not set up.
- Signing: EAS creates and keeps the **upload key** on the first store build (it asks once; that is the owner's yes).
  Play creates and keeps the **app signing key** when the first bundle is uploaded (Play App Signing). No key file is
  ever in the repository.
- Target API level: `targetSdkVersion` 36 (Android 16), pinned in `app.json` with `expo-build-properties`;
  `compileSdkVersion` 37 and `minSdkVersion` 24 come from React Native 0.88. Play asks new apps for API level 36 or higher since 31 August 2026
  ([Play Console help](https://support.google.com/googleplay/android-developer/answer/11926878)). Check the number Play
  shows for the uploaded bundle (App bundle explorer → Details).
- Permissions asked: `INTERNET`, `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`, `ACCESS_NETWORK_STATE`. No location,
  camera, microphone, storage or contacts.

## Target audience and content (recommended answers)

| Form | Answer | Why |
| --- | --- | --- |
| Target age groups | **13-15, 16-17, 18 and over** | Sign-in is Discord only and Discord requires 13+. Under-13 would pull the app into the Families programme. |
| Appeal to children | **No** | A guild companion for a game with a teen-and-up audience. |
| Ads | No ads | The app has no ads SDK. |

Why not 18+ only: nothing here is adult. There is no free-text chat, no comments, no photo upload and no payments. What
members exchange is game data (characters, ranks, wishlist item names, in-game last-seen positions), inside one guild.

Content rating: submitted on 15 November 2026 with the answers in [play-content-rating.md](play-content-rating.md).
Result: Everyone / PEGI 3 / Google Play 3+, with no interactive element.

## Release notes (0.3.0)

Release name: `0.3.0 (closed test)`. Console wants each language in a tag, 500 characters at most each.

```
<en-US>
First Guilded release for Android. Five tabs: Guild (roster, map, raids), Stats (public leaderboards and this week's summary), Me (characters, badges, wishlist), Alerts (raid reminders on your phone) and News. No account needed to look around: open the Guild tab and tap "Look at a sample guild". Thanks for testing; tell us what breaks.
</en-US>
<fr-CA>
Première version de Guilded pour Android. Cinq onglets : Guilde (membres, carte, raids), Stats (classements publics et résumé de la semaine), Moi (personnages, badges, souhaits), Alertes (rappels de raid sur votre téléphone) et Nouvelles. Aucun compte requis pour explorer : ouvrez l'onglet Guilde et touchez « Voir une guilde d'exemple ». Merci de tester, dites-nous ce qui cloche.
</fr-CA>
```

The button reads "Look at a sample guild" / "Voir une guilde d'exemple" (`mobile/src/i18n.ts`), as quoted above.

## Note for the testers (paste where Testers Community asks for instructions)

```
Guilded is a companion app for World of Warcraft guilds. You do not need an account:
1. Open the Guild tab and tap "Look at a sample guild". Every screen then works with made-up data.
2. Try each tab: Guild (roster, map, raids), Stats, Me (badges, wishlist), Alerts (turn the raid reminder on and allow notifications), News.
3. In Me > Settings, switch the language to French and back.
Please keep the app installed for the whole test and open it a few times. Report anything that looks broken or confusing.
```

## Guild members as extra testers (optional)

Testers Community supplies the testers Google asks for. Guild members with an Android phone can join the same test
through the opt-in link; they see their real guild after signing in with Discord. Post, once the link exists:

> EN: Guilded for Android is in closed test on Google Play. Open <OPT-IN LINK> on your Android phone, tap "Become a
> tester", install Guilded from Play and keep it installed for two weeks. Thank you!
>
> FR : Guilded pour Android est en test fermé sur Google Play. Ouvrez <LIEN> sur votre téléphone Android, touchez
> « Devenir testeur », installez Guilded depuis Play et gardez-le installé pendant deux semaines. Merci!

Members can only opt in if their Google account is in a tester list of the track: add a second Google Group or an
email list for them beside the Testers Community group (checklist, step 6).
