// @ts-check

const { existsSync, readFileSync, readdirSync, statSync } = require('node:fs');
const { homedir } = require('node:os');
const { join } = require('node:path');
const { cleanText, truncate } = require('./codex.cjs');

const MAX_SESSION_SCAN_FILES = 20_000;
const MAX_SESSION_MESSAGE_CHARS = 2_400;
const MAX_SESSION_MESSAGES = 18;
const MAX_SESSION_CONTEXT_CHARS = 28_000;
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @typedef {import('../src/types.ts').WalkthroughContext} WalkthroughContext
 */

/** @param {unknown} value */
const normalizeCodexSessionId = (value) =>
  typeof value === 'string' && SESSION_ID_PATTERN.test(value) ? value : '';

const getCodexHome = () => process.env.CODEX_HOME || join(homedir(), '.codex');

/** @param {unknown} value */
const extractContentText = (value) => {
  if (!Array.isArray(value)) {
    return '';
  }

  return cleanText(
    value
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return '';
        }

        if (
          'text' in item &&
          typeof item.text === 'string' &&
          (!('type' in item) ||
            item.type === 'input_text' ||
            item.type === 'output_text' ||
            item.type === 'text')
        ) {
          return item.text;
        }

        return '';
      })
      .filter(Boolean)
      .join('\n'),
  );
};

/** @param {string} text */
const isNoiseMessage = (text) => {
  const normalized = cleanText(text).toLowerCase();
  return (
    normalized === '$codiff' || normalized === 'show me codiff' || normalized === 'open codiff'
  );
};

/** @param {string} path @param {string} sessionId */
const pathMatchesSessionId = (path, sessionId) =>
  path.endsWith('.jsonl') && path.toLowerCase().includes(sessionId.toLowerCase());

/**
 * @param {string} root
 * @param {string} sessionId
 */
const findCodexSessionFile = (root, sessionId) => {
  if (!sessionId || !existsSync(root)) {
    return null;
  }

  /** @type {Array<string>} */
  const stack = [root];
  let scanned = 0;

  while (stack.length > 0 && scanned < MAX_SESSION_SCAN_FILES) {
    const directory = stack.pop();
    if (!directory) {
      continue;
    }

    /** @type {Array<import('node:fs').Dirent>} */
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
        b.name.localeCompare(a.name),
      );
    } catch {
      continue;
    }

    for (const entry of entries) {
      scanned += 1;
      const path = join(directory, entry.name);
      if (entry.isFile() && pathMatchesSessionId(path, sessionId)) {
        return path;
      }

      if (entry.isDirectory()) {
        stack.push(path);
      }

      if (scanned >= MAX_SESSION_SCAN_FILES) {
        break;
      }
    }
  }

  return null;
};

/** @param {unknown} input */
const extractMessage = (input) => {
  if (!input || typeof input !== 'object') {
    return null;
  }

  if (!('type' in input) || input.type !== 'response_item') {
    return null;
  }

  const payload = 'payload' in input ? input.payload : null;
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  if (!('type' in payload) || payload.type !== 'message') {
    return null;
  }

  const role = 'role' in payload ? payload.role : undefined;
  if (role !== 'assistant' && role !== 'user') {
    return null;
  }

  const text = truncate(
    extractContentText('content' in payload ? payload.content : null),
    MAX_SESSION_MESSAGE_CHARS,
  );
  if (!text || isNoiseMessage(text)) {
    return null;
  }

  return { role, text };
};

/** @param {string} sessionPath */
const readSessionMessages = (sessionPath) => {
  const stat = statSync(sessionPath);
  if (!stat.isFile()) {
    return [];
  }

  /** @type {Array<{role: 'assistant' | 'user'; text: string}>} */
  const messages = [];
  let totalChars = 0;

  for (const line of readFileSync(sessionPath, 'utf8').split('\n')) {
    if (!line.trim()) {
      continue;
    }

    try {
      const message = extractMessage(JSON.parse(line));
      if (!message) {
        continue;
      }

      messages.push(message);
    } catch {
      // Ignore malformed or future-format records in Codex session logs.
    }
  }

  /** @type {Array<{role: 'assistant' | 'user'; text: string}>} */
  const selected = [];
  for (const message of messages.slice().reverse()) {
    if (selected.length >= MAX_SESSION_MESSAGES) {
      break;
    }

    const cost = message.role.length + message.text.length + 2;
    if (selected.length > 0 && totalChars + cost > MAX_SESSION_CONTEXT_CHARS) {
      break;
    }

    selected.push(message);
    totalChars += cost;
  }

  return selected.reverse();
};

/**
 * @param {string | undefined} codexSessionId
 * @returns {WalkthroughContext | null}
 */
const readCodexSessionContext = (codexSessionId) => {
  const threadId = normalizeCodexSessionId(codexSessionId);
  if (!threadId) {
    return null;
  }

  const path = findCodexSessionFile(join(getCodexHome(), 'sessions'), threadId);
  const messages = path ? readSessionMessages(path) : [];

  return {
    messages,
    risks:
      messages.length === 0
        ? ['Codiff could not find recent readable messages for the linked Codex session.']
        : undefined,
    source: {
      generatedAt: new Date().toISOString(),
      threadId,
      type: 'codex-session-excerpt',
    },
    version: 1,
  };
};

module.exports = {
  findCodexSessionFile,
  readCodexSessionContext,
  readSessionMessages,
};
