/** React bindings for Yjs types and awareness. */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import type { Awareness } from 'y-protocols/awareness';
import type { AIRequestRecord, Participant } from '../../shared/types';
import { roomParts, type RoomParts } from '../../shared/ydoc';

/** Subscribe to any Yjs type (deep) and derive a snapshot. */
export function useYSnapshot<T>(type: Y.AbstractType<unknown>, read: () => T): T {
  const readRef = useRef(read);
  readRef.current = read;
  const cache = useRef<{ version: number; value: T } | null>(null);
  const version = useRef(0);
  const subscribe = useMemo(
    () => (onChange: () => void) => {
      const handler = () => {
        version.current++;
        onChange();
      };
      type.observeDeep(handler);
      return () => type.unobserveDeep(handler);
    },
    [type],
  );
  const getSnapshot = () => {
    if (!cache.current || cache.current.version !== version.current) {
      cache.current = { version: version.current, value: readRef.current() };
    }
    return cache.current.value;
  };
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useRequests(parts: RoomParts): AIRequestRecord[] {
  return useYSnapshot(parts.requests as unknown as Y.AbstractType<unknown>, () =>
    Array.from(parts.requests.values())
      .map((r) => JSON.parse(JSON.stringify(r)) as AIRequestRecord)
      .sort((a, b) => a.createdAt - b.createdAt),
  );
}

export function useTextVersion(text: Y.Text): string {
  return useYSnapshot(text as unknown as Y.AbstractType<unknown>, () => text.toString());
}

export interface PresenceActivity {
  kind: 'idle' | 'selecting' | 'waiting' | 'reviewing' | 'chatting' | 'typing';
  detail?: string;
}

export interface PresenceState {
  clientId: number;
  user: Participant;
  activity?: PresenceActivity;
  isLocal: boolean;
}

export function usePresence(awareness: Awareness): PresenceState[] {
  const [states, setStates] = useState<PresenceState[]>([]);
  useEffect(() => {
    const read = () => {
      const list: PresenceState[] = [];
      awareness.getStates().forEach((state, clientId) => {
        const s = state as { user?: Participant; activity?: PresenceActivity };
        if (s.user) list.push({ clientId, user: s.user, activity: s.activity, isLocal: clientId === awareness.clientID });
      });
      list.sort((a, b) => (a.isLocal === b.isLocal ? a.user.name.localeCompare(b.user.name) : a.isLocal ? -1 : 1));
      setStates(list);
    };
    read();
    awareness.on('change', read);
    return () => awareness.off('change', read);
  }, [awareness]);
  return states;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export interface CollabConnection {
  doc: Y.Doc;
  provider: WebsocketProvider;
  parts: RoomParts;
  status: ConnectionStatus;
  synced: boolean;
}

/**
 * One Y.Doc + websocket provider per room, created in an effect (safe under
 * React StrictMode's mount/unmount/mount) and torn down on unmount.
 */
export function useCollabConnection(room: string, user: Participant): CollabConnection | null {
  const [conn, setConn] = useState<{ doc: Y.Doc; provider: WebsocketProvider; parts: RoomParts } | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    const doc = new Y.Doc();
    const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/yjs`;
    // Connect on the next tick so React StrictMode's mount/unmount/mount in dev
    // does not open (and immediately abort) a throwaway socket.
    // disableBc: presence comes only from the server, which owns each client's state by socket
    // (otherwise same-browser tabs also exchange presence directly and can keep closed tabs alive).
    const provider = new WebsocketProvider(wsUrl, room, doc, { connect: false, disableBc: true });
    const connectTimer = window.setTimeout(() => provider.connect(), 0);
    // Leave the room's presence immediately when the tab closes, reloads, navigates away or goes into
    // the back/forward cache; come back if the page is restored from that cache.
    let savedState: Record<string, unknown> | null = null;
    const onPageHide = () => {
      savedState = provider.awareness.getLocalState();
      provider.awareness.setLocalState(null);
    };
    const onPageShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      if (savedState) provider.awareness.setLocalState(savedState);
      if (!provider.wsconnected) provider.connect();
    };
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    const onStatus = ({ status: s }: { status: ConnectionStatus }) => setStatus(s);
    const onSync = (s: boolean) => setSynced(s);
    provider.on('status', onStatus);
    provider.on('sync', onSync);
    setConn({ doc, provider, parts: roomParts(doc) });
    return () => {
      window.clearTimeout(connectTimer);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      provider.off('status', onStatus);
      provider.off('sync', onSync);
      provider.awareness.setLocalState(null);
      provider.destroy();
      doc.destroy();
      setConn(null);
      setSynced(false);
      setStatus('connecting');
    };
  }, [room]);

  useEffect(() => {
    if (conn) conn.provider.awareness.setLocalStateField('user', user);
  }, [conn, user]);

  return conn ? { ...conn, status, synced } : null;
}
