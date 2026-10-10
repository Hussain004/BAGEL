/**
 * An MCAP whose messages are JSON with Foxglove schema names, the way the
 * Foxglove SDKs write them with the JSON encoding.
 */
import { McapWriter } from '@mcap/core';
import { makeMemoryWritable } from './synth';

export interface JsonTopic {
  topic: string;
  /** e.g. `foxglove.ImageAnnotations`. */
  schemaName: string;
  messages: Array<{ logTime: bigint; value: unknown }>;
}

export async function writeJsonMcap(topics: JsonTopic[]): Promise<Uint8Array> {
  const writable = makeMemoryWritable();
  const writer = new McapWriter({ writable, useChunks: true });
  await writer.start({ profile: '', library: 'bagel-json-fixture' });
  const ids: number[] = [];
  for (const t of topics) {
    const schemaId = await writer.registerSchema({ name: t.schemaName, encoding: 'jsonschema', data: new TextEncoder().encode('{"type":"object"}') });
    ids.push(await writer.registerChannel({ schemaId, topic: t.topic, messageEncoding: 'json', metadata: new Map() }));
  }
  const events = topics.flatMap((t, i) => t.messages.map((m) => ({ channelId: ids[i]!, logTime: m.logTime, data: new TextEncoder().encode(JSON.stringify(m.value)) })));
  events.sort((a, b) => (a.logTime < b.logTime ? -1 : a.logTime > b.logTime ? 1 : 0));
  let sequence = 0;
  for (const e of events) await writer.addMessage({ channelId: e.channelId, sequence: sequence++, logTime: e.logTime, publishTime: e.logTime, data: e.data });
  await writer.end();
  return writable.getBytes();
}
