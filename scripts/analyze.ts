/**
 * Analyse study exports.
 *
 *   npm run analyze                       # every data/exports/*.json (written by the server)
 *   npm run analyze -- path/a.json dir/   # specific files or folders
 *   npm run analyze -- --demo             # SYNTHETIC demo data, to try the pipeline
 *   npm run analyze -- --out some/dir     # output folder (default data/analysis)
 *   npm run analyze -- --pair-roles-only  # participant measures: only study roles A and B
 *
 * Writes comparisons.csv, team.csv, participants.csv and report.md.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { analyze, comparisonsCsv, comparisonsMarkdown, isSessionExport, rowsCsv } from '../shared/analysis';
import type { SessionExport } from '../shared/exportData';
import { demoExports } from './demoData';

function collect(paths: string[]): string[] {
  const files: string[] = [];
  for (const p of paths) {
    if (!existsSync(p)) {
      console.warn(`skip: ${p} does not exist`);
      continue;
    }
    if (statSync(p).isDirectory()) {
      for (const f of readdirSync(p).sort()) if (f.endsWith('.json')) files.push(join(p, f));
    } else files.push(p);
  }
  return files;
}

function main(argv: string[]): number {
  let out = 'data/analysis';
  let demo = false;
  let pairRolesOnly = false;
  const inputs: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') out = argv[++i] ?? out;
    else if (argv[i] === '--demo') demo = true;
    else if (argv[i] === '--pair-roles-only') pairRolesOnly = true;
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('usage: npm run analyze -- [--demo] [--pair-roles-only] [--out dir] [files or folders...]');
      return 0;
    } else inputs.push(argv[i]);
  }

  let exports: SessionExport[];
  if (demo) {
    exports = demoExports();
    if (out === 'data/analysis') out = 'data/analysis-demo';
    console.log(`Using ${exports.length} SYNTHETIC demo exports (not study data).`);
  } else {
    const dataDir = process.env.DATA_DIR && process.env.DATA_DIR !== 'none' ? process.env.DATA_DIR : 'data';
    const files = collect(inputs.length > 0 ? inputs : [join(dataDir, 'exports')]);
    exports = [];
    for (const f of files) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(f, 'utf8'));
        if (isSessionExport(parsed)) exports.push(parsed);
        else console.warn(`skip: ${f} is not a session export`);
      } catch (err) {
        console.warn(`skip: ${f} (${(err as Error).message})`);
      }
    }
  }
  if (exports.length === 0) {
    console.error('No session exports found. Export rooms from the app (Export data) or the server writes them to data/exports/. Try --demo to see the output format.');
    return 1;
  }

  const result = analyze(exports, { pairRolesOnly });
  if (result.duplicatesDropped > 0) {
    console.warn(`note: ${result.duplicatesDropped} duplicate export(s) of the same room ignored (the most recent export of each room is used).`);
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'comparisons.csv'), comparisonsCsv(result.comparisons));
  writeFileSync(join(out, 'team.csv'), rowsCsv(result.team));
  writeFileSync(join(out, 'participants.csv'), rowsCsv(result.participants));
  const report = (demo ? '> **SYNTHETIC DEMO DATA. These numbers are not study results.**\n\n' : '') + comparisonsMarkdown(result.comparisons, exports.length - result.duplicatesDropped);
  writeFileSync(join(out, 'report.md'), report);
  console.log(report);
  console.log(`Wrote ${resolve(out)}/{comparisons.csv,team.csv,participants.csv,report.md}`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
