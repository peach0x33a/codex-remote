import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [vue(), VitePWA({
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
      globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      navigateFallback: '/index.html', navigateFallbackDenylist: [/^\/api\//],
      cleanupOutdatedCaches: true,
      clientsClaim: true,
    },
  })],
  server: { port: Number(process.env.WEB_PORT || 5173), strictPort: true, proxy: {
    '/api': { target: 'http://127.0.0.1:' + (process.env.BRIDGE_PORT || 3001), ws: true, changeOrigin: false },
  } },
})
