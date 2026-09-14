/// <reference types="@cloudflare/vitest-plugin/types" />

import { applyD1Migrations, env } from 'cloudflare:test';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
