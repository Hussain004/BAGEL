import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/sql.js/dist/sql-wasm.wasm',
          dest: 'assets',
        },
      ],
    }),
  ],

  optimizeDeps: {
    // CRITICAL: prevent Vite from trying to pre-bundle the WASM module
    exclude: ['sql.js'],
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
          if (id.includes('@foxglove/')) return 'foxglove';
        },
      },
    },
  },
});
