import { describe, expect, it } from 'vitest';
import { MAX_SAVED_VARIABLE_CHARACTERS, readDatabase } from '../companion/lua-export-content.mjs';

describe('SavedVariables parser resource limits', () => {
  it('rejects oversized input before parsing and tells the user to keep the original', () => {
    expect(() => readDatabase(' '.repeat(MAX_SAVED_VARIABLE_CHARACTERS + 1))).toThrow(/Keep your original/);
    expect(readDatabase('GuildedDB = { schemaVersion = 3 }')).toEqual({ schemaVersion: 3 });
  });
  it('rejects excessive node counts even when the input fits the size limit', () => {
    const input = 'GuildedDB = {' + '0,'.repeat(250001) + '}';
    expect(input.length).toBeLessThan(MAX_SAVED_VARIABLE_CHARACTERS);
    expect(() => readDatabase(input)).toThrow(/too many Lua values/);
  });
});
