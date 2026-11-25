import { describe, it, expect } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { buildReportZip, healthMarkdown, reportReadme, reportWindow } from '../../src/utils/issueReport';
import { FULL_VIEW } from '../../src/utils/timelineView';
import type { TopicHealth } from '../../src/utils/topicStats';

const S = 1_000_000_000n;
const T0 = 1_700_000_000n * S; // a real epoch, so a lossy float would show

describe('reportWindow', () => {
  const end = T0 + 60n * S;
  it('takes 5 s either side of the playhead when the timeline is not zoomed', () => {
    expect(reportWindow(T0, end, FULL_VIEW, T0 + 30n * S)).toEqual({ startNs: T0 + 25n * S, endNs: T0 + 35n * S });
  });
  it('shifts rather than clips at either end of the bag', () => {
    expect(reportWindow(T0, end, FULL_VIEW, T0 + 1n * S)).toEqual({ startNs: T0, endNs: T0 + 10n * S });
    expect(reportWindow(T0, end, FULL_VIEW, end - 2n * S)).toEqual({ startNs: end - 10n * S, endNs: end });
  });
  it('takes the whole bag when it is shorter than the window, and clamps a playhead outside it', () => {
    const short = T0 + 4n * S;
    expect(reportWindow(T0, short, FULL_VIEW, T0 + 2n * S)).toEqual({ startNs: T0, endNs: short });
    expect(reportWindow(T0, end, FULL_VIEW, 0n)).toEqual({ startNs: T0, endNs: T0 + 10n * S });
  });
  it('uses the zoomed window when there is one', () => {
    expect(reportWindow(T0, end, { lo: 0.25, hi: 0.5 }, T0)).toEqual({ startNs: T0 + 15n * S, endNs: T0 + 30n * S });
  });
  it('handles an empty bag', () => {
    expect(reportWindow(T0, T0, FULL_VIEW, T0)).toEqual({ startNs: T0, endNs: T0 });
  });
});

const health = (topic: string, gaps: Array<{ atNs: number; gapSec: number }>): TopicHealth => ({
  topic, count: 100, durationSec: 10, meanHz: 10, medianPeriodSec: 0.1, jitterSec: 0.002, gapCount: gaps.length, gaps,
  bandwidthBytesPerSec: 2048, rateOverTime: { t: new Float64Array(), hz: new Float64Array() },
});

describe('healthMarkdown', () => {
  it('lists gappy topics first, with their longest gaps, and escapes pipes', () => {
    const md = healthMarkdown([health('/a', []), health('/b|odd', [{ atNs: 4.2e9, gapSec: 3 }, { atNs: 8e9, gapSec: 0.5 }])]);
    const rows = md.split('\n').filter((l) => l.startsWith('| `'));
    expect(rows[0]).toContain('/b\\|odd');
    expect(rows[0]).toContain('| 2 |');
    expect(rows[1]).toContain('| - |');
    expect(md).toContain('- `/b|odd`: 3.00 s at 4.20 s');
  });
});

describe('the zip', () => {
  const info = {
    appVersion: '9.9.9', bagName: 'run.mcap', format: 'mcap', bagStartNs: T0, playheadNs: T0 + 30n * S,
    clip: { startNs: T0 + 25n * S, endNs: T0 + 35n * S, messageCount: 42 }, link: 'https://example.test/#x', linkCarriesBag: false, createdAt: new Date(0),
  };

  it('holds the clip byte for byte, the link, the health and a README', () => {
    const clip = new Uint8Array(5000).map((_, i) => (i * 7) & 0xff);
    const md = healthMarkdown([health('/a', [])]);
    const files = unzipSync(buildReportZip({ clip, link: info.link, health: md, readme: reportReadme(info, md) }));
    expect(Object.keys(files).sort()).toEqual(['README.md', 'clip.mcap', 'health.md', 'link.txt']);
    expect(Buffer.from(files['clip.mcap']!).equals(Buffer.from(clip))).toBe(true);
    expect(strFromU8(files['link.txt']!).trim()).toBe(info.link);
    const readme = strFromU8(files['README.md']!);
    expect(readme).toContain('42 messages from 25.000 s to 35.000 s');
    expect(readme).toContain('Playhead: 30.000 s');
    expect(readme).toContain('Open `clip.mcap` in BAGEL, then open the link');
  });

  it('says so when there is no clip, and when the link carries the bag', () => {
    const readme = reportReadme({ ...info, clip: null, linkCarriesBag: true }, '');
    expect(readme).toContain('No clip');
    expect(readme).toContain('Open the link in `link.txt` to see the same bag');
    const files = unzipSync(buildReportZip({ link: 'l', health: 'h', readme, errors: 'Clip: boom' }));
    expect(Object.keys(files).sort()).toEqual(['README.md', 'errors.txt', 'health.md', 'link.txt']);
  });
});
