import { z } from "zod";

export const challengeRatingSchema = z.object({
  model: z.enum(["guilded-keystone-v1", "guilded-keystone-v2"]), pool: z.string().min(1).max(80),
  dungeons: z.array(z.object({ mapId: z.number().int().positive(), instanceId: z.number().int().positive(),
    name: z.string().min(1).max(100), timeLimitSec: z.number().int().positive().max(14400) })).min(1).max(20)
}).refine(r => new Set(r.dungeons.map(d => d.mapId)).size === r.dungeons.length, "Duplicate keystone maps");
export type ChallengeRatingRules = z.infer<typeof challengeRatingSchema>;

// Facts from Raider.IO's generated season-mn-2 catalog, pinned for this candidate:
// https://github.com/RaiderIO/raiderio-addon/blob/127d971160d9405d5c2dd04c4b46e95b73799cce/db/db_dungeons.lua
// Native timer must match this frozen pool; a later hotfix needs a future rules snapshot.
export const MIDNIGHT_S2_RATING: ChallengeRatingRules = {
  model: "guilded-keystone-v1", pool: "Midnight Season 2",
  dungeons: [
    {mapId:249,instanceId:1762,name:"Kings' Rest",timeLimitSec:1980},
    {mapId:250,instanceId:1877,name:"Temple of Sethraliss",timeLimitSec:1920},
    {mapId:399,instanceId:2521,name:"Ruby Life Pools",timeLimitSec:1680},
    {mapId:587,instanceId:2813,name:"Murder Row",timeLimitSec:2040},
    {mapId:584,instanceId:2859,name:"The Blinding Vale",timeLimitSec:1800},
    {mapId:586,instanceId:2825,name:"Den of Nalorakk",timeLimitSec:1920},
    {mapId:585,instanceId:2923,name:"Voidscar Arena",timeLimitSec:1800},
    {mapId:588,instanceId:2993,name:"Altar of Fangs",timeLimitSec:1800}
  ]
};
// Only newly created rules use v2. Stored v1 snapshots retain their exact policy.
export const MIDNIGHT_S2_RATING_V2: ChallengeRatingRules = { ...MIDNIGHT_S2_RATING, model: "guilded-keystone-v2" };
