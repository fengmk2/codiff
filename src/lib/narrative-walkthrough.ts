import type {
  ChangedFile,
  DiffSection,
  NarrativeWalkthrough,
  WalkthroughChangeType,
  WalkthroughIcon,
  WalkthroughOrder,
  WalkthroughPhase,
  WalkthroughRestItem,
  WalkthroughSegment,
  WalkthroughStop,
} from '../types.ts';
import { getFirstVisibleSection } from './diff.ts';

export type NarrativeLineCount = {
  added: number;
  deleted: number;
};

/** A stop resolved to its segment and given a global position in the order. */
export type WalkthroughStopView = WalkthroughStop & {
  index: number;
  relatedSegments: ReadonlyArray<WalkthroughSegment>;
  segment: WalkthroughSegment;
};

/** A phase with the stops that belong to it, in order. */
export type WalkthroughPhaseView = WalkthroughPhase & {
  stops: ReadonlyArray<WalkthroughStopView>;
};

/** A "rest" item resolved to its segment. */
export type WalkthroughRestView = WalkthroughRestItem & {
  segment: WalkthroughSegment;
};

/** The "rest" grouped by reason, preserving first-seen order. */
export type WalkthroughRestReason = {
  files: ReadonlyArray<WalkthroughRestView>;
  reason: string;
};

/** Everything a narrative order needs to render, derived from the document. */
export type WalkthroughOrderView = {
  order: WalkthroughOrder;
  phases: ReadonlyArray<WalkthroughPhaseView>;
  rest: ReadonlyArray<WalkthroughRestView>;
  restByReason: ReadonlyArray<WalkthroughRestReason>;
  restTotals: NarrativeLineCount;
  sequence: ReadonlyArray<WalkthroughStopView>;
  totals: NarrativeLineCount;
};

export const getStopSegments = (stop: WalkthroughStopView): ReadonlyArray<WalkthroughSegment> => [
  stop.segment,
  ...stop.relatedSegments,
];

const sumSegments = (segments: ReadonlyArray<WalkthroughSegment>): NarrativeLineCount =>
  segments.reduce(
    (totals, segment) => ({
      added: totals.added + segment.added,
      deleted: totals.deleted + segment.deleted,
    }),
    { added: 0, deleted: 0 },
  );

const sumLineCount = (items: ReadonlyArray<{ segment: WalkthroughSegment }>): NarrativeLineCount =>
  items.reduce(
    (totals, { segment }) => ({
      added: totals.added + segment.added,
      deleted: totals.deleted + segment.deleted,
    }),
    { added: 0, deleted: 0 },
  );

const sumStopLineCount = (stops: ReadonlyArray<WalkthroughStopView>): NarrativeLineCount =>
  sumSegments(stops.flatMap((stop) => getStopSegments(stop)));

export const getStopLineCount = (stop: WalkthroughStopView): NarrativeLineCount =>
  sumSegments(getStopSegments(stop));

export const isWalkthroughCommittable = (walkthrough: NarrativeWalkthrough): boolean =>
  walkthrough.source.type === 'working-tree';

const groupRestByReason = (
  rest: ReadonlyArray<WalkthroughRestView>,
): ReadonlyArray<WalkthroughRestReason> => {
  const groups: Array<{ files: Array<WalkthroughRestView>; reason: string }> = [];
  const byReason = new Map<string, { files: Array<WalkthroughRestView>; reason: string }>();
  for (const item of rest) {
    let group = byReason.get(item.reason);
    if (!group) {
      group = { files: [], reason: item.reason };
      byReason.set(item.reason, group);
      groups.push(group);
    }
    group.files.push(item);
  }
  return groups;
};

/** Resolve the order to render: the requested id, the default, or the first. */
export const resolveOrder = (
  walkthrough: NarrativeWalkthrough,
  orderId?: string | null,
): WalkthroughOrder | null => {
  if (walkthrough.orders.length === 0) {
    return null;
  }
  return (
    walkthrough.orders.find((order) => order.id === orderId) ??
    walkthrough.orders.find((order) => order.id === walkthrough.defaultOrder) ??
    walkthrough.orders[0]
  );
};

/**
 * Build the full view-model for one reading order: stops resolved to their
 * segments and indexed, phases populated with their stops, and "the rest"
 * resolved and grouped by reason. Stops/rest whose segment can't be found are
 * dropped (the normalizer should prevent this, but the UI stays defensive).
 */
export const buildOrderView = (
  walkthrough: NarrativeWalkthrough,
  orderId?: string | null,
): WalkthroughOrderView | null => {
  const order = resolveOrder(walkthrough, orderId);
  if (!order) {
    return null;
  }

  const segmentsById = new Map(walkthrough.segments.map((segment) => [segment.id, segment]));

  const sequence: Array<WalkthroughStopView> = [];
  for (const stop of order.sequence) {
    const segment = segmentsById.get(stop.segmentId);
    if (segment) {
      const relatedSegments: Array<WalkthroughSegment> = [];
      for (const segmentId of stop.relatedSegmentIds ?? []) {
        const relatedSegment = segmentsById.get(segmentId);
        if (relatedSegment) {
          relatedSegments.push(relatedSegment);
        }
      }
      sequence.push({ ...stop, index: sequence.length, relatedSegments, segment });
    }
  }

  const phases: Array<WalkthroughPhaseView> = order.phases
    .map((phase, phaseIndex) => ({
      ...phase,
      phaseIndex,
      stops: sequence.filter((stop) => stop.phaseId === phase.id),
    }))
    .sort((a, b) => {
      const aIndex = a.stops[0]?.index ?? Number.MAX_SAFE_INTEGER;
      const bIndex = b.stops[0]?.index ?? Number.MAX_SAFE_INTEGER;
      return aIndex === bIndex ? a.phaseIndex - b.phaseIndex : aIndex - bIndex;
    })
    .map(({ phaseIndex, ...phase }) => phase);

  const rest: Array<WalkthroughRestView> = [];
  for (const item of order.rest) {
    const segment = segmentsById.get(item.segmentId);
    if (segment) {
      rest.push({ ...item, segment });
    }
  }

  return {
    order,
    phases,
    rest,
    restByReason: groupRestByReason(rest),
    restTotals: sumLineCount(rest),
    sequence,
    totals: sumStopLineCount(sequence),
  };
};

/** The changed file + diff section a segment anchors into, if present in the diff. */
export type ResolvedSegmentFile = {
  file: ChangedFile;
  section: DiffSection;
};

/**
 * Resolve a segment to its live `ChangedFile` and `DiffSection`. Prefers the
 * anchor's `sectionId`, then falls back to the file's first visible section.
 */
export const resolveSegmentFile = (
  segment: WalkthroughSegment,
  files: ReadonlyArray<ChangedFile>,
  showWhitespace: boolean,
): ResolvedSegmentFile | null => {
  const file = files.find((candidate) => candidate.path === segment.path);
  if (!file) {
    return null;
  }

  const section =
    (segment.anchor.sectionId
      ? file.sections.find((candidate) => candidate.id === segment.anchor.sectionId)
      : undefined) ?? getFirstVisibleSection(file, showWhitespace);
  if (!section) {
    return null;
  }

  return { file, section };
};

/* ------------------------------------------------------------------------- *
 * Commit composer model
 *
 * The walkthrough's stops + "the rest" ARE the staged changeset. When the
 * document is committable, these helpers collapse that into one list of unique
 * changed files that reuses the narrative context two ways: files keep their
 * walkthrough section (the order's phases, plus "the rest" as a final group),
 * and each carries an optional change-type tag. The body generator reads the
 * current file selection and rewrites the machine-drafted commit body live.
 * ------------------------------------------------------------------------- */

/** One unique changed file in the commit composer, with summed line counts. */
export type CommitFile = {
  added: number;
  changeType?: WalkthroughChangeType;
  deleted: number;
  name: string;
  /** The note the generated body uses for this file. */
  note?: string;
  path: string;
  segmentId: string;
};

/** A group of files in the composer — one per phase, plus a final "rest" group. */
export type CommitGroup = {
  files: ReadonlyArray<CommitFile>;
  icon: WalkthroughIcon;
  id: string;
  isRest: boolean;
  title: string;
};

export type CommitModel = {
  /** Every unique file, in group order. */
  files: ReadonlyArray<CommitFile>;
  groups: ReadonlyArray<CommitGroup>;
};

export const changeTypeLabel: Record<WalkthroughChangeType, string> = {
  docs: 'Docs',
  feature: 'Feature',
  fix: 'Bug fix',
  generated: 'Generated',
  i18n: 'i18n',
  lockfile: 'Lockfile',
  refactor: 'Refactor',
  snapshot: 'Snapshot',
  test: 'Test',
};

const fileBaseName = (path: string) => path.split('/').pop() ?? path;

const countPatchLines = (patch: string): NarrativeLineCount => {
  let added = 0;
  let deleted = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) {
      continue;
    }
    if (line.startsWith('+')) {
      added += 1;
    } else if (line.startsWith('-')) {
      deleted += 1;
    }
  }

  return { added, deleted };
};

const getChangedFileLineCount = (file: ChangedFile): NarrativeLineCount =>
  file.sections.reduce(
    (totals, section) => {
      const count = countPatchLines(section.patch || '');
      return {
        added: totals.added + count.added,
        deleted: totals.deleted + count.deleted,
      };
    },
    { added: 0, deleted: 0 },
  );

export const buildGenericCommitModel = (changedFiles: ReadonlyArray<ChangedFile>): CommitModel => {
  const files = changedFiles.map((changedFile) => {
    const totals = getChangedFileLineCount(changedFile);
    return {
      added: totals.added,
      deleted: totals.deleted,
      name: fileBaseName(changedFile.path),
      path: changedFile.path,
      segmentId: `__file:${changedFile.path}`,
    };
  });

  return {
    files,
    groups:
      files.length > 0
        ? [
            {
              files,
              icon: 'path',
              id: '__changed',
              isRest: false,
              title: 'Changed files',
            },
          ]
        : [],
  };
};

/**
 * Collapse one order's view into the unique changed files, grouped by phase with
 * "the rest" as a final group. Line counts are summed across every segment that
 * shares a path, and a path is placed in the first group that mentions it.
 */
export const buildCommitModel = (
  orderView: WalkthroughOrderView,
  changedFiles: ReadonlyArray<ChangedFile> = [],
): CommitModel => {
  const totalsByPath = new Map<string, NarrativeLineCount>();
  const addTotals = (segment: WalkthroughSegment) => {
    const current = totalsByPath.get(segment.path) ?? { added: 0, deleted: 0 };
    totalsByPath.set(segment.path, {
      added: current.added + segment.added,
      deleted: current.deleted + segment.deleted,
    });
  };
  for (const stop of orderView.sequence) {
    for (const segment of getStopSegments(stop)) {
      addTotals(segment);
    }
  }
  for (const item of orderView.rest) {
    addTotals(item.segment);
  }

  const seen = new Set<string>();
  const toFile = (segment: WalkthroughSegment): CommitFile => {
    const totals = totalsByPath.get(segment.path) ?? {
      added: segment.added,
      deleted: segment.deleted,
    };
    return {
      added: totals.added,
      changeType: segment.changeType,
      deleted: totals.deleted,
      name: fileBaseName(segment.path),
      note: segment.commitNote ?? segment.summary,
      path: segment.path,
      segmentId: segment.id,
    };
  };

  const files: Array<CommitFile> = [];
  const groups: Array<CommitGroup> = [];

  for (const phase of orderView.phases) {
    const phaseFiles: Array<CommitFile> = [];
    for (const stop of phase.stops) {
      for (const segment of getStopSegments(stop)) {
        if (seen.has(segment.path)) {
          continue;
        }
        seen.add(segment.path);
        const file = toFile(segment);
        phaseFiles.push(file);
        files.push(file);
      }
    }
    if (phaseFiles.length > 0) {
      groups.push({
        files: phaseFiles,
        icon: phase.icon,
        id: phase.id,
        isRest: false,
        title: phase.title,
      });
    }
  }

  const restFiles: Array<CommitFile> = [];
  for (const item of orderView.rest) {
    if (seen.has(item.segment.path)) {
      continue;
    }
    seen.add(item.segment.path);
    const file = toFile(item.segment);
    restFiles.push(file);
    files.push(file);
  }
  if (restFiles.length > 0) {
    groups.push({
      files: restFiles,
      icon: 'path',
      id: '__rest',
      isRest: true,
      title: orderView.order.restLabel,
    });
  }

  const missingFiles: Array<CommitFile> = [];
  for (const changedFile of changedFiles) {
    if (seen.has(changedFile.path)) {
      continue;
    }
    seen.add(changedFile.path);
    const totals = getChangedFileLineCount(changedFile);
    const file = {
      added: totals.added,
      deleted: totals.deleted,
      name: fileBaseName(changedFile.path),
      note: 'Not included in the generated walkthrough.',
      path: changedFile.path,
      segmentId: `__file:${changedFile.path}`,
    };
    missingFiles.push(file);
    files.push(file);
  }
  if (missingFiles.length > 0) {
    groups.push({
      files: missingFiles,
      icon: 'path',
      id: '__missing',
      isRest: true,
      title: 'Other changes',
    });
  }

  return { files, groups };
};

export const granularityLabel: Record<WalkthroughSegment['granularity'], string> = {
  file: 'whole file',
  hunk: 'hunk',
  line: 'line',
};

export const importanceLabel: Record<WalkthroughStop['importance'], string> = {
  context: 'Context',
  critical: 'Critical',
  normal: 'Review',
};
