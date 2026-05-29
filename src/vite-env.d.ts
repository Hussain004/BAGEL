/// <reference types="vite/client" />

// Type declaration for sql.js WASM URL import
declare module 'sql.js/dist/sql-wasm.wasm?url' {
  const url: string;
  export default url;
}

// Module declaration for sql.js (CJS module lacks ESM types)
declare module 'sql.js' {
  const initSqlJs: any;
  export default initSqlJs;
}

// Pure-JS bzip2 decoder used to inflate `rosbag record --bz2` chunks.
// `Bunzip.decode(input)` returns the full uncompressed byte stream.
declare module 'seek-bzip' {
  const Bunzip: {
    decode(
      input: Uint8Array,
      expectedSize?: number,
      multistream?: boolean,
    ): Uint8Array;
  };
  export default Bunzip;
}

// Pure-JS lz4 (frame format) decoder used to inflate `rosbag record --lz4`
// chunks. ROS1 bags use the standard LZ4 frame format that `lz4js` reads.
declare module 'lz4js' {
  export function decompress(buffer: Uint8Array, maxSize?: number): Uint8Array;
  export function compress(buffer: Uint8Array, maxSize?: number): Uint8Array;
}
