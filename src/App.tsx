import { registerCustomTheme } from '@pierre/diffs';
import { PatchDiff, Virtualizer } from '@pierre/diffs/react';
import { FileTree, useFileTree } from '@pierre/trees/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dunkelTheme from './themes/dunkel.json' with { type: 'json' };
import lichtTheme from './themes/licht.json' with { type: 'json' };
import type { ChangedFile, GitFileStatus, RepositoryState } from './types.ts';

registerCustomTheme('Licht', async () => lichtTheme as never);
registerCustomTheme('Dunkel', async () => dunkelTheme as never);

const statusLabel: Record<GitFileStatus, string> = {
  added: 'Added',
  deleted: 'Deleted',
  modified: 'Modified',
  renamed: 'Renamed',
  untracked: 'Untracked',
};

const statusForTree: Record<
  GitFileStatus,
  'added' | 'deleted' | 'modified' | 'renamed' | 'untracked'
> = {
  added: 'added',
  deleted: 'deleted',
  modified: 'modified',
  renamed: 'renamed',
  untracked: 'untracked',
};

const hashString = (value: string) => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
};

const compactPath = (path: string) => {
  const homePath = path
    .replace(/^\/Users\/[^/]+(?=\/|$)/, '~')
    .replace(/^\/home\/[^/]+(?=\/|$)/, '~');
  const parts = homePath.split('/').filter(Boolean);

  if (parts.length <= 2) {
    return homePath;
  }

  const prefix = homePath.startsWith('/') ? '/' : '';
  const [first, ...rest] = parts;
  const last = rest.pop();
  const middle = rest.map((part) => part[0]).join('/');

  return `${prefix}${first}/${middle ? `${middle}/` : ''}${last}`;
};

const getViewedKey = (root: string) => `codiff:viewed:${root}`;

const readViewed = (root: string): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(getViewedKey(root)) || '{}') as Record<string, string>;
  } catch {
    return {};
  }
};

const writeViewed = (root: string, viewed: Record<string, string>) => {
  localStorage.setItem(getViewedKey(root), JSON.stringify(viewed));
};

function Sidebar({
  files,
  onSelectPath,
  root,
  selectedPath,
}: {
  files: ReadonlyArray<ChangedFile>;
  onSelectPath: (path: string) => void;
  root: string;
  selectedPath: string | null;
}) {
  const paths = useMemo(() => files.map((file) => file.path), [files]);
  const status = useMemo(
    () =>
      files.map((file) => ({
        path: file.path,
        status: statusForTree[file.status],
      })),
    [files],
  );
  const { model } = useFileTree({
    flattenEmptyDirectories: true,
    gitStatus: status,
    initialExpansion: 'open',
    initialSelectedPaths: selectedPath ? [selectedPath] : [],
    itemHeight: 30,
    onSelectionChange: (paths) => {
      const path = paths[0];
      if (path) {
        onSelectPath(path);
      }
    },
    paths,
    unsafeCSS: `
      :host {
        color: var(--sidebar-text);
        font: 13px/1.35 var(--font-sans);
      }

      button[data-type='item'] {
        border-radius: 14px;
        corner-shape: squircle;
      }
    `,
  });

  return (
    <FileTree
      className="file-tree"
      header={
        <div className="sidebar-header">
          <div className="sidebar-path" title={root}>
            {compactPath(root)}
          </div>
          <div className="sidebar-title">Changed Files</div>
        </div>
      }
      model={model}
    />
  );
}

function DiffFile({
  file,
  isSelected,
  isViewed,
  onToggleViewed,
}: {
  file: ChangedFile;
  isSelected: boolean;
  isViewed: boolean;
  onToggleViewed: (file: ChangedFile, isViewed: boolean) => void;
}) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const toggleViewed = () => {
    onToggleViewed(file, isViewed);
    setIsCollapsed(!isViewed);
  };

  return (
    <section
      className={`diff-file squircle${isSelected ? ' selected' : ''}${isViewed ? ' viewed' : ''}`}
      id={`file-${hashString(file.path)}`}
    >
      <div className="diff-file-header">
        <button
          aria-label={isCollapsed ? 'Expand file' : 'Collapse file'}
          className="icon-button"
          onClick={() => setIsCollapsed((value) => !value)}
          title={isCollapsed ? 'Expand' : 'Collapse'}
          type="button"
        >
          <span className={isCollapsed ? 'chevron collapsed' : 'chevron'} />
        </button>
        <div className="file-heading">
          <div className="file-path">{file.path}</div>
          {file.oldPath ? <div className="file-old-path">{file.oldPath}</div> : null}
        </div>
        <div className={`status-badge ${file.status}`}>{statusLabel[file.status]}</div>
        <button
          aria-pressed={isViewed}
          className={`viewed-button${isViewed ? ' active' : ''}`}
          onClick={toggleViewed}
          type="button"
        >
          <span aria-hidden className="viewed-checkbox" />
          Viewed
        </button>
      </div>
      {isCollapsed ? null : (
        <div className="diff-sections">
          {file.sections.map((section) => (
            <div className="diff-section" key={section.id}>
              {file.sections.length > 1 ? (
                <div className="section-label">
                  {section.kind === 'staged'
                    ? 'Staged'
                    : section.kind === 'unstaged'
                      ? 'Unstaged'
                      : 'Commit'}
                </div>
              ) : null}
              {section.binary ? (
                <div className="binary-diff squircle">Binary file changed</div>
              ) : (
                <Virtualizer>
                  <PatchDiff
                    options={{
                      diffIndicators: 'bars',
                      diffStyle: 'split',
                      disableFileHeader: true,
                      hunkSeparators: 'simple',
                      lineDiffType: 'char',
                      theme: {
                        dark: 'Dunkel',
                        light: 'Licht',
                      },
                      themeType: 'system',
                    }}
                    patch={section.patch}
                  />
                </Virtualizer>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function App() {
  const [state, setState] = useState<RepositoryState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [viewed, setViewed] = useState<Record<string, string>>({});
  const fileRefs = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    let canceled = false;

    window.codiff
      .getRepositoryState()
      .then((nextState) => {
        if (canceled) {
          return;
        }

        setState(nextState);
        setError(null);
        setViewed(readViewed(nextState.root));
        setSelectedPath((current) => current ?? nextState.files[0]?.path ?? null);
      })
      .catch((error: unknown) => {
        if (!canceled) {
          setError(error instanceof Error ? error.message : String(error));
        }
      });

    return () => {
      canceled = true;
    };
  }, []);

  const selectPath = useCallback((path: string) => {
    setSelectedPath(path);
    requestAnimationFrame(() => {
      fileRefs.current.get(path)?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  }, []);

  const toggleViewed = useCallback(
    (file: ChangedFile, isViewed: boolean) => {
      if (!state) {
        return;
      }

      setViewed((current) => {
        if (isViewed) {
          const next = { ...current };
          delete next[file.path];
          writeViewed(state.root, next);
          return next;
        }

        const next = {
          ...current,
          [file.path]: file.fingerprint,
        };
        writeViewed(state.root, next);
        return next;
      });
    },
    [state],
  );

  if (error) {
    return (
      <main className="empty-state">
        <div className="empty-panel squircle">
          <strong>Unable to read repository</strong>
          <span>{error}</span>
        </div>
      </main>
    );
  }

  if (!state) {
    return <main className="loading">Loading</main>;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar squircle">
        <div className="window-drag" />
        <Sidebar
          files={state.files}
          onSelectPath={selectPath}
          root={state.root}
          selectedPath={selectedPath}
        />
      </aside>
      <main className="review">
        {state.files.length === 0 ? (
          <div className="empty-state">
            <div className="empty-panel squircle">
              <strong>No local changes</strong>
              <span>{state.root}</span>
            </div>
          </div>
        ) : (
          <div className="file-list">
            {state.files.map((file) => (
              <div
                key={file.path}
                ref={(element) => {
                  if (element) {
                    fileRefs.current.set(file.path, element);
                  } else {
                    fileRefs.current.delete(file.path);
                  }
                }}
              >
                <DiffFile
                  file={file}
                  isSelected={selectedPath === file.path}
                  isViewed={viewed[file.path] === file.fingerprint}
                  onToggleViewed={toggleViewed}
                />
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
