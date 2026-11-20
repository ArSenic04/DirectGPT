/**
 * Minimal Yjs websocket sync server (Figure 1, step 1: shared document
 * workspace). Implements the standard y-protocols sync + awareness messages
 * used by the y-websocket client, plus:
 *  - seeding each study room with its task text exactly once (so two
 *    clients joining at the same time can never duplicate the document);
 *  - optional on-disk persistence of every room (crash recovery);
 *  - connection-owned presence: each awareness client id belongs to the
 *    socket that introduced it and is removed the moment that socket closes
 *    or stops answering pings. Echoes of other clients' states (y-websocket
 *    clients re-broadcast every awareness change they receive) can never
 *    claim or resurrect a state, so closed tabs never linger as "online".
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
/** Heartbeat: a socket that misses one ping round is considered dead (crash, sleep, network drop). */
export const PING_INTERVAL_MS = 2_500;

export class SharedRoom {
  readonly doc = new Y.Doc();
  readonly awareness: awarenessProtocol.Awareness;
  /** socket -> awareness client ids owned by that socket */
  readonly conns = new Map<WebSocket, Set<number>>();
  /** awareness client id -> owning socket */
  private readonly owners = new Map<number, WebSocket>();
  /** client id -> a new socket of the same client waiting to take over when the old socket dies */
  private readonly pendingClaims = new Map<number, WebSocket>();
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
        // Keep the unreadable file for inspection instead of overwriting it with a freshly seeded room.
        const kept = `${file}.unreadable-${Date.now()}`;
        try {
          fs.renameSync(file, kept);
        } catch {
          /* keep going: the room still starts */
        }
        console.error(`[rooms] could not load ${file} (kept as ${path.basename(kept)}):`, err);
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
      // Write then rename (atomic on the same file system): a crash mid-write never leaves a truncated room file.
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, Y.encodeStateAsUpdate(this.doc));
      fs.renameSync(tmp, file);
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
    // Without a listener, a protocol error (malformed or oversized frame) is an unhandled 'error' event,
    // which would crash the whole server and disconnect every room. Drop just that connection instead.
    conn.on('error', (err) => {
      console.error(`[rooms] connection error in ${this.name}:`, err.message);
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
      const update = this.filterAwareness(conn, decoding.readVarUint8Array(decoder));
      if (update) awarenessProtocol.applyAwarenessUpdate(this.awareness, update, conn);
    }
  }

  /**
   * Keep only the entries of an awareness update that this socket is allowed
   * to change: client ids it owns, or (for a socket that owns none yet) a new
   * or previously disconnected client id, which it then claims. Entries about
   * clients owned by another live socket are echoes and are dropped.
   */
  private filterAwareness(conn: WebSocket, update: Uint8Array): Uint8Array | null {
    const owned = this.conns.get(conn);
    if (!owned) return null;
    const decoder = decoding.createDecoder(update);
    const entries: Array<{ clientID: number; clock: number; state: string }> = [];
    const count = decoding.readVarUint(decoder);
    for (let i = 0; i < count; i++) {
      const clientID = decoding.readVarUint(decoder);
      const clock = decoding.readVarUint(decoder);
      const state = decoding.readVarString(decoder);
      const owner = this.owners.get(clientID);
      const known = this.awareness.meta.get(clientID)?.clock ?? -1;
      if (owner === conn) {
        entries.push({ clientID, clock, state });
      } else if (owner !== undefined && clock > known && state !== 'null') {
        // Only the client itself can advance its clock: it reconnected on a new socket. Move ownership.
        this.conns.get(owner)?.delete(clientID);
        owned.add(clientID);
        this.owners.set(clientID, conn);
        this.pendingClaims.delete(clientID);
        entries.push({ clientID, clock, state });
      } else if (owner !== undefined && owned.size === 0 && state !== 'null') {
        // Same client on a new socket while the old one is not yet known to be dead: take over when it dies.
        this.pendingClaims.set(clientID, conn);
      } else if (owner === undefined && owned.size === 0 && state !== 'null') {
        owned.add(clientID);
        this.owners.set(clientID, conn);
        // A reconnecting client re-sends its state with the clock it had before the drop. Everyone already
        // saw that clock (with a removal), so they would ignore it: advance the clock past what they know.
        let next = clock;
        const prev = this.awareness.meta.get(clientID);
        if (prev && !this.awareness.states.has(clientID)) {
          if (next <= prev.clock) next = prev.clock + 1;
          this.awareness.meta.delete(clientID);
        }
        entries.push({ clientID, clock: next, state });
      }
    }
    if (entries.length === 0) return null;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, entries.length);
    for (const e of entries) {
      encoding.writeVarUint(encoder, e.clientID);
      encoding.writeVarUint(encoder, e.clock);
      encoding.writeVarString(encoder, e.state);
    }
    return encoding.toUint8Array(encoder);
  }

  /** Awareness client ids currently online in this room (for tests and diagnostics). */
  onlineClients(): number[] {
    return Array.from(this.awareness.getStates().keys());
  }

  private close(conn: WebSocket): void {
    const controlled = this.conns.get(conn);
    if (controlled) {
      this.conns.delete(conn);
      const gone: number[] = [];
      for (const id of controlled) {
        if (this.owners.get(id) !== conn) continue;
        const claimant = this.pendingClaims.get(id);
        this.pendingClaims.delete(id);
        if (claimant && claimant !== conn && this.conns.has(claimant) && claimant.readyState === WebSocket.OPEN) {
          this.owners.set(id, claimant);
          this.conns.get(claimant)!.add(id);
        } else {
          this.owners.delete(id);
          gone.push(id);
        }
      }
      for (const [id, claimant] of this.pendingClaims) if (claimant === conn) this.pendingClaims.delete(id);
      awarenessProtocol.removeAwarenessStates(this.awareness, gone, null);
    }
    try {
      conn.terminate();
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
  let url: URL;
  try {
    url = new URL(req.url ?? '/', 'http://localhost');
  } catch {
    return null;
  }
  if (!url.pathname.startsWith('/yjs/')) return null;
  let name: string;
  try {
    name = decodeURIComponent(url.pathname.slice('/yjs/'.length));
  } catch {
    return null; // malformed percent-encoding
  }
  return parseRoomName(name) ? name : null;
}
