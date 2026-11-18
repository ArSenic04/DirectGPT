/**
 * Minimal Yjs websocket sync server (Figure 1, step 1: shared document
 * workspace). Implements the standard y-protocols sync + awareness messages
 * used by the y-websocket client, plus:
 *  - seeding each study room with its task text exactly once (so two
 *    clients joining at the same time can never duplicate the document);
 *  - optional on-disk persistence of every room (crash recovery).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { IncomingMessage } from 'node:http';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { WebSocket } from 'ws';
import { parseRoomName } from '../shared/room';
import { findTask } from '../shared/tasks';
import { seedRoom } from '../shared/ydoc';

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const PING_INTERVAL_MS = 30_000;

export class SharedRoom {
  readonly doc = new Y.Doc();
  readonly awareness: awarenessProtocol.Awareness;
  /** socket -> awareness client ids controlled by that socket */
  readonly conns = new Map<WebSocket, Set<number>>();
  private persistTimer: NodeJS.Timeout | null = null;

  constructor(readonly name: string, private readonly persistDir: string | null) {
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.awareness.setLocalState(null);
    this.load();
    this.seed();

    this.doc.on('update', (update: Uint8Array) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      this.broadcast(encoding.toUint8Array(encoder));
      this.schedulePersist();
    });

    this.awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      const changed = added.concat(updated, removed);
      if (origin instanceof WebSocket) {
        const controlled = this.conns.get(origin);
        if (controlled) {
          added.forEach((id) => controlled.add(id));
          removed.forEach((id) => controlled.delete(id));
        }
      }
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed));
      this.broadcast(encoding.toUint8Array(encoder));
    });
  }

  private file(): string | null {
    return this.persistDir ? path.join(this.persistDir, `${encodeURIComponent(this.name)}.ybin`) : null;
  }

  private load(): void {
    const file = this.file();
    if (file && fs.existsSync(file)) {
      try {
        Y.applyUpdate(this.doc, new Uint8Array(fs.readFileSync(file)));
      } catch (err) {
        console.error(`[rooms] could not load ${file}:`, err);
      }
    }
  }

  private seed(): void {
    const key = parseRoomName(this.name);
    if (!key) return;
    const task = findTask(key.task) ?? findTask('sandbox');
    if (!task) return;
    seedRoom(this.doc, { sessionId: key.sessionId, task: key.task, condition: key.condition, initialText: task.text });
  }

  private schedulePersist(): void {
    if (!this.file() || this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persistNow();
    }, 500);
  }

  persistNow(): void {
    const file = this.file();
    if (!file) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Y.encodeStateAsUpdate(this.doc));
    } catch (err) {
      console.error(`[rooms] could not persist ${file}:`, err);
    }
  }

  private broadcast(message: Uint8Array): void {
    for (const conn of this.conns.keys()) send(conn, message);
  }

  handleConnection(conn: WebSocket): void {
    conn.binaryType = 'arraybuffer';
    this.conns.set(conn, new Set());

    conn.on('message', (data: ArrayBuffer | Buffer) => {
      try {
        const message = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        this.handleMessage(conn, message);
      } catch (err) {
        console.error(`[rooms] bad message in ${this.name}:`, err);
      }
    });

    let alive = true;
    const ping = setInterval(() => {
      if (!alive) {
        this.close(conn);
        clearInterval(ping);
        return;
      }
      alive = false;
      try {
        conn.ping();
      } catch {
        this.close(conn);
        clearInterval(ping);
      }
    }, PING_INTERVAL_MS);
    conn.on('pong', () => {
      alive = true;
    });
    conn.on('close', () => {
      this.close(conn);
      clearInterval(ping);
    });

    // Sync step 1 + current awareness states.
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    send(conn, encoding.toUint8Array(encoder));
    const states = this.awareness.getStates();
    if (states.size > 0) {
      const aw = encoding.createEncoder();
      encoding.writeVarUint(aw, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(aw, awarenessProtocol.encodeAwarenessUpdate(this.awareness, Array.from(states.keys())));
      send(conn, encoding.toUint8Array(aw));
    }
  }

  private handleMessage(conn: WebSocket, message: Uint8Array): void {
    const decoder = decoding.createDecoder(message);
    const encoder = encoding.createEncoder();
    const type = decoding.readVarUint(decoder);
    if (type === MESSAGE_SYNC) {
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.readSyncMessage(decoder, encoder, this.doc, conn);
      if (encoding.length(encoder) > 1) send(conn, encoding.toUint8Array(encoder));
    } else if (type === MESSAGE_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), conn);
    }
  }

  private close(conn: WebSocket): void {
    const controlled = this.conns.get(conn);
    if (controlled) {
      this.conns.delete(conn);
      awarenessProtocol.removeAwarenessStates(this.awareness, Array.from(controlled), null);
    }
    try {
      conn.close();
    } catch {
      /* already closed */
    }
  }
}

function send(conn: WebSocket, message: Uint8Array): void {
  if (conn.readyState !== WebSocket.OPEN && conn.readyState !== WebSocket.CONNECTING) {
    return;
  }
  try {
    conn.send(message, (err) => {
      if (err) conn.terminate();
    });
  } catch {
    conn.terminate();
  }
}

export class RoomRegistry {
  private readonly rooms = new Map<string, SharedRoom>();

  constructor(private readonly persistDir: string | null) {}

  get(name: string): SharedRoom {
    let room = this.rooms.get(name);
    if (!room) {
      room = new SharedRoom(name, this.persistDir);
      this.rooms.set(name, room);
    }
    return room;
  }

  /** Room if it exists in memory or on disk; never creates an empty one. */
  find(name: string): SharedRoom | null {
    const existing = this.rooms.get(name);
    if (existing) return existing;
    if (this.persistDir && fs.existsSync(path.join(this.persistDir, `${encodeURIComponent(name)}.ybin`))) return this.get(name);
    return null;
  }

  names(): string[] {
    const names = new Set(this.rooms.keys());
    if (this.persistDir && fs.existsSync(this.persistDir)) {
      for (const f of fs.readdirSync(this.persistDir)) {
        if (f.endsWith('.ybin')) names.add(decodeURIComponent(f.slice(0, -'.ybin'.length)));
      }
    }
    return Array.from(names).sort();
  }

  persistAll(): void {
    for (const room of this.rooms.values()) room.persistNow();
  }
}

/** Room name from a websocket upgrade URL such as /yjs/<room>. */
export function roomFromRequest(req: IncomingMessage): string | null {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith('/yjs/')) return null;
  const name = decodeURIComponent(url.pathname.slice('/yjs/'.length));
  return parseRoomName(name) ? name : null;
}
