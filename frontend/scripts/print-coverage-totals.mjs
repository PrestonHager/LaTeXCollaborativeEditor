/**
 * Prints aggregate coverage from Vitest's json-summary reporter (coverage/coverage-summary.json).
 * Run from frontend/: node scripts/print-coverage-totals.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const summaryPath = join(__dirname, '..', 'coverage', 'coverage-summary.json');
const raw = readFileSync(summaryPath, 'utf8');
const { total } = JSON.parse(raw);

const keys = ['lines', 'statements', 'functions', 'branches'];
const parts = keys.map((k) => `${k}=${total[k].pct}%`);
console.log(`COVERAGE_TOTALS ${parts.join(' ')}`);
