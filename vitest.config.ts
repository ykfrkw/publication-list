import { defineConfig } from 'vitest/config'
import path from 'node:path'

// Standalone config: src/core is framework-free, so the unit tests need
// neither the React nor the Tailwind plugin from vite.config.ts.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
