import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { cpSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const pdfPackage = dirname(fileURLToPath(import.meta.resolve('pdfjs-dist/package.json')))
const pdfVersion = JSON.parse(readFileSync(resolve(pdfPackage, 'package.json'), 'utf8')).version as string

export default defineConfig({
  plugins: [{ name: 'pdf-preview-assets', buildStart() {
    for (const directory of ['cmaps', 'standard_fonts', 'wasm']) {
      const target = resolve('public/vendor/pdfjs', directory)
      mkdirSync(target, { recursive: true }); cpSync(resolve(pdfPackage, directory), target, { recursive: true })
    }
  } }, vue(), VitePWA({
    registerType: 'prompt',
    includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
    manifest: {
      id: '/', name: 'Codex Remote', short_name: 'Codex Remote', lang: 'zh-CN',
      description: 'Codex App Server 网页客户端，支持多设备连接。',
      start_url: '/', scope: '/', display: 'standalone',
      theme_color: '#ffffff', background_color: '#ffffff',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    workbox: {
      importScripts: ['notification-events.js'],
      globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2,bcmap,ttf,pfb,wasm}'],
      globIgnores: ['vendor/pdfjs/**'],
      runtimeCaching: [{ urlPattern: ({ url }) => url.origin === self.location.origin && url.pathname.startsWith('/vendor/pdfjs/'), handler: 'CacheFirst', options: { cacheName: 'pdf-preview-assets-' + pdfVersion, expiration: { maxEntries: 256, maxAgeSeconds: 30 * 24 * 60 * 60 } } }],
      navigateFallback: '/index.html', navigateFallbackDenylist: [/^\/api\//],
      cleanupOutdatedCaches: true,
      clientsClaim: true,
    },
  })],
  server: { port: Number(process.env.WEB_PORT || 5173), strictPort: true, proxy: {
    '/api': { target: 'http://127.0.0.1:' + (process.env.BRIDGE_PORT || 3001), ws: true, changeOrigin: false },
  } },
})
