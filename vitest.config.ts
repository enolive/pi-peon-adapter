import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    restoreMocks: true,
    clearMocks: true,
    setupFiles: ['./test/setup.ts'],
    coverage: {
      reporter: ['text', 'json-summary', 'json', 'html'],
      reportOnFailure: true,
      exclude: ['test/helpers/**/*.ts'],
    },
  },
})
