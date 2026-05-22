/**
 * Binary and file size utilities
 */

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** Format a file size in bytes to a human-readable string */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const exp = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    SIZE_UNITS.length - 1
  );
  const value = bytes / Math.pow(1024, exp);
  return `${value.toFixed(exp > 0 ? 1 : 0)} ${SIZE_UNITS[exp]}`;
}

/** Convert a Uint8Array to a hex dump string (for raw message preview) */
export function toHexDump(data: Uint8Array, maxBytes: number = 256): string {
  const bytes = data.slice(0, maxBytes);
  const lines: string[] = [];
  
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const chunk = bytes.slice(offset, offset + 16);
    const hex = Array.from(chunk)
      .map(b => b.toString(16).padStart(2, '0'))
      .join(' ');
    const ascii = Array.from(chunk)
      .map(b => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.'))
      .join('');
    lines.push(
      `${offset.toString(16).padStart(8, '0')}  ${hex.padEnd(48)}  ${ascii}`
    );
  }

  if (data.length > maxBytes) {
    lines.push(`... (${data.length - maxBytes} more bytes)`);
  }

  return lines.join('\n');
}

/** Check magic bytes at the start of a file */
export function checkMagicBytes(
  data: Uint8Array,
  expected: number[]
): boolean {
  if (data.length < expected.length) return false;
  return expected.every((byte, i) => data[i] === byte);
}
