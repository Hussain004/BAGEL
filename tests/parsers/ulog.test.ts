import { afterEach, describe, expect, it } from 'vitest';
import { parseBag, detectFormat, readDeserializedMessages, readMessageAtTime, readMessagesInRange, readAllMessageStats, getTopicType, disposeParserCaches } from '../../src/parsers/core';
import { createFileSource } from '../../src/parsers/source';
import { ulogWarnings } from '../../src/parsers/ulog';
import {
  ATTITUDE_FORMAT,
  GPS_FORMAT,
  SYNC_BYTES,
  addLogged,
  attitude,
  concat,
  concatAll,
  data,
  dropout,
  flagBitsFull,
  format,
  gps,
  header,
  infoMulti,
  infoString,
  infoU32,
  logText,
  pack,
  paramF,
  paramI,
  removeLogged,
  sync,
  taggedLog,
} from '../fixtures/ulog';

afterEach(() => disposeParserCaches());

let n = 0;
const open = (bytes: Uint8Array, name = `flight${n++}.ulg`) => createFileSource(new File([bytes], name));
const US = 1_000_000;

/** A small realistic log: attitude at 50 Hz, GPS at 5 Hz, text, parameters and info. */
function flight(extra: Uint8Array[] = []): Uint8Array {
  const parts: Uint8Array[] = [
    header(5 * US),
    flagBitsFull(),
    infoString('sys_name', 'PX4'),
    infoString('ver_sw', 'v1.14.0'),
    infoU32('time_ref_utc', 1_700_000_000),
    infoMulti('perf_counter_preflight', 'a'),
    infoMulti('perf_counter_preflight', 'b'),
    paramF('MC_ROLL_P', 6.5),
    paramI('SYS_AUTOSTART', 4001),
    format(ATTITUDE_FORMAT),
    format(GPS_FORMAT),
    addLogged(0, 0, 'vehicle_attitude'),
    addLogged(0, 1, 'sensor_gps'),
    logText(6, 5 * US, 'Armed by RC'),
  ];
  for (let i = 0; i < 100; i++) {
    const t = 5 * US + i * 20_000;
    parts.push(data(0, attitude(t, [1, 0, 0, i / 100], i)));
    if (i % 10 === 0) parts.push(data(1, gps(t, 47.3977 + i * 1e-5, 8.5456, 488 + i / 10)));
    if (i === 50) parts.push(paramF('MC_ROLL_P', 7.25), logText(4, t, 'Low battery'));
  }
  return concat(...parts, ...extra);
}

describe('detecting and summarising a ULog', () => {
  it('is recognised by extension and by magic bytes, and summarised', async () => {
    const bytes = flight();
    expect(await detectFormat(open(bytes, 'a.ulg'))).toBe('ulog');
    expect(await detectFormat(open(bytes, 'noext'))).toBe('ulog');

    const s = await parseBag(open(bytes));
    expect(s.format).toBe('ulog');
    const byName = Object.fromEntries(s.topics.map((t) => [t.name, t]));
    expect(byName['/vehicle_attitude']).toMatchObject({ type: 'px4/vehicle_attitude', messageCount: 100 });
    expect(byName['/sensor_gps']).toMatchObject({ type: 'sensor_msgs/msg/NavSatFix', messageCount: 10 });
    expect(byName['/rosout']).toMatchObject({ type: 'rcl_interfaces/msg/Log', messageCount: 2 });
    expect(byName['/parameters']!.messageCount).toBe(1);
    expect(byName['/parameter_changes']!.messageCount).toBe(1);
    expect(byName['/info']!.messageCount).toBe(1);
    expect(byName['/vehicle_attitude']!.frequency).toBeCloseTo(50, 0);
    // Start and end come from the data, in nanoseconds.
    expect(s.startTime).toBe(5n * 1_000_000_000n);
    expect(s.duration).toBeCloseTo(1.98, 2);
    expect(s.totalMessageCount).toBe(100 + 10 + 2 + 1 + 1 + 1);
  });

  it('rejects something that is not a ULog with a plain message', async () => {
    await expect(parseBag(open(new Uint8Array(64), 'x.ulg'))).rejects.toThrow(/Not a ULog/);
  });
});

describe('reading messages', () => {
  it('decodes fields, arrays and skips padding', async () => {
    const s = open(flight());
    const msgs = await readDeserializedMessages(s, 'ulog', '/vehicle_attitude');
    expect(msgs).toHaveLength(100);
    expect(msgs[0]!.timestamp).toBe(5n * 1_000_000_000n);
    expect(msgs[1]!.timestamp).toBe(5n * 1_000_000_000n + 20_000_000n);
    const v = msgs[40]!.value as { q: number[]; rollspeed: number; timestamp: number };
    expect(v.q).toEqual([1, 0, 0, 0.4000000059604645]); // float32 on the wire
    expect(v.rollspeed).toBe(40);
    expect(Object.keys(v).some((k) => k.startsWith('_padding'))).toBe(false);
    expect(await getTopicType(s, 'ulog', '/vehicle_attitude')).toBe('px4/vehicle_attitude');
    expect(await getTopicType(s, 'ulog', '/nope')).toBeUndefined();
    expect(await readDeserializedMessages(s, 'ulog', '/nope')).toEqual([]);
  });

  it('honours limit and reports progress and batches', async () => {
    const s = open(flight());
    expect(await readDeserializedMessages(s, 'ulog', '/vehicle_attitude', 7)).toHaveLength(7);
    const batches: number[] = [];
    await readDeserializedMessages(s, 'ulog', '/vehicle_attitude', undefined, undefined, (b) => batches.push(b.length));
    expect(batches.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('gives GPS a NavSatFix shape with degrees and metres', async () => {
    const msgs = await readDeserializedMessages(open(flight()), 'ulog', '/sensor_gps');
    const v = msgs[0]!.value as { latitude: number; longitude: number; altitude: number; status: { status: number }; header: { stamp: { sec: number; nanosec: number } } };
    expect(v.latitude).toBeCloseTo(47.3977, 6);
    expect(v.longitude).toBeCloseTo(8.5456, 6);
    expect(v.altitude).toBeCloseTo(488, 3);
    expect(v.status.status).toBe(0);
    expect(v.header.stamp).toEqual({ sec: 5, nanosec: 0 });
  });

  it('a GPS fix below 3D reports no fix', async () => {
    const bytes = concat(header(0), flagBitsFull(), format(GPS_FORMAT), addLogged(0, 0, 'sensor_gps'), data(0, gps(1000, 1, 2, 3, 0)), data(0, gps(2000, 1, 2, 3, 3)));
    const m = await readDeserializedMessages(open(bytes), 'ulog', '/sensor_gps');
    expect((m[0]!.value as { status: { status: number } }).status.status).toBe(-1);
    expect((m[1]!.value as { status: { status: number } }).status.status).toBe(0);
  });

  it('maps logged text to the Log panel shape with ROS levels', async () => {
    const m = await readDeserializedMessages(open(flight()), 'ulog', '/rosout');
    expect(m.map((x) => (x.value as { msg: string }).msg)).toEqual(['Armed by RC', 'Low battery']);
    // ULog 6 is info and 4 is warning; ROS 2 uses 20 and 30.
    expect(m.map((x) => (x.value as { level: number }).level)).toEqual([20, 30]);
  });

  it('keeps parameters, their changes, and info', async () => {
    const s = open(flight());
    const p = (await readDeserializedMessages(s, 'ulog', '/parameters'))[0]!.value as { params: Record<string, number> };
    expect(p.params).toEqual({ MC_ROLL_P: 6.5, SYS_AUTOSTART: 4001 });
    const c = await readDeserializedMessages(s, 'ulog', '/parameter_changes');
    expect(c[0]!.value).toEqual({ name: 'MC_ROLL_P', value: 7.25 });
    expect(c[0]!.timestamp).toBe(5n * 1_000_000_000n + 50n * 20_000n * 1000n); // 50 samples at 20 ms, in ns
    const info = (await readDeserializedMessages(s, 'ulog', '/info'))[0]!.value as { info: Record<string, unknown> };
    expect(info.info.sys_name).toBe('PX4');
    expect(info.info.time_ref_utc).toBe(1_700_000_000);
    expect(info.info.perf_counter_preflight).toEqual(['a', 'b']);
  });

  it('readMessageAtTime picks the message at or after the time, else the last', async () => {
    const s = open(flight());
    const at = await readMessageAtTime(s, 'ulog', '/vehicle_attitude', 5n * 1_000_000_000n + 30_000_000n);
    expect((at!.value as { rollspeed: number }).rollspeed).toBe(2); // t = +40 ms
    const between = await readMessageAtTime(s, 'ulog', '/vehicle_attitude', 5n * 1_000_000_000n + 40_000_000n);
    expect((between!.value as { rollspeed: number }).rollspeed).toBe(2);
    expect(Number((await readMessageAtTime(s, 'ulog', '/vehicle_attitude', 99n * 1_000_000_000n))!.timestamp)).toBe(5_000_000_000 + 99 * 20_000_000);
    expect(await readMessageAtTime(s, 'ulog', '/nope', 0n)).toBeNull();
  });

  it('stats list every message with its time since the start', async () => {
    const stats = await readAllMessageStats(open(flight()), 'ulog');
    expect(stats['/vehicle_attitude']!.times).toHaveLength(100);
    expect(stats['/vehicle_attitude']!.times[1]).toBe(20_000_000);
    expect(stats['/vehicle_attitude']!.sizes[0]).toBeGreaterThan(0);
  });
});

describe('shapes real logs have', () => {
  it('several instances of a topic become separate topics', async () => {
    const f = 'sensor_gyro:uint64_t timestamp;float x;';
    const bytes = concat(
      header(0), flagBitsFull(), format(f),
      addLogged(0, 0, 'sensor_gyro'), addLogged(1, 1, 'sensor_gyro'), addLogged(2, 2, 'sensor_gyro'),
      data(0, concat(pack.u64(1000), pack.f32(1))), data(1, concat(pack.u64(1100), pack.f32(2))), data(2, concat(pack.u64(1200), pack.f32(3))), data(1, concat(pack.u64(2100), pack.f32(4))),
    );
    const s = await parseBag(open(bytes));
    expect(s.topics.map((t) => [t.name, t.messageCount])).toEqual([['/sensor_gyro', 1], ['/sensor_gyro_1', 2], ['/sensor_gyro_2', 1]]);
    const m = await readDeserializedMessages(open(bytes, 'again.ulg'), 'ulog', '/sensor_gyro_1');
    expect(m.map((x) => (x.value as { x: number }).x)).toEqual([2, 4]);
  });

  it('nested formats, arrays of them, and formats declared after their use', async () => {
    const bytes = concat(
      header(0), flagBitsFull(),
      format('outer:uint64_t timestamp;inner[2] pair;inner single;uint8_t tail;'),
      format('inner:float a;int16_t b;'),
      addLogged(0, 0, 'outer'),
      data(0, concat(pack.u64(10), pack.f32(1.5), pack.i16(-2), pack.f32(2.5), pack.i16(3), pack.f32(9), pack.i16(-9), pack.u8(7))),
    );
    const [m] = await readDeserializedMessages(open(bytes), 'ulog', '/outer');
    expect(m!.value).toEqual({ timestamp: 10, pair: [{ a: 1.5, b: -2 }, { a: 2.5, b: 3 }], single: { a: 9, b: -9 }, tail: 7 });
  });

  it('char arrays decode as text, bools as booleans, 64-bit and signed integers exactly', async () => {
    const bytes = concat(
      header(0), flagBitsFull(),
      format('misc:uint64_t timestamp;char[8] name;bool ok;int8_t s8;uint16_t u16;int32_t i32;uint32_t u32;int64_t i64;double d;'),
      addLogged(0, 0, 'misc'),
      data(0, concat(pack.u64(1), pack.str('abc', 8), pack.bool(true), Uint8Array.from([0xfe]), pack.u16(65535), pack.i32(-123456), pack.u32(4_000_000_000), (() => { const b = new Uint8Array(8); new DataView(b.buffer).setBigInt64(0, -5n, true); return b; })(), pack.f64(Math.PI))),
    );
    const [m] = await readDeserializedMessages(open(bytes), 'ulog', '/misc');
    expect(m!.value).toEqual({ timestamp: 1, name: 'abc', ok: true, s8: -2, u16: 65535, i32: -123456, u32: 4_000_000_000, i64: -5, d: Math.PI });
  });

  it('a topic can be unsubscribed and subscribed again under a new id', async () => {
    const f = 'x:uint64_t timestamp;float v;';
    const bytes = concat(
      header(0), flagBitsFull(), format(f),
      addLogged(0, 3, 'x'), data(3, concat(pack.u64(100), pack.f32(1))),
      removeLogged(3), data(3, concat(pack.u64(150), pack.f32(99))), // ignored: not subscribed
      addLogged(0, 8, 'x'), data(8, concat(pack.u64(200), pack.f32(2))),
    );
    const m = await readDeserializedMessages(open(bytes), 'ulog', '/x');
    expect(m.map((v) => (v.value as { v: number }).v)).toEqual([1, 2]);
  });

  it('tagged log messages are kept', async () => {
    const bytes = concat(header(0), flagBitsFull(), logText(6, 1000, 'plain'), taggedLog(3, 7, 2000, 'tagged'));
    const m = await readDeserializedMessages(open(bytes), 'ulog', '/rosout');
    expect(m.map((x) => (x.value as { msg: string; name: string }).msg)).toEqual(['plain', 'tagged']);
    expect((m[1]!.value as { name: string; level: number }).name).toBe('tag 7');
    expect((m[1]!.value as { level: number }).level).toBe(40);
  });

  it('dropouts become their own topic', async () => {
    const f = 'x:uint64_t timestamp;';
    const bytes = concat(header(0), flagBitsFull(), format(f), addLogged(0, 0, 'x'), data(0, pack.u64(1000)), dropout(120), data(0, pack.u64(2000)));
    const s = await parseBag(open(bytes));
    expect(s.topics.find((t) => t.name === '/ulog_dropouts')!.messageCount).toBe(1);
    const [d] = await readDeserializedMessages(open(bytes, 'dd.ulg'), 'ulog', '/ulog_dropouts');
    expect(d!.value).toEqual({ duration_ms: 120 });
    expect(d!.timestamp).toBe(1_000_000n); // at the last data before the gap
  });

  it('a message with no leading timestamp field is never placed, instead of guessing', async () => {
    const bytes = concat(header(0), flagBitsFull(), format('odd:float v;'), addLogged(0, 0, 'odd'), data(0, pack.f32(1)));
    const s = await parseBag(open(bytes));
    expect(s.topics.find((t) => t.name === '/odd')).toBeUndefined();
  });

  it('an unknown nested type is skipped with a warning, the rest of the log still reads', async () => {
    const bytes = concat(header(0), flagBitsFull(), format('bad:uint64_t timestamp;ghost g;'), format('ok:uint64_t timestamp;'), addLogged(0, 0, 'bad'), addLogged(0, 1, 'ok'), data(1, pack.u64(5)));
    const s = open(bytes);
    const sum = await parseBag(s);
    expect(sum.topics.map((t) => t.name)).toEqual(['/ok']);
    expect((await ulogWarnings(s)).join()).toMatch(/no usable format for "bad"/);
  });

  it('a self-referencing format does not hang', async () => {
    const bytes = concat(header(0), flagBitsFull(), format('loop:uint64_t timestamp;loop again;'), addLogged(0, 0, 'loop'));
    const s = await parseBag(open(bytes));
    expect(s.topics).toEqual([]);
  });
});

describe('damaged and unusual files', () => {
  it('a log cut off mid-message keeps everything before the cut', async () => {
    const whole = flight();
    for (const cut of [1, 2, 3, 4, 9, 30]) {
      const s = open(whole.subarray(0, whole.length - cut), `cut${cut}.ulg`);
      const sum = await parseBag(s);
      expect(sum.topics.find((t) => t.name === '/vehicle_attitude')!.messageCount).toBeGreaterThanOrEqual(98);
      const m = await readDeserializedMessages(s, 'ulog', '/vehicle_attitude');
      expect(m.length).toBe(sum.topics.find((t) => t.name === '/vehicle_attitude')!.messageCount);
    }
  });

  it('a log truncated at every byte of its tail never throws', async () => {
    const whole = flight();
    for (let cut = 0; cut < 200; cut++) {
      await expect(parseBag(open(whole.subarray(0, whole.length - cut), `t${cut}.ulg`))).resolves.toBeTruthy();
    }
  });

  it('a file that is just the header opens with no topics', async () => {
    const s = await parseBag(open(header(1234)));
    expect(s.topics).toEqual([]);
    expect(s.totalMessageCount).toBe(0);
  });

  it('skips a damaged stretch and carries on from the next sync marker', async () => {
    const f = 'x:uint64_t timestamp;float v;';
    const row = (t: number, v: number) => data(0, concat(pack.u64(t), pack.f32(v)));
    const bytes = concat(
      header(0), flagBitsFull(), format(f), addLogged(0, 0, 'x'),
      row(1000, 1), row(2000, 2), sync(),
      Uint8Array.from([0x00, 0x09, 0xff, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), // junk with an impossible type
      sync(), row(3000, 3), row(4000, 4),
    );
    const s = open(bytes);
    const m = await readDeserializedMessages(s, 'ulog', '/x');
    expect(m.map((v) => (v.value as { v: number }).v)).toEqual([1, 2, 3, 4]);
    expect((await ulogWarnings(s)).length).toBeGreaterThan(0);
  });

  it('a corrupt size field that points past the end resyncs instead of ending the log', async () => {
    const f = 'x:uint64_t timestamp;float v;';
    const row = (t: number, v: number) => data(0, concat(pack.u64(t), pack.f32(v)));
    const bad = Uint8Array.from([0xff, 0xff, 0x44, 0, 0]); // a data message claiming 65535 bytes
    const bytes = concat(header(0), flagBitsFull(), format(f), addLogged(0, 0, 'x'), row(1000, 1), sync(), bad, sync(), row(2000, 2));
    const m = await readDeserializedMessages(open(bytes), 'ulog', '/x');
    expect(m.map((v) => (v.value as { v: number }).v)).toEqual([1, 2]);
  });

  it('data appended after the main log (the append flag) reads as a continuation', async () => {
    const f = 'x:uint64_t timestamp;float v;';
    const row = (t: number, v: number) => data(0, concat(pack.u64(t), pack.f32(v)));
    const bytes = concat(header(0), flagBitsFull(1), format(f), addLogged(0, 0, 'x'), row(1000, 1), row(2000, 2), sync(), row(3000, 3));
    const m = await readDeserializedMessages(open(bytes), 'ulog', '/x');
    expect(m).toHaveLength(3);
  });

  it('refuses an incompatible flag it does not know, rather than misreading', async () => {
    const bytes = concat(header(0), flagBitsFull(0x80));
    await expect(parseBag(open(bytes))).rejects.toThrow(/cannot read/);
  });

  it('sync markers inside payloads are not mistaken for structure', async () => {
    const f = 'x:uint64_t timestamp;uint8_t[8] blob;';
    const bytes = concat(header(0), flagBitsFull(), format(f), addLogged(0, 0, 'x'), data(0, concat(pack.u64(1), SYNC_BYTES)), data(0, concat(pack.u64(2), SYNC_BYTES)));
    const m = await readDeserializedMessages(open(bytes), 'ulog', '/x');
    expect(m).toHaveLength(2);
    expect((m[0]!.value as { blob: number[] }).blob).toEqual(Array.from(SYNC_BYTES));
  });
});

describe('scale and reuse', () => {
  it('indexes a 200k message log and answers many varied calls on the same parse', async () => {
    const f = 'big:uint64_t timestamp;float a;float b;';
    const parts: Uint8Array[] = [header(0), flagBitsFull(), format(f), addLogged(0, 0, 'big')];
    for (let i = 0; i < 200_000; i++) parts.push(data(0, concat(pack.u64(i * 1000), pack.f32(i), pack.f32(-i))));
    const s = open(concatAll(parts), 'big.ulg');
    const sum = await parseBag(s);
    expect(sum.topics[0]!.messageCount).toBe(200_000);
    // Many reads of different kinds on the reused parse.
    for (let k = 0; k < 60; k++) {
      const i = (k * 3331) % 200_000;
      const one = await readMessageAtTime(s, 'ulog', '/big', BigInt(i) * 1_000_000n);
      expect((one!.value as { a: number }).a).toBe(i);
    }
    const range = await readMessagesInRange(s, 'ulog', '/big', { startNs: 1_000_000_000n, endNs: 1_000_050_000n * 1000n, stride: 7, phase: 0, max: 5000 });
    expect(range.messages.length).toBeGreaterThan(5000 / 7 - 2);
    expect((range.messages[1]!.value as { a: number }).a - (range.messages[0]!.value as { a: number }).a).toBe(7);
    expect(await ulogWarnings(s)).toEqual([]);
  });
});

describe('range reads', () => {
  it('batches of any size and stride see exactly what one big read sees', async () => {
    const s = open(flight());
    const whole = await readMessagesInRange(s, 'ulog', '/vehicle_attitude', { startNs: 0n, endNs: 99n * 1_000_000_000n, stride: 1, phase: 0, max: 100000 });
    expect(whole.messages).toHaveLength(100);
    for (const [stride, max] of [[1, 1], [1, 7], [3, 4], [10, 100], [2, 1]] as const) {
      const got: bigint[] = [];
      let start: bigint | null = 0n;
      let phase = 0;
      while (start !== null) {
        const r = await readMessagesInRange(s, 'ulog', '/vehicle_attitude', { startNs: start, endNs: 99n * 1_000_000_000n, stride, phase, max });
        got.push(...r.messages.map((m) => m.timestamp));
        start = r.nextStartNs;
        phase = r.phase;
      }
      expect(got, `stride ${stride} max ${max}`).toEqual(whole.messages.filter((_, i) => i % stride === 0).map((m) => m.timestamp));
    }
  });
});
