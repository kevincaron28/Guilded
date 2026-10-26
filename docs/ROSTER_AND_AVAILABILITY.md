# Roster and availability — local release candidate

These additions are prepared locally after 7.4.0 and are not yet deployed.
Every page selects one guild and edition, including when several editions share
the same Discord server. Forever display names retain both first and last names.

## Officers: review and apply main/alt flags

Open **Roster → Review main/alt changes** after signing in. Paste a CSV with
`character,realm,main` columns, or the supported main/alt GRM CSV headers shown
on that page. Preview the matching characters and conflicts first. The plan can
only change main/alt flags among characters already linked to their owners.
It cannot transfer ownership, claim an unlinked character or change EP/GP.

Resolve every conflict before applying. A complete plan must leave each affected
member with exactly one main. Type `APPLY` and submit the reviewed plan within
five minutes. A changed roster, session or officer access requires a fresh preview.
Successful changes have an audit receipt containing the before/after flags.
If a request times out, check the roster and audit receipt before retrying.
To correct a completed plan, prepare a new reviewed plan using those prior flags.

GRM SavedVariables history migration remains a separate desktop/CLI workflow.
Its local archive does not assign Discord ownership or import an EP/GP ledger.
See [the GRM and roster implementation notes](LOCAL_ROSTER_GRM_BUFFS_2026-10-25.md).

## Officers: participation filters

The roster offers seven-day and thirty-day participation filters and CSV fields.
Evidence means recorded present/late attendance in a completed raid or a valid,
completed guild dungeon run. Counts deduplicate linked members across their alts.
They do not identify the played alt unless the source record does.

An empty participation record means **no recorded participation in that window**.
It does not prove inactivity. An unlinked character has unknown coverage. Import
refresh times are kept separate from participation and never treated as logins.

## Members: Who's free?

Sign in, open **Who's free?** on the account page, and choose your guild.
Select one of your linked characters, a role and 15, 30 or 60 minutes. Tick the
sharing consent box and submit. Current members of that guild and edition can
see the post. This is a voluntary availability statement, not live game presence.

Use **Stop sharing my availability** to remove your post. The direct guild page
still offers removal if you lose the guild role. Refresh manually for current
posts; the page does not poll every minute. Expired posts are hidden immediately
and purged within six hours during normal housekeeping. Routine backups retain
their normal retention. Local addon presence observations are not uploaded here.

## Français

Les officiers ouvrent **Effectif → Réviser les principaux**, prévisualisent le CSV,
corrigent les conflits, puis saisissent `APPLY` pour confirmer. La confirmation
expire après cinq minutes et devient invalide si l'effectif change. Seuls les
indicateurs principal/secondaire changent; les propriétaires et points restent
identiques. Conservez le reçu d'audit pour préparer une correction si nécessaire.

Les filtres de participation couvrent les raids terminés et les donjons de guilde
valides enregistrés. Plusieurs personnages d'un membre ne comptent qu'une fois.
L'absence de preuve ne signifie pas que le joueur est inactif.

Dans **Qui est disponible ?**, choisissez votre guilde, votre personnage lié,
votre rôle et une durée de 15, 30 ou 60 minutes. Confirmez explicitement le partage.
L'annonce est réservée aux membres actuels de cette guilde et édition. Elle peut
être retirée à tout moment et disparaît à expiration. Actualisez manuellement
pour consulter les annonces récentes. Aucune présence observée par l'addon n'est
importée dans cette page.
