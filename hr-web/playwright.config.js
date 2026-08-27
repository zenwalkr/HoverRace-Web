import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: 'visual.spec.js',
  outputDir: './test-results',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } },
    },
    {
      name: 'touch-landscape',
      use: {
        ...devices['iPhone 13'],
        browserName: 'chromium',
        viewport: { width: 844, height: 390 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: [
    {
      command: 'HOVERRACE_STORE_DIR="$(mktemp -d /tmp/hr-web-playwright.XXXXXX)" npm run server',
      port: 8081,
      reuseExistingServer: true,
    },
    { command: 'npm run dev', port: 4173, reuseExistingServer: true },
  ],
});
