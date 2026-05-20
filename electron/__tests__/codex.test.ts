import { createRequire } from 'node:module';
import { expect, test } from 'vite-plus/test';

const require = createRequire(import.meta.url);
const {
  CODEX_NOT_FOUND_CODE,
  CODEX_NOT_FOUND_MESSAGE,
  DEFAULT_OPENAI_MODEL,
  getCodexCommand,
  getCodexLaunchErrorMessage,
  isOpenAIModelAvailabilityError,
  normalizeOpenAIModel,
} = require('../codex.cjs') as {
  CODEX_NOT_FOUND_CODE: string;
  CODEX_NOT_FOUND_MESSAGE: string;
  DEFAULT_OPENAI_MODEL: string;
  getCodexCommand: () => string;
  getCodexLaunchErrorMessage: (error: unknown, platform?: NodeJS.Platform) => string;
  isOpenAIModelAvailabilityError: (value: string) => boolean;
  normalizeOpenAIModel: (value: unknown) => string;
};

test('normalizes OpenAI model preferences to known models', () => {
  expect(normalizeOpenAIModel('gpt-5.3-codex')).toBe('gpt-5.3-codex');
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
