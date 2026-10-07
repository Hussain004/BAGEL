import { describe, expect, it } from 'vitest';
import {
  classifyBagError,
  classifyPanelError,
  DATASET_HOSTING_DOC_URL,
} from '../../src/utils/actionableError';

describe('classifyBagError', () => {
  it('turns CORS and range failures into a pointer at the hosting doc', () => {
    // Changed from "open a local copy": the real fix for a remote-host CORS or
    // Range failure is a server config, which the user cannot do from here.
    const error = classifyBagError(
      'The server may not allow cross-origin requests or expose Content-Length.',
      'url',
    );
    expect(error.title).toBe('Remote server cannot stream this bag');
    expect(error.action?.kind).toBe('hosting-doc');
    expect(DATASET_HOSTING_DOC_URL).toContain('DATASET_HOSTING.md');
  });

  it('classifies every remote-server failure signature to the hosting doc', () => {
    for (const message of [
      'A cross-origin request was blocked.',
      'CORS policy rejected the request.',
      'Response is missing Content-Length.',
      'Server advertises Accept-Ranges: none.',
      'Range request failed.',
      'Expected 206 Partial Content.',
      'TypeError: Failed to fetch',
    ]) {
      expect(classifyBagError(message, 'url').action?.kind, message).toBe('hosting-doc');
    }
  });

  it('identifies incomplete or corrupt bags', () => {
    const error = classifyBagError('The bag may be truncated or corrupt.', 'file');
    expect(error.title).toBe('Bag file may be incomplete');
    expect(error.raw).toBe('The bag may be truncated or corrupt.');
  });

  it('preserves unknown URL errors and offers retry', () => {
    const error = classifyBagError('Unexpected worker failure', 'url');
    expect(error.detail).toBe('Unexpected worker failure');
    expect(error.action).toEqual({ kind: 'retry', label: 'Edit URL and retry' });
  });
});

describe('classifyPanelError', () => {
  it('offers schema paste only when schema context is available', () => {
    expect(classifyPanelError('No message schema found.', 'Failed', true).action)
      .toEqual({ kind: 'paste-schema', label: 'Paste message schema' });
    expect(classifyPanelError('No message schema found.', 'Failed', false).action)
      .toBeUndefined();
  });
});
