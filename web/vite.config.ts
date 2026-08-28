import { resolve } from 'node:path';
import babel from '@rolldown/plugin-babel';
import { reactCompilerPreset } from '@vitejs/plugin-react';
import { voidReact } from '@void/react/plugin';
import { fate } from 'react-fate/vite';
import type { Plugin } from 'vite-plus';
import { defineConfig, lazyPlugins } from 'vite-plus';
import { voidPlugin } from 'void';

const codiffSourceConditions = [
  '@nkzw/codiff-source',
  'module',
  'browser',
  'development|production',
];
const workspacePackages = ['@nkzw/codiff-core', '@nkzw/codiff-service'];

const exportDurableObjects = (): Plugin => ({
  name: 'codiff:export-durable-objects',
  transform(code, id) {
    if (!id.endsWith('virtual:cloudflare/worker-entry')) {
      return;
    }
    return `${code}
export { FateLiveDurableObject } from '@web/src/server/live.ts';
`;
  },
});

export default defineConfig({
  environments: {
    void_worker: {
      optimizeDeps: {
        exclude: ['@nkzw/fate/server', '@nkzw/fate/server/drizzle', 'cf-fate/server'],
      },
    },
  },
  optimizeDeps: { exclude: workspacePackages },
  plugins: [
    ...(lazyPlugins(() => [
      babel({ presets: [reactCompilerPreset()] }),
      voidPlugin({ persistTo: '.wrangler/state' }),
      ...voidReact(),
      exportDurableObjects(),
    ]) ?? []),
    fate({
      module: './src/server/fate.ts',
      transport: 'cloudflare',
    }),
  ],
  resolve: {
    alias: [{ find: '@web', replacement: resolve(__dirname, '.') }],
    conditions: codiffSourceConditions,
    dedupe: ['react', 'react-dom'],
  },
  server: { port: 6002 },
});
