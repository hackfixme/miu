import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    test: {
      name: 'node',
      environment: 'jsdom',
      include: ['tests/**/*.test.{js,ts}'],
      exclude: ['tests/e2e/**/*.test.{js,ts}', 'tests/**/*.e2e.test.{js,ts}']
    }
  },
  {
    test: {
      name: 'browser',
      include: ['tests/e2e/**/*.test.{js,ts}', 'tests/**/*.e2e.test.{js,ts}'],
      browser: {
        enabled: true,
        headless: !process.env.GUI,
        screenshotFailures: false,
        provider: 'playwright',
        instances: [
          { browser: 'chromium' }
        ]
      }
    }
  }
]);
