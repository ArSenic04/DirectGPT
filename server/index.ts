/**
 * Entry point: `npm run dev:server` (development, client served by Vite) or
 * `npm run serve` (production, serves ./build).
 *
 * Environment variables:
 *   PORT              port to listen on (default 1234)
 *   HOST              interface to bind (default: all interfaces, IPv4 and IPv6,
 *                     so other computers on the LAN can join)
 *   OPENAI_API_KEY    optional server-side key for the OpenAI-compatible provider
 *   OPENAI_BASE_URL   OpenAI-compatible base URL (default https://api.openai.com/v1)
 *   OPENAI_MODEL      default model (default gpt-4o)
 *   MOCK_LATENCY_MS   simulated latency of the MOCK provider (default 700)
 *   LLM_TIMEOUT_MS    provider timeout (default 60000)
 *   DATA_DIR          where rooms and exports are stored (default ./data; "none" disables)
 *
 * A `.env` file in the project root is loaded if present (see .env.example);
 * variables already set in the shell take precedence.
 */
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');
const envFile = path.join(projectRoot, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const env = (name: string): string | undefined => process.env[name] || undefined;

const port = Number(env('PORT') ?? env('SERVER_PORT') ?? 1234);
const dataDirEnv = env('DATA_DIR') ?? path.join(projectRoot, 'data');

const { server, rooms } = createApp({
  dataDir: dataDirEnv === 'none' ? null : path.resolve(dataDirEnv),
  staticDir: path.join(projectRoot, 'build'),
  llm: {
    envApiKey: env('OPENAI_API_KEY'),
    baseUrl: env('OPENAI_BASE_URL') ?? 'https://api.openai.com/v1',
    defaultModel: env('OPENAI_MODEL') ?? 'gpt-4o',
    mockLatencyMs: Number(env('MOCK_LATENCY_MS') ?? 700),
    timeoutMs: Number(env('LLM_TIMEOUT_MS') ?? 60_000),
  },
});

/** IPv4 addresses of this machine on the local network (for join links from other computers). */
function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((a): a is NonNullable<typeof a> => !!a && a.family === 'IPv4' && !a.internal)
    .map((a) => a.address);
}

const host = env('HOST');
const onListening = () => {
  const key = env('OPENAI_API_KEY') ? 'server key configured' : 'no server key (use MOCK or enter a key in the UI)';
  console.log(`[collab-directgpt] server on http://localhost:${port}  (LLM: ${key})`);
  if (!host || host === '0.0.0.0' || host === '::') {
    for (const ip of lanAddresses()) console.log(`[collab-directgpt] on your network: http://${ip}:${port}/#/collab`);
  }
};
if (host) server.listen(port, host, onListening);
else server.listen(port, onListening);

const shutdown = () => {
  rooms.persistAll();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
