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
