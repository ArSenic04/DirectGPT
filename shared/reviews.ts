/**
 * Group review of AI suggestions: how votes are counted and when "majority
 * approval" is met. Pure functions so the rules can be unit-tested.
 *
 * - Only teammates vote: the requester's own votes do not count.
 * - Each teammate has one current vote (their latest entry); "none" takes it back.
 * - Majority = more than half of the teammates who are online (people other
 *   than the requester). If nobody else is online the requirement is waived,
 *   so a person working alone is never blocked.
 */
import type { ReviewEntry } from './types';

export const MAX_COMMENT_CHARS = 280;

export interface Tally {
  up: ReviewEntry[];
  down: ReviewEntry[];
}

/** Each teammate's latest vote on a request (retracted votes removed). */
export function tally(entries: readonly ReviewEntry[], requestId: string, requesterId: string): Tally {
  const latest = new Map<string, ReviewEntry>();
  for (const e of entries) {
    if (e.kind !== 'vote' || e.requestId !== requestId || e.participantId === requesterId) continue;
    const prev = latest.get(e.participantId);
    if (!prev || e.at >= prev.at) latest.set(e.participantId, e);
  }
  const votes = [...latest.values()].sort((a, b) => a.at - b.at);
  return { up: votes.filter((v) => v.value === 'up'), down: votes.filter((v) => v.value === 'down') };
}

/** The current vote of one participant on a request, or null. */
export function myVote(entries: readonly ReviewEntry[], requestId: string, participantId: string): 'up' | 'down' | null {
  let last: ReviewEntry | null = null;
  for (const e of entries) {
    if (e.kind === 'vote' && e.requestId === requestId && e.participantId === participantId && (!last || e.at >= last.at)) last = e;
  }
  return last?.value === 'up' || last?.value === 'down' ? last.value : null;
}

export function commentsFor(entries: readonly ReviewEntry[], requestId: string): ReviewEntry[] {
  return entries.filter((e) => e.kind === 'comment' && e.requestId === requestId).sort((a, b) => a.at - b.at);
}

export interface ApprovalStatus {
  required: boolean;
  teammates: number;
  needed: number;
  up: number;
  down: number;
  /** True when Accept is allowed as far as the group is concerned. */
  met: boolean;
}

export function approvalStatus(t: Tally, teammatesOnline: number, required: boolean): ApprovalStatus {
  const needed = teammatesOnline > 0 ? Math.floor(teammatesOnline / 2) + 1 : 0;
  const met = !required || needed === 0 || (t.up.length >= needed && t.up.length > t.down.length);
  return { required, teammates: teammatesOnline, needed, up: t.up.length, down: t.down.length, met };
}
