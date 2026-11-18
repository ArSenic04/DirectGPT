import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { WebSocket } from 'ws';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import { createApp } from '../server/app';
import { PING_INTERVAL_MS } from '../server/rooms';
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
  const provider = new WebsocketProvider(wsBase, room, doc, { WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket, disableBc: true });
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

/** A raw socket that speaks just the awareness part of the protocol. */
async function rawSocket(room: string, opts: { autoPong?: boolean } = {}): Promise<WebSocket> {
  const ws = new WebSocket(`${wsBase}/${room}`, { autoPong: opts.autoPong ?? true });
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  return ws;
}

function awarenessMessage(aw: awarenessProtocol.Awareness): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, 1);
  encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(aw, [aw.clientID]));
  return encoding.toUint8Array(enc);
}

const namesOnline = (p: WebsocketProvider) =>
  Array.from(p.awareness.getStates().values())
    .map((s) => (s as { user?: { name?: string } }).user?.name)
    .filter(Boolean);

describe('presence (awareness) on the server', () => {
  it('removes a user the moment their socket closes', async () => {
    const room = 'presence1.sandbox.direct';
    const watcher = connect(room);
    await watcher.synced;
    const leaver = connect(room);
    await leaver.synced;
    leaver.provider.awareness.setLocalStateField('user', { name: 'Leaver' });
    await waitFor(() => namesOnline(watcher.provider).includes('Leaver'));
    const start = Date.now();
    leaver.provider.shouldConnect = false; // no auto-reconnect: this simulates a closed tab
    (leaver.provider.ws as unknown as WebSocket).terminate();
    await waitFor(() => !namesOnline(watcher.provider).includes('Leaver'), 1000);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it('a client that reconnects before its old socket is noticed as dead leaves no ghost when it closes', async () => {
    const room = 'presence2.sandbox.direct';
    const watcher = connect(room);
    await watcher.synced;
    const aw = new awarenessProtocol.Awareness(new Y.Doc());
    aw.setLocalState({ user: { name: 'Ghost' } });
    const oldSocket = await rawSocket(room); // e.g. a laptop that went to sleep: never closed
    oldSocket.send(awarenessMessage(aw));
    await waitFor(() => namesOnline(watcher.provider).includes('Ghost'));
    const newSocket = await rawSocket(room); // the same client (same clientID) reconnects
    aw.setLocalState({ user: { name: 'Ghost' }, again: true });
    newSocket.send(awarenessMessage(aw));
    await new Promise((r) => setTimeout(r, 100));
    newSocket.close(); // and then closes its tab
    await waitFor(() => !namesOnline(watcher.provider).includes('Ghost'), 1000);
    oldSocket.terminate();
    aw.destroy();
  });

  it('a client that reconnects after a network drop shows up at once, and disappears at once when it then closes', async () => {
    const room = 'presence3.sandbox.direct';
    const watcher = connect(room);
    await watcher.synced;
    const aw = new awarenessProtocol.Awareness(new Y.Doc());
    aw.setLocalState({ user: { name: 'Roamer' } });
    const first = await rawSocket(room);
    first.send(awarenessMessage(aw));
    await waitFor(() => namesOnline(watcher.provider).includes('Roamer'));
    first.terminate(); // Wi-Fi blip
    await waitFor(() => !namesOnline(watcher.provider).includes('Roamer'), 1000);
    const second = await rawSocket(room); // y-websocket reconnects and re-sends the same state (same clock)
    second.send(awarenessMessage(aw));
    await waitFor(() => namesOnline(watcher.provider).includes('Roamer'), 1000);
    second.close(); // tab closed
    await waitFor(() => !namesOnline(watcher.provider).includes('Roamer'), 1000);
    aw.destroy();
  });

  it('drops a client that stops answering pings (crash, sleep, network loss) within a few seconds', async () => {
    const room = 'presence5.sandbox.direct';
    const watcher = connect(room);
    await watcher.synced;
    const aw = new awarenessProtocol.Awareness(new Y.Doc());
    aw.setLocalState({ user: { name: 'Frozen' } });
    const socket = await rawSocket(room, { autoPong: false }); // its TCP connection is silently dead
    socket.send(awarenessMessage(aw));
    await waitFor(() => namesOnline(watcher.provider).includes('Frozen'));
    const start = Date.now();
    await waitFor(() => !namesOnline(watcher.provider).includes('Frozen'), 3 * PING_INTERVAL_MS);
    expect(Date.now() - start).toBeLessThanOrEqual(2 * PING_INTERVAL_MS + 500);
    socket.terminate();
    aw.destroy();
  }, 15_000);

  it('ignores echoes: another client re-sending a departed user\'s state cannot bring it back', async () => {
    const room = 'presence4.sandbox.direct';
    const watcher = connect(room);
    await watcher.synced;
    watcher.provider.awareness.setLocalStateField('user', { name: 'Watcher' });
    const leaver = new awarenessProtocol.Awareness(new Y.Doc());
    leaver.setLocalState({ user: { name: 'Leaver' } });
    const echoer = new awarenessProtocol.Awareness(new Y.Doc());
    echoer.setLocalState({ user: { name: 'Echoer' } });
    const leaverSocket = await rawSocket(room);
    leaverSocket.send(awarenessMessage(leaver));
    const echoSocket = await rawSocket(room);
    echoSocket.send(awarenessMessage(echoer));
    await waitFor(() => namesOnline(watcher.provider).includes('Leaver') && namesOnline(watcher.provider).includes('Echoer'));
    leaverSocket.close();
    await waitFor(() => !namesOnline(watcher.provider).includes('Leaver'), 1000);
    // The echoer re-broadcasts the Leaver's last state, as y-websocket clients do with every update they receive.
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, 1);
    encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(leaver, [leaver.clientID]));
    echoSocket.send(encoding.toUint8Array(enc));
    await new Promise((r) => setTimeout(r, 300));
    expect(namesOnline(watcher.provider)).not.toContain('Leaver');
    expect(app.rooms.get(room).onlineClients()).not.toContain(leaver.clientID);
    echoSocket.close();
    leaver.destroy();
    echoer.destroy();
  });
});

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
    expect(await ok.json()).toMatchObject({ ok: true, text: "We don't know.", provider: 'mock' });
    // Provider failures are expected outcomes: reported in-band with HTTP 200.
    const noKey = await post({ provider: 'openai', request });
    expect(noKey.status).toBe(200);
    expect(await noKey.json()).toMatchObject({ ok: false, code: 'no_key', status: 400 });
    const network = await post({ provider: 'openai', request }, { 'X-OpenAI-Key': 'sk-test' });
    expect(await network.json()).toMatchObject({ ok: false, code: 'network', status: 502 });
    // Malformed requests are HTTP errors.
    const bad = await fetch(`${base}/api/llm`, { method: 'POST', body: '{not json' });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ ok: false, code: 'bad_request' });
    const config = await (await fetch(`${base}/api/config`)).json();
    expect(config).toMatchObject({ serverKeyConfigured: false, defaultModel: 'gpt-test' });
  });
});
