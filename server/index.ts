/**
 * Entry point: `npm run dev:server` (development, client served by Vite) or
 * `npm run serve` (production, serves ./build).
 *
 * Environment variables:
 *   PORT              port to listen on (default 1234)
 *   OPENAI_API_KEY    optional server-side key for the OpenAI-compatible provider
 *   OPENAI_BASE_URL   OpenAI-compatible base URL (default https://api.openai.com/v1)
 *   OPENAI_MODEL      default model (default gpt-4o)
 *   MOCK_LATENCY_MS   simulated latency of the MOCK provider (default 700)
 *   LLM_TIMEOUT_MS    provider timeout (default 60000)
 *   DATA_DIR          where rooms and exports are stored (default ./data; "none" disables)
 */
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');

const port = Number(process.env.PORT ?? process.env.SERVER_PORT ?? 1234);
const dataDirEnv = process.env.DATA_DIR ?? path.join(projectRoot, 'data');

const { server, rooms } = createApp({
  dataDir: dataDirEnv === 'none' ? null : path.resolve(dataDirEnv),
  staticDir: path.join(projectRoot, 'build'),
  llm: {
    envApiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
    defaultModel: process.env.OPENAI_MODEL ?? 'gpt-4o',
    mockLatencyMs: Number(process.env.MOCK_LATENCY_MS ?? 700),
    timeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 60_000),
  },
});

server.listen(port, () => {
  const key = process.env.OPENAI_API_KEY ? 'server key configured' : 'no server key (use MOCK or enter a key in the UI)';
  console.log(`[collab-directgpt] server on http://localhost:${port}  (LLM: ${key})`);
});

const shutdown = () => {
  rooms.persistAll();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
