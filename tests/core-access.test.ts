import { describe, expect, it, vi } from "vitest";
import { Collection, PermissionsBitField } from "discord.js";
import { checkCoreAccess } from "../src/commands/core-access.js";
import { runInGuildScope } from "../src/services/guild-scope.js";

function interaction(ids: string[], raw = false) {
  const roles = new Collection([['era-leader', { id: 'era-leader', name: 'Raid Leader' }], ['retail-leader', { id: 'retail-leader', name: 'Raid Leader' }]]);
  const permissions = new PermissionsBitField();
  return { guild: { id: 'discord', roles: { cache: roles } }, memberPermissions: permissions,
    member: raw ? { roles: ids } : { permissions, roles: { cache: roles.filter(role => ids.includes(role.id)) } },
    reply: vi.fn(), followUp: vi.fn(), deferred: false, replied: false };
}
describe('core collector authorization', () => {
  it.each([false,true])('checks current roles inside the bound edition scope (raw member: %s)', async raw => {
    const scope = { guild: { id: 'era', discordId: 'discord' }, permissionRoles: { raidLeader: 'era-leader' } };
    await runInGuildScope(scope as never, async () => {
      expect(await checkCoreAccess(interaction(['era-leader'], raw) as never)).toBe(true);
      const wrongEdition = interaction(['retail-leader'], raw);
      expect(await checkCoreAccess(wrongEdition as never)).toBe(false);
      expect(wrongEdition.reply).toHaveBeenCalled();
      expect(await checkCoreAccess(interaction([], raw) as never)).toBe(false);
    });
  });
  it('uses a follow-up after acknowledgement and refuses another Discord server', async () => {
    const i = interaction([]);i.deferred=true;
    expect(await checkCoreAccess(i as never)).toBe(false);
    expect(i.followUp).toHaveBeenCalled();expect(i.reply).not.toHaveBeenCalled();
    await runInGuildScope({guild:{discordId:'other'}} as never,async()=>{
      expect(await checkCoreAccess(interaction(['era-leader']) as never)).toBe(false);
    });
  });
});
