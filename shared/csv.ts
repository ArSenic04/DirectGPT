/** Minimal RFC 4180 CSV writer. */
export type CsvValue = string | number | boolean | null | undefined;

export function csvEscape(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'number' && !Number.isFinite(value) ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Array<Record<string, CsvValue>>, columns?: string[]): string {
  const cols = columns ?? Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const lines = [cols.map(csvEscape).join(',')];
  for (const row of rows) lines.push(cols.map((c) => csvEscape(row[c])).join(','));
  return lines.join('\n') + '\n';
}
