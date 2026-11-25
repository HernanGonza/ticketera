import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['{apps,packages}/*/{test,src}/**/*.test.{ts,tsx}'],
          exclude: ['**/*.int.test.ts', '**/node_modules/**'],
        },
      },
      {
        test: {
          name: 'integracion',
          include: ['{apps,tests}/**/*.int.test.ts'],
          exclude: ['**/node_modules/**'],
          globalSetup: ['./tests/helpers/pg-global.ts'],
          testTimeout: 30_000,
          hookTimeout: 60_000,
          maxWorkers: 3,
        },
      },
    ],
  },
});
