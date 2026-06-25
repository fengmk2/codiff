/**
 * @vitest-environment jsdom
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { expect, test, vi } from 'vite-plus/test';
import { PlanCommentCard } from '../app/components/PlanEditorView.tsx';
import { SharedPlanApp } from '../SharedPlanApp.tsx';
import type { PlanCommentThread, SharedPlanSnapshot } from '../types.ts';
import { waitFor } from './helpers/react.tsx';

const reactActEnvironment = globalThis as typeof globalThis & {
  ResizeObserver?: typeof ResizeObserver;
};
reactActEnvironment.ResizeObserver ??= class ResizeObserver {
  disconnect() {}
  observe() {}
  unobserve() {}
};
HTMLElement.prototype.scrollIntoView ??= function scrollIntoView() {};
HTMLElement.prototype.scrollTo ??= function scrollTo() {};

test('read-only comments can reveal attached targets', async () => {
  const thread = {
    anchor: {
      block: {
        fingerprint: 'heading-fingerprint',
        path: [0],
        text: 'Ship plan sharing',
        type: 'heading',
      },
      kind: 'block',
      version: 1,
    },
    createdAt: '2026-06-25T00:00:00.000Z',
    createdBy: { id: 'reviewer', name: 'Reviewer' },
    id: 'thread-1',
    messages: [
      {
        author: { id: 'reviewer', name: 'Reviewer' },
        body: 'Review this target.',
        createdAt: '2026-06-25T00:00:00.000Z',
        id: 'message-1',
        updatedAt: '2026-06-25T00:00:00.000Z',
      },
    ],
    status: 'open',
    updatedAt: '2026-06-25T00:00:00.000Z',
  } satisfies PlanCommentThread;
  const onReveal = vi.fn();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        <PlanCommentCard
          active={false}
          detached={false}
          identity={null}
          onActivate={() => {}}
          onBodyChange={() => {}}
          onDelete={() => {}}
          onEmptyBlur={() => {}}
          onHeightChange={() => {}}
          onReveal={onReveal}
          readOnly
          showDelete={false}
          thread={thread}
        />,
      );
    });

    const target = container.querySelector<HTMLButtonElement>('.plan-comment-target');
    expect(target?.disabled).toBe(false);
    await act(async () => target?.click());
    expect(onReveal).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

test('shared plans render Markdown and comments read-only', async () => {
  const snapshot = {
    codiffVersion: '1.4.7',
    document: {
      content: '# Ship plan sharing\n\n- Keep walkthroughs stable\n',
      name: 'plan.md',
      title: 'Ship plan sharing',
    },
    exportedAt: '2026-06-25T00:00:00.000Z',
    kind: 'codiff-plan-share',
    preferences: {
      theme: 'system',
    },
    review: {
      threads: [
        {
          anchor: {
            block: {
              fingerprint: 'heading-fingerprint',
              path: [0],
              text: 'Ship plan sharing',
              type: 'heading',
            },
            kind: 'block',
            version: 1,
          },
          createdAt: '2026-06-25T00:00:00.000Z',
          createdBy: {
            email: 'reviewer@example.com',
            id: 'reviewer@example.com',
            name: 'Reviewer',
          },
          id: 'thread-1',
          messages: [
            {
              author: {
                email: 'reviewer@example.com',
                id: 'reviewer@example.com',
                name: 'Reviewer',
              },
              body: 'Do not regress walkthrough sharing.',
              createdAt: '2026-06-25T00:00:00.000Z',
              id: 'message-1',
              updatedAt: '2026-06-25T00:00:00.000Z',
            },
          ],
          status: 'open',
          updatedAt: '2026-06-25T00:00:00.000Z',
        },
      ],
      version: 1,
    },
    source: {
      agent: 'codex',
      sessionId: 'thread-id',
    },
    version: 1,
  } satisfies SharedPlanSnapshot;

  const container = document.createElement('div');
  document.body.append(container);
  let root: Root | null = null;

  try {
    await act(async () => {
      root = createRoot(container);
      root.render(<SharedPlanApp snapshot={snapshot} />);
    });

    await waitFor(() => {
      expect(container.querySelector('.mdx-editor-content h1')?.textContent).toBe(
        'Ship plan sharing',
      );
      expect(container.querySelector('.plan-comment-thread')?.textContent).toContain(
        'Do not regress walkthrough sharing.',
      );
    });

    expect(container.querySelector('.plan-title')?.textContent).toBe('Ship plan sharing');
    expect(container.querySelector('.codiff-file-path')?.textContent).toBe('plan.md');
    expect(
      [...container.querySelectorAll<HTMLElement>('[contenteditable]')].every(
        (element) => element.getAttribute('contenteditable') === 'false',
      ),
    ).toBe(true);
    expect(container.querySelector('.review-comment-delete')).toBeNull();
    expect(container.querySelector('.plan-comment-affordance')).toBeNull();
  } finally {
    if (root) {
      await act(async () => root?.unmount());
    }
    container.remove();
  }
});

test('shared plans do not render active HTML from documents or comments', async () => {
  const snapshot = {
    codiffVersion: '1.4.7',
    document: {
      content:
        '# Safe plan\n\n<button onclick="document.body.dataset.probe = \'active\'">Run</button>\n\n<iframe src="https://example.com"></iframe>\n',
      name: 'plan.md',
      title: 'Safe plan',
    },
    exportedAt: '2026-06-25T00:00:00.000Z',
    kind: 'codiff-plan-share',
    preferences: { theme: 'system' },
    review: {
      threads: [
        {
          anchor: {
            block: {
              fingerprint: 'heading-fingerprint',
              path: [0],
              text: 'Safe plan',
              type: 'heading',
            },
            kind: 'block',
            version: 1,
          },
          createdAt: '2026-06-25T00:00:00.000Z',
          createdBy: { id: 'reviewer', name: 'Reviewer' },
          id: 'thread-1',
          messages: [
            {
              author: { id: 'reviewer', name: 'Reviewer' },
              body: '<img src=x onerror="document.body.dataset.probe = \'active\'">',
              createdAt: '2026-06-25T00:00:00.000Z',
              id: 'message-1',
              updatedAt: '2026-06-25T00:00:00.000Z',
            },
          ],
          status: 'open',
          updatedAt: '2026-06-25T00:00:00.000Z',
        },
      ],
      version: 1,
    },
    version: 1,
  } satisfies SharedPlanSnapshot;

  const container = document.createElement('div');
  document.body.append(container);
  let root: Root | null = null;

  try {
    await act(async () => {
      root = createRoot(container);
      root.render(<SharedPlanApp snapshot={snapshot} />);
    });

    await waitFor(() => {
      expect(container.querySelector('.mdx-editor-content h1')?.textContent).toBe('Safe plan');
    });
    expect(container.querySelector('button[onclick]')).toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('img[onerror]')).toBeNull();
  } finally {
    if (root) {
      await act(async () => root?.unmount());
    }
    container.remove();
  }
});
