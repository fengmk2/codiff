import { useCallback, useEffect, useMemo, useState } from 'react';
import { ReviewCodeView, type ReviewDiffBlock } from './app/components/ReviewCodeView.tsx';
import { NarrativeSidebar } from './app/components/walkthrough/NarrativeSidebar.tsx';
import {
  NarrativeWalkthroughView,
  type WalkthroughBlockScrollTarget,
} from './app/components/walkthrough/NarrativeWalkthroughView.tsx';
import { useNarrativeNavigation } from './app/components/walkthrough/useNarrativeNavigation.ts';
import { createDefaultConfig } from './config/defaults.ts';
import { getAgentLabel } from './lib/app-constants.ts';
import type { ReviewComment } from './lib/app-types.ts';
import { compactPath } from './lib/files.ts';
import { getReviewCommentsFromState } from './lib/review-comments.ts';
import { getSourceLabel, getSourceKey } from './lib/source.ts';
import type {
  ChangedFile,
  PullRequestExistingReviewComment,
  RepositoryState,
  SharedWalkthroughSnapshot,
  WalkthroughCommitMessageResult,
  WalkthroughCommitResult,
} from './types.ts';

const emptyReviewComments: ReadonlyArray<ReviewComment> = [];
const emptyWalkthroughNotes = new Map();
const walkthroughCodeViewBottomInset = 96;
const CODE_FONT_SIZE_DEFAULT = 13;

const getCodeFontLineHeight = (size: number) => Math.round((size * 20) / 13);

const normalizeCodeFontSizePreference = (size: number) =>
  Number.isFinite(size) ? Math.min(32, Math.max(10, Math.round(size))) : CODE_FONT_SIZE_DEFAULT;

const getSnapshotReviewComments = (
  snapshot: SharedWalkthroughSnapshot,
): ReadonlyArray<ReviewComment> => {
  if (!snapshot.reviewComments?.length) {
    return emptyReviewComments;
  }

  return getReviewCommentsFromState({
    branch: snapshot.branch,
    files: snapshot.files,
    generatedAt: Date.parse(snapshot.exportedAt) || Date.now(),
    launchPath: snapshot.repository.root,
    reviewComments: snapshot.reviewComments as ReadonlyArray<PullRequestExistingReviewComment>,
    root: snapshot.repository.root,
    source: snapshot.repository.source,
  } satisfies RepositoryState);
};

const noop = () => {};

const disabledCommit = async (): Promise<WalkthroughCommitResult> => ({
  reason: 'Shared walkthroughs are read-only.',
  status: 'failed',
});

const disabledCommitMessage = async (): Promise<WalkthroughCommitMessageResult> => ({
  reason: 'Shared walkthroughs are read-only.',
  status: 'unavailable',
});

export function SharedWalkthroughApp({ snapshot }: { snapshot: SharedWalkthroughSnapshot }) {
  const sharedWalkthrough = useMemo(
    () => ({
      ...snapshot.walkthrough,
      commit: undefined,
    }),
    [snapshot.walkthrough],
  );
  const navigation = useNarrativeNavigation(
    sharedWalkthrough,
    snapshot.files,
    `${snapshot.repository.root}:${getSourceKey(snapshot.repository.source)}`,
  );
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [itemVersionByKey, setItemVersionByKey] = useState<Record<string, number>>({});
  const reviewComments = useMemo(() => getSnapshotReviewComments(snapshot), [snapshot]);

  useEffect(() => {
    const root = document.documentElement;
    if (snapshot.preferences.theme === 'system') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', snapshot.preferences.theme);
    }
  }, [snapshot.preferences.theme]);

  useEffect(() => {
    const root = document.documentElement;
    const codeFontFamily = snapshot.preferences.codeFontFamily.trim();
    const codeFontSize = normalizeCodeFontSizePreference(snapshot.preferences.codeFontSize);

    if (codeFontFamily) {
      root.style.setProperty('--font-diff-mono', `${JSON.stringify(codeFontFamily)}, monospace`);
    }

    root.style.setProperty('--font-diff-size', `${codeFontSize}px`);
    root.style.setProperty('--font-diff-line-height', `${getCodeFontLineHeight(codeFontSize)}px`);
  }, [snapshot.preferences.codeFontFamily, snapshot.preferences.codeFontSize]);

  const bumpItemVersion = useCallback((key: string) => {
    setItemVersionByKey((current) => ({
      ...current,
      [key]: (current[key] ?? 0) + 1,
    }));
  }, []);

  const toggleCollapsed = useCallback(
    (_file: ChangedFile, isCollapsed: boolean, reviewKey: string) => {
      setCollapsed((current) => {
        const next = new Set(current);
        if (isCollapsed) {
          next.delete(reviewKey);
        } else {
          next.add(reviewKey);
        }
        return next;
      });
      bumpItemVersion(reviewKey);
    },
    [bumpItemVersion],
  );

  const diffLineHeight = getCodeFontLineHeight(
    normalizeCodeFontSizePreference(snapshot.preferences.codeFontSize),
  );
  const commonReviewProps = {
    activeSearchMatch: null,
    agentId: snapshot.walkthrough.agent,
    agentLabel: getAgentLabel(snapshot.walkthrough.agent),
    collapsed,
    comments: reviewComments,
    commitMetadata: null,
    diffLineHeight,
    diffStyle: snapshot.preferences.diffStyle,
    disableWorkerPool: true,
    focusCommentId: null,
    focusCommentRequest: 0,
    gitIdentity: null,
    hunkNavigation: null,
    isPullRequest: snapshot.repository.source.type === 'pull-request',
    isReadOnly: true,
    itemVersionByKey,
    keymap: createDefaultConfig().keymap,
    loadingSectionIds: new Set<string>(),
    onAskCodex: noop,
    onCreateComment: noop,
    onDeleteComment: noop,
    onLoadSection: noop,
    onOpenFile: noop,
    onSelectPathFromScroll: noop,
    onSubmitComment: noop,
    onToggleCollapsed: toggleCollapsed,
    onToggleViewed: noop,
    onUpdateComment: noop,
    searchQuery: '',
    showWhitespace: snapshot.preferences.showWhitespace,
    source: snapshot.repository.source,
    viewed: {},
    wordWrap: snapshot.preferences.wordWrap,
  };

  const renderWalkthroughDiffBlocks = (
    blocks: ReadonlyArray<ReviewDiffBlock>,
    blockScrollTarget: WalkthroughBlockScrollTarget | null,
    onActiveBlockChange: (blockId: string) => void,
  ) => (
    <div className="wt-stop wt-diff-surface">
      <ReviewCodeView
        {...commonReviewProps}
        blocks={blocks}
        bottomInset={walkthroughCodeViewBottomInset}
        files={[]}
        forceExpandedPaths={new Set()}
        onActiveBlockChange={onActiveBlockChange}
        scrollTarget={blockScrollTarget}
        selectedPath={null}
        walkthroughNotes={emptyWalkthroughNotes}
      />
    </div>
  );

  const sourceLabel =
    snapshot.repository.source.type === 'working-tree'
      ? ''
      : ` · ${getSourceLabel(snapshot.repository.source)}`;
  const rootLabel = `${compactPath(snapshot.repository.root)}${snapshot.branch ? ` (${snapshot.branch})` : ''}`;

  return (
    <div
      className="app-shell share-shell"
      style={{ gridTemplateColumns: '292px 0 minmax(0, 1fr)' }}
    >
      <aside className="squircle sidebar">
        <div className="sidebar-header">
          <div className="sidebar-path-row">
            <div className="sidebar-path" title={snapshot.repository.root}>
              {rootLabel}
              {sourceLabel}
            </div>
          </div>
        </div>
        <NarrativeSidebar
          allowCommit={false}
          files={snapshot.files}
          navigation={navigation}
          showWhitespace={snapshot.preferences.showWhitespace}
          walkthrough={sharedWalkthrough}
        />
      </aside>
      <div aria-hidden className="sidebar-resizer" />
      <main className="review">
        <NarrativeWalkthroughView
          allowCommit={false}
          files={snapshot.files}
          navigation={navigation}
          onActiveReviewTargetChange={noop}
          onCommit={disabledCommit}
          onUpdateCommitMessage={disabledCommitMessage}
          renderDiffBlocks={renderWalkthroughDiffBlocks}
          showWhitespace={snapshot.preferences.showWhitespace}
          walkthrough={sharedWalkthrough}
        />
      </main>
    </div>
  );
}
