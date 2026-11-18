/**
 * Counterbalancing for the within-pairs design: 2 conditions x 2 task
 * documents gives 4 orders (a balanced Latin square). Pair n uses order
 * (n - 1) mod 4, so every condition appears first equally often and is paired
 * with each document equally often.
 */
import type { Condition } from './types';

export interface Block {
  condition: Condition;
  task: 'T1' | 'T2';
}

export const ORDERS: readonly (readonly [Block, Block])[] = [
  [{ condition: 'direct', task: 'T1' }, { condition: 'baseline', task: 'T2' }],
  [{ condition: 'baseline', task: 'T1' }, { condition: 'direct', task: 'T2' }],
  [{ condition: 'direct', task: 'T2' }, { condition: 'baseline', task: 'T1' }],
  [{ condition: 'baseline', task: 'T2' }, { condition: 'direct', task: 'T1' }],
];

export function orderForPair(pairNumber: number): readonly [Block, Block] {
  const n = Number.isFinite(pairNumber) && pairNumber >= 1 ? Math.floor(pairNumber) : 1;
  return ORDERS[(n - 1) % ORDERS.length];
}

/** Pair number from a session id like "pair07" or "07" (null if none). */
export function pairNumberFromSession(session: string): number | null {
  const m = session.match(/(\d+)\s*$/);
  return m ? Number(m[1]) : null;
}
