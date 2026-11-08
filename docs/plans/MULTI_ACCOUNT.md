# Several game accounts, one member (plan)

Owner request, 7 November 2026 (list 3, item 3, P2): "multiple account setup, so people with the
companion and several Battle.net accounts can link them all".

**Owner decisions (7 November 2026):** 1) sync every account folder found; 2) the first time a
second account folder appears, ask once whether it belongs to the same person, and remember the
answer; 3) up to 5 Battle.net accounts per member; 4) companion part first.

**Built:** step 1 (`companion/wow-accounts.mjs`: one engine per account, the "Is WOW2 yours too?"
question under the Sync status card, Repair and setup start with the newest account instead of
stopping). Standings stay in the install's `Interface\AddOns` folder, which every account of that
install shares, so only the first account's engine writes them.

**Built:** step 2: one line per account on the Sync page (synced, waiting for a /reload, or its
error) and in Settings › Your WoW folder, with a switch beside each further account. Switching
one off stops its sync and it is never asked about again; switching it back on syncs it again.

**Not built (owner, 7 November 2026): step 3.** Battle.net identities were removed with the
Forever-only focus (#573): no Battle.net sign-in, page or auto-link is left, and the stored rows
are no longer read. Step 1 already syncs every WoW account folder on a PC, two Battle.net logins
included, and characters are proven from the saved data, so several accounts are covered without it.

## 1. Who this is for

A member is one Discord account. Behind that one person there can be:

| Case | What is on their PC | How common |
|---|---|---|
| **A. One Battle.net, several WoW licences** | One WoW install; `WTF\Account\WOW1` and `WTF\Account\WOW2` (Battle.net's "WoW1 / WoW2" accounts) | Common for multiboxers and people with a second licence for alts |
| **B. Several Battle.net accounts on one PC** | One WoW install; one `WTF\Account\<NAME>` folder per Battle.net login | Partners sharing a PC, or a member with an old and a new Battle.net |
| **C. The same member on two PCs** | One companion per PC | Desktop plus laptop |

In every case the member wants all their characters linked to their one Discord account, synced,
and shown together, without picking one account and losing the others.

## 2. What happens today

**Companion: one WoW account folder per connection.**
- Each connection watches one `Guilded.lua` (`config.watchFile`), which lives in one account folder.
- When the WoW folder holds several account folders, setup and Repair stop with "Several WoW accounts were found. Choose WoW folder and pick yours." (`companion-app/repair.cjs`, `detect-wow.cjs`). The other accounts never sync.
- The only workaround is Settings › Advanced › Guild connections: add a second connection for the same guild and point it at the other folder. It works, but nobody will find it.
  - Two connections to the same guild also need an exact WoW guild name on each (`companion/profile-engine.mjs`, "Shared saved data needs an exact WoW guild name…").

**Bot and website: one Battle.net per member.**
- `BattleNetIdentity.accountId` is `@unique` (`prisma/schema.prisma`), so a website account holds one Battle.net identity.
- Linking a second Battle.net replaces the first, including its selected characters (`battlenet-store.ts`, `upsert` on `accountId`).
- `subject` (the Battle.net account's id) is also unique. That part is right, and stays: one Battle.net account can belong to only one member.

**Characters: already per character.**
- The companion proves ownership from the saved data of whichever file it watches, and the bot links each character to the member.
- So once more folders are watched, their characters link the same way. No new proof is needed.

**Case C (two PCs) already works.** Each PC's companion signs in as the same Discord member. Each is a separate device (`companion-devices.ts`), and both PCs' characters land on the same account. It stays as it is.

## 3. Proposal

### 3.1 Companion: sync every account folder it finds (cases A and B)

**Watched files:**
- One connection watches **every account folder under the chosen WoW install that has `Guilded.lua`**, not just one.
- `config.watchFile` stays as the first, for older code and the Copy report.
- A new `config.watchFiles: string[]` holds the rest. It is filled by the same search that today stops at "Several WoW accounts".

**Uploads:**
- Each file uploads on its own, as today, with its own change detection. The engine loops over the files.
- The bot already accepts any number of uploads from one credential.
- Standings are written back into **each** watched file, so the addon on every account sees them.

**Setup and Repair:**
- They never ask "which account?" again.
- Several found: "Found 2 WoW accounts (WOW1, WOW2): both will sync."
- A member can still turn one off in Settings › Your WoW folder, where each account shows as a line with a switch.

**Status card:**
- The guild line shows the last /reload across all files.
- A problem names the account it is about ("WOW2 has not saved Guilded's data yet").

**Advanced › Guild connections stays for its real purpose:** different guilds or editions, not different accounts of the same guild.

### 3.2 Bot and website: several Battle.net accounts per member (case B)

**Schema:**
- Drop `@unique` on `BattleNetIdentity.accountId` and add `@@unique([accountId, subject])`. `subject` stays globally unique.
- The migration is hand-written: drop the unique index, then add the composite index. Existing rows don't change.

**Store:**
- `get` returns a list.
- `link` adds a new identity, or updates the one with the same `subject`; it never replaces another one.
- `unlink` takes the identity id.

**`/me/battlenet` page:**
- One card per linked Battle.net: BattleTag, its selected characters, Unlink.
- Then **Link another Battle.net account**.
- When the member signs in to Battle.net, Blizzard's own login decides which account comes back. The page says to sign out of Battle.net in the browser first, or use a private window, to add a different one.

**Readers:**
- Code that expects one identity (the player page, auto-link, `link-status`) uses the list.
- "Main" stays one character across all identities.

### 3.3 What a member sees

| Situation | Today | Proposed |
|---|---|---|
| Two WoW accounts on the PC | Setup stops: "Several WoW accounts were found. Choose WoW folder and pick yours." | "Found 2 WoW accounts: both will sync." Nothing to choose. |
| One account never /reloaded | Silent (not watched) | Status card: "WOW2: waiting for WoW to save your addon data. Log in on that account and type /reload once." |
| Second Battle.net on the website | Replaces the first | Added as a second card, both kept |
| Turn one account off | Not possible | Settings › Your WoW folder › switch beside that account |

## 4. Build plan (after the owner picks)

Each step is its own PR, keeps everything working, and comes in English and French with tests.

1. **Companion: watch several account folders.** Add `watchFiles`, the engine loop, standings written to each file, and the setup/Repair wording. Tests: a fake install with WOW1 and WOW2, both synced; one turned off; upgrading from a single-file config.
2. **Companion: per-account status and switches** in Settings and on the status card.
3. **Bot: several Battle.net identities** (migration, store, page, readers). Tests: link two, unlink one; the same `subject` can't go to two members.
4. **Docs:** the member install guide and the companion page ("several WoW accounts sync by themselves").

Real-client checks owed for step 1: two WoW licences on one Battle.net, and two Battle.net logins on one PC.

## 5. Questions for the owner

1. **Default:** sync every account folder found (proposed), or ask once and remember?
2. **Partners on one PC (case B):** two people, two Discord accounts, one Windows login. Watching every folder would send one person's characters as the other's. Proposed: the first time a second account folder appears, ask once, "Is WOW2 also yours?". Only a yes adds it. Is that acceptable, or should it never ask (one person per PC)?
3. **Battle.net limit:** cap the number of Battle.net accounts per member (say 5), or no limit?
4. **Order:** build the companion part first (it covers cases A and B for syncing without any bot change), then Battle.net (proposed)?
