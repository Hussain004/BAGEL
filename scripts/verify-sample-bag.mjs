/**
 * Sanity-check the generated sample bag: open it with McapIndexedReader and
 * print the topic table. If this prints the expected four topics with the
 * right counts, the bag is valid for BAGEL.
 */

import { readFileSync } from 'node:fs';
import { McapIndexedReader } from '@mcap/core';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PATH = resolve(__dirname, '..', 'public', 'sample-bags', 'tour.mcap');

const buf = readFileSync(PATH);

// Build a memory-backed IReadable for McapIndexedReader.
const readable = {
  async size() {
    return BigInt(buf.byteLength);
  },
  async read(offset, length) {
    const start = Number(offset);
    const end = start + Number(length);
    return new Uint8Array(buf.buffer, buf.byteOffset + start, Number(length)).slice();
  },
};

const reader = await McapIndexedReader.Initialize({ readable });

console.log(`File size: ${(buf.byteLength / 1024).toFixed(1)} KB`);
console.log(`Profile  : ${reader.header?.profile ?? '(missing)'}`);
console.log(`Library  : ${reader.header?.library ?? '(missing)'}`);
console.log(`Time     : ${reader.statistics?.messageStartTime} → ${reader.statistics?.messageEndTime}`);
console.log(`Messages : ${reader.statistics?.messageCount}`);
console.log(`Channels :`);
for (const ch of reader.channelsById.values()) {
  const schema = reader.schemasById.get(ch.schemaId);
  const count = reader.statistics?.channelMessageCounts?.get(ch.id) ?? 0n;
  console.log(`  ${ch.topic.padEnd(12)} ${schema?.name?.padEnd(32) ?? '?'} ${count}`);
}

// Try iterating the first 5 messages to make sure the chunks decompress fine.
let n = 0;
for await (const msg of reader.readMessages()) {
  n++;
  if (n <= 3) {
    const ch = reader.channelsById.get(msg.channelId);
    console.log(`  msg #${n}: ${ch?.topic} @ ${msg.logTime}  (${msg.data.byteLength} bytes)`);
  }
  if (n >= 5) break;
}
console.log('OK');
