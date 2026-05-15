const { execFile } = require('node:child_process');
const { promises: fs } = require('node:fs');
const { createHash } = require('node:crypto');
const { join } = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const getFingerprint = (value) => createHash('sha256').update(value).digest('hex').slice(0, 16);

const git = async (repoPath, args, options = {}) => {
  const { stdout } = await execFileAsync('git', ['-C', repoPath, ...args], {
    encoding: options.encoding || 'utf8',
    maxBuffer: 1024 * 1024 * 64,
  });
  return stdout;
};

const parseStatus = (raw) => {
  const parts = raw.split('\0').filter(Boolean);
  const files = new Map();

  for (let index = 0; index < parts.length; index += 1) {
    const record = parts[index];
    const x = record[0];
    const y = record[1];
    let path = record.slice(3);
    let oldPath;

    if (x === 'R' || x === 'C') {
      oldPath = path;
      path = parts[++index];
    }

    const current = files.get(path) || {
      oldPath,
      path,
      staged: false,
      status: 'modified',
      unstaged: false,
      untracked: false,
    };

    if (x === '?' && y === '?') {
      current.status = 'untracked';
      current.unstaged = true;
      current.untracked = true;
    } else {
      current.staged = x !== ' ';
      current.unstaged = y !== ' ';

      const statusCode = current.staged ? x : y;
      current.status =
        statusCode === 'A'
          ? 'added'
          : statusCode === 'D'
            ? 'deleted'
            : statusCode === 'R' || statusCode === 'C'
              ? 'renamed'
              : 'modified';
    }

    files.set(path, current);
  }

  return [...files.values()].sort((left, right) => left.path.localeCompare(right.path));
};

const isBinaryBuffer = (buffer) => buffer.includes(0);

const createUntrackedPatch = async (repoRoot, path) => {
  const absolutePath = join(repoRoot, path);
  const buffer = await fs.readFile(absolutePath);

  if (isBinaryBuffer(buffer)) {
    return {
      binary: true,
      patch: '',
    };
  }

  const contents = buffer.toString('utf8');
  const trimmed = contents.endsWith('\n') ? contents.slice(0, -1) : contents;
  const lines = trimmed.length > 0 ? trimmed.split('\n') : [];
  const body = lines.map((line) => `+${line}`).join('\n');
  const noNewline = contents.endsWith('\n') ? '' : '\n\\ No newline at end of file';

  return {
    binary: false,
    patch: [
      `diff --git a/${path} b/${path}`,
      'new file mode 100644',
      'index 0000000..0000000',
      '--- /dev/null',
      `+++ b/${path}`,
      `@@ -0,0 +1,${lines.length} @@`,
      body,
    ]
      .filter(Boolean)
      .join('\n')
      .concat(noNewline, '\n'),
  };
};

const getPatch = async (repoRoot, path, kind, untracked) => {
  if (untracked) {
    return createUntrackedPatch(repoRoot, path);
  }

  const args =
    kind === 'staged'
      ? ['diff', '--cached', '--patch', '--no-ext-diff', '--', path]
      : ['diff', '--patch', '--no-ext-diff', '--', path];
  const patch = await git(repoRoot, args);

  return {
    binary: /Binary files .* differ/.test(patch),
    patch,
  };
};

const normalizeStatus = (statusCode) =>
  statusCode === 'A'
    ? 'added'
    : statusCode === 'D'
      ? 'deleted'
      : statusCode === 'R' || statusCode === 'C'
        ? 'renamed'
        : 'modified';

const parseCommitNameStatus = (raw) => {
  const parts = raw.split('\0').filter(Boolean);
  const files = [];

  for (let index = 0; index < parts.length; ) {
    const statusCode = parts[index++];
    const statusType = statusCode[0];

    if (statusType === 'R' || statusType === 'C') {
      const oldPath = parts[index++];
      const path = parts[index++];
      files.push({
        oldPath,
        path,
        status: 'renamed',
      });
    } else {
      const path = parts[index++];
      files.push({
        path,
        status: normalizeStatus(statusType),
      });
    }
  }

  return files.sort((left, right) => left.path.localeCompare(right.path));
};

const readWorkingTreeState = async (launchPath) => {
  const repoRoot = (await git(launchPath, ['rev-parse', '--show-toplevel'])).trim();
  const status = parseStatus(await git(repoRoot, ['status', '--porcelain=v1', '-z', '-uall']));
  const files = [];

  for (const item of status) {
    const sections = [];

    if (item.staged) {
      const staged = await getPatch(repoRoot, item.path, 'staged', false);
      sections.push({
        binary: staged.binary,
        id: `${item.path}:staged`,
        kind: 'staged',
        patch: staged.patch,
      });
    }

    if (item.unstaged) {
      const unstaged = await getPatch(repoRoot, item.path, 'unstaged', item.untracked);
      sections.push({
        binary: unstaged.binary,
        id: `${item.path}:unstaged`,
        kind: 'unstaged',
        patch: unstaged.patch,
      });
    }

    const fingerprint = getFingerprint(
      `${item.status}\n${item.oldPath || ''}\n${sections.map((section) => section.patch).join('\n')}`,
    );

    files.push({
      fingerprint,
      oldPath: item.oldPath,
      path: item.path,
      sections,
      status: item.status,
    });
  }

  return {
    files,
    generatedAt: Date.now(),
    launchPath,
    root: repoRoot,
    source: {
      type: 'working-tree',
    },
  };
};

const readCommitState = async (launchPath, ref) => {
  const repoRoot = (await git(launchPath, ['rev-parse', '--show-toplevel'])).trim();
  const commit = (await git(repoRoot, ['rev-parse', '--verify', `${ref}^{commit}`])).trim();
  const status = parseCommitNameStatus(
    await git(repoRoot, [
      'diff-tree',
      '--no-commit-id',
      '--name-status',
      '-r',
      '-z',
      '--root',
      '-M',
      commit,
    ]),
  );
  const files = [];

  for (const item of status) {
    const patch = await git(repoRoot, [
      'show',
      '--format=',
      '--patch',
      '--no-ext-diff',
      '--find-renames',
      commit,
      '--',
      item.path,
    ]);

    files.push({
      fingerprint: getFingerprint(`${commit}\n${item.oldPath || ''}\n${patch}`),
      oldPath: item.oldPath,
      path: item.path,
      sections: [
        {
          binary: /Binary files .* differ/.test(patch),
          id: `${item.path}:${commit}`,
          kind: 'commit',
          patch,
        },
      ],
      status: item.status,
    });
  }

  return {
    files,
    generatedAt: Date.now(),
    launchPath,
    root: repoRoot,
    source: {
      ref: commit,
      type: 'commit',
    },
  };
};

const readRepositoryState = async (launchPath, source = { type: 'working-tree' }) =>
  source.type === 'commit'
    ? readCommitState(launchPath, source.ref)
    : readWorkingTreeState(launchPath);

const listRepositoryHistory = async (launchPath, limit = 200) => {
  const repoRoot = (await git(launchPath, ['rev-parse', '--show-toplevel'])).trim();
  const raw = await git(repoRoot, [
    'log',
    `--max-count=${limit}`,
    '--format=%H%x00%P%x00%ct%x00%s%x00',
  ]);
  const parts = raw.split('\0').filter(Boolean);
  const entries = [];

  for (let index = 0; index < parts.length; index += 4) {
    entries.push({
      committedAt: Number(parts[index + 2]) * 1000,
      parents: parts[index + 1] ? parts[index + 1].split(' ') : [],
      ref: parts[index],
      subject: parts[index + 3],
    });
  }

  return {
    entries,
    root: repoRoot,
  };
};

module.exports = {
  listRepositoryHistory,
  parseStatus,
  readCommitState,
  readRepositoryState,
  readWorkingTreeState,
};
