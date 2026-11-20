/**
 * Study analysis (proposal §Evaluation): compares the direct-manipulation
 * condition with the prompt-based baseline using within-subjects data
 * exported from the server (`collab-directgpt/session-export@1`).
 *
 * Team-level measures (task time, unintended modifications, prompts, ...) are
 * paired by session (pair) ID; questionnaire measures are paired by
 * participant ID within the session. Practice and sandbox rooms are ignored,
 * and a room exported more than once counts once.
 *
 * Rooms may contain any number of participants. Team measures are per room
 * regardless of size; participant measures include everyone unless
 * `pairRolesOnly` keeps only the A/B partners of the formal pair protocol.
 */
import type { Condition } from './types';
import type { SessionExport } from './exportData';
import { EXPORT_SCHEMA } from './exportData';
import { toCsv, type CsvValue } from './csv';
import { isPairRole } from './roles';

export const STUDY_TASKS = ['T1', 'T2'];
export const CONDITIONS: Condition[] = ['direct', 'baseline'];

export const TEAM_MEASURES = [
  'participantCount', 'taskTimeSec', 'unintendedChangeChars', 'intendedChangeChars', 'prompts', 'meanPromptChars', 'accepts',
  'rejects', 'regenerations', 'conflicts', 'reverts', 'pastes', 'manualEditChars', 'aiErrors', 'meanLatencyMs',
] as const;
export const PARTICIPANT_MEASURES = [
  'control', 'transparency', 'coordination', 'tlxRaw', 'prompts', 'accepts', 'rejects', 'manualEditChars',
] as const;

export type TeamMeasure = (typeof TEAM_MEASURES)[number];
export type ParticipantMeasure = (typeof PARTICIPANT_MEASURES)[number];

export interface TeamRow { sessionId: string; task: string; condition: Condition; values: Record<TeamMeasure, number | null> }
export interface ParticipantRow { sessionId: string; participantId: string; role: string | null; task: string; condition: Condition; values: Record<ParticipantMeasure, number | null> }

export interface Descriptives { n: number; mean: number | null; sd: number | null; median: number | null }
export interface WilcoxonResult { n: number; wPlus: number; wMinus: number; statistic: number; z: number | null; p: number | null; method: 'exact' | 'normal' | 'none' }
export interface Comparison {
  level: 'team' | 'participant';
  measure: string;
  direct: Descriptives;
  baseline: Descriptives;
  pairs: number;
  /** Median of (direct − baseline) over complete pairs. */
  medianDiff: number | null;
  wilcoxon: WilcoxonResult;
  /** Matched-pairs rank-biserial correlation (W+ − W−) / (W+ + W−). */
  effectSize: number | null;
}

const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function isSessionExport(value: unknown): value is SessionExport {
  return typeof value === 'object' && value !== null && (value as { schema?: unknown }).schema === EXPORT_SCHEMA;
}

export function teamRows(exports: SessionExport[]): TeamRow[] {
  return exports
    .filter((e) => STUDY_TASKS.includes(e.summary.task))
    .map((e) => {
      const s = e.summary as unknown as Record<string, unknown>;
      const values = {} as Record<TeamMeasure, number | null>;
      for (const m of TEAM_MEASURES) values[m] = finite(s[m]);
      return { sessionId: e.summary.sessionId, task: e.summary.task, condition: e.summary.condition, values };
    });
}

export interface AnalyzeOptions {
  /** Keep only participants with study role A or B in participant-level measures. */
  pairRolesOnly?: boolean;
}

export function participantRows(exports: SessionExport[], options: AnalyzeOptions = {}): ParticipantRow[] {
  const rows: ParticipantRow[] = [];
  for (const e of exports) {
    if (!STUDY_TASKS.includes(e.summary.task)) continue;
    for (const p of e.summary.participants) {
      const role = p.role ?? null;
      if (options.pairRolesOnly && !isPairRole(role)) continue;
      const q = (p.questionnaire ?? {}) as Record<string, unknown>;
      const a = p as unknown as Record<string, unknown>;
      const values = {} as Record<ParticipantMeasure, number | null>;
      for (const m of PARTICIPANT_MEASURES) values[m] = finite(m in q ? q[m] : a[m]);
      rows.push({ sessionId: e.summary.sessionId, participantId: p.participantId, role, task: e.summary.task, condition: e.summary.condition, values });
    }
  }
  return rows;
}

export function describe(values: Array<number | null>): Descriptives {
  const xs = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  const n = xs.length;
  if (n === 0) return { n, mean: null, sd: null, median: null };
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : null;
  const median = n % 2 === 1 ? xs[(n - 1) / 2] : (xs[n / 2 - 1] + xs[n / 2]) / 2;
  return { n, mean, sd, median };
}

/** Average ranks (1-based) with ties sharing the mean rank. */
export function rank(values: number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(values.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].v === order[i].v) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k].i] = r;
    i = j + 1;
  }
  return ranks;
}

function normalCdf(z: number): number {
  // Abramowitz & Stegun 7.1.26 approximation of erf.
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/**
 * Two-sided Wilcoxon signed-rank test on paired differences. Zero differences
 * are dropped (Wilcoxon's method). Exact p-value for n ≤ 25 without ties,
 * otherwise a normal approximation with tie and continuity correction.
 */
export function wilcoxonSignedRank(diffs: number[]): WilcoxonResult {
  const d = diffs.filter((x) => x !== 0);
  const n = d.length;
  if (n === 0) return { n, wPlus: 0, wMinus: 0, statistic: 0, z: null, p: null, method: 'none' };
  const ranks = rank(d.map(Math.abs));
  let wPlus = 0;
  let wMinus = 0;
  d.forEach((x, i) => (x > 0 ? (wPlus += ranks[i]) : (wMinus += ranks[i])));
  const statistic = Math.min(wPlus, wMinus);
  const hasTies = new Set(d.map(Math.abs)).size < n;
  if (n <= 25 && !hasTies) {
    // Distribution of W+ under H0: counts of subsets of {1..n} by sum.
    const max = (n * (n + 1)) / 2;
    let counts = new Array<number>(max + 1).fill(0);
    counts[0] = 1;
    for (let k = 1; k <= n; k++) {
      const next = counts.slice();
      for (let s = k; s <= max; s++) next[s] += counts[s - k];
      counts = next;
    }
    const total = 2 ** n;
    let tail = 0;
    for (let s = 0; s <= statistic; s++) tail += counts[s];
    return { n, wPlus, wMinus, statistic, z: null, p: Math.min(1, (2 * tail) / total), method: 'exact' };
  }
  const mean = (n * (n + 1)) / 4;
  const tieGroups = new Map<number, number>();
  for (const x of d.map(Math.abs)) tieGroups.set(x, (tieGroups.get(x) ?? 0) + 1);
  let tieTerm = 0;
  for (const t of tieGroups.values()) tieTerm += t ** 3 - t;
  const variance = (n * (n + 1) * (2 * n + 1)) / 24 - tieTerm / 48;
  if (variance <= 0) return { n, wPlus, wMinus, statistic, z: null, p: null, method: 'none' };
  const z = (wPlus - mean - Math.sign(wPlus - mean) * 0.5) / Math.sqrt(variance);
  return { n, wPlus, wMinus, statistic, z, p: Math.min(1, 2 * (1 - normalCdf(Math.abs(z)))), method: 'normal' };
}

function compare<M extends string>(
  level: Comparison['level'],
  measure: M,
  rows: Array<{ condition: Condition; values: Record<M, number | null> }>,
  key: (row: { condition: Condition; values: Record<M, number | null> }) => string,
): Comparison {
  const byCondition = (c: Condition) => rows.filter((r) => r.condition === c);
  const direct = describe(byCondition('direct').map((r) => r.values[measure]));
  const baseline = describe(byCondition('baseline').map((r) => r.values[measure]));
  // One value per unit and condition (mean if a unit has several rooms).
  const perUnit = new Map<string, Partial<Record<Condition, number[]>>>();
  for (const r of rows) {
    const v = r.values[measure];
    if (v === null) continue;
    const entry = perUnit.get(key(r)) ?? {};
    (entry[r.condition] ??= []).push(v);
    perUnit.set(key(r), entry);
  }
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const diffs: number[] = [];
  for (const entry of perUnit.values()) {
    if (entry.direct && entry.baseline) diffs.push(avg(entry.direct) - avg(entry.baseline));
  }
  const wilcoxon = wilcoxonSignedRank(diffs);
  const totalRank = wilcoxon.wPlus + wilcoxon.wMinus;
  return {
    level,
    measure,
    direct,
    baseline,
    pairs: diffs.length,
    medianDiff: describe(diffs).median,
    wilcoxon,
    effectSize: totalRank > 0 ? (wilcoxon.wPlus - wilcoxon.wMinus) / totalRank : null,
  };
}

/**
 * One export per room: the same room exported twice (for example the server
 * copy in data/exports/ and a downloaded copy) would otherwise count twice in
 * every descriptive statistic. The most recent export of a room is kept.
 */
export function dedupeExports(exports: SessionExport[]): { exports: SessionExport[]; duplicates: number } {
  const byRoom = new Map<string, SessionExport>();
  for (const e of exports) {
    const prev = byRoom.get(e.room);
    if (!prev || Date.parse(e.exportedAt) >= Date.parse(prev.exportedAt)) byRoom.set(e.room, e);
  }
  return { exports: Array.from(byRoom.values()), duplicates: exports.length - byRoom.size };
}

export function analyze(
  exports: SessionExport[],
  options: AnalyzeOptions = {},
): { team: TeamRow[]; participants: ParticipantRow[]; comparisons: Comparison[]; duplicatesDropped: number } {
  const unique = dedupeExports(exports);
  const team = teamRows(unique.exports);
  const participants = participantRows(unique.exports, options);
  const comparisons = [
    ...TEAM_MEASURES.map((m) => compare('team', m, team, (r) => (r as TeamRow).sessionId)),
    // A participant is identified within their session (pair): a participant ID reused in another
    // session is a different person and must not be averaged with them.
    ...PARTICIPANT_MEASURES.map((m) =>
      compare('participant', m, participants, (r) => `${(r as ParticipantRow).sessionId}\u0000${(r as ParticipantRow).participantId}`),
    ),
  ];
  return { team, participants, comparisons, duplicatesDropped: unique.duplicates };
}

const round = (v: number | null, digits = 3): number | null => (v === null ? null : Math.round(v * 10 ** digits) / 10 ** digits);

export function comparisonsCsv(comparisons: Comparison[]): string {
  const rows: Array<Record<string, CsvValue>> = comparisons.map((c) => ({
    level: c.level, measure: c.measure,
    direct_n: c.direct.n, direct_mean: round(c.direct.mean), direct_sd: round(c.direct.sd), direct_median: round(c.direct.median),
    baseline_n: c.baseline.n, baseline_mean: round(c.baseline.mean), baseline_sd: round(c.baseline.sd), baseline_median: round(c.baseline.median),
    pairs: c.pairs, median_diff: round(c.medianDiff), wilcoxon_V: c.wilcoxon.wPlus, wilcoxon_n: c.wilcoxon.n,
    z: round(c.wilcoxon.z), p: round(c.wilcoxon.p, 4), method: c.wilcoxon.method, rank_biserial: round(c.effectSize),
  }));
  return toCsv(rows);
}

export function rowsCsv(rows: Array<TeamRow | ParticipantRow>): string {
  return toCsv(rows.map((r) => ({ sessionId: r.sessionId, ...('participantId' in r ? { participantId: r.participantId, role: r.role ?? '' } : {}), task: r.task, condition: r.condition, ...r.values })));
}

const fmt = (v: number | null, digits = 2) => (v === null ? '–' : v.toFixed(digits));

export function comparisonsMarkdown(comparisons: Comparison[], sources: number): string {
  const lines = [
    '# Collaborative DirectGPT: study analysis',
    '',
    `Generated ${new Date().toISOString()} from ${sources} session export(s). Direct = Collaborative DirectGPT, Baseline = prompt-based chat.`,
    'Paired two-sided Wilcoxon signed-rank tests (team measures paired by session, questionnaire measures by participant within the session).',
    'Effect size: matched-pairs rank-biserial r (positive = higher in Direct).',
    '',
    '| Level | Measure | Direct M (SD) | Baseline M (SD) | Pairs | Median diff | V | p | r |',
    '|---|---|---|---|---|---|---|---|---|',
  ];
  for (const c of comparisons) {
    lines.push(`| ${c.level} | ${c.measure} | ${fmt(c.direct.mean)} (${fmt(c.direct.sd)}) | ${fmt(c.baseline.mean)} (${fmt(c.baseline.sd)}) | ${c.pairs} | ${fmt(c.medianDiff)} | ${c.wilcoxon.wPlus} | ${c.wilcoxon.p === null ? '–' : c.wilcoxon.p.toFixed(4)} | ${fmt(c.effectSize)} |`);
  }
  lines.push('', 'With few pairs these tests have low power; report them as exploratory, as stated in the study protocol.', '');
  return lines.join('\n');
}
