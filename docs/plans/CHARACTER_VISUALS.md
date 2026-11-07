# Character pictures on cards and profiles (plan, 7 November 2026)

Status: **plan only.** Nothing here is built. The owner picks; this document recommends.

Owner question: "How can we implement character screenshot sharing or character visual sharing with the website and Discord, so a picture of the character appears on certain cards or the website profile?"

## Recommendation (short)

**Build "Character picture": a member-chosen image per character, shown on cards, the website profile and the phone app, with a generated emblem as the fallback.** Ways to get the image, in order of build:

1. **Upload on the website** (My profile -> a character -> Change picture). Works on every platform, needs nothing from Blizzard.
2. **"Take a character photo" in the addon**, picked up by the companion: `/guilded photo` hides the interface, takes a screenshot, and the companion crops, shrinks and uploads it. The easy path for most members once built.
3. **Generated emblem** (class colour, race-neutral crest, level and rank ring, original art) for characters with no picture, so every card looks finished.

Do **not** build on the Blizzard character media API until Blizzard publishes a Forever realm (it is closed today), and do not read the armory pages. Keep the armory link as is.

## Where things stand

| Fact | Source |
| --- | --- |
| Forever profile API is closed: no realm is published, every profile route 404s. Character media (`character-media`) is a profile route, so it is closed too. | [FOREVER_ARMORY.md](../FOREVER_ARMORY.md), probe 7 Nov |
| The armory character page has an "Export character image" button and serves avatar images from `render.worldofwarcraft.com`, but there is no public endpoint, and Blizzard's Developer API Terms forbid scraping. | same |
| Cards already take a portrait: `ScoreCard.portrait` is a base64 image drawn in a circle, and `withDiscordMember` (`src/services/card-member.ts`) fills it with the member's Discord avatar at delivery, capped at 1 MB. The stored card never holds the image. | `score-card.ts`, `card-member.ts` |
| `Character` has `race`, `className`, `spec`, `level`, `isMain` but no image. Companion API bodies are capped at 1 MB (`MAX_BODY_BYTES`). | `prisma/schema.prisma`, `src/companion-api.ts` |
| The addon cannot read files and has no network. It can ask the game to take a screenshot and write notes to SavedVariables, which the companion reads. | addon / companion design |

So the plumbing for "a picture on a card" already exists; what is missing is a **source of pictures** and a place to keep them.

## The options

| # | Option | Looks like | Works today | Privacy / moderation | Effort | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| A | **Blizzard character media API** (`avatar`, `inset`, `main-raw` renders) | The real character, Blizzard's own render | **No.** No Forever realm, profile namespace answers 404 | Public data, no moderation | Small once open: fetch, cache, refresh daily | Wait. Re-run `scripts/forever-armory-probe.mjs` after Forever patches. Add later as a source "from the armory" |
| B | **Read the armory page** or hotlink its image URLs | The real character | Technically, but it is scraping | Forbidden by the Developer API Terms | - | **No** |
| C | **Member uploads an image** (website, phone app later) | Whatever they choose: screenshot, the armory's "Export character image" file, art | Yes | Needs limits and moderation (below) | 4-6 days | **Build first** |
| D | **Addon photo mode + companion upload** | A real screenshot of the character, framed for a portrait | Needs a real client check (see risks) | Same as C, plus the capture itself is the member's own screenshot | 5-8 days | **Build second**, feeds the same store as C |
| E | **Generated portrait** from race, class and gear | A stylised emblem, not the character | Yes | No user content, so nothing to moderate | 3-4 days | **Build as the fallback**, not as the headline answer |
| F | **Discord avatar** (today) | The person, not the character | Yes | Already live | Done | Keep as the last fallback |

Why not only E: it is the safest, but it answers "a picture of the character" with a badge. Why not only C: most members will never visit a web form; D removes the work. A and B are not available.

## How option D works (addon photo mode)

1. Member types `/guilded photo` (or a button on their character tab). The addon opens a small preview using the game's own model frame (the character facing the camera), hides the rest of the interface, and calls `Screenshot()`.
2. The addon writes `photoRequest = { character, at, edition }` to SavedVariables. It cannot read the screenshot file and does not try to.
3. The companion (which already knows the WoW folder and reads SavedVariables) looks in that edition's `Screenshots` folder for the newest image taken at or after `at`, within a few minutes.
4. The companion crops to the centre, shrinks it to 768 px on the long side, strips metadata, converts to JPEG/WebP under 400 KB, shows a **preview with Accept / Retake** in its window, and only then uploads it to the member's character.
5. Nothing leaves the PC until the member presses Accept. The raw screenshot stays in the WoW folder, untouched.

Blizzard policy check: taking a screenshot and the companion reading a folder are ordinary; the addon asks for no payment and shows no ads. The policy question is about money, not images ([MONETIZATION.md](MONETIZATION.md)).

Risks to settle with a real client before building: whether `Screenshot()` works from an addon on the Forever client (the Classic API has it, unverified there); where Forever writes its `Screenshots` folder; whether a hidden-interface capture shows the interface for one frame; and the character model facing/zoom APIs on the Forever client. If `Screenshot()` is blocked, D degrades to "press PrtScn or Print Screen, then the companion offers the newest image", which still works because the companion only reads the folder.

## Storage, size and cost

Keep the picture in the existing PostgreSQL database in a new table (no object storage service to run or pay for):

`CharacterPicture { characterId (unique), guildId, contentType, large (bytea ~256x320 WebP), thumb (bytea 96x120 WebP), version, source ("upload" | "addon" | "armory"), visibility, status ("ok" | "removed"), createdAt, updatedAt, reviewedById? }`

| Limit | Value | Why |
| --- | --- | --- |
| Upload accepted | JPEG, PNG, WebP, up to 5 MB, up to 4096 px a side | Covers a 4K screenshot |
| Stored | Re-encoded with `sharp` to a 512 px long edge WebP (about 40-80 KB) plus a 96 px thumb (about 5 KB); EXIF/GPS stripped; animated images flattened | Small, predictable, no tracking data |
| Per character | One current picture; the previous one kept for 30 days for undo | Keeps storage bounded |
| Per member | One picture per linked character, and the picture follows a character that is relinked | Matches ownership |
| Rate | 5 uploads a day per member | Stops abuse and scripts |
| Cost | 238 members x about 85 KB = about 20 MB | Negligible on Aiven; it is far smaller than the ledger tables |

Companion route: the 1 MB `MAX_BODY_BYTES` cap stays. The companion shrinks first, so its upload is under 400 KB; the website upload form uses a separate route with its own 5 MB cap and the same re-encode step.

Serving: `GET /portrait/{characterId}-{version}.webp` (large) and `.../thumb.webp`, versioned in the URL so a change busts caches, `cache-control: public, max-age=86400, immutable`. For members who keep the picture guild-only, the route answers 404 without a guild session and only the bot's card renderer reads the bytes from the database. The Worker needs the path allowlisted, as for the other public routes.

## Privacy and moderation

Default stance: **a picture is the member's own content, shown where the member's character is already shown, and the member can remove it any time.**

- **Opt-in by action.** Nothing is uploaded unless the member picks a picture or accepts a photo. That is the consent; no automatic capture, no background screenshots, no reading other images in the folder.
- **Visibility switch per picture:** *Guild only* (default: cards in that server's Discord channels, the guild website pages behind sign-in, the phone app) or *Public* (also the public profile and share images). Public is explicit.
- **Server off switch:** an officer setting turns pictures off for the server (cards fall back to the emblem). Matches the repo's "every new feature has officer and member off switches" rule.
- **Removal:** the member can remove or replace it on their profile and in the companion; an officer can remove any picture in their server (`/officer picture remove`) and the removal is logged. `Delete my data` deletes the picture and its history.
- **Reports:** a "Report picture" link on the profile and `/report bug`-style flow to the officers; the report uses the existing report channel.
- **Automated checks:** content type sniffed from bytes (not the file name), decompression-bomb limits in `sharp`, re-encode so any hidden payload is dropped. No image classifier on day one; the safeguards are accountability (pictures are tied to a linked member), visibility defaults, officer removal and the report link. If abuse appears, add a hash block list of removed images (an officer-removed image cannot be re-uploaded) before considering a moderation API.
- **Faces and people:** a character screenshot normally has no real person. The upload screen says "a picture of your character, not of a person". Only the character's own picture is allowed, not other members' photos.
- **Copyright:** screenshots of one's own character are fan content; the member confirms "this is my own screenshot or image". No Blizzard art is bundled in the bot or used for the emblem.
- **Minors/GDPR/Law 25:** the image is personal data only if it identifies someone; the Privacy page lists pictures as a data category with the same access, export and deletion route as the rest.
- **Discord side:** a card is posted by the bot into a channel. The image is drawn into the card PNG at delivery (as the Discord avatar is today), so Discord stores a rendered card, not the member's file, and a later removal stops new cards but cannot recall posts already made. The upload screen says so.

## Card and site integration

Resolution order for any picture slot: **character picture -> generated emblem -> Discord avatar** (the existing fallback stays last so cards never look empty).

| Surface | What shows | Size |
| --- | --- | --- |
| Character card (`/character`, "my card") | Large picture left, name, class colour edge, level, rank | 200 px circle or 3:4 panel |
| Roster card (`renderRoster`) | Thumb per row, optional | 40 px |
| Dungeon party card (`renderDungeon`) | Thumb beside each member | 56 px |
| Unlock/achievement card (`renderUnlock`) | Existing 80 px circle | 80 px |
| Website profile (`/me`, public profile, guild member page) | Hero picture plus name | 160-256 px |
| Share image / Open Graph for a public profile | The card PNG with the picture | 1200x630 |
| Phone app (Me tab, Guild roster) | Thumb in rows, large on the profile | 48 / 160 px |

Code touch points: `withDiscordMember` becomes `withMemberPicture`, which reads the stored thumb/large for the character first (a database read, no network); `ScoreCard.portrait` and the existing circle mask do the drawing, so card layout code barely changes. Queued Discord messages keep storing a card definition without bytes and draw the picture on delivery, as today.

## Recommendation, in order

1. **Slice 1 (backend, 3-4 days):** `CharacterPicture` table and migration, upload route with re-encode and limits, serve routes, officer remove, Delete-my-data, privacy text, tests. No UI yet beyond a hidden test page.
2. **Slice 2 (website and cards, 3 days):** My profile "Change picture" with visibility switch, `withMemberPicture` on the character, roster and party cards, profile hero, French strings.
3. **Slice 3 (emblem fallback, 3 days):** generated emblem in `score-card.ts` from class, level band and rank, original art only.
4. **Slice 4 (addon and companion, 5-8 days, needs a real client):** `/guilded photo`, SavedVariables handshake, companion preview with Accept/Retake. Ship in a normal addon release.
5. **Later:** phone app picker, and Blizzard media as an extra source when a Forever realm appears.

Version rule: slices 1-3 are bot and website only and need no addon change; slice 4 rides with an addon release. Bump nothing from this plan.

## Open questions for the owner

1. Is "guild only" the right default, with Public as an explicit choice? (Recommended.)
2. Should officers be able to *require* the emblem (pictures off) per server? (Recommended: yes, the server switch above.)
3. Is a screenshot-only picture enough, or should members also be able to upload any artwork? (Recommended: allow any image the member owns; the officer remove and report path cover the rest.)
4. Does the owner accept that a removed picture cannot be pulled out of cards already posted in Discord?

## Re-check when

- Blizzard lists a Forever realm or namespace (run `scripts/forever-armory-probe.mjs`): then add option A as a "from the armory" source with a refresh job.
- A real Forever client confirms `Screenshot()` and the `Screenshots` folder path (slice 4 gate).
