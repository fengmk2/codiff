import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      main: '../web/dist/ssr/index.js',
      miniflare: {
        bindings: {
          AUTH_GITHUB_CLIENT_ID: 'test-github-client-id',
          AUTH_GITHUB_CLIENT_SECRET: 'test-github-client-secret',
          BETTER_AUTH_SECRET: 'test-better-auth-secret-at-least-32-characters',
          PUBLIC_ORIGIN: 'https://test.codiff.local',
          TEST_MIGRATIONS: await readD1Migrations(
            fileURLToPath(new URL('../web/db/migrations', import.meta.url)),
          ),
        },
        d1Databases: ['DB'],
        r2Buckets: ['WALKTHROUGH_BUCKET'],
      },
      remoteBindings: false,
      wrangler: {
        configPath: '../web/wrangler.jsonc',
      },
    })),
  ],
  test: {
    // Vitest v4 compatibility: preserve mock call history.
    // Remove after tests no longer rely on calls from setup or earlier tests.
    // https://vitest.dev/guide/migration/#clearmocks-is-enabled-by-default
    clearMocks: false,
    include: ['**/*.integration.ts'],
    setupFiles: ['./setup.cloudflare.ts'],
  },
});
