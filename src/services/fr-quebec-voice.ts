// The Québécois "gang" voice for the fun, social French text (owner request, 20 Nov 2026).
//
// Only celebratory lines live here: promotions, achievements, MVP and top 3, badges, welcome, records.
// Error messages, privacy and data text, moderation, setup, admin and officer tools, help and FAQ never
// use this module (tests/fr-quebec-voice.test.ts enforces it): they stay clear French with "tu".
//
// To tone the whole thing down, set QUEBEC_SWEARING to false: every line then uses its joual-only variant
// (same slang, no sacres). Each event has a few variants; the one shown is chosen from a stable key so the
// same event always reads the same and different events do not all repeat one sentence.

export const QUEBEC_SWEARING = true;

export type VoiceEvent = "promotion" | "promotionKicker" | "achievement" | "mvp" | "weeklyMvp" | "top3" | "badge" | "welcome" | "joined" | "guildRecord" | "personalBest" | "rookie"
  | "duelKo" | "duelFled" | "duelUpset" | "duelSwing" | "duelUpsetLine" | "duelSummaryTitle" | "hallTitle" | "hallHead" | "anniversary";

interface Variant { /** With sacres, used while QUEBEC_SWEARING is on. */ swear: string; /** Joual only, no sacres. */ clean: string }

// Placeholders: {who} (a mention or name), {rank}, {names}, {dungeon}, {before}, {now}, {name}, {threshold}, {guild}, {mention}, {id}.
// Rules: "tu" register, never an insult at a member, no slurs, nothing sexual. Sacres are exclamations only.
const VARIANTS: Record<VoiceEvent, readonly Variant[]> = {
  promotion: [
    { swear: "🎉 Tabarnak, {who}, t’es rendu(e) **{rank}** ! C’est ben mérité, pas pire pantoute !", clean: "🎉 Ben voyons donc, {who}, t’es rendu(e) **{rank}** ! C’est ben mérité, pas pire pantoute !" },
    { swear: "🎉 Câlisse, {who} passe **{rank}** ! La gang est fière de toé, continue de même !", clean: "🎉 Wow, {who} passe **{rank}** ! La gang est fière de toé, continue de même !" },
    { swear: "🎉 Ostie de belle promotion, {who} ! Bienvenue au rang de **{rank}**, t’as ça dans le sang !", clean: "🎉 Belle promotion, {who} ! Bienvenue au rang de **{rank}**, t’as ça dans le sang !" },
    { swear: "🎉 Crisse que c’est bon, {who} est **{rank}** astheure ! Pis y’a des affaires à fêter à soir !", clean: "🎉 C’est malade, {who} est **{rank}** astheure ! Pis y’a des affaires à fêter à soir !" },
    { swear: "🎉 Câlisse de bonne affaire, {who} est **{rank}** ! Les gants sont à terre, c’est du hockey de gars de shop, pis tu l’as mérité !", clean: "🎉 Belle affaire, {who} est **{rank}** ! C’est du hockey de gars de shop, pis tu l’as mérité !" },
    { swear: "🎉 Ostie, {who}, **{rank}** ! Les Chiefs pourraient pas faire mieux. Mets-toi du ruban sur les lunettes, ça brasse !", clean: "🎉 Wow, {who}, **{rank}** ! Les Chiefs pourraient pas faire mieux. Mets-toi du ruban sur les lunettes, ça brasse !" },
    { swear: "🎉 Sacrament, {who} passe **{rank}** ! Ça mérite un lancer frappé en pleine face du banc adverse !", clean: "🎉 Ben voyons, {who} passe **{rank}** ! Ça mérite un lancer frappé en pleine face du banc adverse !" }
  ],
  promotionKicker: [
    { swear: "Tabarouette, bravo !", clean: "Pas pire pantoute !" },
    { swear: "Câlisse, félicitations !", clean: "C’est malade !" },
    { swear: "Crisse, c’est bon !", clean: "Félicitations !" },
    { swear: "Ciboire, t’es bon !", clean: "Ben là, t’es bon !" },
    { swear: "Ostie, lancer frappé !", clean: "Lancer frappé !" }
  ],
  achievement: [
    { swear: "🎉 Tabarouette, bravo <@{id}> ! Ça, c’est du bon stock !", clean: "🎉 Ben bravo <@{id}> ! Ça, c’est du bon stock !" },
    { swear: "🎉 Câlisse, <@{id}> ramasse un autre succès ! T’es en feu !", clean: "🎉 Wow, <@{id}> ramasse un autre succès ! T’es en feu !" },
    { swear: "🎉 Ostie que c’est beau, <@{id}> ! Pas pire pantoute !", clean: "🎉 C’est malade, <@{id}> ! Pas pire pantoute !" },
    { swear: "🎉 Sacrament, <@{id}>, t’en as de la swing ! Bravo !", clean: "🎉 Ben coudonc, <@{id}>, t’en as de la swing ! Bravo !" },
    { swear: "🎉 Ciboire, <@{id}> ramasse un autre succès ! Les frères Hanson te donnent la main !", clean: "🎉 Ben coudonc, <@{id}> ramasse un autre succès ! Les frères Hanson te donnent la main !" },
    { swear: "🎉 Câlisse, <@{id}>, t’es en feu à soir ! Ça, c’est du vrai hockey de bagarreur !", clean: "🎉 Wow, <@{id}>, t’es en feu à soir ! Ça, c’est du vrai hockey de bagarreur !" }
  ],
  mvp: [
    { swear: "⭐ Tabarnak, bravo {who} ! T’as fait le gros ouvrage cette semaine !", clean: "⭐ Ben bravo {who} ! T’as fait le gros ouvrage cette semaine !" },
    { swear: "⭐ Câlisse, {who} mène la gang ! C’est ben mérité !", clean: "⭐ Wow, {who} mène la gang ! C’est ben mérité !" },
    { swear: "⭐ Crisse que t’es bon, {who} ! Pas pire pantoute !", clean: "⭐ C’est malade, {who} ! Pas pire pantoute !" },
    { swear: "⭐ Ostie que {who} a donné le go cette semaine ! Un vrai Reggie, pis ça jase pas pour rien dire !", clean: "⭐ {who} a donné le go cette semaine ! Un vrai Reggie, pis ça jase pas pour rien dire !" },
    { swear: "⭐ Ciboire, {who} mène la gang comme un gars de shop mène un trio ! Bravo !", clean: "⭐ Wow, {who} mène la gang comme un gars de shop mène un trio ! Bravo !" }
  ],
  weeklyMvp: [
    { swear: "⭐ Tabarnak, bravo {who}, MVP de la semaine ! T’as fait le gros ouvrage !", clean: "⭐ Ben bravo {who}, MVP de la semaine ! T’as fait le gros ouvrage !" },
    { swear: "⭐ Câlisse, {who} est MVP de la semaine ! La gang s’en rappelle !", clean: "⭐ Wow, {who} est MVP de la semaine ! La gang s’en rappelle !" },
    { swear: "⭐ Crisse que t’es bon, {who}, MVP de la semaine ! Pas pire pantoute !", clean: "⭐ C’est malade, {who}, MVP de la semaine ! Pas pire pantoute !" },
    { swear: "⭐ Ciboire, {who}, MVP de la semaine ! T’as fessé plus fort que les Hanson !", clean: "⭐ Wow, {who}, MVP de la semaine ! T’as fessé plus fort que les Hanson !" },
    { swear: "⭐ Câlisse de belle semaine, {who} ! MVP, pis les lunettes tiennent encore !", clean: "⭐ Belle semaine, {who} ! MVP, pis les lunettes tiennent encore !" }
  ],
  top3: [
    { swear: "🏆 Tabarouette, bravo au top 3 de la gang : {names} ! Ça, c’est du monde pas pire pantoute !", clean: "🏆 Ben bravo au top 3 de la gang : {names} ! Ça, c’est du monde pas pire pantoute !" },
    { swear: "🏆 Câlisse, le podium du mois : {names} ! La gang est ben fière !", clean: "🏆 Wow, le podium du mois : {names} ! La gang est ben fière !" },
    { swear: "🏆 Ostie de beau podium : {names} ! Ben joué, la gang !", clean: "🏆 Beau podium : {names} ! Ben joué, la gang !" },
    { swear: "🏆 Câlisse de beau podium : {names} ! Les Chiefs du mois, mets les gants, la gang !", clean: "🏆 Beau podium : {names} ! Les Chiefs du mois, mets les gants, la gang !" },
    { swear: "🏆 Ciboire, {names} sur le podium ! Du hockey de tabarnak, la gang !", clean: "🏆 Wow, {names} sur le podium ! Du hockey de feu, la gang !" }
  ],
  badge: [
    { swear: "🏅 Tabarouette, bravo **{name}** ! T’as atteint **{threshold} points communautaires** cette saison. Ton badge est gardé dans /community badges. Merci de faire vivre la gang !", clean: "🏅 Ben bravo **{name}** ! T’as atteint **{threshold} points communautaires** cette saison. Ton badge est gardé dans /community badges. Merci de faire vivre la gang !" },
    { swear: "🏅 Câlisse, **{name}**, t’as atteint **{threshold} points communautaires** cette saison ! Ton badge t’attend dans /community badges. Merci d’être là, c’est malade !", clean: "🏅 Wow, **{name}**, t’as atteint **{threshold} points communautaires** cette saison ! Ton badge t’attend dans /community badges. Merci d’être là, c’est malade !" },
    { swear: "🏅 Crisse, **{name}** ! **{threshold} points communautaires** cette saison, pas pire pantoute. Ton badge est dans /community badges. Merci de faire vivre la gang !", clean: "🏅 Ben voyons, **{name}** ! **{threshold} points communautaires** cette saison, pas pire pantoute. Ton badge est dans /community badges. Merci de faire vivre la gang !" },
    { swear: "🏅 Ciboire, **{name}** ! **{threshold} points communautaires** cette saison, du vrai hockey de bagarreur. Ton badge est dans /community badges. Merci de faire vivre la gang !", clean: "🏅 Wow, **{name}** ! **{threshold} points communautaires** cette saison, du vrai hockey de bagarreur. Ton badge est dans /community badges. Merci de faire vivre la gang !" }
  ],
  welcome: [
    { swear: "Bienvenue dans la gang de {guild}, {mention} ! Tabarnak, on est contents de t’avoir icitte. Utilise les boutons ci-dessous pour bien commencer : les réponses sont privées, toi seul les vois.", clean: "Bienvenue dans la gang de {guild}, {mention} ! On est ben contents de t’avoir icitte. Utilise les boutons ci-dessous pour bien commencer : les réponses sont privées, toi seul les vois." },
    { swear: "Eille, {mention}, bienvenue dans la gang de {guild} ! Câlisse, ça fait plaisir. Les boutons ci-dessous répondent en privé : toi seul vois les réponses.", clean: "Eille, {mention}, bienvenue dans la gang de {guild} ! Ça fait ben plaisir. Les boutons ci-dessous répondent en privé : toi seul vois les réponses." },
    { swear: "Ça va bien, {mention} ? Bienvenue dans la gang de {guild}, crisse que t’arrives au bon moment ! Les boutons ci-dessous répondent en privé : toi seul vois les réponses.", clean: "Ça va bien, {mention} ? Bienvenue dans la gang de {guild}, t’arrives au bon moment ! Les boutons ci-dessous répondent en privé : toi seul vois les réponses." },
    { swear: "Eille, {mention}, bienvenue dans la gang de {guild} ! Ostie qu’on est contents, mets tes gants pis viens jouer. Les boutons ci-dessous répondent en privé : toi seul vois les réponses.", clean: "Eille, {mention}, bienvenue dans la gang de {guild} ! On est ben contents, mets tes gants pis viens jouer. Les boutons ci-dessous répondent en privé : toi seul vois les réponses." }
  ],
  joined: [
    { swear: "✅ **{name}** a rejoint la guilde. Tabarouette, bienvenue !", clean: "✅ **{name}** a rejoint la guilde. Bienvenue dans la gang !" },
    { swear: "✅ **{name}** est dans la guilde astheure. Câlisse, bienvenue !", clean: "✅ **{name}** est dans la guilde astheure. Bienvenue, pas pire pantoute !" },
    { swear: "✅ **{name}** a rejoint la guilde. Ostie qu’on est contents, bienvenue !", clean: "✅ **{name}** a rejoint la guilde. On est ben contents, bienvenue !" },
    { swear: "✅ **{name}** a rejoint la guilde. Câlisse, un autre pour les Chiefs, bienvenue !", clean: "✅ **{name}** a rejoint la guilde. Un autre pour les Chiefs, bienvenue !" },
    { swear: "✅ **{name}** est dans la gang astheure. Ciboire, bienvenue, les lunettes sont prêtes !", clean: "✅ **{name}** est dans la gang astheure. Bienvenue, les lunettes sont prêtes !" }
  ],
  guildRecord: [
    { swear: "🏆 Tabarnak, nouveau record de guilde dans **{dungeon}** : {before} → **{now}** !", clean: "🏆 Ben voyons donc, nouveau record de guilde dans **{dungeon}** : {before} → **{now}** !" },
    { swear: "🏆 Câlisse, la gang bat le record de **{dungeon}** : {before} → **{now}** ! C’est malade !", clean: "🏆 Wow, la gang bat le record de **{dungeon}** : {before} → **{now}** ! C’est malade !" },
    { swear: "🏆 Crisse que ça va vite : record de guilde dans **{dungeon}**, {before} → **{now}** !", clean: "🏆 Ça va vite, ben vite : record de guilde dans **{dungeon}**, {before} → **{now}** !" },
    { swear: "🏆 Ostie de câlisse de record de guilde dans **{dungeon}** : {before} → **{now}** ! Du lancer frappé en pleine face !", clean: "🏆 Quel record de guilde dans **{dungeon}** : {before} → **{now}** ! Du lancer frappé en pleine face !" }
  ],
  personalBest: [
    { swear: "⭐ Tabarouette, record personnel dans {dungeon} : {names} !", clean: "⭐ Ben coudonc, record personnel dans {dungeon} : {names} !" },
    { swear: "⭐ Câlisse, record personnel dans {dungeon} : {names} !", clean: "⭐ Wow, record personnel dans {dungeon} : {names} !" },
    { swear: "⭐ Ostie de bon temps, record personnel dans {dungeon} : {names} !", clean: "⭐ Beau temps, record personnel dans {dungeon} : {names} !" },
    { swear: "⭐ Ciboire, record personnel dans {dungeon} : {names} ! Un vrai lancer frappé !", clean: "⭐ Wow, record personnel dans {dungeon} : {names} ! Un vrai lancer frappé !" }
  ],
  rookie: [
    { swear: "Nouveau dans la gang : tabarouette, bienvenue !", clean: "Nouveau dans la gang : ben content de te voir, bienvenue !" },
    { swear: "Nouveau dans la gang : câlisse, bon départ, bienvenue !", clean: "Nouveau dans la gang : pas pire pantoute pour un début, bienvenue !" },
    { swear: "Nouveau dans la gang : crisse, bon début, bienvenue !", clean: "Nouveau dans la gang : beau début, bienvenue !" },
    { swear: "Nouveau dans la gang : câlisse, un p’tit Hanson de plus, bienvenue !", clean: "Nouveau dans la gang : un p’tit Hanson de plus, bienvenue !" }
  ],
  // Duels (cards and post text). Card texts stay short.
  duelKo: [
    { swear: "K.O. : tabarnak, ça a fessé !", clean: "K.O. : ça a fessé dur !" },
    { swear: "K.O. : câlisse de belle claque !", clean: "K.O. : toute une claque !" },
    { swear: "K.O. : crisse, y’a pas fait long feu !", clean: "K.O. : y’a pas fait long feu !" },
    { swear: "K.O. : ostie de bon coup !", clean: "K.O. : ben bon coup !" },
    { swear: "K.O. : câlisse, les gants sont à terre !", clean: "K.O. : les gants sont à terre !" },
    { swear: "K.O. : ciboire, du hockey des frères Hanson !", clean: "K.O. : du hockey des frères Hanson !" },
    { swear: "K.O. : sacrament, direct au banc des punitions !", clean: "K.O. : direct au banc des punitions !" }
  ],
  duelFled: [
    { swear: "Tabarnak, y’a fui !", clean: "Y’a pris la poudre d’escampette !" },
    { swear: "Câlisse, y’a décampé !", clean: "Y’a lâché la patate !" },
    { swear: "Crisse, y’a pris le bord !", clean: "Y’a pris le bord !" },
    { swear: "Ciboire, y’a laissé tomber les gants !", clean: "Y’a laissé tomber les gants !" },
    { swear: "Ostie, direct au vestiaire !", clean: "Direct au vestiaire !" }
  ],
  duelUpset: [
    { swear: "Tabarnak de surprise !", clean: "Pas vu venir pantoute !" },
    { swear: "Câlisse, quelle surprise !", clean: "Ben voyons donc, surprise !" },
    { swear: "Ostie de coup de théâtre !", clean: "Coup de théâtre !" },
    { swear: "Câlisse de surprise, les Chiefs ont gagné !", clean: "Surprise, les Chiefs ont gagné !" },
    { swear: "Ciboire, surprise : Surprise : Reggie l’a pas vu venir !", clean: "Surprise : Reggie l’a pas vu venir !" }
  ],
  duelSwing: [
    { swear: "Tabarouette, ça a swingé fort !", clean: "Ben coudonc, ça a swingé fort !" },
    { swear: "Câlisse, grosse swing de cote !", clean: "Wow, grosse swing de cote !" },
    { swear: "Crisse, ça bouge dans le classement !", clean: "Ça bouge dans le classement !" },
    { swear: "Sacrament, ça a brassé dans le classement !", clean: "Ça a brassé dans le classement !" },
    { swear: "Câlisse, bagarre générale dans le classement !", clean: "Bagarre générale dans le classement !" }
  ],
  duelUpsetLine: [
    { swear: "Tabarnak, le petit a viré le gros de bord ! Personne a vu ça venir !", clean: "Le petit a viré le gros de bord ! Personne a vu ça venir !" },
    { swear: "Câlisse, quelle surprise : le plus faible a pris le plus fort !", clean: "Wow, quelle surprise : le plus faible a pris le plus fort !" },
    { swear: "Ostie de revirement, le petit a gagné contre toute attente !", clean: "Beau revirement, le petit a gagné contre toute attente !" },
    { swear: "Ciboire, le petit a sorti les gants pis viré le gros de bord ! Du vrai hockey de Charlestown !", clean: "Le petit a sorti les gants pis viré le gros de bord ! Du vrai hockey de Charlestown !" }
  ],
  duelSummaryTitle: [
    { swear: "Câlisse, ça se bat dans’ gang !", clean: "Ça se bat dans’ gang !" },
    { swear: "Tabarouette, encore des duels !", clean: "Ben voyons, encore des duels !" },
    { swear: "Crisse que ça fesse icitte !", clean: "Ça fesse fort icitte !" },
    { swear: "Ciboire, bagarre générale dans’ gang !", clean: "Bagarre générale dans’ gang !" },
    { swear: "Câlisse, les gants sont à terre icitte !", clean: "Les gants sont à terre icitte !" }
  ],
  // Race to 60: the Hall of Fame post title ({order}) and the header line ({n}).
  hallTitle: [
    { swear: "🏆 Tabarnak, n° {order} à atteindre le niveau 60 !", clean: "🏆 Ben voyons, n° {order} à atteindre le niveau 60 !" },
    { swear: "🏆 Câlisse, n° {order} à atteindre le niveau 60 !", clean: "🏆 Wow, n° {order} à atteindre le niveau 60 !" },
    { swear: "🏆 Ostie, n° {order} à atteindre le niveau 60 !", clean: "🏆 Pas pire, n° {order} à atteindre le niveau 60 !" },
    { swear: "🏆 Câlisse, n° {order} à atteindre le niveau 60 !", clean: "🏆 Wow, n° {order} à atteindre le niveau 60 !" }
  ],
  hallHead: [
    { swear: "**{n}** personnages ont atteint le niveau 60, par ordre d’arrivée. Tabarnak, la gang avance !", clean: "**{n}** personnages ont atteint le niveau 60, par ordre d’arrivée. La gang avance !" },
    { swear: "**{n}** personnages au niveau 60, par ordre d’arrivée. Câlisse que ça va vite !", clean: "**{n}** personnages au niveau 60, par ordre d’arrivée. Ça va ben vite !" },
    { swear: "**{n}** rendus au niveau 60, par ordre d’arrivée. Crisse, du beau monde !", clean: "**{n}** rendus au niveau 60, par ordre d’arrivée. Du beau monde !" },
    { swear: "**{n}** personnages au niveau 60, par ordre d’arrivée. Ciboire, la gang joue du hockey de feu !", clean: "**{n}** personnages au niveau 60, par ordre d’arrivée. La gang joue du hockey de feu !" }
  ],
  anniversary: [
    { swear: "🎂 Tabarnak, **{name}** fête ses {years} {unit} ! Joyeux anniversaire la gang !", clean: "🎂 Ben voyons donc, **{name}** fête ses {years} {unit} ! Joyeux anniversaire la gang !" },
    { swear: "🎂 Câlisse, **{name}** a {years} {unit} astheure ! Faut fêter ça !", clean: "🎂 Wow, **{name}** a {years} {unit} astheure ! Faut fêter ça !" },
    { swear: "🎂 Ostie qu’on est fiers : **{name}** fête ses {years} {unit} !", clean: "🎂 On est ben fiers : **{name}** fête ses {years} {unit} !" },
    { swear: "🎂 Ciboire, **{name}** fête ses {years} {unit} ! Du vrai hockey de gang, joyeux anniversaire !", clean: "🎂 Wow, **{name}** fête ses {years} {unit} ! Du vrai hockey de gang, joyeux anniversaire !" }
  ]
};

/** Every sacre the module may use, for the tests that keep them out of formal text. */
export const QUEBEC_SACRES = /\b(?:tabarn\w*|tabarou\w*|c[âa]lisse|c[âa]line|criss\w*|ostie|osti|sacrament|viarge)\b/i;

/** A small stable hash (FNV-1a): the same key always picks the same variant. */
function hashKey(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) { hash ^= key.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return hash >>> 0;
}

export function variantCount(event: VoiceEvent): number { return VARIANTS[event].length; }

/** The variant index chosen for an event key (stable). */
export function variantIndex(event: VoiceEvent, key: string): number { return hashKey(`${event}:${key}`) % VARIANTS[event].length; }

/**
 * One rotating line. `key` identifies the occurrence (member id and day, rank, run id...). Placeholders in `vars`
 * are filled; unknown ones stay as written, so a template that a later renderer fills (welcome) keeps them.
 */
export function quebecLine(event: VoiceEvent, key: string, vars: Record<string, string | number> = {}, swearing = QUEBEC_SWEARING): string {
  const variant = VARIANTS[event][variantIndex(event, key)]!;
  const template = swearing ? variant.swear : variant.clean;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

/** Every template, for the preview and the tests. */
export function allVariants(): Array<{ event: VoiceEvent; swear: string; clean: string }> {
  return (Object.keys(VARIANTS) as VoiceEvent[]).flatMap(event => VARIANTS[event].map(variant => ({ event, ...variant })));
}
