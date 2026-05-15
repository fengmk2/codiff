export type DiffSection = {
  binary: boolean;
  id: string;
  kind: 'commit' | 'staged' | 'unstaged';
  patch: string;
};

export type GitFileStatus = 'added' | 'deleted' | 'modified' | 'renamed' | 'untracked';

export type ChangedFile = {
  fingerprint: string;
  oldPath?: string;
  path: string;
  sections: ReadonlyArray<DiffSection>;
  status: GitFileStatus;
};

export type ReviewSource =
  | {
      type: 'working-tree';
    }
  | {
      ref: string;
      type: 'commit';
    };

export type HistoryEntry = {
  committedAt: number;
  parents: ReadonlyArray<string>;
  ref: string;
  subject: string;
};

export type RepositoryHistory = {
  entries: ReadonlyArray<HistoryEntry>;
  root: string;
};

export type RepositoryState = {
  files: ReadonlyArray<ChangedFile>;
  generatedAt: number;
  launchPath: string;
  root: string;
  source: ReviewSource;
};
