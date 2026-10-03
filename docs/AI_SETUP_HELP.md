# Ask an AI for help with Guilded

Copy one prompt below into your preferred assistant. If it cannot access links,
attach the relevant guide and README from the release you downloaded. Replace
bracketed placeholders. An assistant must be able to distinguish the code in a
download from the code actually installed or running.

Keep bot tokens, database passwords/URLs, pairing codes and companion credentials
out of the conversation. Enter them locally in the application or environment
file. A support summary is preferable to config.json or an entire SavedVariables
file; review it before sharing. Guilded's optional Discord AI answer channel is
not required to use these prompts.

## Guildmate: help me install

```text
Help me install Guilded for my guild. I am a member, not the bot host.
Read MEMBER_INSTALL.md and README.md from my downloaded release.
My game is WoW Forever [beta or other client]; my OS is [OS].
My release version is [version]. My officer gave me the download links,
Discord server ID and bot address, which I can enter locally.

Guide me through one short step at a time with a visible success check.
Locate the actual game client and account before selecting files. Do not assume
_forever_, _retail_ or _classic_beta_ without checking my installation.
I do not need Node.js, a database or the Discord bot token. Set my guild's bot
address before pairing; do not assume the prefilled Quebec Gold address is mine.
Never ask me to paste a pairing code, token or config.json into chat.
Explain that /reload or logout writes addon data, the companion uploads it,
and another reload loads newly downloaded standings. Profession scanning is
automatic when I open the profession window. Do not mark a check passed until
I have observed its result.
```

## Guild owner: help me run my own bot

```text
Help me set up a new, independent Guilded installation for my guild.
Read GUILD_OWNER_SETUP.md, MEMBER_INSTALL.md, README.md and the deployment
instructions from my selected release before proposing commands.
My release version/source commit is [version/commit]. My host is [OS/provider].
I [do/do not] already have a running bot, database and HTTPS hostname.

First identify what already exists. Use my own Discord application, database,
hostname and host, never the maintainer's Oracle SSH target or credentials.
Do not run redeploy-oracle.bat unmodified. Verify dependencies against the
release; Node 24 is the documented build baseline. Have me enter secrets
locally; never print them or ask me to share them. Start only one instance of
my bot. Preserve existing data and require a verified backup before migration
of an existing database. Never reset the database to solve an error.

Guide me through checkpoints: Discord intent/invite/roles; host and database;
public HTTPS health; /report ping; /setup start; one officer and one ordinary
member pairing; upload and standings return; a test signup. Use my actual
command schema and UI labels, and verify uncertain external instructions in
official documentation. Leave optional AI answers off until basic setup works.
Finish with the exact links, server ID and bot address I can give members,
and a list of checks still unverified. Do not claim a public release is ready
just because automated tests pass.
```

## Something is broken

```text
Help diagnose Guilded with the smallest safe check first.
Read the troubleshooting section for my installed release.
Role: [member / officer / host owner]
Game/client and OS: [details]
Addon version, companion version, bot version/commit if known: [details]
Expected behavior: [what should happen]
Actual behavior and time: [exact error and timestamp]
Last successful upload and standings refresh: [times / unknown]
Recent change: [update, new account, re-pairing, none]
Sanitized support summary or screenshot: [attach if available]

Separate addon collection, file saving, companion upload, server authorization
and standings download. Old diagnostic entries are not proof of a new error.
Zero imported ledger entries or new characters can be a normal successful sync.
Check the actual installed files/build when several builds share a version.
For missing guild-map dots, collect /guilded map check from both players and
distinguish zero received peers from a drawing problem. Client send acceptance
does not prove delivery; self echoes are normal. Use the Forever-beta recovery
steps in MEMBER_INSTALL.md and verify actual client menus instead of assuming
standard WoW UI. Record confirmed results so we do not repeat passed checks.
Do not delete SavedVariables, remove pending transactions, reset my database,
disable authorization, or start another copy of a live bot. Never request
credentials. Explain what each check proves and what remains unknown.
```

## En français : aide à l'installation

```text
Aide-moi à installer Guilded pour ma guilde. Je joue sur WoW Forever [beta/autre]
et j'utilise [système]. Lis MEMBER_INSTALL.md de ma version [version].
Je suis [membre/officier/propriétaire du bot]. Guide-moi en français, une étape
courte à la fois, avec un résultat visible à vérifier. Utilise les noms réels
des boutons, même quand l'interface du compagnon est en anglais.
Vérifie mon dossier de jeu, mon compte et l'adresse du bot de ma propre guilde.
Ne me demande jamais de partager un jeton, un code de liaison, un mot de passe
ou config.json. Préserve les données existantes. N'annonce pas une réussite
avant que le résultat soit confirmé.
```
