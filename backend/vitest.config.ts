import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Set before the app's own .env is loaded (dotenv never overrides), so tests
    // never use real keys or the real JWT secret. Nothing here reaches a network.
    env: {
      DATABASE_URL: 'postgresql://test:test@localhost:1/test',
      JWT_SECRET: 'test-secret',
      MISTRAL_API_KEY: 'test-key',
      VISION_API_KEY: '',
      INVOICE_EXTRACTOR: 'direct',
      FILE_STORAGE_PROVIDER: 'local'
    }
  }
});
