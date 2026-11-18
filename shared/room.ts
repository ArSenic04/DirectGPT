/** Room naming: one shared Y.Doc per (session, task, condition). */
import type { Condition } from './types';
import { CONDITIONS } from './types';

export interface RoomKey {
  sessionId: string;
  task: string;
  condition: Condition;
}

export function sanitizeId(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, 40);
}

export function roomName(key: RoomKey): string {
  return `${sanitizeId(key.sessionId)}.${sanitizeId(key.task)}.${key.condition}`;
}

export function parseRoomName(name: string): RoomKey | null {
  const parts = name.split('.');
  if (parts.length !== 3) return null;
  const [sessionId, task, condition] = parts;
  if (!sessionId || !task || !(CONDITIONS as readonly string[]).includes(condition)) return null;
  if (sanitizeId(sessionId) !== sessionId || sanitizeId(task) !== task) return null;
  return { sessionId, task, condition: condition as Condition };
}
