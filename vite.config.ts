import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import path from 'path'

const listsDir = path.resolve(import.meta.dirname, 'lists')

/**
 * Ship the `lists/` registry with the site.
 *
 * `data-list="furukawa"` (and `?list=furukawa`) resolve to
 * `<site>/lists/furukawa.json`, so those files have to exist under `dist/`.
 * They are not in `public/` because the registry is documented — in
 * `README.md` and `lists/README.md` — as living at the repository root, where
 * a maintainer edits it and reviews it in a diff.
 *
 * Only `*.json` is copied: `lists/README.md` is documentation for the repo,
 * not something to serve.
 */
function publistCopyLists(): Plugin {
  return {
    name: 'publist-copy-lists',
    closeBundle() {
      const outDir = path.resolve(import.meta.dirname, 'dist', 'lists')
      mkdirSync(outDir, { recursive: true })
      for (const name of readdirSync(listsDir)) {
        if (!name.endsWith('.json')) continue
        copyFileSync(path.join(listsDir, name), path.join(outDir, name))
      }
    },
  }
}

// App build (React wizard + iframe widget page).
// The embed bundle is built separately by vite.embed.config.ts.
export default defineConfig({
  plugins: [react(), tailwindcss(), publistCopyLists()],
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
