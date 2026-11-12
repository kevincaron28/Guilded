# Google Play closed test (Alpha): answers, testers and release notes

Prepared 10 November 2026 for the owner's Play Console clicks. Companion to
[docs/ANDROID_PLAY_LAUNCH.md](../../docs/ANDROID_PLAY_LAUNCH.md) (sections 5 and 7) and
[play-content-rating.md](play-content-rating.md). Agents may save drafts only; the owner ticks every declaration.

## Build facts (release/mobile-launch, PR #345)

- `eas.json` `production` (and `store`, which extends it) builds an **app bundle (.aab)** with `distribution: store`,
  channel `production`. Play App Signing needs nothing in the repo: Play creates and holds the app signing key when the
  first bundle is uploaded; EAS signs the upload with its own managed upload key (`eas credentials` creates it on the first
  production build).
- `app.json`: version `0.2.0`, `android.versionCode` 2. Play has never seen a bundle, so 2 is accepted for the first
  upload. Every later upload needs a higher versionCode (a reviewed PR).
- `app.config.js` refuses a production Android build without the EAS file variable `GOOGLE_SERVICES_JSON` (push). Firebase
  is therefore on the critical path for the first AAB (owner, about 5 minutes: ANDROID_PLAY_LAUNCH.md section 1-2).

## Target audience and content (recommended answers)

| Form | Answer | Why |
| --- | --- | --- |
| Target age groups | **13-15, 16-17, 18 and over** | Sign-in is Discord only and Discord requires 13+. Under-13 would pull the app into the Families programme (extra policy, ads SDK rules, no account sign-in). |
| Appeal to children | **No** | A guild companion for a game with a 12+/teen-and-up audience; no cartoon-for-kids content. |
| Ads | No ads | Already saved. |

Why not 18+ only: nothing here is adult. There is no free-text chat, no comments, no photo upload and no payments. What
members exchange is game data (characters, ranks, wishlist item names, in-game last-seen positions) and Guilded Clash
card matches and guild card trades, all inside one guild. 18+ would only exclude the guild's teenage members for no
policy gain. If the owner wants the most conservative stance anyway, 18+ only is allowed and changes nothing else in the
forms.

## Content rating (IARC) recommendation

Use the table in [play-content-rating.md](play-content-rating.md) unchanged: category **All Other App Types**, every
content question No, **users interact = Yes**, location sharing = No, digital goods = No. Two items worth knowing since
Guilded Clash joined the app:

- Card packs are free and earned by play, with crafting. There is no purchase, so "simulated gambling / loot boxes" stays No.
- Matches and trades are between guild members with fixed moves, no typed messages. Users interact remains the only
  interactive element. Expected result: Everyone / PEGI 3 with "Users Interact"; read Console's summary before applying.
  Console asks for a contact email: use the support address chosen for the store listing.

## Testers (12 for 14 days)

Recommended mechanism: **a Google Group**, not a typed email list.

1. groups.google.com (owner's Google account) -> **Create group** -> name `Guilded Android testers`, address e.g.
   `guilded-testers@googlegroups.com` -> access: **Anyone can join** (Basic permissions: Who can join = "Anyone can ask",
   or "Anyone can join" if offered). Visibility: group members only.
2. Play Console -> Closed testing - Alpha -> **Testers** -> under "Google Groups" enter the
   group address. Tick it -> **Save changes**.
3. Post the join link in the guild's Discord (text below). Members join the group first, then use Play's opt-in link.
   They need a Google account on their Android phone; the group keeps working if members come and go, so you are not
   copying 12 addresses by hand.
4. Count joins in the group's member list. The 14-day clock needs **12+ testers opted in the whole time**; aim for 20.
5. Fallback: Play's own email list (`Guild testers`) with addresses typed in.

Discord post (EN):
> Help us launch Guilded on Google Play! Android players: 1) join https://groups.google.com/g/guilded-testers
> (use the Google account on your phone), 2) open the test link <PASTE OPT-IN LINK> and tap Become a tester,
> 3) install Guilded from Play and keep it installed for two weeks. Thank you!

Discord post (FR):
> Aidez-nous a lancer Guilded sur Google Play! Joueurs Android : 1) rejoignez https://groups.google.com/g/guilded-testers
> (avec le compte Google de votre telephone), 2) ouvrez le lien de test <COLLER LE LIEN> et touchez Devenir testeur,
> 3) installez Guilded depuis Play et gardez-le installe pendant deux semaines. Merci!

(The group address above is a placeholder: use the real one once created. The opt-in link appears on the Testers tab
only after the first release is approved.)

## Release notes for the Alpha release (0.2.0, versionCode 2)

Name: `0.2.0 (closed test)`. Console wants each language in a tag. 500 characters max each.

```
<en-US>
First Guilded release for Android. Five tabs: Guild (roster, map, raids), Stats (public leaderboards and this week's summary), Me (characters, badges, wishlist), Alerts (raid reminders on your phone) and News. Includes Guilded Clash, the card game: free packs, matches against the AI, and challenges with guildmates. No account needed to look around: tap "Look at a sample guild". Thanks for testing; tell us what breaks.
</en-US>
<fr-CA>
Première version de Guilded pour Android. Cinq onglets : Guilde (membres, carte, raids), Stats (classements publics et résumé de la semaine), Moi (personnages, badges, souhaits), Alertes (rappels de raid sur votre téléphone) et Nouvelles. Inclut Guilded Clash, le jeu de cartes : paquets gratuits, parties contre l'IA et défis entre membres de la guilde. Aucun compte requis pour explorer : touchez « Voir une guilde d'exemple ». Merci de tester, dites-nous ce qui cloche.
</fr-CA>
```

The sample-guild button reads "Look at a sample guild" / "Voir une guilde d'exemple" (`mobile/src/i18n.ts`), as quoted above.
