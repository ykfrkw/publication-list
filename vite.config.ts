import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// App build (React wizard + iframe widget page).
// The embed bundle is built separately by vite.embed.config.ts.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/publication-list/',
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: path.resolve(import.meta.dirname, 'index.html'),
        widget: path.resolve(import.meta.dirname, 'widget.html'),
      },
    },
  },
})
