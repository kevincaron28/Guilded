// Help & FAQ (phone app 0.7.0). Short answers in English and in Québec French (tu). Markdown read by ui/Prose.tsx.
// Keep the facts in step with mobile/README.md when a feature changes.

export interface HelpTopic { id: string; title: string; items: { q: string; a: string }[] }

const en: HelpTopic[] = [
  { id: "signin", title: "Signing in and pairing", items: [
    { q: "How do I sign in?", a: "Open the **Guild** tab and press **Sign in with Discord**. A short code shows on the phone and the Guilded page opens: choose your Discord server, type the code, then come back. The app signs in by itself within a few seconds." },
    { q: "What is the pairing code?", a: "Another way in: in Discord, `/character link` gives a code. On the sign-in screen, open **Or paste a code from /character link**, type the code and your Discord server ID, then press **Connect**." },
    { q: "Do I need an account to look around?", a: "No. The **Stats** and **News** tabs are public, and **Look at a sample guild** fills every tab with made-up names. Nothing is sent." },
    { q: "Can I use a guild that runs its own Guilded?", a: "Yes: on the sign-in screen open **Server address** and type its https address." }
  ] },
  { id: "sync", title: "Sync and your data", items: [
    { q: "Where does the data come from?", a: "From the Guilded addon in the game, sent by the **Windows companion** after you play. The phone reads what the bot has: when something is missing, play with the companion running, then pull down to refresh." },
    { q: "Why does a screen say \"Last updated\"?", a: "The app keeps the last good copy of each screen so it opens without a signal. It refreshes by itself; pull down to refresh now." },
    { q: "My character is missing.", a: "Send your character's full name to the Guilded bot in a Discord message, or sign the Windows companion in. Then pull down on **Me**." },
    { q: "How do I delete my data?", a: "**Me** > **Settings** > **Delete my data**. It erases your account, characters, badges, wishlist and map positions on the server and signs this phone out; the confirmation says what stays in guild histories." }
  ] },
  { id: "alerts", title: "Alerts and reminders", items: [
    { q: "How do raid reminders work?", a: "In **Alerts**, turn on **Remind me before each raid**: the phone reminds you a day, two hours and an hour before each raid it can see. A raid you answered **Can't come** gets none." },
    { q: "What does push add?", a: "With **Push alerts for raids** on, your guild server tells you about raid changes and cancellations even when the app is closed, plus a guildmate's call for help and a raid spot opening up for you (each has its own switch)." },
    { q: "I get no notification.", a: "Allow notifications for Guilded in the phone's settings (Alerts has a button for it), and keep battery saving from closing the app. Open the app now and then so the raid list stays current." }
  ] },
  { id: "raids", title: "Raids and crafting", items: [
    { q: "How do I sign up for a raid?", a: "**Guild** > **Raids**: pick your role, then **I'm in**, **Maybe** or **Can't come**. It is the same sign-up as the post in Discord, with the same rules and deadline." },
    { q: "How do I ask for a craft?", a: "**Guild** > **Crafting**: search the item, choose who should make it (or anyone), and press **Ask for it**. The request goes to the craft board and every guildmate's Orders page in game." }
  ] },
  { id: "problems", title: "Common problems", items: [
    { q: "The sign-in code expired.", a: "Codes last a few minutes. Press **Sign in with Discord** again for a new one." },
    { q: "\"Guilded could not be reached\".", a: "Check the connection. If you changed **Server address**, check it starts with https." },
    { q: "The app shows the wrong guild.", a: "Sign out in **Me** > **Settings**, then sign in again and choose the right Discord server." },
    { q: "Something else is broken.", a: "**Me** > **Settings** > **Report a problem**. Say what you did and what you saw; you get a reference." }
  ] }
];

const fr: HelpTopic[] = [
  { id: "signin", title: "Connexion et jumelage", items: [
    { q: "Comment je me connecte?", a: "Ouvre l'onglet **Guilde** et appuie sur **Connexion avec Discord**. Un court code s'affiche sur le téléphone et la page Guilded s'ouvre : choisis ton serveur Discord, tape le code, puis reviens. L'appli se connecte toute seule en quelques secondes." },
    { q: "C'est quoi, le code de jumelage?", a: "Une autre façon d'entrer : dans Discord, `/character link` te donne un code. À l'écran de connexion, ouvre **Ou colle un code de /character link**, tape le code avec l'identifiant de ton serveur Discord, puis appuie sur **Relier**." },
    { q: "Ai-je besoin d'un compte pour regarder?", a: "Non. Les onglets **Stats** et **Nouvelles** sont publics, et **Voir une guilde d'exemple** remplit tous les onglets avec des noms inventés. Rien n'est envoyé." },
    { q: "Ma guilde a son propre Guilded. Ça marche?", a: "Oui : à l'écran de connexion, ouvre **Adresse du serveur** et tape son adresse https." }
  ] },
  { id: "sync", title: "Synchro et tes données", items: [
    { q: "D'où viennent les données?", a: "De l'addon Guilded dans le jeu, envoyées par le **compagnon Windows** après ta partie. Le téléphone lit ce que le bot a : s'il manque quelque chose, joue avec le compagnon ouvert, puis tire vers le bas pour rafraîchir." },
    { q: "Pourquoi un écran dit « Mis à jour »?", a: "L'appli garde la dernière bonne copie de chaque écran pour s'ouvrir même sans réseau. Elle se rafraîchit toute seule; tire vers le bas pour le faire tout de suite." },
    { q: "Mon personnage n'apparaît pas.", a: "Envoie le nom complet de ton personnage au bot Guilded dans un message Discord, ou connecte le compagnon Windows. Ensuite, tire vers le bas dans **Moi**." },
    { q: "Comment je supprime mes données?", a: "**Moi** > **Réglages** > **Supprimer mes données**. Ça supprime ton compte, tes personnages, tes badges, ta liste de souhaits et tes positions sur le serveur, et déconnecte ce téléphone; la confirmation dit ce qui reste dans l'historique des guildes." }
  ] },
  { id: "alerts", title: "Alertes et rappels", items: [
    { q: "Comment marchent les rappels de raid?", a: "Dans **Alertes**, active **Me rappeler avant chaque raid** : le téléphone te le rappelle un jour, deux heures et une heure avant chaque raid qu'il voit. Un raid où tu as répondu **Je ne peux pas** n'en a pas." },
    { q: "Qu'est-ce que le push ajoute?", a: "Avec **Alertes push pour les raids**, ton serveur de guilde te prévient des changements et des annulations même appli fermée, en plus d'un appel à l'aide d'un membre et d'une place de raid qui se libère pour toi (chacun a son interrupteur)." },
    { q: "Je ne reçois aucune notification.", a: "Permets les notifications pour Guilded dans les réglages du téléphone (Alertes a un bouton pour ça), et empêche l'économiseur de pile de fermer l'appli. Ouvre l'appli de temps en temps pour garder la liste des raids à jour." }
  ] },
  { id: "raids", title: "Raids et artisanat", items: [
    { q: "Comment je m'inscris à un raid?", a: "**Guilde** > **Raids** : choisis ton rôle, puis **J'y vais**, **Peut-être** ou **Je ne peux pas**. C'est la même inscription que la publication dans Discord, avec les mêmes règles et la même date limite." },
    { q: "Comment je demande un objet à fabriquer?", a: "**Guilde** > **Artisanat** : cherche l'objet, choisis qui devrait le faire (ou n'importe qui), puis appuie sur **Le demander**. La demande va au tableau d'artisanat et à la page Commandes de chaque membre en jeu." }
  ] },
  { id: "problems", title: "Problèmes courants", items: [
    { q: "Le code de connexion est expiré.", a: "Les codes durent quelques minutes. Appuie encore sur **Connexion avec Discord** pour en avoir un nouveau." },
    { q: "« Impossible de joindre Guilded ».", a: "Vérifie ta connexion. Si tu as changé l'**Adresse du serveur**, vérifie qu'elle commence par https." },
    { q: "L'appli montre la mauvaise guilde.", a: "Déconnecte-toi dans **Moi** > **Réglages**, puis reconnecte-toi et choisis le bon serveur Discord." },
    { q: "Autre chose est brisé.", a: "**Moi** > **Réglages** > **Signaler un problème**. Dis ce que tu as fait et ce que tu as vu; tu reçois une référence." }
  ] }
];

export const HELP: Record<"en" | "fr", HelpTopic[]> = { en, fr };
