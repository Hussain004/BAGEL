export type ErrorActionKind = 'choose-file' | 'paste-schema' | 'retry';

export interface ActionableError {
  title: string;
  detail: string;
  raw: string;
  action?: {
    kind: ErrorActionKind;
    label: string;
  };
}

const REMOTE_SERVER_PATTERN =
  /cross-origin|cors|content-length|accept-ranges|range request|partial content|failed to fetch/i;
const INCOMPLETE_FILE_PATTERN =
  /truncated|corrupt|invalid (?:mcap|bag)|does not appear to be a valid|range not satisfiable|header does not match/i;
const UNSUPPORTED_FORMAT_PATTERN = /unsupported file format/i;
const SCHEMA_PATTERN =
  /schema (?:is )?(?:missing|not found|unavailable)|no (?:message )?(?:definition|schema)|unknown message type|cannot decode.*schema/i;

export function classifyBagError(
  raw: string,
  source: 'file' | 'url',
): ActionableError {
  if (REMOTE_SERVER_PATTERN.test(raw)) {
    return {
      title: 'Remote server cannot stream this bag',
      detail: raw,
      raw,
      action: { kind: 'choose-file', label: 'Open a local copy' },
    };
  }
  if (INCOMPLETE_FILE_PATTERN.test(raw)) {
    return {
      title: 'Bag file may be incomplete',
      detail: raw,
      raw,
      action: { kind: 'choose-file', label: 'Choose another file' },
    };
  }
  if (UNSUPPORTED_FORMAT_PATTERN.test(raw)) {
    return {
      title: 'Unsupported file format',
      detail: raw,
      raw,
      action: { kind: 'choose-file', label: 'Choose a supported file' },
    };
  }
  return {
    title: source === 'url' ? 'Failed to load bag URL' : 'Failed to parse bag file',
    detail: raw,
    raw,
    action: {
      kind: source === 'url' ? 'retry' : 'choose-file',
      label: source === 'url' ? 'Edit URL and retry' : 'Choose another file',
    },
  };
}

export function classifyPanelError(
  raw: string,
  defaultTitle: string,
  canPasteSchema: boolean,
): ActionableError {
  if (canPasteSchema && SCHEMA_PATTERN.test(raw)) {
    return {
      title: 'Message schema required',
      detail: raw,
      raw,
      action: { kind: 'paste-schema', label: 'Paste message schema' },
    };
  }
  return { title: defaultTitle, detail: raw, raw };
}
