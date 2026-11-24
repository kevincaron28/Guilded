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
- Permissions: see "Permissions in the bundle" below. No location, camera, microphone, storage, contacts or
  advertising ID.

## Permissions in the bundle

Read from the merged manifest of the store bundle 0.3.0 (versionCode 7, `production-no-push`, built 15 November 2026).
The app's own code asks for the first two; the rest are added by the libraries it is built with. Checked against Play's
own list for the uploaded bundle on 15 November 2026 (Test and release → Latest releases and bundles → View all app
bundles → version 7 → Permissions): Play shows **28 permissions**, which are the rows below, the badge permissions
counted one per launcher brand.

| Permission | Why it is there |
| --- | --- |
| `INTERNET` | The app talks to the Guilded server. |
| `POST_NOTIFICATIONS` | Raid reminders. Android 13 and later ask the member before any notification shows. |
| `RECEIVE_BOOT_COMPLETED` | `expo-notifications`: reminders scheduled on the phone are set again after a restart. |
| `ACCESS_NETWORK_STATE` | `expo-updates` and React Native: knowing whether the phone is online before a request. |
| `VIBRATE` | `expo-notifications`: a notification may vibrate. |
| `WAKE_LOCK` | The notification and background-work libraries keep the phone awake for the moment a notification is delivered. |
| `USE_BIOMETRIC`, `USE_FINGERPRINT` | `expo-secure-store` declares them for its optional "ask for a fingerprint before reading" mode. The app does not use that mode and never asks for a fingerprint. |
| `com.google.android.c2dm.permission.RECEIVE` | The Firebase Cloud Messaging library that `expo-notifications` always brings in. In this bundle there is no Firebase configuration, so it never starts, gets no token and receives nothing. |
| `com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE` | Google's Install Referrer library, brought in by a dependency (which one was not traced). The app does not read the install referrer. |
| Launcher badge permissions: `android.permission.READ_APP_BADGE` and 15 brand-specific ones (Samsung, Huawei, HTC, Oppo, Sony, Apex, Solid and "everything" launchers: `...READ_SETTINGS`, `...WRITE_SETTINGS`, `...CHANGE_BADGE`, `...UPDATE_COUNT`, `...UPDATE_BADGE`, `...BROADCAST_BADGE`, `...PROVIDER_INSERT_BADGE`, `...BADGE_COUNT_READ` / `WRITE`, `...badge.permission.READ` / `WRITE`, `...UPDATE_SHORTCUT`) | The badge-count library inside `expo-notifications`, for the small number some launchers draw on an app's icon. The app sets no badge count. |
| `com.android.vending.CHECK_LICENSE` | Google Play's licensing check. It is in Play's list for the bundle; which library or Play step adds it was not traced. The app does not check a licence itself and has nothing to buy. |
| `top.kcaron.guilded.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | The app's own private permission, added by the AndroidX library so that other apps cannot send it internal broadcasts. It grants nothing. |

Not present: `com.google.android.gms.permission.AD_ID`, location, camera, microphone, contacts, storage.

**Can the messaging component be dropped from the no-push bundle later?** Yes, with a small Expo config plugin that
removes the Firebase messaging service and the `c2dm` permission from the merged manifest when the build is
`production-no-push`. It is not needed for the closed test: without the Firebase file the component does nothing. It
would have to stay in the `production` (push) bundle.

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

## Release notes (0.5.2)

Release name: `0.5.2 (closed test)`. Paste into the closed-test release of the 0.5.2 bundle (each under 500 characters).

```
<en-CA>
Sign up for raids from the phone (I'm in, Maybe, Can't come) with reminders a day, two hours and an hour before. Polish: class names read like the game and in French, cleaner leaderboard rows, levels on the duel ladder, links to duel stats and World PvP, a first-launch screen that fits small phones. Thanks for testing; tell us what breaks.
</en-CA>
<fr-CA>
Inscris-toi aux raids depuis le téléphone (J'y vais, Peut-être, Je ne peux pas) avec des rappels un jour, deux heures et une heure avant. Finition : noms de classes en français, classements plus clairs, niveaux au classement des duels, liens vers les statistiques de duels et le JcJ sauvage, un premier écran adapté aux petits téléphones. Merci de tester, dis-nous ce qui cloche.
</fr-CA>
```

## Release notes (0.3.0)

Release name: `0.3.0 (closed test)`. Console wants each language in a tag, 500 characters at most each. The tags must
be the listing's own languages: the app's default language in Play Console is **English (Canada), en-CA** (set when the
app was created), with French (Canada), fr-CA, beside it. An `<en-US>` tag would not match a listing language.

```
<en-CA>
First Guilded release for Android. Five tabs: Guild (roster, map, raids), Stats (public leaderboards and this week's summary), Me (characters, badges, wishlist), Alerts (raid reminders on your phone) and News. No account needed to look around: open the Guild tab and tap "Look at a sample guild". Thanks for testing; tell us what breaks.
</en-CA>
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
