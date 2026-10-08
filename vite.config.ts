import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import type { Plugin } from 'vite';

// Public files an offline session needs (the bundle list does not include
// public/). Demo videos are deliberately absent: tens of MB nobody needs offline.
const OFFLINE_PUBLIC = [
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons.svg',
  '/sql-wasm.wasm',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/sample-bags/tour.mcap',
  '/sample-bags/sample-robot.urdf',
];

// Lists every built asset so the service worker can precache the whole app for
// installed use (see public/sw.js). Emitted as /sw-assets.json.
function swAssetList(): Plugin {
  return {
    name: 'bagel-sw-assets',
    generateBundle(_options, bundle) {
      const files = [...Object.keys(bundle).filter((f) => !f.endsWith('.map')).map((f) => `/${f}`), ...OFFLINE_PUBLIC];
      this.emitFile({ type: 'asset', fileName: 'sw-assets.json', source: JSON.stringify(files) });
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    swAssetList(),
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
      // Lets a host page that sends COEP: require-corp frame the app (embed mode).
      'Cross-Origin-Resource-Policy': 'cross-origin',
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
          if (id.includes('fzstd')) return 'mcap-decompress';
          if (id.includes('@foxglove/')) return 'foxglove';
          if (id.includes('node_modules/three/') || id.includes('node_modules\\three\\')) return 'three';
        },
      },
    },
  },
});
