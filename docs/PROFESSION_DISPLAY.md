# How professions are shown in Discord (8.5, track D, owner requests 9 and 11)

One look everywhere: the directory index, each profession's post, the recipe picker's reply, `/craft who` and the
Artisans' Gallery all use `src/services/profession-style.ts`.

## Before

- The directory was one text block, `**Alchemy**: 3 crafters · last seen: …`, plain names, no icon, no way to jump.
- A profession post was a wall of `• **Recipe** — Name (today), Name (5 weeks ago)` lines. Skill was a bare number in a
  comma-separated sentence. Nothing on a recipe was clickable.
- The gallery showed `Alchemy 300` as text.

## After

| Element | Choice | Why |
| --- | --- | --- |
| Icon | One Unicode emoji per profession (🧪 Alchemy, ⚒️ Blacksmithing, ⛏️ Mining…) | Custom server emoji need uploads and a permission per server, break on a fresh server and in the website; Unicode renders everywhere, in both languages, with no setup. Unknown names get 📚. |
| Skill | `▰▰▰▰▰▰▱▱ 225`, scaled to 300 (375 or 450 once a skill passes the lower cap) | A bar compares eight crafters at a glance; the number stays for exactness. Plain characters, so it survives mobile, screen readers (the website marks the bar `aria-hidden` and keeps the number) and copy-paste. |
| Recency | 🟢 seen this week, 🟡 this month, ⚪ longer or unknown, plus "3 weeks ago" | The dot answers "will they answer?" before reading; the words stay for precision. Same wording as D3 everywhere. |
| Grouping | One post per profession (D2), crafters first, then recipes | The thing a member looks for is a profession, then a person, then a recipe. |
| Legend | One line under each post and under the directory | Without it a bar and a dot are guesses; one line costs almost nothing. |
| Navigation | Directory: one **link button per profession** to its post (5 per row, up to 25). Each post: a **recipe picker** (25 most recently crafted by active people) | A select menu cannot jump to a channel (Discord only sends the choice to the bot), but a link button can, and channel mentions in the text also work. Inside a post, a select is the right tool: 25 recipes in a single row instead of 25 buttons. The rest are one `/craft who` or gallery search away. |

## Request and Details (owner request 9)

Picking a recipe opens a private reply: the item, who can craft it, and

- **Request** opens the existing "Request a craft" form with the item and profession filled in.
- A menu **"Or request it from one crafter"** opens the same form with the crafter chosen. The new request post then
  mentions that crafter **once**, at creation (it is never repeated on edits), never the requester, and only that person
  (`allowedMentions`).
- **Details** shows the item id, a Wowhead link and, when an item source is connected, quality and summary. Without a source
  it says stats are not available yet; nothing is invented (same rule as `docs/ITEM_PREVIEWS.md`).

On the gallery each crafter row has its own **Request** button (same behaviour, same one-time mention) and each item a
**Details** fold-out. Both surfaces use `src/services/item-details.ts`, built on the item-preview data seam
(`ItemDataProvider`), so a provider connected by track C lights up Details in both places and in chat previews.
Track C's compact "Details" for chat links is a different message; if it lands first, point its helper at
`itemDetails()` or the other way round; the data seam is the shared part.

## Limits worth knowing

- Reagent search still needs recipe materials that the addon does not upload yet.
- Posts are edited by the existing profession refresh job; Discord components in an old post appear on its next edit.
- Everything is on by default; an officer switches the posts off with `/craft posts-setting` (see `docs/ARTISANS_GALLERY.md`).

## One profession, one name in every game language (9 November 2026)

French and English WoW Forever clients report a profession under their own language ("Cuisine", "Cooking"), and the guild
saw two professions. The stored and sent key is now the English name, identified by the skill line id when the game gives
it, else by any client's localized name (`src/services/profession-names.ts` for the bot, the same table in
`addon/Guilded/Util.lua`; a test keeps them equal). The addon sends and stores English names and shows the player's own
language through Locale.lua; the bot maps names on arrival (so an older addon cannot split a profession again) and shows
the server's language. Migration `20270130000000_canonical_profession_names` merged rows already stored under a localized
name (the highest skill wins, nothing else is dropped); the addon rewrites older SavedVariables when it loads.
