import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    testTimeout: 10000,
    include: ['tests/**/*.test.ts'],
    exclude: ['dashboard/**', 'node_modules/**'],
  },
});
