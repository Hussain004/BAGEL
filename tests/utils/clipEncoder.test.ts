import { describe, expect, it, vi, afterEach } from 'vitest';
import { bestVideoFormat } from '../../src/utils/clipEncoder';

function stubSupport(supported: string[]) {
  vi.stubGlobal('MediaRecorder', {
    isTypeSupported: (mimeType: string) => supported.includes(mimeType),
  });
}

describe('bestVideoFormat', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('prefers MP4 when the browser can record it', () => {
    stubSupport(['video/mp4;codecs=avc1.42E01E', 'video/webm;codecs=vp9']);
    expect(bestVideoFormat()).toEqual({
      mimeType: 'video/mp4;codecs=avc1.42E01E',
      extension: 'mp4',
    });
  });

  it('falls back to WebM when MP4 recording is unsupported', () => {
    stubSupport(['video/webm;codecs=vp9', 'video/webm']);
    expect(bestVideoFormat()).toEqual({
      mimeType: 'video/webm;codecs=vp9',
      extension: 'webm',
    });
  });

  it('falls back to plain WebM when nothing else is supported', () => {
    stubSupport([]);
    expect(bestVideoFormat()).toEqual({ mimeType: 'video/webm', extension: 'webm' });
  });
});
