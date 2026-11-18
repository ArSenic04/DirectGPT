import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices['Desktop Chrome'],
    viewport: { width: 1600, height: 900 },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { viewport: { width: 1600, height: 900 } } }],
  webServer: {
    // Production build served by the real server, with the MOCK LLM and an
    // unreachable OpenAI base URL (to test network-error handling offline).
    command: `npm run build && rm -rf test-results/e2e-data && PORT=${PORT} MOCK_LATENCY_MS=400 DATA_DIR=test-results/e2e-data OPENAI_BASE_URL=http://127.0.0.1:9/v1 npx tsx server/index.ts`,
    url: `http://localhost:${PORT}/api/health`,
    timeout: 180_000,
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
