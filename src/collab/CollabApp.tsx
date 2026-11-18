/** Route component for #/collab: setup screen or the workspace of a room. */
import { Component, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { findTask } from '../../shared/tasks';
import { roomName } from '../../shared/room';
import type { Participant } from '../../shared/types';
import { lighten, parseSessionParams, type SessionParams } from './params';
import { colorForId, colorForIndex } from '../../shared/colors';
import { registerParticipant, rosterIndex } from '../../shared/ydoc';
import { SetupScreen } from './SetupScreen';
import { Workspace } from './Workspace';
import { useCollabConnection } from './hooks';
import { fetchServerConfig } from './llmClient';
import { useSettings } from './settings';
import './collab.css';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error('Collaborative DirectGPT crashed:', error);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="cdg-setup-page">
          <div className="cdg-setup" role="alert">
            <h1>Something went wrong</h1>
            <p>{this.state.error.message}</p>
            <button className="cdg-btn cdg-btn-primary" onClick={() => window.location.reload()}>Reload</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function Room({ params }: { params: SessionParams }) {
  const task = findTask(params.task)!;
  const room = roomName({ sessionId: params.session, task: params.task, condition: params.condition });
  // Colour = join order in the room roster, so every collaborator (any number) gets a distinct colour.
  const [joinIndex, setJoinIndex] = useState(-1);
  const color = joinIndex >= 0 ? colorForIndex(joinIndex) : colorForId(params.pid);
  const me: Participant = useMemo(
    () => ({ participantId: params.pid, name: params.name, color, colorLight: lighten(color), role: params.role }),
    [params.pid, params.name, params.role, color],
  );
  const conn = useCollabConnection(room, me);
  const [everSynced, setEverSynced] = useState(false);
  useEffect(() => {
    if (conn?.synced) setEverSynced(true);
  }, [conn?.synced]);
  useEffect(() => {
    if (!conn || !everSynced) return;
    registerParticipant(conn.doc, { participantId: params.pid, name: params.name, role: params.role });
    const update = () => setJoinIndex(rosterIndex(conn.doc, params.pid));
    update();
    conn.parts.participants.observe(update);
    return () => conn.parts.participants.unobserve(update);
  }, [conn, everSynced, params.pid, params.name, params.role]);
  useEffect(() => {
    setEverSynced(false);
  }, [room]);

  if (!conn || !everSynced || joinIndex < 0) {
    return (
      <div className="cdg-setup-page">
        <div className="cdg-setup" data-testid="connecting">
          <h2>Connecting to the shared document…</h2>
          <p className="cdg-muted">Room {room}. {conn?.status === 'disconnected' ? 'The sync server is not reachable yet; retrying.' : ''}</p>
        </div>
      </div>
    );
  }
  return <Workspace key={room} conn={conn} params={params} me={me} task={task} room={room} />;
}

export default function CollabApp() {
  const [search] = useSearchParams();
  const params = useMemo(() => parseSessionParams(search), [search]);
  const setServerConfig = useSettings((s) => s.setServerConfig);
  const setProvider = useSettings((s) => s.setProvider);
  const setModel = useSettings((s) => s.setModel);

  useEffect(() => {
    void fetchServerConfig().then(setServerConfig);
  }, [setServerConfig]);

  useEffect(() => {
    if (params) {
      setProvider(params.provider);
      setModel(params.model);
    }
  }, [params, setProvider, setModel]);

  return <ErrorBoundary>{params ? <Room params={params} /> : <SetupScreen initial={search} />}</ErrorBoundary>;
}
