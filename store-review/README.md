# Guilded Companion: synthetic Store review connection

This endpoint is a separate review sandbox, not the production Discord service.
It has no production database, Discord token, real members or game records.
It exercises companion pairing, authenticated network uploads, duplicate handling,
standings download/file writes, pause/restart and credential revocation. It does
not certify Discord OAuth, PoE2, public leaderboards or game-client behavior.

## Reviewer steps (English)

1. Download `review-kit.zip` from the review endpoint and extract it to a new
   folder under Documents. No game installation is needed. Never use real guild files.
2. Open Guilded Companion → Connection & setup. Add a connection named
   **Microsoft Store review (synthetic)** so existing profiles remain separate.
3. Expand **Older companions or your guild's own bot**. Set the bot address to
   `<review endpoint>/api/v1/addon-imports`. Enter the private 12-character review
   code supplied in Partner Center Credentials, then Connect. It is a sandbox
   code reusable until the stated deadline, unlike normal one-use guild codes.
   Re-pairing replaces the prior sandbox session. Sessions last at most 24 hours.
4. Select the extracted `WTF/Account/REVIEW/SavedVariables/Guilded.lua`. Enable WoW,
   leave PoE2 off, then Save & start syncing. The server ID fills automatically.
5. Test connection should report one synthetic character. The first sample import
   sets Reviewmage's sample EP to 100; duplicates do not apply twice. Refresh
   standings and inspect `Interface/AddOns/Guilded/Standings.lua` in the extracted
   folder. This is generated sample data, never a real ledger or public score.
6. Pause/restart; check Overview/Activity, CSV export and language switching.
7. Disconnect from Help & privacy. The old session must be refused. Reconnect with
   the review code to reset the synthetic session, if further review is needed.

The endpoint refuses other guild IDs, altered/real exports and unsupported APIs.
It retains only a session hash, expiry, synthetic import flag and bounded request
counter. It never stores raw uploads or records them in application logs.

## Procédure (français)

Extrayez le kit dans un nouveau dossier. Créez la connexion « Test Microsoft Store
(données fictives) ». Dans Connexion et configuration, développez l'option pour
le bot de votre guilde et saisissez l'adresse du serveur de test, puis le code
privé fourni à Microsoft. Sélectionnez le fichier Guilded.lua du kit, activez WoW,
laissez PoE2 désactivé, puis enregistrez et démarrez la synchronisation. Vérifiez
le personnage fictif Reviewmage, les 100 EP de démonstration après l'envoi, le
fichier Standings.lua généré, la pause et la déconnexion. N'utilisez aucune donnée
réelle. Cette démonstration ne remplace pas les tests Discord ou en jeu.

## Maintainer operations

- Separate Worker config: `store-review/wrangler.jsonc`. Never deploy this config
  as `guilded-wow` or attach production routes/bindings.
- Build the fixture archive with `node scripts/prepare-store-review.mjs`.
- Review code is six random bytes encoded as uppercase hex, supplied only through
  a Cloudflare secret and Partner Center's private Credentials field. Never commit it.
- `REVIEW_EXPIRES_AT` disables the endpoint after 25 November 2026 UTC. Setting a
  past deadline revokes all access; rotating REVIEW_CODE invalidates prior sessions.
- One durable object keeps bounded state. Re-pairing and logout replace/delete
  its session; no external services are called. Logs/observability are off.
- Both local tests and actual endpoint round trips are required before sharing
  credentials. Record the deployed URL and evidence separately from credentials.
