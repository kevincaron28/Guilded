# Google Play production access: draft answers

For **Guild Sync Companion** (`top.kcaron.guilded`). Drafted 26 November 2026, updated 27 November with the two
Testers Community reports (the ASO audit and their answer template). The sources are the git history of `mobile/`,
the store documents here and Play Console. **The owner reads, corrects and submits.** Nothing has been typed into the
application form.

Open it from Play Console **Dashboard → Apply for production**. It unlocks after 12 testers have been opted in for 14
days in a row: on 26 November the Dashboard said **12 testers, 9 days**, so about **1 December 2026**. Google says a
review usually takes seven days or less
([testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465)).

**Apply after 0.7.0 has reached the testers.** 0.7.0 carries what the testers asked for. The two answers about changes
and readiness have a version **A** (0.7.0 is available on the closed track) and a version **B** (it is not). On
27 November it is not.

## Before you apply

1. **Keep the tester list as it is.** There are exactly 12. If one leaves, the count drops under 12 and the 14 days
   start again.
2. **Check the guild-members sentence** in the recruiting answer. The closed track's tester list is the Testers
   Community Google Group, so a guild member could join only through that group or a list you added. Keep the sentence
   only if guild members really tested the app; otherwise delete it.
3. **Release 0.7.0 to the closed track and check what shipped** against version A: in-app privacy policy, rate, share,
   help and FAQ, walkthrough, Back to leave the app, keyboard fix, feedback. Delete anything that did not ship.
4. **Send the store listing with 0.7.0:** save the names and descriptions in [play-listing.md](play-listing.md) in
   Play Console (not yet done on 27 November), then send them from Publishing overview.
5. **Check Data safety against 0.7.0.** If the new feedback option sends anything new from the phone, update
   [play-data-safety.md](play-data-safety.md) and the form first.
6. **Get testers to open 0.7.0 and use it.** Google can ask for more testing when engagement is low.
7. **Try the signed-in features on a real phone:** push for a call for help and for a raid spot, a character page with
   a real account and crafting against your guild's recipes.
8. **Read anything sent to `support@guildedwow.com`** and the Testers Community reports again; add real points that are
   missing here.
9. **Update the numbers** in the answers if Play shows different ones that day, and delete any sentence that is not true.

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

> I used Testers Community, a paid testing service, whose testers joined the closed track through a Google Group. I also
> asked members of my World of Warcraft guild, Québec Gold, the people the app is made for. Without a Guilded guild,
> testers could use the built-in sample guild.

**How easy was it to recruit testers for your app?** **Easy** (a paid service supplied them). Your call.

**Describe the engagement you received from testers** (300 characters at most)

> 12 testers stayed opted in; Play counted 10 device installs and 7 monthly active devices. Testers without a guild had
> the sample guild, public stats, news and alerts. Raid sign-up, crafting and push need a real guild. Requests reached
> me in Testers Community's reports.

**Summary of the feedback and how you collected it** (300 characters at most)

> Through Testers Community's reports. Asked for: a fuller store description, privacy policy in the app, rate and share
> options, help and FAQ, a better walkthrough, Back to leave the app, a keyboard fix and a way to send feedback. Play
> showed no crashes or ANRs.

## Part 2: About your app

**Target audience** (be specific)

> World of Warcraft players and guild members, 13 and over and mostly adults, whose guild uses the Guilded Discord bot
> and who want their guild on their phone, in English or French.

**How your app provides value to users**

> It keeps members organized away from the game: raid sign-up and reminders, alerts when a guildmate needs help or a
> raid spot opens, crafting requests, guild activity and map, their characters and badges, and public leaderboards. No
> ads, nothing to buy.

**Expected installs in the first year:** choose the **lowest range** Play offers. The app is for guilds that use one
Discord bot, and the closed test saw 10 installs. (The Testers Community template suggests 10,000 to 100,000; nothing
supports that.)

## Part 3: Your production readiness

**What changes did you make based on what you learned in the closed test?**

A. Use only after 0.7.0 is available to testers:

> From testers' requests, 0.7.0 adds the privacy policy in the app, rate and share options, help and FAQ, a better
> walkthrough, Back to leave the app, a keyboard fix and a feedback option, with a fuller store description. Earlier
> test builds added raid sign-up, crafting and push.

B. Use if you apply before 0.7.0 is out:

> Test builds 0.4.0 to 0.6.0 added offline copies, error reports, better Back and touch targets, French fixes, raid
> sign-up, guild activity, crafting, character pages and push. Testers' requests (in-app privacy, rate, share, help,
> walkthrough) are in the next update.

**How did you decide your app is ready for production?**

A. Use only after 0.7.0 is available to testers:

> Testers' requests are in 0.7.0, Android vitals showed no crashes or ANRs, and the code is checked and tested
> automatically. Anyone can try the sample guild without an account, data can be deleted in the app, and the listing
> and Data safety form describe the app.

B. Use if you apply before 0.7.0 is out:

> Android vitals showed no crashes or ANRs during the test, and the code is checked and tested automatically. Anyone
> can try the sample guild without an account and data can be deleted in the app. The testers' requests are small
> additions planned for the next update.

**What did you do differently this time?** The template has this question for a second application; the form seen on
26 November did not. If Google asks it, answer from what changed after the first application.

## Where the change list comes from

| Version | What changed (pull requests) |
| --- | --- |
| 0.4.0, 0.4.1 | Offline copies, Duels and seasons, first-launch screens, roster filters, error report button, notification permission flow (#1102); optional portrait (#1103); safe areas, Android Back, retry and refresh, touch targets (#1104, #1105) |
| 0.5.0 | My characters, promotion status, raid progress (#1133) |
| 0.5.1 | News through the website, French error text (#1249); raid sign-up and reminders (#1259) |
| 0.5.2 | Class names as in the game and in French, cleaner boards, "Coming later" instead of switches that did nothing, first screen fits small phones; found walking the app at 390 × 800 (#1294) |
| 0.6.0 | Push for calls for help and raid spots, guild activity, crafting, character page (#1296 to #1299) |
| 0.7.0 | Being built on 27 November: the testers' requests listed above. Confirm what shipped before using answer A. |

0.4.0 to 0.6.0 came from the developer's own use and checks. Do not say a tester's report led to any of them.

The Testers Community answer template also claims things that are not recorded anywhere: feedback gathered by surveys
and direct conversations, "diverse testers", "critical usability issues" fixed, and changes already made. None of that
is used here.
