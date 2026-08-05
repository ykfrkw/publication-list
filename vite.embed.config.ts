import { defineConfig } from 'vite'
import { copyFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const outDir = path.resolve(import.meta.dirname, 'dist')

/**
 * Second build target: the framework-free embed script.
 *
 * It is injected into other people's pages, so it must be a single
 * self-contained IIFE with no React, no Tailwind, no hashed filenames and
 * no code splitting. Emitted twice:
 *   dist/embed.js     — floating "latest" URL
 *   dist/v1/embed.js  — pinned URL, for cache safety
 *
 * `emptyOutDir: false` keeps the app build (which runs first) intact.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  build: {
    outDir,
    emptyOutDir: false,
    cssCodeSplit: false,
    copyPublicDir: false,
    target: 'es2019',
    lib: {
      entry: path.resolve(import.meta.dirname, 'src/embed/entry.ts'),
      name: 'PublicationListEmbed',
      formats: ['iife'],
      fileName: () => 'embed.js',
    },
    rollupOptions: {
      output: {
        entryFileNames: 'embed.js',
        assetFileNames: 'embed.[ext]',
      },
    },
  },
  plugins: [
    {
      name: 'publist-emit-pinned-copy',
      closeBundle() {
        mkdirSync(path.join(outDir, 'v1'), { recursive: true })
        copyFileSync(
          path.join(outDir, 'embed.js'),
          path.join(outDir, 'v1', 'embed.js'),
        )
      },
    },
  ],
})
