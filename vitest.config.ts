import { defineConfig } from 'vitest/config'
import path from 'node:path'

// Standalone config: src/core is framework-free, so the unit tests need
// neither the React nor the Tailwind plugin from vite.config.ts. The wizard's
// component tests are `.tsx` and run under jsdom, which they opt into with a
// per-file `@vitest-environment jsdom` docblock — the core tests stay on the
// node environment they were written for.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
