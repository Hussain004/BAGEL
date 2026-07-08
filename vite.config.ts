import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],

  optimizeDeps: {
    // Include sql.js in pre-bundling so Vite wraps CJS → ESM properly
    include: ['sql.js'],
  },

  server: {
    headers: {
      // Required for SharedArrayBuffer used by sql.js WASM
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },

  build: {
    target: 'es2022', // Required for BigInt literals and top-level await
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('sql.js')) return 'sql-js';
          if (id.includes('@mcap/') || id.includes('@mcap\\\\')) return 'mcap';
          if (id.includes('zstd-wasm')) return 'mcap-decompress';
          if (id.includes('@foxglove/')) return 'foxglove';
          if (id.includes('node_modules/three/') || id.includes('node_modules\\three\\')) return 'three';
        },
      },
    },
  },
});
