import { expect, it } from 'vitest';
import { keystonePoints, challengeScores } from '../src/services/challenge-rating.js';
import { MIDNIGHT_S2_RATING, MIDNIGHT_S2_RATING_V2 } from '../src/services/challenge-rating-rules.js';
import type { ChallengeRun } from '../src/services/challenge-leaderboard.js';
const challenge={mapId:249,level:10,affixIds:[3,9],durationMs:1980000,timeLimitSec:1980,onTime:true,practiceRun:false,eligibleForScore:true};
it('keeps v1 immutable and awards bounded, eligible overtime credit only in v2',()=>{
  const overtime={...challenge,onTime:false,durationMs:2376000};
  expect(keystonePoints(overtime)).toBeNull();
  expect(keystonePoints(overtime,'guilded-keystone-v2')).toBe(240);
  expect(keystonePoints({...overtime,durationMs:2772000},'guilded-keystone-v2')).toBe(160);
  expect(keystonePoints({...overtime,durationMs:2772001},'guilded-keystone-v2')).toBeNull();
  for(const change of [{practiceRun:true},{eligibleForScore:false},{onTime:true},{level:31}]) expect(keystonePoints({...overtime,...change},'guilded-keystone-v2')).toBeNull();
});
it('counts a dungeon once across affixes and never lets overtime replace a better timed run',()=>{
  const run:ChallengeRun={gameEdition:'retail',runId:'over',instanceId:1762,difficultyId:8,dungeonName:'Fixture',durationSec:2376,
    endedAt:new Date('2026-10-28T00:00Z'),challenge:{...challenge,onTime:false,durationMs:2376000},evidence:{completedBy:'challenge objectives'},players:[{character:'Tester',realm:'Realm',presentSec:2376}]};
  expect(challengeScores([run],MIDNIGHT_S2_RATING)).toEqual([]);
  expect(challengeScores([run],MIDNIGHT_S2_RATING_V2)[0]?.points).toBe(240);
  const timed={...run,runId:'timed',challenge:{...challenge,affixIds:[10]}};
  const result=challengeScores([run,timed,{...run,runId:'duplicate'}],MIDNIGHT_S2_RATING_V2);
  expect(result[0]).toMatchObject({points:320,completed:1});
  expect(result[0]?.best[0]?.group).toBe('249/10');
});
