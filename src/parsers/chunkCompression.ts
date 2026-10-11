import * as lz4 from 'lz4js';

/**
 * Chunk compression for every bag BAGEL writes from an edit: an lz4 frame,
 * which is what MCAP's `lz4` compression means, and which every MCAP reader
 * supports. (There is no zstd encoder in the bundle.) A chunk that would not
 * shrink, such as already-compressed images or noise, is stored as it is.
 */
export function compressChunkLz4(chunkData: Uint8Array): { compression: string; compressedData: Uint8Array } {
  const packed = lz4.compress(chunkData);
  return packed.length < chunkData.length
    ? { compression: 'lz4', compressedData: packed }
    : { compression: '', compressedData: chunkData };
}
