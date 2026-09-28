# Character pairing implementation handoff

This page describes the account-pairing change for the next developer/AI
working on the repository. It is intended as implementation context, not as
an additional product spec.

## What changed

- Added `/character pair`. It creates a code bound to the caller's Discord
  member and guild. The code expires after 15 minutes and is single-use.
- Added **Discord account pairing code** and **Link Discord account** to the
  desktop Companion Settings. The command-line watcher also accepts a
  `pairingCode` in `companion/companion.config.json` and exchanges it at startup.
- Successful exchange issues a random per-companion credential. Only its
  SHA-256 hash is stored in Postgres; the secret is stored in that companion's
  local config and sent as `x-companion-credential` on addon uploads.
- Paired uploads link only their top-level `character` (the exporter's own
  character) to that member, directly on upload, even when the export is a
  duplicate or imports await officer approval. Characters in the shared guild
  digest remain on the existing auto-match/claim/officer-link path.
- One active credential per member: exchanging a new pairing code revokes any
  credential(s) already issued to that member first (`revokeCompanionCredentials`
  in `character-pairing.ts`). This doubles as self-service recovery (lost
  laptop, new PC: just run `/character pair` again) and keeps `CompanionCredential`
  rows from accumulating unbounded. It does NOT fire on code issuance, only on
  a successful exchange — so generating a code you never use can't lock out an
  already-working companion.
- `/character unlink` also revokes the affected member's credentials, but only
  when an *officer* unlinks someone else's character (not a self-unlink).
  Without this, a paired companion would silently relink the exact character an
  officer just removed on its next upload, defeating the point of `/unlink`.
- The character-upsert logic (normalize class/race, clamp level, upsert
  professions, clear from unclaimed) is shared via `createSelfCharacter()` in
  `character-pairing.ts`, called both by the immediate upload-time link and by
  the apply-time safety net in `addon-import.ts` — kept as one function so the
  two call sites can't drift apart.
- Updated command, getting-started, `/setup` wizard, and `/help` text so
  `/character pair` is the first thing new members are told to run, not just
  something documented in markdown.

## Files to know

- `src/services/character-pairing.ts`: pairing-code issuance, atomic one-time
  exchange, and secret hashing.
- `src/commands/character.ts`: `/character pair`, and `unlink`'s officer-branch
  credential revoke.
- `src/companion-api.ts`: authenticated `POST /api/v1/addon-pairings` and
  validation of per-companion credentials on uploads.
- `src/services/addon-import.ts`: preserves paired ownership on an associated
  import if it is later applied.
- `prisma/schema.prisma` and `prisma/migrations/20260930140000_character_pairing/`:
  pairing-code and credential tables plus import-to-member association.
- `companion/engine.mjs`, `companion/watcher.mjs`, and `companion-app/`:
  code exchange, credential persistence, and upload header.
- `tests/character-pairing.test.ts` and `tests/companion-engine.test.ts`:
  pairing service and companion exchange tests.

## Flow and compatibility

1. A member runs `/character pair` and receives an ephemeral one-time code.
2. In Companion Settings they enter the code and select **Link Discord account**.
   The desktop app saves the returned credential locally and clears the code.
   The CLI watcher does the same if `pairingCode` is set in its config.
3. The companion continues to use the existing `COMPANION_UPLOAD_TOKEN`; paired
   uploads additionally send the per-account credential header.
4. The bot resolves the credential only inside its guild and links the
   exporter's own character immediately (the first character is main). The
   member association is also recorded on a new import for safe reprocessing.
   No guildmate identities are inferred from the credential.
5. Existing unpaired companions and imports continue to work unchanged.
   Nickname matching, `/character claim`, `/character link`, and manual
   `/character import` remain available.

Pairing does not bypass the guild's import policy: if auto-import is disabled,
an officer still applies the uploaded import before ledger, raid, and other
guild-wide data is applied. Only the paired member's own character link happens
immediately.

## Database and verification

The migration is additive; apply it on deployment with `npm run db:update`.
The focused local checks are:

```text
npx prisma generate
npm run build
npx vitest run tests/character-pairing.test.ts tests/companion-engine.test.ts tests/commands-shape.test.ts
```

The companion credential is separate from the shared upload token. Do not add
the credential or a real pairing code to logs, documentation examples, or
commits.

`revokeCompanionCredentials` itself has a unit test, but the `/character
unlink` officer-branch call site does not — this repo has no existing pattern
for mocking a `ChatInputCommandInteraction` for `character.ts`, and one wasn't
introduced just for this. Verify manually: pair a companion, have an officer
`/character unlink` that character from someone else, then re-upload from that
companion and confirm it lands as unclaimed instead of silently relinking.
