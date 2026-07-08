#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import process from 'node:process';
import {
  listAttemptDirs,
  nowMs,
  readCases,
  readJson,
  resolveRunDir,
  root,
  roundMs,
  writeJson,
} from './lib.mjs';

const [label, requestedCase] = process.argv.slice(2);
if (!label) {
  throw new Error('usage: node evals/judge.mjs <run-label> [case-id]');
}

const runDir = resolveRunDir(label);
const judgeSchema = await readFile(join(root, 'evals', 'judge-schema.json'), 'utf8');
const cases = (await readCases()).filter((item) => !requestedCase || item.id === requestedCase);

const runJudge = async (evalCase, attemptDir) => {
  const walkthrough = await readFile(join(attemptDir, 'walkthrough.json'), 'utf8');
  const prompt = `You are judging the quality of a Codiff narrative code walkthrough for commit ${evalCase.commit}.

Inspect the commit directly with read-only git commands. Judge the candidate as a reviewer-facing path through the change, not as a generic summary. Hunk IDs are deterministic anchors; verify the prose and ordering against the actual diff. Do not reward verbosity.

Case rubric:
${evalCase.rubric.map((item) => `- ${item}`).join('\n')}

Candidate walkthrough:
${walkthrough}

Scoring:
- factualGrounding (0-35): statements match the diff; no invented behavior, tests, risks, or intent.
- prioritization (0-30): main stops cover the highest-leverage behavior in a useful review order; mechanical changes are support.
- organization (0-20): coherent conceptual chapters, sensible grouping, concise reviewer path.
- specificity (0-15): prose names concrete symbols, contracts, and interactions rather than generic file summaries.
- total must equal the four component scores.

Be strict and consistent. Put material factual or coverage failures in majorErrors.`;

  const temporaryDir = await mkdtemp(join(tmpdir(), 'codiff-eval-judge-'));
  const schemaPath = join(temporaryDir, 'judge-schema.json');
  const outputPath = join(temporaryDir, 'judge.json');
  await writeFile(schemaPath, judgeSchema);
  const eventsPath = join(attemptDir, 'judge-events.jsonl');
  const stderrPath = join(attemptDir, 'judge.stderr');
  const started = nowMs();

  try {
    const result = await new Promise((resolve) => {
      const child = spawn(
        'codex',
        [
          'exec',
          '-',
          '--ephemeral',
          '--ignore-rules',
          '--sandbox',
          'read-only',
          '--json',
          '--output-schema',
          schemaPath,
          '--output-last-message',
          outputPath,
          '--cd',
          root,
        ],
        { stdio: ['pipe', 'pipe', 'pipe'] },
      );
      let events = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => {
        events += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('close', (code, signal) => resolve({ code, events, signal, stderr }));
      child.stdin.end(prompt);
    });
    await writeFile(eventsPath, result.events);
    await writeFile(stderrPath, result.stderr);
    const judge = await readJson(outputPath);
    if (judge) {
      await writeJson(join(attemptDir, 'judge.json'), judge);
    }
    await writeJson(join(attemptDir, 'judge-meta.json'), {
      exitCode: result.code,
      signal: result.signal,
      wallMs: roundMs(nowMs() - started),
    });
    process.stdout.write(
      `${evalCase.id}/${basename(attemptDir)}: ${judge?.total ?? 'failed'}/100\n`,
    );
  } finally {
    await rm(temporaryDir, { force: true, recursive: true });
  }
};

for (const evalCase of cases) {
  for (const attemptDir of await listAttemptDirs(runDir, evalCase.id)) {
    if (await readJson(join(attemptDir, 'walkthrough.json'))) {
      await runJudge(evalCase, attemptDir);
    }
  }
}
