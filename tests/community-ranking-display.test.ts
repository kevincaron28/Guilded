import { describe, expect, it, vi } from 'vitest';
import { communityRankingLines } from '../src/services/community-ranking-display.js';

describe('readable full community rankings', () => {
  it('keeps tied scores and uses saved names when Discord cannot resolve departed members', async () => {
    const database = { member: { findMany: vi.fn(async () => [{ discordUserId: 'user1111', displayName: 'Saved Name' }]) } };
    const guild = { members: { cache: new Map(), fetch: vi.fn(async () => { throw new Error('departed'); }) },
      client: { users: { fetch: vi.fn(async () => { throw new Error('not found'); }) } } };
    const board = [{ userId: 'user1111', points: 50, balance: 5 }, { userId: 'user2222', points: 50, balance: 50 }, { userId: 'user3333', points: 10, balance: 10 }];
    const original = structuredClone(board);
    const content = await communityRankingLines(database as never, guild as never, 'scope', board, board, 'fr');
    expect(content).toBe('1. **Saved Name** · 50 pts\n1. **Membre …2222** · 50 pts\n3. **Membre …3333** · 10 pts');
    expect(database.member.findMany).toHaveBeenCalledWith({ where: { guildId: 'scope', discordUserId: { in: board.map(row => row.userId) } }, select: { discordUserId: true, displayName: true } });
    expect(board).toEqual(original);
  });

  it('resolves only the visible page and escapes names without creating mentions', async () => {
    const database = { member: { findMany: vi.fn() } };
    const guild = { members: { cache: new Map([['u', { displayName: '**Name**\n<@123>' }]]), fetch: vi.fn() } };
    const row = { userId: 'u', points: 20, balance: 0 };
    const content = await communityRankingLines(database as never, guild as never, 'scope', [{ userId: 'off-page', points: 30, balance: 30 }, row], [row], 'en');
    expect(content).toContain('2.');
    expect(content).toContain('\\*\\*Name\\*\\*');
    expect(content).not.toContain('<@');
    expect(content).toContain('20 pts');
    expect(guild.members.fetch).not.toHaveBeenCalled();
    expect(database.member.findMany).not.toHaveBeenCalled();
  });
});
