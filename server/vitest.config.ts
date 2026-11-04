import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Every test file gets a fresh, seeded in-memory database and never talks to the real API.
    env: {
      MARKETPLACE_DB: ':memory:',
      ANTHROPIC_API_KEY: '',
      MARKETPLACE_FALLBACKS: '0',
    },
    testTimeout: 20_000,
  },
});
