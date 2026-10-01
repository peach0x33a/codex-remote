import { defineConfig, devices } from '@playwright/test'
import { MOCK_PORT, MOCK_URL, TEST_PORT, TEST_URL } from './tests/config'

export default defineConfig({
  testDir: './tests/e2e', testMatch: '**/*.e2e.ts', timeout: 30_000, fullyParallel: false, workers: 1,
  reporter: 'list',
  use: { colorScheme: 'light', baseURL: TEST_URL, trace: 'retain-on-failure', screenshot: 'only-on-failure', launchOptions: { executablePath: process.env.CHROMIUM_PATH || undefined } },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 960 } } }, { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } }],
  webServer: [
    { command: 'bun tests/mock-bridge.ts', url: TEST_URL + '/api/health', reuseExistingServer: false },
    { command: 'MOCK_PORT=' + MOCK_PORT + ' bun tests/mock-daemon.ts', url: MOCK_URL + '/health', reuseExistingServer: false },
  ],
})
