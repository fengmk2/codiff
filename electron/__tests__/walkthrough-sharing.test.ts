import { createRequire } from 'node:module';
import { expect, test } from 'vite-plus/test';

const require = createRequire(import.meta.url);
const { resolvePlanShareTarget, resolveWalkthroughShareTarget } =
  require('../walkthrough-sharing.cjs') as {
    resolvePlanShareTarget: (options: { overrideUrl?: string }) => {
      authenticated: boolean;
      internal: boolean;
      serviceUrl: string;
    };
    resolveWalkthroughShareTarget: (options: {
      email?: string;
      overrideUrl?: string;
      username?: string;
    }) => {
      authenticated: boolean;
      internal: boolean;
      serviceUrl: string;
    } | null;
  };

test('routes plan shares to the authenticated service without Git identity', () => {
  expect(resolvePlanShareTarget({})).toEqual({
    authenticated: true,
    internal: true,
    serviceUrl: 'https://codiff.cloudflare.dev',
  });
  expect(resolvePlanShareTarget({ overrideUrl: 'http://localhost:6001/' })).toEqual({
    authenticated: false,
    internal: true,
    serviceUrl: 'http://localhost:6001',
  });
});

test('routes Cloudflare git identities to the authenticated internal service', () => {
  expect(
    resolveWalkthroughShareTarget({
      email: 'Ada@Cloudflare.com ',
      username: 'ada',
    }),
  ).toEqual({
    authenticated: true,
    internal: true,
    serviceUrl: 'https://codiff.cloudflare.dev',
  });
});

test('routes cpojer to the existing public service', () => {
  expect(
    resolveWalkthroughShareTarget({
      email: 'cpojer@example.com',
      username: 'cpojer',
    }),
  ).toEqual({
    authenticated: false,
    internal: false,
    serviceUrl: 'https://api.codiff.dev',
  });
});

test('keeps explicit development servers unauthenticated', () => {
  expect(
    resolveWalkthroughShareTarget({
      email: 'ada@cloudflare.com',
      overrideUrl: 'http://localhost:6001/',
      username: 'ada',
    }),
  ).toEqual({
    authenticated: false,
    internal: true,
    serviceUrl: 'http://localhost:6001',
  });
});

test('does not expose sharing to other users', () => {
  expect(
    resolveWalkthroughShareTarget({
      email: 'ada@example.com',
      username: 'ada',
    }),
  ).toBeNull();
});
