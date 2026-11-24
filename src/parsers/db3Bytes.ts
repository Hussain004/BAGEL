import { decompress as fzstdDecompress } from 'fzstd';

/**
 * A message blob as CDR bytes. rosbag2 recorded with `compression_mode:
 * message` stores each blob as its own zstd frame, and that setting lives only
 * in `metadata.yaml`, which a dropped `.db3` arrives without. So detect it per
 * blob: a CDR blob opens with its encapsulation header (`00 01 00 00` and
 * kin), never the zstd magic `28 B5 2F FD`. (`compression_mode: file`, a
 * whole `.db3.zstd`, is not a SQLite file and is not handled here.)
 * A frame that will not decompress comes back as it is, so that one row fails
 * to decode like any other bad message instead of failing its whole topic.
 */
export function db3MessageBytes(data: Uint8Array): Uint8Array {
  if (!(data[0] === 0x28 && data[1] === 0xb5 && data[2] === 0x2f && data[3] === 0xfd)) return data;
  try {
    return fzstdDecompress(data);
  } catch {
    return data;
  }
}
