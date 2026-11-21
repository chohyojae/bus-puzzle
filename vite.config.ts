import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const rawBase = process.env.BASE_PATH ?? '/bus-puzzle/';
const base = `/${rawBase.split('/').filter(Boolean).join('/')}${rawBase === '/' ? '' : '/'}`;

export default defineConfig({
  base,
  optimizeDeps: { exclude: ['@bokuweb/zstd-wasm'] },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: {
        name: 'Bus Puzzle · 즐거운 출발',
        short_name: 'Bus Puzzle',
        description: '나만의 속도로 즐기는 색상 주차 퍼즐',
        lang: 'ko',
        display: 'standalone',
        background_color: '#c8d3e2',
        theme_color: '#c8d3e2',
        start_url: base,
        scope: base,
        icons: [
          { src: `${base}icons/icon-192.png`, sizes: '192x192', type: 'image/png' },
          { src: `${base}icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webp,jpg,jpeg,ogg,mp3,woff2,wasm}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: `${base}index.html`,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    assetsInlineLimit: 0,
  },
});
