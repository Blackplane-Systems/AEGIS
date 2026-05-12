import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'tests/**/*.test.ts'],
    globals: true,
    restoreMocks: true,
    clearMocks: true,
    passWithNoTests: true,
  },
});
