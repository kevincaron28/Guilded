# Raid signup post layout (29 October 2026)

The Components V2 signup post now reads like a calendar event card, after the
Guilds of WoW raid post the owner shared. Code: `src/services/signup-layout.ts`;
tests: `tests/signup-layout.test.ts`. No version bump, migration or addon change.

## What the post shows

1. **Header:** the Discord server's name and icon, then the raid title. When the
   raid has a native Discord event, the title links to it ("Interested" turns on
   Discord's reminders). Then the officer's description and, with `close_hours`,
   "Signups lock N h before the start (in …)".
2. **Local time:** `<t:…:F> · <t:…:R>`, so every reader sees their own time.
3. **Summary, two facts per line:** status, raid core, attendees (✅ signed
   up / total seats when all three role caps are set) and average item level of
   the signed-up characters with a gear check from the last 24 hours.
4. **Role blocks:** Tanks, Healers, DPS, each with an icon, an uppercase label, a
   count badge (`2/2`) and FULL, then one player per line: one spec icon (class
   icon if the spec emoji is missing), the character name, ⭐/🪑 for the core,
   ⏰ when late and `⚠️ N` when the latest gear check has open problems.
5. **Other answers**, compact, with counts: Late, Tentative (Maybe), Waitlist
   (in order), Bench (core bench not answered), Declined ("Can't come"),
   Pending (core members not answered) and Open spots for core raids.
6. **Footer:** how to sign up, the core legend, the ⚠️ legend, `/raid roster`,
   then the unchanged buttons (Tank, Healer, DPS, Maybe, Can't come, Late).

## Data choices

- Discord V2 has no side-by-side columns, so blocks stack; each other list
  shares lines, which stays short for large guilds.
- Roles stay Tank/Healer/DPS. Melee/ranged is not stored, and specs alone are
  not enough (Survival hunters are melee in Retail but ranged in Classic).
- `⚠️ N` counts the latest addon gear check's unresolved WARNING and ERROR
  findings (missing gear or enchants, low durability, no flask/food in a raid
  group), only when that check is under 24 hours old, like `/readiness`.
- Declined lists signups cancelled with "Can't come"; a core member who
  declined is no longer listed as pending.
- Legacy embed posts keep `buildSignupEmbed` unchanged.

## Limits

A V2 message allows 4000 characters of text and 40 components. The post uses at
most about 28 components. Every heading always fits. Role blocks get room first;
each other list keeps about 200 characters, and anything cut ends in "+N more",
never half an emoji. Tests cover 10-, 20- and 40-player raids, an empty raid,
French text and an oversized roster.

## Not verified

Rendering in a real Discord client (desktop and mobile, light and dark) was not
checked; only the payload was tested. Check a new post in a test server before
relying on the look, especially the title link and the guild icon thumbnail.
