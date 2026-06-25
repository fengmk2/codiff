import {
  MarkdownEditor,
  type MarkdownAnnotation,
  type MarkdownAnnotationLayout,
  type MarkdownEditorHandle,
} from '@nkzw/mdx-editor';
import { frontmatterPlugin, imagePlugin } from '@nkzw/mdx-editor/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PlanCommentRail } from './app/components/PlanEditorView.tsx';
import type { PlanCommentThread, SharedPlanSnapshot } from './types.ts';

const markdownPlugins = [
  frontmatterPlugin(),
  imagePlugin({
    disableImageResize: true,
    disableImageSettingsButton: true,
  }),
];

const noop = () => {};

export function SharedPlanApp({ snapshot }: { snapshot: SharedPlanSnapshot }) {
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [layoutPass, setLayoutPass] = useState(0);
  const [layouts, setLayouts] = useState<ReadonlyArray<MarkdownAnnotationLayout>>([]);
  const [workspace, setWorkspace] = useState<HTMLDivElement | null>(null);
  const annotations = useMemo<ReadonlyArray<MarkdownAnnotation>>(
    () => snapshot.review.threads.map(({ anchor, id }) => ({ anchor, id })),
    [snapshot.review.threads],
  );

  useEffect(() => {
    const root = document.documentElement;
    if (snapshot.preferences.theme === 'system') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', snapshot.preferences.theme);
    }
  }, [snapshot.preferences.theme]);

  const activateThread = useCallback((thread: PlanCommentThread) => {
    setActiveThreadId(thread.id);
  }, []);

  const revealThread = useCallback((thread: PlanCommentThread) => {
    setActiveThreadId(thread.id);
    editorRef.current?.focusAnnotation(thread.id);
  }, []);

  return (
    <main className="plan-shell shared-plan-shell">
      <header className="plan-header">
        <div className="plan-title" title={snapshot.document.title}>
          {snapshot.document.title}
        </div>
      </header>
      <section className="plan-review review">
        <div
          className={`plan-workspace${snapshot.review.threads.length > 0 ? ' with-comments' : ''}`}
          onClickCapture={(event) => {
            const element = event.target as HTMLElement;
            const ids =
              element.closest<HTMLElement>('[data-mdx-annotation-ids]')?.dataset.mdxAnnotationIds ??
              element.closest<HTMLElement>('[data-mdx-annotation-block]')?.dataset
                .mdxAnnotationBlock;
            const id = ids?.split(' ')[0];
            if (id) {
              const thread = snapshot.review.threads.find((candidate) => candidate.id === id);
              if (thread) {
                activateThread(thread);
              }
            }
          }}
          ref={setWorkspace}
        >
          <div className="plan-document code-view">
            <div className="plan-file-surface">
              <div className="codiff-file-header plan-file-header">
                <div className="codiff-file-heading">
                  <span className="codiff-file-path-row">
                    <span className="codiff-file-path">{snapshot.document.name}</span>
                  </span>
                </div>
              </div>
              <MarkdownEditor
                activeAnnotationId={activeThreadId}
                additionalPlugins={markdownPlugins}
                annotations={annotations}
                ariaLabel={`Read ${snapshot.document.title}`}
                className="codiff-plan-editor"
                colorScheme="inherit"
                density="document"
                onAnnotationLayoutChange={setLayouts}
                readOnly
                ref={editorRef}
                spellCheck={false}
                suppressHtmlProcessing
                value={snapshot.document.content}
                variant="plain"
              />
            </div>
          </div>
          {snapshot.review.threads.length > 0 ? (
            <PlanCommentRail
              activeThreadId={activeThreadId}
              identity={null}
              layoutPass={layoutPass}
              layouts={layouts}
              onActivate={activateThread}
              onBodyChange={noop}
              onDelete={noop}
              onEmptyBlur={noop}
              onHeightChange={() => setLayoutPass((pass) => pass + 1)}
              onReveal={revealThread}
              readOnly
              showDelete={false}
              threads={snapshot.review.threads}
              workspace={workspace}
            />
          ) : null}
        </div>
      </section>
    </main>
  );
}
