import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    restoreMocks: true,
    clearMocks: true,
    coverage: {
      reporter: ['text', 'json', 'html'],
      exclude: ['test/helpers/**', '**/*.test.ts', '**/*.config.ts', 'node_modules/**'],
    },
  },
})
