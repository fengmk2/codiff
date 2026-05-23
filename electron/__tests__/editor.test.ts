import { createRequire } from 'node:module';
import { expect, test } from 'vite-plus/test';

const require = createRequire(import.meta.url);
const { createEditorOpener } = require('../main/editor.cjs') as {
  createEditorOpener: (options: {
    platform?: NodeJS.Platform;
    shell: {
      openPath: (path: string) => Promise<string>;
    };
  }) => {
    getEditorCommands: (absolutePath: string) => Array<{
      args: Array<string>;
      command: string;
    }>;
    parseEditorCommand: (command: string) => Array<string>;
  };
};

test('falls back to the macOS default text editor for text files without app associations', () => {
  const opener = createEditorOpener({
    platform: 'darwin',
    shell: {
      openPath: async () => '',
    },
  });

  expect(opener.getEditorCommands('/Users/test/.codiff/codiff.jsonc')).toContainEqual({
    args: ['-t', '/Users/test/.codiff/codiff.jsonc'],
    command: 'open',
  });
});

test('parses custom editor commands with quoted arguments', () => {
  const opener = createEditorOpener({
    shell: {
      openPath: async () => '',
    },
  });

  expect(opener.parseEditorCommand('editor --goto "{file}"')).toEqual([
    'editor',
    '--goto',
    '{file}',
  ]);
});
