// The Québécois "gang" voice for the fun, social French text (owner request, 20 Nov 2026).
//
// Only celebratory lines live here: promotions, achievements, MVP and top 3, badges, welcome, records.
// Error messages, privacy and data text, moderation, setup, admin and officer tools, help and FAQ never
// use this module (tests/fr-quebec-voice.test.ts enforces it): they stay clear French with "vous".
//
// To tone the whole thing down, set QUEBEC_SWEARING to false: every line then uses its joual-only variant
// (same slang, no sacres). Each event has a few variants; the one shown is chosen from a stable key so the
// same event always reads the same and different events do not all repeat one sentence.

export const QUEBEC_SWEARING = true;

export type VoiceEvent = "promotion" | "promotionKicker" | "achievement" | "mvp" | "weeklyMvp" | "top3" | "badge" | "welcome" | "joined" | "guildRecord" | "personalBest" | "rookie";

interface Variant { /** With sacres, used while QUEBEC_SWEARING is on. */ swear: string; /** Joual only, no sacres. */ clean: string }

// Placeholders: {who} (a mention or name), {rank}, {names}, {dungeon}, {before}, {now}, {name}, {threshold}, {guild}, {mention}, {id}.
// Rules: "tu" register, never an insult at a member, no slurs, nothing sexual. Sacres are exclamations only.
const VARIANTS: Record<VoiceEvent, readonly Variant[]> = {
  promotion: [
    { swear: "🎉 Tabarnak, {who}, t’es rendu(e) **{rank}** ! C’est ben mérité, pas pire pantoute !", clean: "🎉 Ben voyons donc, {who}, t’es rendu(e) **{rank}** ! C’est ben mérité, pas pire pantoute !" },
    { swear: "🎉 Câline, {who} passe **{rank}** ! La gang est fière de toé, continue de même !", clean: "🎉 Wow, {who} passe **{rank}** ! La gang est fière de toé, continue de même !" },
    { swear: "🎉 Ostie de belle promotion, {who} ! Bienvenue au rang de **{rank}**, t’as ça dans le sang !", clean: "🎉 Belle promotion, {who} ! Bienvenue au rang de **{rank}**, t’as ça dans le sang !" },
    { swear: "🎉 Crisse que c’est bon, {who} est **{rank}** astheure ! Pis y’a des affaires à fêter à soir !", clean: "🎉 C’est malade, {who} est **{rank}** astheure ! Pis y’a des affaires à fêter à soir !" }
  ],
  promotionKicker: [
    { swear: "Tabarouette, bravo !", clean: "Pas pire pantoute !" },
    { swear: "Câline, félicitations !", clean: "C’est malade !" },
    { swear: "Crisse, c’est bon !", clean: "Félicitations !" }
  ],
  achievement: [
    { swear: "🎉 Tabarouette, bravo <@{id}> ! Ça, c’est du bon stock !", clean: "🎉 Ben bravo <@{id}> ! Ça, c’est du bon stock !" },
    { swear: "🎉 Câline, <@{id}> ramasse un autre succès ! T’es en feu !", clean: "🎉 Wow, <@{id}> ramasse un autre succès ! T’es en feu !" },
    { swear: "🎉 Ostie que c’est beau, <@{id}> ! Pas pire pantoute !", clean: "🎉 C’est malade, <@{id}> ! Pas pire pantoute !" },
    { swear: "🎉 Sacrament, <@{id}>, t’en as de la swing ! Bravo !", clean: "🎉 Ben coudonc, <@{id}>, t’en as de la swing ! Bravo !" }
  ],
  mvp: [
    { swear: "⭐ Tabarnak, bravo {who} ! T’as fait le gros ouvrage cette semaine !", clean: "⭐ Ben bravo {who} ! T’as fait le gros ouvrage cette semaine !" },
    { swear: "⭐ Câline, {who} mène la gang ! C’est ben mérité !", clean: "⭐ Wow, {who} mène la gang ! C’est ben mérité !" },
    { swear: "⭐ Crisse que t’es bon, {who} ! Pas pire pantoute !", clean: "⭐ C’est malade, {who} ! Pas pire pantoute !" }
  ],
  weeklyMvp: [
    { swear: "⭐ Tabarnak, bravo {who}, MVP de la semaine ! T’as fait le gros ouvrage !", clean: "⭐ Ben bravo {who}, MVP de la semaine ! T’as fait le gros ouvrage !" },
    { swear: "⭐ Câline, {who} est MVP de la semaine ! La gang s’en rappelle !", clean: "⭐ Wow, {who} est MVP de la semaine ! La gang s’en rappelle !" },
    { swear: "⭐ Crisse que t’es bon, {who}, MVP de la semaine ! Pas pire pantoute !", clean: "⭐ C’est malade, {who}, MVP de la semaine ! Pas pire pantoute !" }
  ],
  top3: [
    { swear: "🏆 Tabarouette, bravo au top 3 de la gang : {names} ! Ça, c’est du monde pas pire pantoute !", clean: "🏆 Ben bravo au top 3 de la gang : {names} ! Ça, c’est du monde pas pire pantoute !" },
    { swear: "🏆 Câline, le podium du mois : {names} ! La gang est ben fière !", clean: "🏆 Wow, le podium du mois : {names} ! La gang est ben fière !" },
    { swear: "🏆 Ostie de beau podium : {names} ! Ben joué, la gang !", clean: "🏆 Beau podium : {names} ! Ben joué, la gang !" }
  ],
  badge: [
    { swear: "🏅 Tabarouette, bravo **{name}** ! T’as atteint **{threshold} points communautaires** cette saison. Ton badge est gardé dans /community badges. Merci de faire vivre la gang !", clean: "🏅 Ben bravo **{name}** ! T’as atteint **{threshold} points communautaires** cette saison. Ton badge est gardé dans /community badges. Merci de faire vivre la gang !" },
    { swear: "🏅 Câline, **{name}**, t’as atteint **{threshold} points communautaires** cette saison ! Ton badge t’attend dans /community badges. Merci d’être là, c’est malade !", clean: "🏅 Wow, **{name}**, t’as atteint **{threshold} points communautaires** cette saison ! Ton badge t’attend dans /community badges. Merci d’être là, c’est malade !" },
    { swear: "🏅 Crisse, **{name}** ! **{threshold} points communautaires** cette saison, pas pire pantoute. Ton badge est dans /community badges. Merci de faire vivre la gang !", clean: "🏅 Ben voyons, **{name}** ! **{threshold} points communautaires** cette saison, pas pire pantoute. Ton badge est dans /community badges. Merci de faire vivre la gang !" }
  ],
  welcome: [
    { swear: "Bienvenue dans la gang de {guild}, {mention} ! Tabarnak, on est contents de t’avoir icitte. Utilise les boutons ci-dessous pour bien commencer : les réponses sont privées, toi seul les vois.", clean: "Bienvenue dans la gang de {guild}, {mention} ! On est ben contents de t’avoir icitte. Utilise les boutons ci-dessous pour bien commencer : les réponses sont privées, toi seul les vois." },
    { swear: "Eille, {mention}, bienvenue dans la gang de {guild} ! Câline, ça fait plaisir. Les boutons ci-dessous répondent en privé : toi seul vois les réponses.", clean: "Eille, {mention}, bienvenue dans la gang de {guild} ! Ça fait ben plaisir. Les boutons ci-dessous répondent en privé : toi seul vois les réponses." },
    { swear: "Ça va bien, {mention} ? Bienvenue dans la gang de {guild}, crisse que t’arrives au bon moment ! Les boutons ci-dessous répondent en privé : toi seul vois les réponses.", clean: "Ça va bien, {mention} ? Bienvenue dans la gang de {guild}, t’arrives au bon moment ! Les boutons ci-dessous répondent en privé : toi seul vois les réponses." }
  ],
  joined: [
    { swear: "✅ **{name}** a rejoint la guilde. Tabarouette, bienvenue !", clean: "✅ **{name}** a rejoint la guilde. Bienvenue dans la gang !" },
    { swear: "✅ **{name}** est dans la guilde astheure. Câline, bienvenue !", clean: "✅ **{name}** est dans la guilde astheure. Bienvenue, pas pire pantoute !" },
    { swear: "✅ **{name}** a rejoint la guilde. Ostie qu’on est contents, bienvenue !", clean: "✅ **{name}** a rejoint la guilde. On est ben contents, bienvenue !" }
  ],
  guildRecord: [
    { swear: "🏆 Tabarnak, nouveau record de guilde dans **{dungeon}** : {before} → **{now}** !", clean: "🏆 Ben voyons donc, nouveau record de guilde dans **{dungeon}** : {before} → **{now}** !" },
    { swear: "🏆 Câline, la gang bat le record de **{dungeon}** : {before} → **{now}** ! C’est malade !", clean: "🏆 Wow, la gang bat le record de **{dungeon}** : {before} → **{now}** ! C’est malade !" },
    { swear: "🏆 Crisse que ça va vite : record de guilde dans **{dungeon}**, {before} → **{now}** !", clean: "🏆 Ça va vite, ben vite : record de guilde dans **{dungeon}**, {before} → **{now}** !" }
  ],
  personalBest: [
    { swear: "⭐ Tabarouette, record personnel dans {dungeon} : {names} !", clean: "⭐ Ben coudonc, record personnel dans {dungeon} : {names} !" },
    { swear: "⭐ Câline, {names} bat son record dans {dungeon} !", clean: "⭐ Wow, {names} bat son record dans {dungeon} !" },
    { swear: "⭐ Ostie de bon temps dans {dungeon} : record personnel pour {names} !", clean: "⭐ Beau temps dans {dungeon} : record personnel pour {names} !" }
  ],
  rookie: [
    { swear: "Nouveau dans la gang : tabarouette, bienvenue !", clean: "Nouveau dans la gang : ben content de te voir, bienvenue !" },
    { swear: "Nouveau dans la gang : câline, bon départ, bienvenue !", clean: "Nouveau dans la gang : pas pire pantoute pour un début, bienvenue !" },
    { swear: "Nouveau dans la gang : crisse, bon début, bienvenue !", clean: "Nouveau dans la gang : beau début, bienvenue !" }
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
