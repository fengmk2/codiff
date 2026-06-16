import type { ChangedFile, GitFileStatus } from '../types.ts';

export const statusForTree: Record<
  GitFileStatus,
  'added' | 'deleted' | 'modified' | 'renamed' | 'untracked'
> = {
  added: 'added',
  deleted: 'deleted',
  modified: 'modified',
  renamed: 'renamed',
  untracked: 'untracked',
};

export const fileTreeSort = (
  left: { isDirectory: boolean; path: string; segments?: ReadonlyArray<string> },
  right: { isDirectory: boolean; path: string; segments?: ReadonlyArray<string> },
) => compareTreePaths(left.path, right.path);

export const compactPath = (path: string) => {
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

function compareTreePaths(leftPath: string, rightPath: string) {
  const leftParts = leftPath.split('/');
  const rightParts = rightPath.split('/');
  const length = Math.min(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const left = leftParts[index];
    const right = rightParts[index];
    if (left === right) {
      continue;
    }

    const leftIsDirectory = index < leftParts.length - 1;
    const rightIsDirectory = index < rightParts.length - 1;
    if (leftIsDirectory !== rightIsDirectory) {
      return leftIsDirectory ? -1 : 1;
    }

    return left.localeCompare(right);
  }

  return leftParts.length - rightParts.length;
}

export const sortFiles = (files: ReadonlyArray<ChangedFile>) =>
  [...files].sort((left, right) => compareTreePaths(left.path, right.path));

export const fuzzyMatches = (path: string, query: string) => {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  const normalizedPath = path.toLowerCase();
  let pathIndex = 0;
  for (const character of normalizedQuery) {
    pathIndex = normalizedPath.indexOf(character, pathIndex);
    if (pathIndex === -1) {
      return false;
    }
    pathIndex += 1;
  }
  return true;
};
