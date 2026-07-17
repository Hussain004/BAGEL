import { describe, expect, it } from 'vitest';
import { classifyBagError, classifyPanelError } from '../../src/utils/actionableError';

describe('classifyBagError', () => {
  it('turns CORS and range failures into a local-file action', () => {
    const error = classifyBagError(
      'The server may not allow cross-origin requests or expose Content-Length.',
      'url',
    );
    expect(error.title).toBe('Remote server cannot stream this bag');
    expect(error.action).toEqual({ kind: 'choose-file', label: 'Open a local copy' });
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
