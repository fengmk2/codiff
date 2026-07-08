import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';

const require = createRequire(import.meta.url);
const {
  CODEX_NOT_FOUND_CODE,
  CODEX_NOT_FOUND_MESSAGE,
  DEFAULT_OPENAI_MODEL,
  getCodexCommand,
  getCodexInstallPaths,
  getCodexLaunchErrorMessage,
  isOpenAIModelAvailabilityError,
  normalizeOpenAIModel,
  runCodex,
} = require('../codex.cjs') as {
  CODEX_NOT_FOUND_CODE: string;
  CODEX_NOT_FOUND_MESSAGE: string;
  DEFAULT_OPENAI_MODEL: string;
  getCodexCommand: () => string;
  getCodexInstallPaths: (platform?: NodeJS.Platform, home?: string) => Array<string>;
  getCodexLaunchErrorMessage: (error: unknown, platform?: NodeJS.Platform) => string;
  isOpenAIModelAvailabilityError: (value: string) => boolean;
  normalizeOpenAIModel: (value: unknown) => string;
  runCodex: (
    repoRoot: string,
    prompt: string,
    schema: unknown,
    outputName?: string,
    timeoutMessage?: string,
    options?: {
      model?: string;
      onMetrics?: (metrics: {
        transport: string;
        usage?: {
          cachedInputTokens: number;
          inputTokens: number;
          outputTokens: number;
          reasoningOutputTokens: number;
          totalTokens: number;
        };
      }) => void;
      onProgress?: (phase: string) => void;
      reasoningEffort?: 'low' | 'medium' | 'high';
      timeoutMs?: number;
    },
  ) => Promise<string>;
};

test('normalizes OpenAI model preferences to known models', () => {
  expect(normalizeOpenAIModel('gpt-5.5')).toBe('gpt-5.5');
  expect(normalizeOpenAIModel('gpt-5.4-mini')).toBe(DEFAULT_OPENAI_MODEL);
  expect(normalizeOpenAIModel('gpt-5.3-codex')).toBe(DEFAULT_OPENAI_MODEL);
  expect(normalizeOpenAIModel('gpt-4o')).toBe(DEFAULT_OPENAI_MODEL);
});

test('detects selected model availability failures', () => {
  expect(
    isOpenAIModelAvailabilityError('You do not have access to model gpt-5.3-codex-spark.'),
  ).toBe(true);
  expect(isOpenAIModelAvailabilityError('Rate limit reached, please try again later.')).toBe(false);
});

test('explains macOS Codex CLI security blocks', () => {
  expect(
    getCodexLaunchErrorMessage(
      new Error('"codex" was not opened because it contains malware.'),
      'darwin',
    ),
  ).toContain('Update Codex CLI');
  expect(
    getCodexLaunchErrorMessage(
      Object.assign(new Error('spawn codex EACCES'), {
        code: 'EACCES',
      }),
      'darwin',
    ),
  ).toContain('Update Codex CLI');
  expect(
    getCodexLaunchErrorMessage(
      {
        message: 'Codex was terminated by SIGKILL.',
        signal: 'SIGKILL',
      },
      'darwin',
    ),
  ).toContain('Update Codex CLI');
  expect(getCodexLaunchErrorMessage(new Error('spawn codex EACCES'), 'linux')).toBe(
    'spawn codex EACCES',
  );
});

test('explains missing Codex CLI launches', () => {
  expect(
    getCodexLaunchErrorMessage(
      Object.assign(new Error('spawn codex ENOENT'), {
        code: 'ENOENT',
      }),
    ),
  ).toBe(CODEX_NOT_FOUND_MESSAGE);
});

test('checks the Codex app embedded CLI on macOS', () => {
  expect(getCodexInstallPaths('darwin', '/Users/reviewer')).toEqual([
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
    '/Applications/Codex.app/Contents/Resources/codex',
    '/Users/reviewer/Applications/Codex.app/Contents/Resources/codex',
  ]);
  expect(getCodexInstallPaths('linux', '/home/reviewer')).toEqual([
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
  ]);
});

test('rejects invalid explicit Codex CLI overrides', () => {
  const previousCodexPath = process.env.CODIFF_CODEX_PATH;
  process.env.CODIFF_CODEX_PATH = '/tmp/codiff-missing-codex';

  try {
    expect(() => getCodexCommand()).toThrow('CODIFF_CODEX_PATH');
    try {
      getCodexCommand();
    } catch (error) {
      expect(error).toMatchObject({ code: CODEX_NOT_FOUND_CODE });
    }
  } finally {
    if (previousCodexPath == null) {
      delete process.env.CODIFF_CODEX_PATH;
    } else {
      process.env.CODIFF_CODEX_PATH = previousCodexPath;
    }
  }
});

test('runs Codex walkthroughs as fresh ephemeral repository-scoped calls', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codiff-codex-'));
  const fakeCodexPath = join(directory, 'codex');
  const argsPath = join(directory, 'args.txt');
  const previousCodexPath = process.env.CODIFF_CODEX_PATH;

  try {
    await writeFile(
      fakeCodexPath,
      `#!/bin/sh
for arg in "$@"; do
  printf '%s\\n' "$arg" >> "${argsPath}"
done
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--output-last-message" ]; then
    shift
    printf '{"version":1}' > "$1"
    exit 0
  fi
  shift
done
exit 1
`,
    );
    await chmod(fakeCodexPath, 0o755);
    process.env.CODIFF_CODEX_PATH = fakeCodexPath;

    await expect(runCodex('/repo', 'prompt', {}, 'walkthrough.json', 'Timed out.')).resolves.toBe(
      '{"version":1}',
    );

    const args = (await readFile(argsPath, 'utf8')).trim().split('\n');
    expect(args).toContain('--ephemeral');
    expect(args).toContain('--json');
    expect(args).toContain('--cd');
    expect(args).toContain('/repo');
    expect(args).toContain('model_reasoning_effort="high"');
    expect(args).not.toContain('resume');
  } finally {
    if (previousCodexPath == null) {
      delete process.env.CODIFF_CODEX_PATH;
    } else {
      process.env.CODIFF_CODEX_PATH = previousCodexPath;
    }
    await rm(directory, { force: true, recursive: true });
  }
});

test('streams Codex app-server reasoning and message deltas as semantic progress', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codiff-codex-progress-'));
  const fakeCodexPath = join(directory, 'codex');
  const requestsPath = join(directory, 'requests.txt');
  const previousCodexPath = process.env.CODIFF_CODEX_PATH;

  try {
    await writeFile(
      fakeCodexPath,
      `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
const readline = require('node:readline');
const requestsPath = ${JSON.stringify(requestsPath)};
for (const arg of process.argv.slice(2)) {
  appendFileSync(requestsPath, JSON.stringify({ arg }) + '\\n');
}
const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  appendFileSync(requestsPath, JSON.stringify({ message }) + '\\n');
  if (message.method === 'initialize') {
    send({ id: message.id, result: {} });
  } else if (message.method === 'thread/start') {
    send({ id: message.id, result: { thread: { id: 'thread-1' } } });
    send({ method: 'thread/started', params: { thread: { id: 'thread-1' } } });
  } else if (message.method === 'turn/start') {
    send({ id: message.id, result: { turn: { id: 'turn-1' } } });
    send({ method: 'turn/started', params: { threadId: 'thread-1', turn: { id: 'turn-1' } } });
    send({
      method: 'item/started',
      params: { item: { id: 'reasoning-1', type: 'reasoning' } },
    });
    send({
      method: 'item/reasoning/summaryTextDelta',
      params: { delta: 'Reasoning privately.' },
    });
    send({
      method: 'item/agentMessage/delta',
      params: { delta: '{"version":' },
    });
    send({
      method: 'item/agentMessage/delta',
      params: { delta: '1}' },
    });
    send({
      method: 'item/completed',
      params: { item: { text: '{"version":1}', type: 'agentMessage' } },
    });
    send({
      method: 'thread/tokenUsage/updated',
      params: {
        tokenUsage: {
          total: {
            cachedInputTokens: 80,
            inputTokens: 100,
            outputTokens: 25,
            reasoningOutputTokens: 10,
            totalTokens: 125,
          },
        },
      },
    });
    send({
      method: 'turn/completed',
      params: { turn: { items: [], status: 'completed' } },
    });
  }
});
`,
    );
    await chmod(fakeCodexPath, 0o755);
    process.env.CODIFF_CODEX_PATH = fakeCodexPath;
    const phases: Array<string> = [];
    const metrics: Array<any> = [];

    await expect(
      runCodex(directory, 'prompt', {}, 'walkthrough.json', 'Timed out.', {
        onProgress: (phase) => phases.push(phase),
        onMetrics: (value) => metrics.push(value),
      }),
    ).resolves.toBe('{"version":1}');

    expect(phases).toEqual([
      'agent-generation',
      'agent-generation',
      'agent-generation',
      'agent-generation',
      'response-received',
      'response-received',
      'response-received',
    ]);
    expect(metrics).toEqual([
      {
        transport: 'app-server',
        usage: {
          cachedInputTokens: 80,
          inputTokens: 100,
          outputTokens: 25,
          reasoningOutputTokens: 10,
          totalTokens: 125,
        },
      },
    ]);

    const records = (await readFile(requestsPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(records.filter((record) => record.arg).map((record) => record.arg)).toContain(
      'app-server',
    );
    const threadStart = records.find((record) => record.message?.method === 'thread/start').message;
    expect(threadStart.params).toMatchObject({
      approvalPolicy: 'never',
      cwd: directory,
      ephemeral: true,
      sandbox: 'read-only',
    });
    const turnStart = records.find((record) => record.message?.method === 'turn/start').message;
    expect(turnStart.params).toMatchObject({
      approvalPolicy: 'never',
      cwd: directory,
      effort: 'high',
      outputSchema: {},
      sandboxPolicy: {
        networkAccess: false,
        type: 'readOnly',
      },
      threadId: 'thread-1',
    });
  } finally {
    if (previousCodexPath == null) {
      delete process.env.CODIFF_CODEX_PATH;
    } else {
      process.env.CODIFF_CODEX_PATH = previousCodexPath;
    }
    await rm(directory, { force: true, recursive: true });
  }
});

test('reports Codex exec token usage for eval instrumentation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codiff-codex-metrics-'));
  const fakeCodexPath = join(directory, 'codex');
  const previousCodexPath = process.env.CODIFF_CODEX_PATH;

  try {
    await writeFile(
      fakeCodexPath,
      `#!/usr/bin/env node
const args = process.argv.slice(2);
const outputIndex = args.indexOf('--output-last-message');
require('node:fs').writeFileSync(args[outputIndex + 1], '{"version":1}');
process.stdout.write(JSON.stringify({
  type: 'turn.completed',
  usage: {
    cached_input_tokens: 80,
    input_tokens: 100,
    output_tokens: 25,
    reasoning_output_tokens: 10,
  },
}) + '\\n');
`,
    );
    await chmod(fakeCodexPath, 0o755);
    process.env.CODIFF_CODEX_PATH = fakeCodexPath;
    const metrics: Array<any> = [];

    await expect(
      runCodex(directory, 'prompt', {}, 'walkthrough.json', 'Timed out.', {
        onMetrics: (value) => metrics.push(value),
      }),
    ).resolves.toBe('{"version":1}');

    expect(metrics).toEqual([
      {
        transport: 'exec',
        usage: {
          cachedInputTokens: 80,
          inputTokens: 100,
          outputTokens: 25,
          reasoningOutputTokens: 10,
          totalTokens: 125,
        },
      },
    ]);
  } finally {
    if (previousCodexPath == null) {
      delete process.env.CODIFF_CODEX_PATH;
    } else {
      process.env.CODIFF_CODEX_PATH = previousCodexPath;
    }
    await rm(directory, { force: true, recursive: true });
  }
});

test('falls back to codex exec when app-server is unavailable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codiff-codex-app-server-fallback-'));
  const fakeCodexPath = join(directory, 'codex');
  const previousCodexPath = process.env.CODIFF_CODEX_PATH;

  try {
    await writeFile(
      fakeCodexPath,
      `#!/bin/sh
if [ "$1" = "app-server" ]; then
  printf '%s\\n' "error: unrecognized subcommand 'app-server'" >&2
  exit 2
fi
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--output-last-message" ]; then
    shift
    printf '{"version":1}' > "$1"
    exit 0
  fi
  shift
done
exit 1
`,
    );
    await chmod(fakeCodexPath, 0o755);
    process.env.CODIFF_CODEX_PATH = fakeCodexPath;

    await expect(
      runCodex(directory, 'prompt', {}, 'walkthrough.json', 'Timed out.', {
        onProgress: () => {},
      }),
    ).resolves.toBe('{"version":1}');
  } finally {
    if (previousCodexPath == null) {
      delete process.env.CODIFF_CODEX_PATH;
    } else {
      process.env.CODIFF_CODEX_PATH = previousCodexPath;
    }
    await rm(directory, { force: true, recursive: true });
  }
});

test('forwards per-call Codex reasoning effort overrides', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codiff-codex-'));
  const fakeCodexPath = join(directory, 'codex');
  const argsPath = join(directory, 'args.txt');
  const previousCodexPath = process.env.CODIFF_CODEX_PATH;

  try {
    await writeFile(
      fakeCodexPath,
      `#!/bin/sh
for arg in "$@"; do
  printf '%s\\n' "$arg" >> "${argsPath}"
done
while [ "$#" -gt 0 ]; do
  if [ "$1" = "--output-last-message" ]; then
    shift
    printf '{"version":1}' > "$1"
    exit 0
  fi
  shift
done
exit 1
`,
    );
    await chmod(fakeCodexPath, 0o755);
    process.env.CODIFF_CODEX_PATH = fakeCodexPath;

    await expect(
      runCodex('/repo', 'prompt', {}, 'walkthrough.json', 'Timed out.', {
        reasoningEffort: 'low',
      }),
    ).resolves.toBe('{"version":1}');

    const args = (await readFile(argsPath, 'utf8')).trim().split('\n');
    expect(args).toContain('model_reasoning_effort="low"');
  } finally {
    if (previousCodexPath == null) {
      delete process.env.CODIFF_CODEX_PATH;
    } else {
      process.env.CODIFF_CODEX_PATH = previousCodexPath;
    }
    await rm(directory, { force: true, recursive: true });
  }
});

test('supports per-call Codex timeouts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codiff-codex-timeout-'));
  const fakeCodexPath = join(directory, 'codex');
  const previousCodexPath = process.env.CODIFF_CODEX_PATH;

  try {
    await writeFile(
      fakeCodexPath,
      `#!/usr/bin/env node
process.stdin.resume();
setInterval(() => {}, 1_000);
`,
    );
    await chmod(fakeCodexPath, 0o755);
    process.env.CODIFF_CODEX_PATH = fakeCodexPath;

    await expect(
      runCodex('/repo', 'prompt', {}, 'walkthrough.json', 'Timed out.', { timeoutMs: 10 }),
    ).rejects.toThrow('Timed out.');
  } finally {
    if (previousCodexPath == null) {
      delete process.env.CODIFF_CODEX_PATH;
    } else {
      process.env.CODIFF_CODEX_PATH = previousCodexPath;
    }
    await rm(directory, { force: true, recursive: true });
  }
});

test('surfaces structured Codex CLI errors without the full prompt stream', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codiff-codex-'));
  const fakeCodexPath = join(directory, 'codex');
  const previousCodexPath = process.env.CODIFF_CODEX_PATH;

  try {
    await writeFile(
      fakeCodexPath,
      `#!/bin/sh
printf '%s\\n' 'user very long prompt that should not be shown'
printf '%s\\n' 'ERROR: {"type":"error","error":{"message":"Invalid schema for response_format."}}' >&2
exit 1
`,
    );
    await chmod(fakeCodexPath, 0o755);
    process.env.CODIFF_CODEX_PATH = fakeCodexPath;

    let message = '';
    try {
      await runCodex('/repo', 'prompt', {}, 'walkthrough.json', 'Timed out.');
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('Invalid schema for response_format.');
    expect(message).not.toContain('very long prompt');
  } finally {
    if (previousCodexPath == null) {
      delete process.env.CODIFF_CODEX_PATH;
    } else {
      process.env.CODIFF_CODEX_PATH = previousCodexPath;
    }
    await rm(directory, { force: true, recursive: true });
  }
});
