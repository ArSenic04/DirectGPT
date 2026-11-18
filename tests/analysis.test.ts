import { describe as group, expect, it } from 'vitest';
import { analyze, comparisonsCsv, comparisonsMarkdown, describe, isSessionExport, rank, wilcoxonSignedRank } from '../shared/analysis';
import { demoExports } from '../scripts/demoData';

group('statistics', () => {
  it('describes a sample', () => {
    expect(describe([1, 2, 3, 4, null])).toEqual({ n: 4, mean: 2.5, sd: Math.sqrt(5 / 3), median: 2.5 });
    expect(describe([])).toEqual({ n: 0, mean: null, sd: null, median: null });
  });

  it('ranks with ties', () => {
    expect(rank([10, 20, 20, 5])).toEqual([2, 3.5, 3.5, 1]);
  });

  it('matches R wilcox.test(x, y, paired = TRUE) on the Hollander & Wolfe example (V = 40, p = 0.03906)', () => {
    const x = [1.83, 0.5, 1.62, 2.48, 1.68, 1.88, 1.55, 3.06, 1.3];
    const y = [0.878, 0.647, 0.598, 2.05, 1.06, 1.29, 1.06, 3.14, 1.29];
    const r = wilcoxonSignedRank(x.map((v, i) => v - y[i]));
    expect(r.wPlus).toBe(40);
    expect(r.method).toBe('exact');
    expect(r.p).toBeCloseTo(0.03906, 4);
  });

  it('uses the normal approximation with ties and drops zero differences', () => {
    const r = wilcoxonSignedRank([1, 1, 2, 2, 3, 0, -1]);
    expect(r.n).toBe(6);
    expect(r.method).toBe('normal');
    expect(r.p).toBeGreaterThan(0);
    expect(r.p).toBeLessThan(1);
    expect(wilcoxonSignedRank([0, 0]).p).toBeNull();
  });
});

group('analyze', () => {
  const exports = demoExports(4, 7);

  it('builds team and participant rows for the study tasks and paired comparisons', () => {
    expect(exports.every(isSessionExport)).toBe(true);
    const result = analyze(exports);
    expect(result.team).toHaveLength(8);
    expect(result.participants).toHaveLength(16);
    const unintended = result.comparisons.find((c) => c.level === 'team' && c.measure === 'unintendedChangeChars')!;
    expect(unintended.pairs).toBe(4);
    expect(unintended.direct.mean).toBe(0);
    const control = result.comparisons.find((c) => c.level === 'participant' && c.measure === 'control')!;
    expect(control.pairs).toBe(8);
    expect(comparisonsCsv(result.comparisons).split('\n')[0]).toContain('wilcoxon_V');
    expect(comparisonsMarkdown(result.comparisons, exports.length)).toContain('| team | taskTimeSec |');
  });

  it('ignores practice and sandbox rooms', () => {
    const practice = { ...exports[0], summary: { ...exports[0].summary, task: 'practice' } };
    expect(analyze([practice]).team).toHaveLength(0);
  });
});
