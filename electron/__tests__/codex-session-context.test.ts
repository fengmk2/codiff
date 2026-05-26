import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';

const require = createRequire(import.meta.url);
const { findCodexSessionFile, readCodexSessionContext, readSessionMessages } =
  require('../codex-session-context.cjs') as {
    findCodexSessionFile: (root: string, sessionId: string) => string | null;
    readCodexSessionContext: (sessionId?: string) => {
      messages?: ReadonlyArray<{ role: 'assistant' | 'user'; text: string }>;
      risks?: ReadonlyArray<string>;
      source: { threadId?: string; type: string };
      version: 1;
    } | null;
    readSessionMessages: (
      path: string,
    ) => ReadonlyArray<{ role: 'assistant' | 'user'; text: string }>;
  };

const sessionId = '019e5e57-e7d6-7392-9ad1-ad959319d2fb';

test('extracts bounded readable messages from Codex session jsonl', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codiff-session-'));
  const sessionPath = join(directory, `rollout-${sessionId}.jsonl`);

  try {
    await writeFile(
      sessionPath,
      [
        JSON.stringify({
          payload: {
            content: [{ text: 'Implement walkthrough session handoff.', type: 'input_text' }],
            role: 'user',
            type: 'message',
          },
          type: 'response_item',
        }),
        JSON.stringify({
          payload: {
            content: [{ text: 'Updated the CLI and skill handoff.', type: 'output_text' }],
            role: 'assistant',
            type: 'message',
          },
          type: 'response_item',
        }),
        JSON.stringify({
          payload: {
            content: [{ text: 'Internal developer instruction.', type: 'input_text' }],
            role: 'developer',
            type: 'message',
          },
          type: 'response_item',
        }),
        JSON.stringify({
          payload: {
            content: [{ text: '$codiff', type: 'input_text' }],
            role: 'user',
            type: 'message',
          },
          type: 'response_item',
        }),
      ].join('\n'),
    );

    expect(readSessionMessages(sessionPath)).toEqual([
      { role: 'user', text: 'Implement walkthrough session handoff.' },
      { role: 'assistant', text: 'Updated the CLI and skill handoff.' },
    ]);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('finds the active Codex session under CODEX_HOME', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codiff-codex-home-'));
  const previousCodexHome = process.env.CODEX_HOME;

  try {
    const sessionDirectory = join(directory, 'sessions', '2026', '05', '25');
    const sessionPath = join(sessionDirectory, `rollout-${sessionId}.jsonl`);
    await mkdir(sessionDirectory, { recursive: true });
    await writeFile(
      sessionPath,
      `${JSON.stringify({
        payload: {
          content: [
            {
              text: 'Keep Codiff in charge of the ephemeral walkthrough.',
              type: 'input_text',
            },
          ],
          role: 'user',
          type: 'message',
        },
        type: 'response_item',
      })}\n`,
    );
    process.env.CODEX_HOME = directory;

    expect(findCodexSessionFile(join(directory, 'sessions'), sessionId)).toBe(sessionPath);
    expect(readCodexSessionContext(sessionId)).toMatchObject({
      messages: [
        {
          role: 'user',
          text: 'Keep Codiff in charge of the ephemeral walkthrough.',
        },
      ],
      source: {
        threadId: sessionId,
        type: 'codex-session-excerpt',
      },
      version: 1,
    });
  } finally {
    if (previousCodexHome == null) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousCodexHome;
    }
    await rm(directory, { force: true, recursive: true });
  }
});
