import { renderInlineMarkdown } from '../../../lib/markdown.tsx';
import {
  buildCommitModel,
  getStopLineCount,
  getStopSegments,
  isWalkthroughCommittable,
  type WalkthroughOrderView,
  type WalkthroughStopView,
} from '../../../lib/narrative-walkthrough.ts';
import type { ChangedFile, NarrativeWalkthrough } from '../../../types.ts';
import { Check, GitBranch, Path } from './icons.tsx';
import { PhaseIcon } from './parts.tsx';
import type { NarrativeNavigation } from './useNarrativeNavigation.ts';

const agentLabel = (agentId: 'codex' | 'claude') =>
  agentId === 'claude' ? 'Claude Code' : 'Codex';

const fileName = (path: string) => path.split('/').pop() ?? path;

const countUniqueRestFiles = (orderView: WalkthroughOrderView) =>
  new Set(orderView.rest.map((item) => item.segment.path)).size;

function TocStop({
  current,
  onSelect,
  stop,
  visited,
}: {
  current: boolean;
  onSelect: (index: number) => void;
  stop: WalkthroughStopView;
  visited: boolean;
}) {
  const isDone = visited && !current;
  const segments = getStopSegments(stop);
  const fileCount = new Set(segments.map((segment) => segment.path)).size;
  const lineCount = getStopLineCount(stop);
  return (
    <button
      className={`wt-toc-stop${current ? ' current' : ''}${isDone ? ' visited' : ''}`}
      onClick={() => onSelect(stop.index)}
      title={stop.title ?? stop.segment.title ?? stop.segment.path}
      type="button"
    >
      <span className="wt-toc-rail">
        {isDone ? (
          <span className="wt-toc-node done">
            <Check size={8} weight="bold" />
          </span>
        ) : (
          <span className={`wt-toc-node${current ? ' current' : ''}`}>
            {current ? <span className="wt-toc-node-pulse" /> : null}
          </span>
        )}
      </span>
      <span className="wt-toc-main">
        <span className="wt-toc-title-row">
          <span className="wt-toc-num">{stop.index + 1}</span>
          <span className="wt-toc-title">
            {stop.title ?? stop.segment.title ?? stop.segment.path}
          </span>
        </span>
        <span className="wt-toc-meta">
          <span className="wt-toc-file">
            {fileCount > 1 ? `${fileCount} files` : fileName(stop.segment.path)}
          </span>
          <span className="wt-toc-count">
            <span className="added">+{lineCount.added}</span>
            {lineCount.deleted > 0 ? <span className="deleted">−{lineCount.deleted}</span> : null}
          </span>
        </span>
      </span>
    </button>
  );
}

function SupportingFilesStop({
  navigation,
  orderView,
}: {
  navigation: NarrativeNavigation;
  orderView: WalkthroughOrderView;
}) {
  if (orderView.rest.length === 0) {
    return null;
  }
  const current = navigation.mode === 'rest';
  const isDone = navigation.restVisited && !current;
  const fileCount = countUniqueRestFiles(orderView);
  return (
    <div className="wt-toc-chapter">
      <div className="wt-toc-chapter-head">
        <span className="wt-toc-chapter-icon">
          <Path size={15} />
        </span>
        <span className="wt-toc-chapter-title">{orderView.order.restLabel}</span>
      </div>
      <div className="wt-toc-stops">
        <button
          className={`wt-toc-stop${current ? ' current' : ''}${isDone ? ' visited' : ''}`}
          onClick={navigation.openRest}
          title={orderView.order.restBlurb}
          type="button"
        >
          <span className="wt-toc-rail">
            {isDone ? (
              <span className="wt-toc-node done">
                <Check size={8} weight="bold" />
              </span>
            ) : (
              <span className={`wt-toc-node${current ? ' current' : ''}`}>
                {current ? <span className="wt-toc-node-pulse" /> : null}
              </span>
            )}
          </span>
          <span className="wt-toc-main">
            <span className="wt-toc-title-row">
              <span className="wt-toc-title">
                {fileCount} file{fileCount === 1 ? '' : 's'}
              </span>
            </span>
            <span className="wt-toc-meta">
              <span className="wt-toc-count">
                <span className="added">+{orderView.restTotals.added}</span>
                {orderView.restTotals.deleted > 0 ? (
                  <span className="deleted">−{orderView.restTotals.deleted}</span>
                ) : null}
              </span>
            </span>
          </span>
        </button>
      </div>
    </div>
  );
}

export function NarrativeSidebar({
  files,
  navigation,
  walkthrough,
}: {
  files: ReadonlyArray<ChangedFile>;
  navigation: NarrativeNavigation;
  walkthrough: NarrativeWalkthrough;
}) {
  const { orderView } = navigation;
  if (!orderView) {
    return <div className="wt-empty">This walkthrough has no readable order.</div>;
  }

  const currentSegmentId =
    navigation.mode === 'stop' ? orderView.sequence[navigation.index]?.segmentId : null;

  const committable = isWalkthroughCommittable(walkthrough);
  const commitModel = committable ? buildCommitModel(orderView, files) : null;
  const commitTotals = commitModel
    ? commitModel.files
        .filter((file) => navigation.commitSelected.has(file.path))
        .reduce(
          (sum, file) => ({ added: sum.added + file.added, deleted: sum.deleted + file.deleted }),
          { added: 0, deleted: 0 },
        )
    : null;

  return (
    <div className="walkthrough-list">
      <div className="wt-focus">
        <span className="wt-focus-label">Review focus</span>
        <p>{renderInlineMarkdown(walkthrough.focus)}</p>
      </div>

      <div className="wt-toc-scroll">
        {orderView.phases.map((phase) => (
          <div className="wt-toc-chapter" key={phase.id}>
            <div className="wt-toc-chapter-head">
              <span className="wt-toc-chapter-icon">
                <PhaseIcon icon={phase.icon} size={15} />
              </span>
              <span className="wt-toc-chapter-title">{phase.title}</span>
            </div>
            <div className="wt-toc-stops">
              {phase.stops.map((stop) => (
                <TocStop
                  current={navigation.mode === 'stop' && stop.segmentId === currentSegmentId}
                  key={stop.segmentId}
                  onSelect={navigation.goStop}
                  stop={stop}
                  visited={navigation.visited.has(stop.segmentId)}
                />
              ))}
            </div>
          </div>
        ))}
        <SupportingFilesStop navigation={navigation} orderView={orderView} />
        {committable && commitTotals ? (
          <div className="wt-toc-chapter">
            <div className="wt-toc-chapter-head">
              <span className="wt-toc-chapter-icon commit">
                <GitBranch size={15} />
              </span>
              <span className="wt-toc-chapter-title">Commit</span>
            </div>
            <button
              className={`wt-toc-stop${navigation.mode === 'commit' ? ' current' : ''}`}
              onClick={navigation.enterCommit}
              type="button"
            >
              <span className="wt-toc-rail wt-toc-rail-commit">
                <span className={`wt-toc-node${navigation.mode === 'commit' ? ' current' : ''}`}>
                  {navigation.mode === 'commit' ? <span className="wt-toc-node-pulse" /> : null}
                </span>
              </span>
              <span className="wt-toc-main">
                <span className="wt-toc-title-row">
                  <span className="wt-toc-title">Write the commit</span>
                </span>
                <span className="wt-toc-meta">
                  <span className="wt-toc-file">
                    {navigation.commitSelected.size} file
                    {navigation.commitSelected.size === 1 ? '' : 's'}
                  </span>
                  <span className="wt-toc-count">
                    <span className="added">+{commitTotals.added}</span>
                    {commitTotals.deleted > 0 ? (
                      <span className="deleted">−{commitTotals.deleted}</span>
                    ) : null}
                  </span>
                </span>
              </span>
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export { agentLabel };
