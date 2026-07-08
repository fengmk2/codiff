#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import {
  average,
  listAttemptDirs,
  median,
  readCases,
  readJson,
  resolveRunDir,
  writeJson,
} from './lib.mjs';

const [label] = process.argv.slice(2);
if (!label) {
  throw new Error('usage: node evals/report.mjs <run-label>');
}

const runDir = resolveRunDir(label);
const rows = [];

for (const evalCase of await readCases()) {
  const attempts = [];
  for (const attemptDir of await listAttemptDirs(runDir, evalCase.id)) {
    const meta = await readJson(join(attemptDir, 'meta.json'));
    if (!meta) {
      continue;
    }
    attempts.push({
      judge: await readJson(join(attemptDir, 'judge.json')),
      meta,
    });
  }
  if (attempts.length === 0) {
    continue;
  }

  const successful = attempts.filter((attempt) => attempt.meta.exitStatus === 'ready');
  rows.push({
    attempts: attempts.length,
    case: evalCase.id,
    firstResponseMs: median(
      successful.map((attempt) => attempt.meta.firstResponseMs).filter(Number.isFinite),
    ),
    generationMs: median(successful.map((attempt) => attempt.meta.generationMs)),
    hunkCount: successful[0]?.meta.metrics?.hunkCount ?? 0,
    inputTokens: median(
      successful.map((attempt) => attempt.meta.usage?.inputTokens).filter(Number.isFinite),
    ),
    mainCoverage: average(successful.map((attempt) => attempt.meta.metrics?.mainCoverage ?? 0)),
    outputTokens: median(
      successful.map((attempt) => attempt.meta.usage?.outputTokens).filter(Number.isFinite),
    ),
    promptChars: median(successful.map((attempt) => attempt.meta.promptChars)),
    quality: average(attempts.map((attempt) => attempt.judge?.total).filter(Number.isFinite)),
    successRate: successful.length / attempts.length,
    transport: successful[0]?.meta.transport ?? 'unknown',
  });
}

const summary = {
  averageQuality: average(rows.map((row) => row.quality).filter(Number.isFinite)),
  averageSuccessRate: average(rows.map((row) => row.successRate)),
  cases: rows.length,
  medianFirstResponseMs: median(rows.map((row) => row.firstResponseMs)),
  medianGenerationMs: median(rows.map((row) => row.generationMs)),
};
await writeJson(join(runDir, 'summary.json'), { rows, summary });

const lines = [
  `# Walkthrough eval: ${label}`,
  '',
  '| Case | Attempts | Success | Hunks | Prompt | First response | Generation | Input | Output | Main coverage | Quality | Transport |',
  '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|',
  ...rows.map(
    (row) =>
      `| ${row.case} | ${row.attempts} | ${(row.successRate * 100).toFixed(0)}% | ${row.hunkCount} | ${Math.round(row.promptChars / 1000)}k | ${(row.firstResponseMs / 1000).toFixed(2)}s | ${(row.generationMs / 1000).toFixed(2)}s | ${Math.round(row.inputTokens)} | ${Math.round(row.outputTokens)} | ${(row.mainCoverage * 100).toFixed(0)}% | ${row.quality.toFixed(1)}/100 | ${row.transport} |`,
  ),
  '',
  '## Summary',
  '',
  '```json',
  JSON.stringify(summary, null, 2),
  '```',
  '',
];
const report = `${lines.join('\n')}\n`;
await writeFile(join(runDir, 'report.md'), report);
process.stdout.write(report);
