import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

const API = process.env.API_URL || 'http://localhost:8306'
export default defineConfig({
  root: resolve(import.meta.dirname),
  plugins: [react()],
  server: {
    port: 5306,
    strictPort: true,
    proxy: { '/api': { target: API, changeOrigin: false }, '/mock-paypal': API, '/samples': API },
  },
  preview: { port: 5306 },
  build: { outDir: resolve(import.meta.dirname, 'dist'), emptyOutDir: true, chunkSizeWarningLimit: 9000 },
  optimizeDeps: { exclude: ['occt-import-js'] },
  worker: { format: 'iife' },
})
