# Google Play production access: draft answers

For **Guild Sync Companion** (`top.kcaron.guilded`). Drafted 26 November 2026 from the git history of `mobile/`, the
store documents here and what Play Console showed that day. **The owner reads, corrects and submits.** Nothing has been
typed into the application form.

Open it from Play Console **Dashboard → Apply for production**. It unlocks after 12 testers have been opted in for 14
days in a row: on 26 November the Dashboard said **12 testers, 9 days**, so about **1 December 2026**. Google says a
review usually takes seven days or less
([testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465)).

## Before you apply

1. **Keep the tester list as it is.** There are exactly 12. If one leaves, the count drops under 12 and the 14 days
   start again.
2. **Read the Testers Community report and anything sent to `support@guildedwow.com`.** Neither is in this repository, so
   the feedback answer below cannot include them. Add what they say.
3. **Get testers to open 0.6.0 and use it.** Google can ask for more testing when engagement is low. Play showed 10
   device acquisitions, 8 first opens and 7 monthly active devices.
4. **Try the signed-in features on a real phone.** Push for a call for help and for a raid spot, a character page with a
   real account and crafting against your guild's recipes were not yet checked on a phone when 0.6.0 was built.
5. **Send the saved changes for review** (Publishing overview): the new descriptions and screenshots in both languages,
   and the Data safety form. They are saved, not sent.
6. **Update the numbers** in the answers if Play shows different ones that day, and delete any sentence that is not true.

## What Play Console showed on 26 November 2026

| Fact | Value |
| --- | --- |
| Testers opted in | 12, for 9 days in a row |
| Releases on the closed track | 0.3.0 (15 Nov), 0.4.0 and 0.4.1 (18 Nov), 0.5.0 (19 Nov), 0.5.1 (23 Nov), 0.5.2 (24 Nov), 0.6.0 (26 Nov, available to testers at 6:24 a.m.) |
| Device acquisitions / first opens / monthly active devices (28 days) | 10 / 8 / 7 |
| Private feedback in Play (Testing feedback) | none |
| Android vitals, user-perceived crashes and ANRs, 29 Oct to 26 Nov | none reported (a small group, so this says little on its own) |

## Part 1: About your closed test

**How did you recruit users for your closed test?** (300 characters at most)

> I used Testers Community, a paid testing service: its testers joined the closed track through a Google Group. The app
> is for guilds that use my Discord bot, so testers without a guild were told to open the built-in sample guild.

If guild members also joined the test, add: "Some members of my guild joined too."

**How easy was it to recruit testers for your app?** Suggested: **Easy** (a paid service supplied them). Your call.

**Describe the engagement you received from testers** (300 characters at most)

> 12 testers stayed opted in; Play counted 10 device installs and 7 monthly active devices. Without a guild, testers had
> the sample guild, public stats, news and alerts. Raid sign-up, crafting and push need a real guild, where members
> would open the app around raid times.

**Summary of the feedback and how you collected it** (300 characters at most)

Use **A** when the report or the support address holds feedback: replace the part in brackets with the real points.

> A. Collected through Play's private feedback, support@guildedwow.com and the Testers Community report. Testers
> reported: [two or three real points]. Android vitals showed no crashes or ANRs.

Use **B** only if you checked both and found nothing.

> B. Testers could use Play's private feedback, support@guildedwow.com or Testers Community. I received no problem
> reports, and Android vitals showed no crashes or ANRs. Fixes during the test came from my own walkthroughs and an
> audit of the app.

## Part 2: About your app

**Target audience** (be specific)

> Members of World of Warcraft guilds that use the Guilded Discord bot, aged 13 and over and mostly adults, who want
> their guild on their phone, in English or French.

**How your app provides value to users**

> Shows your guild away from the game: raid sign-up and reminders, alerts when a guildmate needs help or a raid spot
> opens, crafting requests, guild activity, your characters and badges, and public leaderboards. Free, no ads, nothing
> to buy.

**Expected installs in the first year:** choose the **lowest range** Play offers.

## Part 3: Your production readiness

**What changes did you make based on what you learned in the closed test?**

> From my own checks, 0.4.0 to 0.6.0: offline copies, error reports, better Back button and touch targets, French
> fixes, a first screen that fits small phones, clearer boards and alerts. Also added raid sign-up, guild activity,
> crafting, character pages and push alerts.

**How did you decide your app is ready for production?**

> No crashes or ANRs in Android vitals during the test. The code is checked and tested automatically. Anyone can try
> the sample guild without an account, data can be deleted in the app, and the listing and Data safety form describe
> version 0.6.0.

## Where the change list comes from

| Version | What changed (pull requests) |
| --- | --- |
| 0.4.0, 0.4.1 | Offline copies, Duels and seasons, first-launch screens, roster filters, error report button, notification permission flow (#1102); optional portrait (#1103); safe areas, Android Back, retry and refresh, touch targets (#1104, #1105) |
| 0.5.0 | My characters, promotion status, raid progress (#1133) |
| 0.5.1 | News through the website, French error text (#1249); raid sign-up and reminders (#1259) |
| 0.5.2 | Class names as in the game and in French, cleaner boards, "Coming later" instead of switches that did nothing, first screen fits small phones; found walking the app at 390 × 800 (#1294) |
| 0.6.0 | Push for calls for help and raid spots, guild activity, crafting, character page (#1296 to #1299) |

These came from the developer's own use and checks. The repository records no fix made from a tester's report, so do not
claim one unless the report or the support mail shows it.
