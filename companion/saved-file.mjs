import { createReadStream } from 'node:fs';

export const MAX_SAVED_FILE_BYTES = 32_000_000;
// Bound the actual stream, including files that grow after opening. Never
// modify the player's original SavedVariables when rejecting an input.
export async function readSavedText(path, limit = MAX_SAVED_FILE_BYTES) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of createReadStream(path, { highWaterMark: 64 * 1024 })) {
    bytes += chunk.length;
    if (bytes > limit) throw new Error('Saved data exceeds the file reading limit. Keep your original file and ask an officer for help.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
