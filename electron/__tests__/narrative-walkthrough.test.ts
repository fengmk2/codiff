import { createRequire } from 'node:module';
import { expect, test } from 'vite-plus/test';

const require = createRequire(import.meta.url);
const {
  buildNarrativeWalkthroughPrompt,
  narrativeWalkthroughResponseSchema,
  narrativeWalkthroughSchema,
  normalizeNarrativeWalkthrough,
} = require('../narrative-walkthrough.cjs') as {
  buildNarrativeWalkthroughPrompt: (state: any, context?: unknown, agentLabel?: string) => string;
  narrativeWalkthroughResponseSchema: {
    properties: Record<string, any>;
    required: ReadonlyArray<string>;
    type: string;
  };
  narrativeWalkthroughSchema: { type: string; required: ReadonlyArray<string> };
  normalizeNarrativeWalkthrough: (
    input: unknown,
    files: ReadonlyArray<{
      oldPath?: string;
      path: string;
      sections: ReadonlyArray<{ id: string; kind: string }>;
      status: string;
    }>,
  ) => any;
};

const files = [
  {
    path: 'src/App.tsx',
    sections: [{ id: 'src/App.tsx:staged', kind: 'staged' }],
    status: 'modified',
  },
  {
    path: 'src/__tests__/hunkNavigation.test.ts',
    sections: [{ id: 'src/__tests__/hunkNavigation.test.ts:staged', kind: 'staged' }],
    status: 'added',
  },
  {
    path: 'pnpm-lock.yaml',
    sections: [{ id: 'pnpm-lock.yaml:staged', kind: 'staged' }],
    status: 'modified',
  },
];

const baseInput = () => ({
  agent: 'claude',
  defaultOrder: 'keys',
  focus: 'A one-line ordering bug let j/k skip collapsed files.',
  generatedAt: '2026-06-05T00:00:00.000Z',
  kind: 'narrative',
  orders: [
    {
      id: 'keys',
      label: 'Key changes first',
      phases: [{ blurb: 'Where it breaks.', icon: 'bug', id: 'bug', title: 'The bug' }],
      rest: [{ note: 'Regenerated.', reason: 'Lockfile', segmentId: 'lock' }],
      restBlurb: 'Skim only.',
      restLabel: 'Not in the arc',
      sequence: [
        {
          importance: 'critical',
          phaseId: 'bug',
          prose: 'The root cause line.',
          segmentId: 's1',
        },
        {
          importance: 'normal',
          phaseId: 'bug',
          prose: 'The regression test.',
          segmentId: 's6',
        },
      ],
      tagline: 'Cause leads.',
    },
  ],
  repo: { branch: 'fix/hunk-nav', root: '/repo' },
  segments: [
    {
      added: 1,
      anchor: {
        display: 'src/App.tsx:311',
        sectionId: 'src/App.tsx:staged',
        side: 'both',
        startLine: 311,
      },
      deleted: 1,
      granularity: 'line',
      id: 's1',
      path: 'src/App.tsx',
      status: 'modified',
    },
    {
      added: 14,
      anchor: { display: 'hunkNavigation.test.ts (new)' },
      deleted: 0,
      granularity: 'file',
      id: 's6',
      path: 'src/__tests__/hunkNavigation.test.ts',
      status: 'added',
    },
    {
      added: 312,
      anchor: { display: 'pnpm-lock.yaml' },
      deleted: 180,
      granularity: 'file',
      id: 'lock',
      path: 'pnpm-lock.yaml',
      status: 'modified',
    },
  ],
  source: { type: 'working-tree' },
  title: 'Hunk navigation skips collapsed files',
  version: 2,
});

test('exposes a schema requiring the core narrative fields', () => {
  expect(narrativeWalkthroughSchema.type).toBe('object');
  expect(narrativeWalkthroughSchema.required).toContain('segments');
  expect(narrativeWalkthroughSchema.required).toContain('orders');
  expect(narrativeWalkthroughSchema.required).toContain('defaultOrder');
});

test('derives an OpenAI strict-compatible response schema', () => {
  expect(narrativeWalkthroughResponseSchema.required).toEqual(
    Object.keys(narrativeWalkthroughResponseSchema.properties),
  );
  expect(narrativeWalkthroughResponseSchema.properties.context).toBeUndefined();
  expect(narrativeWalkthroughResponseSchema.properties.source).toBeUndefined();
  expect(narrativeWalkthroughResponseSchema.required).not.toContain('context');
  expect(narrativeWalkthroughResponseSchema.required).not.toContain('source');
  expect(narrativeWalkthroughResponseSchema.properties.commit.required).toEqual(['body', 'title']);
  expect(narrativeWalkthroughResponseSchema.properties.commit.type).toContain('null');
  expect(
    narrativeWalkthroughResponseSchema.properties.orders.items.properties.phases.maxItems,
  ).toBe(6);
  expect(
    narrativeWalkthroughResponseSchema.properties.orders.items.properties.phases.items.properties
      .title.maxLength,
  ).toBe(16);
  expect(
    narrativeWalkthroughResponseSchema.properties.orders.items.properties.sequence.maxItems,
  ).toBe(14);
  expect(
    narrativeWalkthroughResponseSchema.properties.orders.items.properties.sequence.items.properties
      .relatedSegmentIds.type,
  ).toContain('null');
  expect(
    narrativeWalkthroughResponseSchema.properties.orders.items.properties.sequence.items.properties
      .relatedSegmentIds.maxItems,
  ).toBe(8);
  expect(
    narrativeWalkthroughResponseSchema.properties.segments.items.properties.anchor.required,
  ).toEqual(
    Object.keys(
      narrativeWalkthroughResponseSchema.properties.segments.items.properties.anchor.properties,
    ),
  );
});

test('prompts generated walkthroughs to stay grouped instead of file-per-stop', () => {
  const prompt = buildNarrativeWalkthroughPrompt({
    branch: 'main',
    files: Array.from({ length: 28 }, (_, index) => ({
      path: `file-${index}.ts`,
      sections: [],
      status: 'modified',
    })),
    generatedAt: 1,
    root: '/repo',
    source: { type: 'working-tree' },
  });

  expect(prompt).toContain('digest has 28 files');
  expect(prompt).toContain('Target 7-12 main-path stops');
  expect(prompt).toContain('Coverage contract');
  expect(prompt).toContain('Create exactly one segment for every file');
  expect(prompt).toContain('Phase titles render in a compact top bar');
  expect(prompt).toContain('Do not create one stop per file');
  expect(prompt).toContain('use relatedSegmentIds for up to 8 files');
  expect(prompt).toContain('Sequence + relatedSegmentIds + rest');
  expect(prompt).toContain('include commit.title and commit.body by default');
});

test('normalizes a well-formed narrative walkthrough', () => {
  const result = normalizeNarrativeWalkthrough(baseInput(), files);

  expect(result.version).toBe(2);
  expect(result.kind).toBe('narrative');
  expect(result.segments).toHaveLength(3);
  expect(result.orders).toHaveLength(1);
  expect(result.defaultOrder).toBe('keys');
  expect(result.orders[0].sequence.map((stop: any) => stop.segmentId)).toEqual(['s1', 's6']);
  expect(result.orders[0].rest[0].segmentId).toBe('lock');
  // The 'file' granularity segment drops its line range.
  expect(result.segments[1].anchor.startLine).toBeUndefined();
});

test('drops stops and rest items that reference unknown segments', () => {
  const input = baseInput();
  input.orders[0].sequence.push({
    importance: 'normal',
    phaseId: 'bug',
    prose: 'Ghost.',
    segmentId: 'does-not-exist',
  });
  input.orders[0].rest.push({ note: '', reason: 'Generated', segmentId: 'also-missing' });

  const result = normalizeNarrativeWalkthrough(input, files);

  expect(result.orders[0].sequence.map((stop: any) => stop.segmentId)).toEqual(['s1', 's6']);
  expect(result.orders[0].rest.map((item: any) => item.segmentId)).toEqual(['lock']);
});

test('adds unreferenced segments to rest so changed files remain visible', () => {
  const input = baseInput();
  input.orders[0].rest = [];

  const result = normalizeNarrativeWalkthrough(input, files);

  expect(result.orders[0].sequence.map((stop: any) => stop.segmentId)).toEqual(['s1', 's6']);
  expect(result.orders[0].rest.map((item: any) => item.segmentId)).toEqual(['lock']);
  expect(result.orders[0].rest[0].reason).toBe('Other changes');
});

test('normalizes related segments under the same stop and keeps them out of rest', () => {
  const input = baseInput();
  input.orders[0].sequence = [
    {
      importance: 'critical',
      phaseId: 'bug',
      prose: 'The root cause and proof are one review idea.',
      relatedSegmentIds: ['s6', 'missing', 's1'],
      segmentId: 's1',
    },
  ];
  input.orders[0].rest.push({
    note: 'Should not duplicate.',
    reason: 'Duplicate',
    segmentId: 's6',
  });

  const result = normalizeNarrativeWalkthrough(input, files);

  expect(result.orders[0].sequence).toHaveLength(1);
  expect(result.orders[0].sequence[0].relatedSegmentIds).toEqual(['s6']);
  expect(result.orders[0].rest.map((item: any) => item.segmentId)).toEqual(['lock']);
});

test('drops segments whose path is not in the current diff', () => {
  const input = baseInput();
  input.segments.push({
    added: 1,
    anchor: { display: 'gone.ts' },
    deleted: 0,
    granularity: 'file',
    id: 'stale',
    path: 'src/removed.ts',
    status: 'modified',
  });
  input.orders[0].sequence.push({
    importance: 'normal',
    phaseId: 'bug',
    prose: 'Points at a stale file.',
    segmentId: 'stale',
  });

  const result = normalizeNarrativeWalkthrough(input, files);

  expect(result.segments.find((segment: any) => segment.id === 'stale')).toBeUndefined();
  expect(result.orders[0].sequence.map((stop: any) => stop.segmentId)).toEqual(['s1', 's6']);
});

test('repairs a missing or stale anchor sectionId against the live diff', () => {
  const input = baseInput();
  input.segments[0].anchor.sectionId = 'src/App.tsx:unstaged'; // stale — only :staged exists
  delete (input.segments[1].anchor as any).sectionId; // missing

  const result = normalizeNarrativeWalkthrough(input, files);

  expect(result.segments[0].anchor.sectionId).toBe('src/App.tsx:staged');
  expect(result.segments[1].anchor.sectionId).toBe('src/__tests__/hunkNavigation.test.ts:staged');
});

test('falls back to the first order when defaultOrder is unknown', () => {
  const input = baseInput();
  input.defaultOrder = 'results'; // no such order

  const result = normalizeNarrativeWalkthrough(input, files);

  expect(result.defaultOrder).toBe('keys');
});

test('throws when no segments match the diff', () => {
  const input = baseInput();
  input.segments = input.segments.map((segment) => ({ ...segment, path: 'nope.ts' }));

  expect(() => normalizeNarrativeWalkthrough(input, files)).toThrow(/no segments/i);
});

test('keeps only phases that still have stops, renumbered', () => {
  const input = baseInput();
  input.orders[0].phases.push({
    blurb: 'Nothing references this.',
    icon: 'flask',
    id: 'proof',
    title: 'Proof',
  });

  const result = normalizeNarrativeWalkthrough(input, files);

  expect(result.orders[0].phases.map((phase: any) => phase.id)).toEqual(['bug']);
  expect(result.orders[0].phases[0].n).toBe(1);
});

test('preserves embedded conversation context for in-app Q&A', () => {
  const input = baseInput() as any;
  input.context = {
    objective: 'Stop hunk navigation skipping collapsed files.',
    source: { generatedAt: '2026-06-05T00:00:00.000Z', type: 'claude-session' },
    version: 1,
  };

  const result = normalizeNarrativeWalkthrough(input, files);

  expect(result.context.objective).toBe('Stop hunk navigation skipping collapsed files.');
});

test('normalizes per-segment commit tags', () => {
  const input = baseInput() as any;
  input.segments[0].changeType = 'fix';
  input.segments[0].commitNote = 'derive a collapse-independent hunk order';
  input.segments[2].changeType = 'not-a-tag'; // invalid → dropped

  const result = normalizeNarrativeWalkthrough(input, files);

  expect(result.segments[0].changeType).toBe('fix');
  expect(result.segments[0].commitNote).toBe('derive a collapse-independent hunk order');
  expect(result.segments[2].changeType).toBeUndefined();
});

test('keeps the commit composer for a working-tree staging set', () => {
  const input = baseInput() as any;
  input.commit = {
    body: 'Hunk order is now collapse-independent.\n\nNavigation expands a collapsed target before scrolling.',
    title: 'Fix hunk nav',
  };

  const result = normalizeNarrativeWalkthrough(input, files);

  expect(result.commit).toEqual({
    body: 'Hunk order is now collapse-independent.\n\nNavigation expands a collapsed target before scrolling.',
    title: 'Fix hunk nav',
  });
});

test('normalizes legacy commit subjectSeed as title', () => {
  const input = baseInput() as any;
  input.commit = {
    subjectSeed: 'Fix hunk nav',
  };

  const result = normalizeNarrativeWalkthrough(input, files);

  expect(result.commit).toEqual({
    title: 'Fix hunk nav',
  });
});

test('derives a missing commit title from a title-like body first line', () => {
  const input = baseInput() as any;
  input.commit = {
    body: 'Fix hunk nav\n\nNavigation expands a collapsed target before scrolling.',
  };

  const result = normalizeNarrativeWalkthrough(input, files);

  expect(result.commit).toEqual({
    body: 'Navigation expands a collapsed target before scrolling.',
    title: 'Fix hunk nav',
  });
});

test('strips a duplicated commit title from the body', () => {
  const input = baseInput() as any;
  input.commit = {
    body: 'Fix hunk nav\n\nNavigation expands a collapsed target before scrolling.',
    title: 'Fix hunk nav',
  };

  const result = normalizeNarrativeWalkthrough(input, files);

  expect(result.commit).toEqual({
    body: 'Navigation expands a collapsed target before scrolling.',
    title: 'Fix hunk nav',
  });
});

test('adds an empty commit composer for a working-tree walkthrough without commit seeds', () => {
  const input = baseInput() as any;
  delete input.commit;

  const result = normalizeNarrativeWalkthrough(input, files);

  expect(result.commit).toEqual({});
});

test('strips the commit composer when the source is not a working tree', () => {
  const input = baseInput() as any;
  input.commit = { title: 'Fix hunk nav' };
  input.source = { ref: 'abc1234', type: 'commit' };

  const result = normalizeNarrativeWalkthrough(input, files);

  expect(result.commit).toBeUndefined();
});
