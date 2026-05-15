import type { RepositoryHistory, RepositoryState, ReviewSource } from './types.ts';

declare global {
  interface Window {
    codiff: {
      getRepositoryHistory: (limit?: number) => Promise<RepositoryHistory>;
      getRepositoryState: (source?: ReviewSource) => Promise<RepositoryState>;
      showInFolder: (path: string) => Promise<void>;
    };
  }
}
