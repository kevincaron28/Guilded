# Optional automation / Automatisation facultative

Everything below starts **off**. Setup is saved; you do not need to repeat it
each week. No scoring or awards are changed.

## Members

- `/automation recap action:on` enables one private weekly recap DM to **you**.
  Defaults: Monday 09:00 in your guild's timezone, quiet hours 22:00–08:00.
  Choose `day`, `time`, `timezone` and `quiet` when needed.
- `/automation recap action:status` shows the schedule and latest delivery state.
- `/automation recap action:off` pauses future delivery. Turning it back on does
  not resend a recap already attempted this week.
- `/dungeon watch` saves your roles, availability, quiet hours and expiration for
  group/vacancy matches. It lasts at most seven days and can be turned off.
  Alerts only run if an officer enables your configured channel. There is no DM
  fallback; the cap is two alerts per 24 hours, at least six hours apart.

## Officers

1. In the intended existing channel, save `/poll weekly-preview` with a question,
   day, time and timezone. Review the text and channel.
2. `/automation question action:on` explicitly enables that saved weekly post.
   Editing its text/channel/schedule disables automation until approved again.
3. `/automation vacancies action:on channel:…` enables matches only for active
   consenting members and opportunities posted in that channel.
4. Use `action:status` to inspect, or `action:off` to pause either automation.

Delivery checks run every five minutes. Membership, officer authority, channel
permissions, opt-in and quiet hours are checked again before sending. A missed
weekly time catches up only that local day. An **UNCERTAIN** send may already
have arrived: inspect the destination; the bot holds it instead of duplicating
it. Failures before an attempt are retried on a later check. Pause stops future
sends; it cannot recall a message already delivered.

## Français

Tout commence **désactivé**. Aucun score ni point n'est modifié.

- `/automation recap action:on` : un bilan privé par semaine, seulement pour
  vous. Par défaut : lundi 9 h, fuseau de la guilde, silence de 22 h à 8 h.
  Les options `day`, `time`, `timezone` et `quiet` adaptent l'horaire.
- `action:status` affiche l'horaire et le dernier résultat; `action:off` suspend.
  Réactiver ne renvoie pas un bilan déjà tenté cette semaine.
- `/dungeon watch` : rôles, disponibilités, silence et expiration (sept jours
  maximum). Un officier doit activer le salon. Aucun MP de secours; deux avis
  maximum par 24 h, espacés d'au moins six heures.
- Officiers : enregistrez `/poll weekly-preview`, vérifiez le salon et le texte,
  puis activez `/automation question action:on`. Modifier la question désactive
  l'envoi jusqu'à une nouvelle approbation.
- `/automation vacancies action:on channel:…` active les correspondances pour
  les abonnés volontaires et les activités de ce salon seulement.

Vérification toutes les cinq minutes, avec contrôle des autorisations et du
consentement. Un résultat **UNCERTAIN** peut déjà avoir été livré : vérifiez le
salon ou vos MP; aucun renvoi aveugle. Une pause ne rappelle pas un message déjà
envoyé. Le résumé de vos préférences figure dans **Mes données** et son export.
