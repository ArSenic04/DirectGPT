import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { WebSocket } from 'ws';
import { createApp } from '../server/app';
import { findTask } from '../shared/tasks';
import { logEvent, roomParts } from '../shared/ydoc';

let base = '';
let wsBase = '';
let dataDir = '';
let app: ReturnType<typeof createApp>;
const providers: WebsocketProvider[] = [];

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdg-test-'));
  app = createApp({
    dataDir,
    staticDir: null,
    llm: { baseUrl: 'http://127.0.0.1:9/v1', defaultModel: 'gpt-test', mockLatencyMs: 0, timeoutMs: 2000 },
  });
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const port = (app.server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
  wsBase = `ws://127.0.0.1:${port}/yjs`;
});

afterAll(async () => {
  providers.forEach((p) => p.destroy());
  app.wss.clients.forEach((c) => c.terminate());
  await new Promise<void>((resolve) => app.server.close(() => resolve()));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function connect(room: string) {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(wsBase, room, doc, { WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket });
  providers.push(provider);
  const synced = new Promise<void>((resolve) => {
    if (provider.synced) resolve();
    provider.on('sync', (s: boolean) => s && resolve());
  });
  return { doc, provider, synced };
}

async function waitFor(check: () => boolean, ms = 3000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timeout waiting for condition');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('collaboration server', () => {
  it('seeds a study room once and syncs edits and presence between two clients', async () => {
    const room = 'pairX.T1.direct';
    const a = connect(room);
    const b = connect(room);
    await Promise.all([a.synced, b.synced]);
    const t1 = findTask('T1')!.text;
    expect(roomParts(a.doc).text.toString()).toBe(t1);
    expect(roomParts(b.doc).text.toString()).toBe(t1);
    roomParts(a.doc).text.insert(0, 'Hello. ');
    await waitFor(() => roomParts(b.doc).text.toString().startsWith('Hello. '));
    a.provider.awareness.setLocalStateField('user', { name: 'Alice', color: '#f00' });
    await waitFor(() => Array.from(b.provider.awareness.getStates().values()).some((s) => (s as { user?: { name?: string } }).user?.name === 'Alice'));
    // A third client joining later gets the same single copy (no double seeding).
    const c = connect(room);
    await c.synced;
    expect(roomParts(c.doc).text.toString()).toBe('Hello. ' + t1);
  });

  it('rejects websocket connections to invalid rooms', async () => {
    const ws = new WebSocket(`${wsBase}/not-a-room`);
    const result = await new Promise<string>((resolve) => {
      ws.on('error', () => resolve('error'));
      ws.on('open', () => resolve('open'));
    });
    expect(result).toBe('error');
  });

  it('exports JSON and CSV, and stores a copy for the analysis script', async () => {
    const room = 'pairY.T2.baseline';
    const a = connect(room);
    await a.synced;
    logEvent(a.doc, { participantId: 'P09', name: 'Zoe', condition: 'baseline', task: 'T2' }, 'chat_message', { typedChars: 12 });
    await waitFor(() => (app.rooms.find(room)?.doc.getArray('events').length ?? 0) === 1);
    const json = await (await fetch(`${base}/api/rooms/${room}/export`)).json();
    expect(json.meta).toMatchObject({ sessionId: 'pairY', task: 'T2', condition: 'baseline' });
    expect(json.summary.prompts).toBe(1);
    expect(fs.existsSync(path.join(dataDir, 'exports', `${room}.json`))).toBe(true);
    const csv = await (await fetch(`${base}/api/rooms/${room}/export?format=events.csv&download=1`)).text();
    expect(csv.split('\n')[1]).toContain('chat_message');
    expect((await fetch(`${base}/api/rooms/${room}/export?format=xml`)).status).toBe(400);
    expect((await fetch(`${base}/api/rooms/nope.T1.direct/export`)).status).toBe(404);
    const list = await (await fetch(`${base}/api/rooms`)).json();
    expect(list.rooms).toContain(room);
  });

  it('persists rooms to disk', async () => {
    app.rooms.persistAll();
    expect(fs.existsSync(path.join(dataDir, 'rooms', `${encodeURIComponent('pairX.T1.direct')}.ybin`))).toBe(true);
  });

  it('serves the LLM gateway: mock works, missing key and network errors are reported, not thrown', async () => {
    const post = (body: unknown, headers: Record<string, string> = {}) =>
      fetch(`${base}/api/llm`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const request = { kind: 'scoped', commandId: 'grammar', instruction: 'Fix', selection: 'We dont know.', contextBefore: '', contextAfter: '', variant: 0 };
    const ok = await post({ provider: 'mock', request });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ text: "We don't know.", provider: 'mock' });
    const noKey = await post({ provider: 'openai', request });
    expect(noKey.status).toBe(400);
    expect((await noKey.json()).code).toBe('no_key');
    const network = await post({ provider: 'openai', request }, { 'X-OpenAI-Key': 'sk-test' });
    expect(network.status).toBe(502);
    expect((await network.json()).code).toBe('network');
    const bad = await fetch(`${base}/api/llm`, { method: 'POST', body: '{not json' });
    expect(bad.status).toBe(400);
    const config = await (await fetch(`${base}/api/config`)).json();
    expect(config).toMatchObject({ serverKeyConfigured: false, defaultModel: 'gpt-test' });
  });
});
