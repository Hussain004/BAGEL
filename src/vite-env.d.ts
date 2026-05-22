/// <reference types="vite/client" />

// Type declaration for sql.js WASM URL import
declare module 'sql.js/dist/sql-wasm.wasm?url' {
  const url: string;
  export default url;
}

// Augment sql.js types if @types/sql.js is not available
declare module 'sql.js' {
  export interface Database {
    exec(sql: string, params?: unknown[]): QueryExecResult[];
    run(sql: string, params?: unknown[]): void;
    close(): void;
    export(): Uint8Array;
  }

  export interface QueryExecResult {
    columns: string[];
    values: unknown[][];
  }

  export interface SqlJsStatic {
    Database: new (data?: ArrayLike<number>) => Database;
  }

  export default function initSqlJs(config?: {
    locateFile?: (filename: string) => string;
  }): Promise<SqlJsStatic>;
}
