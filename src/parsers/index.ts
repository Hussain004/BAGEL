/**
 * Unified Bag File Parser
 * 
 * Detects the format of a bag file and delegates to the appropriate parser.
 * Supports .mcap (MCAP container) and .db3 (ROS2 SQLite) formats.
 */

import type { BagFormat, BagSummary } from '../types/bag';
import { parseMcap } from './mcap';
import { parseDb3 } from './db3';
import { checkMagicBytes } from '../utils/bytes';

// MCAP magic bytes: 0x89, 'M', 'C', 'A', 'P', '0', '\r', '\n'
const MCAP_MAGIC = [0x89, 0x4d, 0x43, 0x41, 0x50, 0x30, 0x0d, 0x0a];

// SQLite magic bytes: 'SQLite format 3\0'
const SQLITE_MAGIC = [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65];

/**
 * Detect the format of a bag file from its extension and magic bytes.
 */
export async function detectFormat(file: File): Promise<BagFormat | 'unknown'> {
  // First check by extension
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'mcap') return 'mcap';
  if (ext === 'db3') return 'db3';
  
  // Fall back to magic bytes
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (checkMagicBytes(header, MCAP_MAGIC)) return 'mcap';
  if (checkMagicBytes(header, SQLITE_MAGIC)) return 'db3';
  
  return 'unknown';
}

/**
 * Parse a bag file and return a unified BagSummary.
 * Auto-detects the format and delegates to the appropriate parser.
 * 
 * @param file - The bag file to parse (File object from drag & drop or file input)
 * @throws Error if the format is unsupported or parsing fails
 */
export async function parseBag(file: File): Promise<BagSummary> {
  const format = await detectFormat(file);
  
  switch (format) {
    case 'mcap':
      return parseMcap(file);
    case 'db3':
      return parseDb3(file);
    default:
      throw new Error(
        `Unsupported file format: "${file.name}". ` +
        'BAGEL supports .db3 (ROS2 SQLite) and .mcap (MCAP) bag files.'
      );
  }
}

export { parseMcap } from './mcap';
export { parseDb3 } from './db3';
