/**
 * Regression tests for server robustness: malformed input from any client on
 * the network must be answered (or that one connection dropped), never crash
 * the process that every collaborator depends on.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { WebSocket } from 'ws';
import { createApp } from '../server/app';
import { roomParts } from '../shared/ydoc';

let tmp = '';
let port = 0;
let app: ReturnType<typeof createApp>;
const providers: WebsocketProvider[] = [];

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cdg-robust-'));
  const staticDir = path.join(tmp, 'build');
  fs.mkdirSync(path.join(staticDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><title>app</title>');
  fs.writeFileSync(path.join(staticDir, 'assets', 'app.js'), 'console.log(1)');
  // A sibling directory whose name starts with the static root's name.
  fs.mkdirSync(path.join(tmp, 'build-private'));
  fs.writeFileSync(path.join(tmp, 'build-private', 'secret.txt'), 'TOP-SECRET');
  app = createApp({
    dataDir: null,
    staticDir,
    llm: { baseUrl: 'http://127.0.0.1:9/v1', defaultModel: 'gpt-test', mockLatencyMs: 0, timeoutMs: 2000 },
  });
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  port = (app.server.address() as AddressInfo).port;
});

afterAll(async () => {
  providers.forEach((p) => p.destroy());
  app.wss.clients.forEach((c) => c.terminate());
  await new Promise<void>((resolve) => app.server.close(() => resolve()));
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** GET with the raw request path (no client-side URL normalisation). */
function rawGet(rawPath: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: rawPath, method: 'GET' }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function healthy(): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/health`);
    return r.ok;
  } catch {
    return false;
  }
}

/** Raw websocket handshake on a TCP socket, optionally followed by raw bytes. */
function rawUpgrade(rawPath: string, afterOpen?: Buffer): Promise<string> {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1', () => {
      s.write(
        `GET ${rawPath} HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
          'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n',
      );
    });
    let first = '';
    s.on('data', (d) => {
      if (!first) {
        first = d.toString('latin1').split('\r\n')[0];
        if (afterOpen && first.includes('101')) s.write(afterOpen);
      }
    });
    s.on('close', () => resolve(first));
    s.on('error', () => undefined);
    setTimeout(() => s.destroy(), 1500);
  });
}

describe('server robustness', () => {
  it('answers a malformed URL with 400 instead of crashing (static files and export API)', async () => {
    expect((await rawGet('/%E0%A4%A')).status).toBe(400);
    expect((await rawGet('/api/rooms/%E0%A4%A/export')).status).toBe(400);
    expect(await healthy()).toBe(true);
  });

  it('serves files only from inside the static root (no sibling-directory traversal)', async () => {
    const r = await rawGet('/..%2Fbuild-private/secret.txt');
    expect(r.body).not.toContain('TOP-SECRET');
    expect([403, 404]).toContain(r.status);
    expect((await rawGet('/assets/app.js')).body).toBe('console.log(1)');
    // Unknown paths fall back to the single-page app.
    expect((await rawGet('/collab/anything')).body).toContain('<title>app</title>');
  });

  it('rejects a websocket upgrade with a malformed room URL without crashing', async () => {
    expect(await rawUpgrade('/yjs/%E0%A4%A')).toContain('400');
    expect(await healthy()).toBe(true);
  });

  it('drops a connection that sends an invalid websocket frame; other collaborators keep syncing', async () => {
    const room = 'robust1.sandbox.direct';
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const opts = { WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket, disableBc: true };
    const a = new WebsocketProvider(`ws://127.0.0.1:${port}/yjs`, room, docA, opts);
    const b = new WebsocketProvider(`ws://127.0.0.1:${port}/yjs`, room, docB, opts);
    providers.push(a, b);
    await new Promise<void>((resolve) => {
      const check = () => a.synced && b.synced && resolve();
      a.on('sync', check);
      b.on('sync', check);
      check();
    });
    // Masked text frame with reserved opcode 3: a protocol error on the server side.
    const status = await rawUpgrade(`/yjs/${room}`, Buffer.from([0x83, 0x80, 0, 0, 0, 0]));
    expect(status).toContain('101');
    expect(await healthy()).toBe(true);
    roomParts(docA).text.insert(0, 'still live ');
    const start = Date.now();
    while (!roomParts(docB).text.toString().startsWith('still live ')) {
      if (Date.now() - start > 3000) throw new Error('edit did not sync after the bad frame');
      await new Promise((r) => setTimeout(r, 20));
    }
  });

  it('answers an oversized LLM request with a readable 413, not a reset connection', async () => {
    const big = 'x'.repeat(2 * 1024 * 1024 + 10);
    const res = await fetch(`http://127.0.0.1:${port}/api/llm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: big });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ ok: false, code: 'bad_request' });
    expect(await healthy()).toBe(true);
  });
});

describe('room persistence', () => {
  it('keeps an unreadable room file aside instead of overwriting it, and writes room files atomically', async () => {
    const { RoomRegistry } = await import('../server/rooms');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdg-persist-'));
    try {
      const name = 'broken1.sandbox.direct';
      const file = path.join(dir, `${encodeURIComponent(name)}.ybin`);
      fs.writeFileSync(file, Buffer.from([1, 2, 3, 250, 251]));
      const room = new RoomRegistry(dir).get(name);
      room.persistNow();
      const kept = fs.readdirSync(dir).filter((f) => f.includes('.unreadable-'));
      expect(kept).toHaveLength(1);
      expect(Array.from(fs.readFileSync(path.join(dir, kept[0])))).toEqual([1, 2, 3, 250, 251]);
      // The new file is a valid room and no temporary file is left behind.
      const doc = new Y.Doc();
      Y.applyUpdate(doc, new Uint8Array(fs.readFileSync(file)));
      expect(roomParts(doc).text.length).toBeGreaterThan(0);
      expect(fs.readdirSync(dir).some((f) => f.endsWith('.tmp'))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
