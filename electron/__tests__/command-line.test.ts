import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';

const require = createRequire(import.meta.url);
const { getInitialRepositoryPath, parseCommandLineArguments, parseGitHubRemoteUrl } =
  require('../main/command-line.cjs') as {
    getInitialRepositoryPath: (
      launchPath: string,
      launchOptions: {
        codexSessionId?: string;
        repositoryPathProvided: boolean;
        source?: { ref: string; type: 'commit' } | { type: 'pull-request'; url: string };
        walkthrough: boolean;
        walkthroughContext?: unknown;
      },
      lastRepositoryPath: string,
      environment?: NodeJS.ProcessEnv,
    ) => string;
    parseCommandLineArguments: (commandLine: ReadonlyArray<string>) => {
      launchOptions: {
        codexSessionId?: string;
        repositoryPathProvided: boolean;
        source?: { ref: string; type: 'commit' } | { type: 'pull-request'; url: string };
        walkthrough: boolean;
        walkthroughContext?: unknown;
      };
      pullRequestNumber: number | null;
      repositoryPath: string | null;
    };
    parseGitHubRemoteUrl: (value: string) => { owner: string; repo: string } | null;
  };

const defaultLaunchOptions = {
  repositoryPathProvided: false,
  walkthrough: false,
};

test('parses commit and walkthrough command-line options', () => {
  expect(
    parseCommandLineArguments(['codiff', '--walkthrough', '--commit', 'HEAD', '/repo']),
  ).toEqual({
    launchOptions: {
      repositoryPathProvided: true,
      source: {
        ref: 'HEAD',
        type: 'commit',
      },
      walkthrough: true,
    },
    pullRequestNumber: null,
    repositoryPath: '/repo',
  });
});

test('parses positional HEAD revisions as commit sources', () => {
  expect(parseCommandLineArguments(['codiff', 'HEAD'])).toEqual({
    launchOptions: {
      repositoryPathProvided: false,
      source: {
        ref: 'HEAD',
        type: 'commit',
      },
      walkthrough: false,
    },
    pullRequestNumber: null,
    repositoryPath: null,
  });

  expect(parseCommandLineArguments(['codiff', 'HEAD^1', '/repo'])).toEqual({
    launchOptions: {
      repositoryPathProvided: true,
      source: {
        ref: 'HEAD^1',
        type: 'commit',
      },
      walkthrough: false,
    },
    pullRequestNumber: null,
    repositoryPath: '/repo',
  });
});

test('parses Codex walkthrough seed command-line options', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codiff-context-'));
  const contextPath = join(directory, 'seed.json');

  try {
    await writeFile(
      contextPath,
      JSON.stringify({
        objective: 'Make walkthroughs reuse the creating Codex session.',
        messages: [
          {
            role: 'user',
            text: 'Open Codiff with the context from this implementation session.',
          },
          {
            role: 'developer',
            text: 'Internal instruction that should not be included.',
          },
          {
            role: 'assistant',
            text: 'I wired the skill handoff through launch options.',
          },
        ],
        source: {
          generatedAt: '2026-05-25T00:00:00.000Z',
          threadId: 'context-file-thread',
        },
        version: 1,
      }),
    );

    expect(
      parseCommandLineArguments([
        'codiff',
        '--walkthrough',
        '--codex-session',
        'cli-thread',
        '--walkthrough-context',
        contextPath,
        '/repo',
      ]).launchOptions,
    ).toEqual({
      codexSessionId: 'cli-thread',
      repositoryPathProvided: true,
      walkthrough: true,
      walkthroughContext: {
        messages: [
          {
            role: 'user',
            text: 'Open Codiff with the context from this implementation session.',
          },
          {
            role: 'assistant',
            text: 'I wired the skill handoff through launch options.',
          },
        ],
        objective: 'Make walkthroughs reuse the creating Codex session.',
        source: {
          generatedAt: '2026-05-25T00:00:00.000Z',
          threadId: 'context-file-thread',
          type: 'codex-session',
        },
        version: 1,
      },
    });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test('parses Codex session ids without creating walkthrough context', () => {
  expect(
    parseCommandLineArguments([
      'codiff',
      '--walkthrough',
      '--codex-session',
      '019e5e57-e7d6-7392-9ad1-ad959319d2fb',
      '/repo',
    ]).launchOptions,
  ).toEqual({
    codexSessionId: '019e5e57-e7d6-7392-9ad1-ad959319d2fb',
    repositoryPathProvided: true,
    walkthrough: true,
  });
});

test('parses pull request markers without resolving the repository remote', () => {
  expect(parseCommandLineArguments(['codiff', 'pr', '12', '/repo'])).toMatchObject({
    launchOptions: {
      repositoryPathProvided: true,
      source: undefined,
      walkthrough: false,
    },
    pullRequestNumber: 12,
    repositoryPath: '/repo',
  });
});

test('parses hash-prefixed pull request marker values', () => {
  expect(parseCommandLineArguments(['codiff', 'pr', '#12', '/repo'])).toMatchObject({
    launchOptions: {
      repositoryPathProvided: true,
      source: undefined,
      walkthrough: false,
    },
    pullRequestNumber: 12,
    repositoryPath: '/repo',
  });
});

test('parses full GitHub pull request URLs as launch sources', () => {
  expect(
    parseCommandLineArguments(['codiff', 'https://github.com/nkzw-tech/codiff/pull/11', '/repo'])
      .launchOptions.source,
  ).toEqual({
    type: 'pull-request',
    url: 'https://github.com/nkzw-tech/codiff/pull/11',
  });
});

test('parses GitHub remotes from ssh and https URLs', () => {
  expect(parseGitHubRemoteUrl('git@github.com:nkzw-tech/codiff.git')).toEqual({
    owner: 'nkzw-tech',
    repo: 'codiff',
  });
  expect(parseGitHubRemoteUrl('https://github.com/nkzw-tech/codiff.git')).toEqual({
    owner: 'nkzw-tech',
    repo: 'codiff',
  });
  expect(parseGitHubRemoteUrl('https://example.com/nkzw-tech/codiff.git')).toBeNull();
});

test('restores the last repository for plain app launches', async () => {
  const lastRepositoryPath = await mkdtemp(join(tmpdir(), 'codiff-last-repo-'));

  try {
    expect(
      getInitialRepositoryPath('/fallback', defaultLaunchOptions, lastRepositoryPath, {}),
    ).toBe(lastRepositoryPath);
  } finally {
    await rm(lastRepositoryPath, { force: true, recursive: true });
  }
});

test('does not restore missing last repositories', () => {
  expect(
    getInitialRepositoryPath('/fallback', defaultLaunchOptions, '/missing/codiff-repo', {}),
  ).toBe('/fallback');
});

test('does not restore over explicit launch intent', async () => {
  const lastRepositoryPath = await mkdtemp(join(tmpdir(), 'codiff-last-repo-'));

  try {
    expect(
      getInitialRepositoryPath(
        '/fallback',
        {
          repositoryPathProvided: true,
          walkthrough: false,
        },
        lastRepositoryPath,
        {},
      ),
    ).toBe('/fallback');
    expect(
      getInitialRepositoryPath(
        '/fallback',
        {
          repositoryPathProvided: false,
          source: {
            ref: 'HEAD',
            type: 'commit',
          },
          walkthrough: false,
        },
        lastRepositoryPath,
        {},
      ),
    ).toBe('/fallback');
    expect(
      getInitialRepositoryPath(
        '/fallback',
        {
          repositoryPathProvided: false,
          walkthrough: true,
        },
        lastRepositoryPath,
        {},
      ),
    ).toBe('/fallback');
    expect(
      getInitialRepositoryPath('/fallback', defaultLaunchOptions, lastRepositoryPath, {
        CODIFF_REPOSITORY_PATH: '/explicit',
      }),
    ).toBe('/fallback');
  } finally {
    await rm(lastRepositoryPath, { force: true, recursive: true });
  }
});
