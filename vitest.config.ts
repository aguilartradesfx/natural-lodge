import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts', 'app/**/*.test.ts'],
  },
  resolve: {
    alias: {
      'server-only': path.resolve(import.meta.dirname, 'tests/stubs/server-only.ts'),
      '@': path.resolve(import.meta.dirname),
    },
  },
});
