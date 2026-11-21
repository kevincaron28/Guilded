import { describe, expect, it } from 'vitest';
import { MAX_SAVED_VARIABLE_CHARACTERS, MAX_LUA_NODES, readDatabase } from '../companion/lua-export-content.mjs';

describe('SavedVariables parser resource limits', () => {
  it('rejects oversized input before parsing and tells the user to keep the original', () => {
    expect(() => readDatabase(' '.repeat(MAX_SAVED_VARIABLE_CHARACTERS + 1))).toThrow(/Keep your original/);
    expect(readDatabase('GuildedDB = { schemaVersion = 3 }')).toEqual({ schemaVersion: 3 });
  });
  it('rejects excessive node counts even when the input fits the size limit', () => {
    const input = 'GuildedDB = {' + '0,'.repeat(Math.floor(MAX_LUA_NODES / 2) + 1) + '}';
    expect(input.length).toBeLessThan(MAX_SAVED_VARIABLE_CHARACTERS);
    expect(() => readDatabase(input)).toThrow(/too many Lua values/);
  });
});
