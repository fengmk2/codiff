#!/usr/bin/env node

import { join } from 'node:path';
import process from 'node:process';
import { readJson, resolveRunDir } from './lib.mjs';

const [baselineLabel, candidateLabel, enforceFlag] = process.argv.slice(2);
if (!baselineLabel || !candidateLabel) {
  throw new Error('usage: node evals/compare.mjs <baseline-label> <candidate-label> [--enforce]');
}

const baseline = await readJson(join(resolveRunDir(baselineLabel), 'summary.json'));
const candidate = await readJson(join(resolveRunDir(candidateLabel), 'summary.json'));
if (!baseline || !candidate) {
  throw new Error('Run evals/report.mjs for both labels before comparing them.');
}

const baselineRows = new Map(baseline.rows.map((row) => [row.case, row]));
const comparisons = candidate.rows
  .filter((row) => baselineRows.has(row.case))
  .map((row) => {
    const base = baselineRows.get(row.case);
    return {
      case: row.case,
      qualityChange: row.quality - base.quality,
      speedup: base.generationMs / row.generationMs,
    };
  });
const qualityRatio =
  baseline.summary.averageQuality === 0
    ? 1
    : candidate.summary.averageQuality / baseline.summary.averageQuality;
const speedup =
  candidate.summary.medianGenerationMs === 0
    ? 0
    : baseline.summary.medianGenerationMs / candidate.summary.medianGenerationMs;
const qualityGatePassed = qualityRatio >= 0.9;

process.stdout.write(`# Walkthrough eval comparison\n\n`);
process.stdout.write(`- Baseline: \`${baselineLabel}\`\n`);
process.stdout.write(`- Candidate: \`${candidateLabel}\`\n`);
process.stdout.write(`- Aggregate speedup: ${speedup.toFixed(2)}x\n`);
process.stdout.write(
  `- Quality: ${baseline.summary.averageQuality.toFixed(1)} -> ${candidate.summary.averageQuality.toFixed(1)} (${((qualityRatio - 1) * 100).toFixed(1)}%)\n`,
);
process.stdout.write(`- 10% quality gate: ${qualityGatePassed ? 'PASS' : 'FAIL'}\n\n`);
process.stdout.write('| Case | Speedup | Quality change |\n|---|---:|---:|\n');
for (const comparison of comparisons) {
  process.stdout.write(
    `| ${comparison.case} | ${comparison.speedup.toFixed(2)}x | ${comparison.qualityChange >= 0 ? '+' : ''}${comparison.qualityChange.toFixed(1)} |\n`,
  );
}

if (enforceFlag === '--enforce' && !qualityGatePassed) {
  process.exitCode = 2;
}
