import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { readSavedText } from '../companion/saved-file.mjs';

it('bounds bytes rather than characters and preserves the original on failure', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'guilded-bounded-'));
  try {
    const file = join(dir, 'Guilded.lua');
    await writeFile(file, 'ééé');
    expect(await readSavedText(file, 6)).toBe('ééé');
    await expect(readSavedText(file, 5)).rejects.toThrow(/Keep your original/);
    expect(await readFile(file, 'utf8')).toBe('ééé');
    await expect(readSavedText(join(dir, 'missing'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
