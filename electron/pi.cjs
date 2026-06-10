// @ts-check

// Pi walkthroughs can take longer than Codex/Claude because the agent is
// allowed to call read-only tools before producing a structured answer.
// Pi is given 3 minutes to leave room for read-only repository exploration.
const PI_TIMEOUT_MS = 180_000;
const DEFAULT_PI_MODEL = 'pi-default';
const FALLBACK_PI_MODEL = 'pi-default';
const PI_NOT_FOUND_CODE = 'PI_NOT_FOUND';
const PI_NOT_FOUND_MESSAGE =
  'Pi support could not be loaded. Reinstall Codiff and verify the bundled Pi SDK is available.';
const PI_SDK_PACKAGE = '@earendil-works/pi-coding-agent';

const piRunError = (/** @type {string} */ detail) => `Pi run failed. ${detail}`;

/**
 * @typedef {{
 *   fallbackModel?: string;
 *   model?: string;
 *   onModelFallback?: (fallbackModel: string, originalModel: string) => Promise<void> | void;
 *   onPartialText?: (delta: string) => void;
 * }} PiOptions
 */
/**
 * @typedef {{
 *   id: string;
 *   label: string;
 * }} PiModel
 */

/** @type {ReadonlyArray<PiModel>} */
const PLACEHOLDER_MODELS = Object.freeze([{ id: DEFAULT_PI_MODEL, label: 'Pi default' }]);
/** @type {ReadonlyArray<PiModel>} */
let piModelsCache = PLACEHOLDER_MODELS;
/** @type {Promise<ReadonlyArray<PiModel>> | null} */
let piModelsLoading = null;
let piModelsLoaded = false;
/** @type {(() => void) | null} */
let onPiModelsLoaded = null;

/** @param {string} [detail] */
const createPiNotFoundError = (detail) =>
  Object.assign(new Error(detail ? `${PI_NOT_FOUND_MESSAGE} ${detail}` : PI_NOT_FOUND_MESSAGE), {
    code: PI_NOT_FOUND_CODE,
  });

/** @param {unknown} error */
const isPiNotFoundError = (error) =>
  Boolean(
    error && typeof error === 'object' && 'code' in error && error.code === PI_NOT_FOUND_CODE,
  );

/**
 * @returns {Promise<boolean>} `true` when the Pi SDK package can be resolved
 *   from disk. `runPi` performs the same check at call time, but exposing
 *   the probe lets callers (e.g. tests) decide whether to skip SDK-only work.
 */
const isPiInstalled = async () => {
  try {
    await loadPiSdk();
    return true;
  } catch {
    return false;
  }
};

/** @returns {Set<string>} */
const piModelIds = () => new Set(piModelsCache.map((model) => model.id));

/** @param {unknown} value @returns {string} */
const normalizePiModel = (value) => {
  // Don't normalize before real models have loaded: the placeholder cache
  // would overwrite the user's stored selection. The caller re-normalizes once
  // model discovery completes.
  if (!piModelsLoaded || piModelsLoading !== null || piModelsCache.length === 0) {
    return typeof value === 'string' ? value : DEFAULT_PI_MODEL;
  }
  const ids = piModelIds();
  if (ids.has(/** @type {string} */ (value))) {
    return /** @type {string} */ (value);
  }
  const firstReal = piModelsCache.find((model) => model.id !== DEFAULT_PI_MODEL);
  return firstReal?.id ?? DEFAULT_PI_MODEL;
};

/** @param {string} entry @param {string} [provider] */
const formatPiModelLabel = (entry, provider) => (provider ? `${provider}/${entry}` : entry);

/** @returns {Promise<any>} */
const loadPiSdk = async () => {
  try {
    return await import(PI_SDK_PACKAGE);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw createPiNotFoundError(`Could not import ${PI_SDK_PACKAGE}: ${detail}`);
  }
};

/** @param {any} sdk */
const createAuthStorage = (sdk) => {
  try {
    return sdk.AuthStorage.create();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(piRunError(detail));
  }
};

/**
 * @param {any} sdk
 * @param {any} modelRegistry
 * @param {string} cwd
 */
const loadPiExtensions = async (sdk, modelRegistry, cwd) => {
  const { DefaultResourceLoader, getAgentDir } = sdk;
  if (typeof DefaultResourceLoader !== 'function') {
    return;
  }

  const agentDir = getAgentDir?.() ?? `${process.env.HOME}/.pi/agent`;
  const loader = new DefaultResourceLoader({ agentDir, cwd });
  await loader.reload();
  const { runtime } = loader.getExtensions();
  for (const registration of runtime.pendingProviderRegistrations ?? []) {
    modelRegistry.registerProvider(registration.name, registration.config);
  }
};

/**
 * @param {any} modelRegistry
 * @returns {ReadonlyArray<{ provider: string; id: string; name?: string }>}
 */
const getAvailablePiModels = (modelRegistry) => {
  const available = modelRegistry.getAvailable();
  return available.length ? available : modelRegistry.getAll();
};

/**
 * @returns {Promise<ReadonlyArray<PiModel>>}
 */
const getPiModels = () => {
  if (piModelsLoaded) {
    return Promise.resolve(piModelsCache);
  }

  if (piModelsLoading) {
    return piModelsLoading;
  }

  const loadingPromise = (async () => {
    const sdk = await loadPiSdk();
    const authStorage = createAuthStorage(sdk);
    const modelRegistry = sdk.ModelRegistry.create(authStorage);

    // Load Pi extensions so providers registered via pi.registerProvider()
    // (e.g. LM Studio, custom endpoints) are included in the model registry.
    try {
      await loadPiExtensions(sdk, modelRegistry, process.cwd());
    } catch {
      // Extension loading is best-effort for model listing.
    }

    const models = getAvailablePiModels(modelRegistry);

    const next = models
      .map((/** @type {any} */ model) => {
        const id = `${model.provider}/${model.id}`;
        const label = formatPiModelLabel(model.name || model.id, model.provider);
        return Object.freeze({ id, label });
      })
      .filter((/** @type {{id: string}} */ entry) => Boolean(entry.id));

    if (next.length) {
      piModelsCache = Object.freeze(next);
    }

    piModelsLoaded = true;
    onPiModelsLoaded?.();

    return piModelsCache;
  })();

  piModelsLoading = loadingPromise.finally(() => {
    piModelsLoading = null;
  });

  return piModelsLoading;
};

/** @returns {ReadonlyArray<PiModel>} */
const getCachedPiModels = () => piModelsCache;

/**
 * Walk `text` and return the first balanced JSON object or array, or `null`
 * if none is found. Used as a last-resort fallback when the model replies
 * with prose that contains an embedded JSON document.
 *
 * @param {string} text
 * @returns {string | null}
 */
const extractFirstJson = (text) => {
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch !== '{' && ch !== '[') continue;
    const open = ch;
    const close = ch === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let j = i; j < text.length; j += 1) {
      const c = text[j];
      if (inString) {
        if (escape) {
          escape = false;
        } else if (c === '\\') {
          escape = true;
        } else if (c === '"') {
          inString = false;
        }
        continue;
      }
      if (c === '"') {
        inString = true;
        continue;
      }
      if (c === open) depth += 1;
      else if (c === close) {
        depth -= 1;
        if (depth === 0) {
          return text.slice(i, j + 1);
        }
      }
    }
  }
  return null;
};

/**
 * @param {string} value
 * @returns {{ provider: string; id: string }}
 */
const splitProviderAndId = (value) => {
  const text = String(value);
  const slash = text.indexOf('/');
  if (slash < 0) {
    return { provider: '', id: text };
  }
  return { provider: text.slice(0, slash), id: text.slice(slash + 1) };
};

/**
 * Common alternative keys the model tends to use when the structured-output
 * prompt instruction is ambiguous. Used as a last-resort coercion when the
 * model returns a JSON document that does not match the supplied schema.
 *
 * @type {ReadonlyArray<readonly [string, string]>}
 */
const SCHEMA_FIELD_ALIASES = Object.freeze([
  ['reply', 'text'],
  ['reply', 'response'],
  ['reply', 'answer'],
  ['reply', 'message'],
  ['reply', 'body'],
]);

/**
 * @param {unknown} schema
 * @returns {ReadonlyArray<string>}
 */
const schemaRequiredFields = (schema) => {
  if (!schema || typeof schema !== 'object') return [];
  const required = /** @type {any} */ (schema).required;
  if (!Array.isArray(required)) return [];
  return required.filter((field) => typeof field === 'string');
};

/**
 * @param {unknown} parsed
 * @param {ReadonlyArray<string>} required
 * @returns {boolean}
 */
const hasAllRequiredFields = (parsed, required) => {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  for (const field of required) {
    if (!(field in parsed)) return false;
  }
  return true;
};

/**
 * Best-effort coercion of a parsed JSON object into the shape described by
 * the supplied schema. Returns the original object if it already satisfies
 * the schema, otherwise tries to remap common alternative field names.
 *
 * @param {unknown} parsed
 * @param {unknown} schema
 * @returns {unknown}
 */
const coerceResultToSchema = (parsed, schema) => {
  const required = schemaRequiredFields(schema);
  if (!required.length) return parsed;
  if (hasAllRequiredFields(parsed, required)) return parsed;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return parsed;

  /** @type {Record<string, unknown>} */
  const next = { .../** @type {object} */ (parsed) };
  for (const [target, alias] of SCHEMA_FIELD_ALIASES) {
    if (required.includes(target) && !(target in next) && alias in next) {
      next[target] = next[alias];
    }
  }
  if (hasAllRequiredFields(next, required)) return next;
  return parsed;
};

/**
 * Build a short reminder the agent should include in its final reply. The
 * call sites already embed the schema in the prompt, but Pi's SDK does not
 * surface a `--output-schema` flag, so the prompt-level instruction is the
 * only enforcement mechanism. Echoing the required field names back at the
 * agent in a separate paragraph dramatically improves conformance.
 *
 * @param {unknown} schema
 * @returns {string}
 */
const buildSchemaReminder = (schema) => {
  const required = schemaRequiredFields(schema);
  if (!required.length) return '';
  return `\n\nYour final reply must be a single JSON object that includes the field${
    required.length === 1 ? '' : 's'
  }: ${required.map((field) => `\`${field}\``).join(', ')}. Do not include any prose outside the JSON.`;
};

/**
 * @param {unknown} identifier
 * @param {any} modelRegistry
 * @param {ReadonlyArray<{ provider: string; id: string }>} available
 */
const resolveModel = (identifier, modelRegistry, available) => {
  const { provider, id } = splitProviderAndId(String(identifier ?? ''));
  if (provider && id) {
    const direct = modelRegistry.find(provider, id);
    if (direct) return direct;
  }
  if (id) {
    for (const candidate of available) {
      if (candidate.id === id) {
        const found = modelRegistry.find(candidate.provider, candidate.id);
        if (found) return found;
      }
    }
  }
  if (available.length) {
    return modelRegistry.find(available[0].provider, available[0].id);
  }
  return undefined;
};

/**
 * @param {string} repoRoot
 * @param {string} prompt
 * @param {unknown} _schema
 * @param {string} [_outputName]
 * @param {string} [timeoutMessage]
 * @param {PiOptions} [options]
 */
const runPi = async (
  repoRoot,
  prompt,
  _schema,
  _outputName = 'pi-output.json',
  timeoutMessage = 'Pi timed out.',
  options = {},
) => {
  const sdk = await loadPiSdk();
  const authStorage = createAuthStorage(sdk);
  const modelRegistry = sdk.ModelRegistry.create(authStorage);

  // Load extensions so providers registered via pi.registerProvider()
  // (e.g. LM Studio) are available for model resolution.
  try {
    await loadPiExtensions(sdk, modelRegistry, repoRoot);
  } catch {
    // Extension loading is best-effort.
  }

  const available = getAvailablePiModels(modelRegistry);
  const model = resolveModel(options.model, modelRegistry, available);
  if (!model) {
    throw new Error(
      piRunError('No Pi models are available. Set an API key for any provider and try again.'),
    );
  }

  /** @type {any} */
  let session;
  try {
    const created = await sdk.createAgentSession({
      cwd: repoRoot,
      model,
      authStorage,
      modelRegistry,
      sessionManager: sdk.SessionManager.inMemory(),
      // Read-only tools so the model can explore the repo before answering.
      // No custom structured-output tool: the model answers in prose / JSON
      // text and we parse the final reply (see {@link extractFirstJson}).
      tools: ['read', 'grep', 'find', 'ls'],
    });
    session = created.session;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(piRunError(detail));
  }

  const unsubscribe = session.subscribe(
    /** @type {(event: any) => void} */ (
      (event) => {
        if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
          options.onPartialText?.(event.assistantMessageEvent.delta);
        }
      }
    ),
  );

  /** @type {NodeJS.Timeout | undefined} */
  let timeoutHandle;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, PI_TIMEOUT_MS);
  });

  const finishWithError = async (/** @type {unknown} */ error) => {
    try {
      await session.abort();
    } catch {}
    if (error instanceof Error) throw error;
    throw new Error(String(error ?? ''));
  };

  const schemaReminder = buildSchemaReminder(_schema);
  const effectivePrompt = schemaReminder ? `${prompt}${schemaReminder}` : prompt;

  try {
    await Promise.race([session.prompt(effectivePrompt), timeoutPromise]).catch(finishWithError);

    const messages = /** @type {any[]} */ (session.messages);
    /**
     * @param {unknown} value
     * @returns {string}
     */
    const serialize = (value) => {
      const coerced = coerceResultToSchema(value, _schema);
      return JSON.stringify(coerced);
    };

    // The walkthrough and review-assist prompts are written as "reply with
    // this JSON schema", so the model's final answer is a JSON document
    // emitted in an assistant text block. We walk the messages from the
    // end, and within each assistant message we walk the content blocks
    // from the end, so we pick up the final reply rather than earlier
    // "thinking aloud" text.
    const assistantTexts = [];
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (message && message.role === 'assistant' && Array.isArray(message.content)) {
        for (let j = message.content.length - 1; j >= 0; j -= 1) {
          const block = message.content[j];
          if (block && block.type === 'text' && typeof block.text === 'string') {
            const text = block.text.trim();
            if (text) assistantTexts.push(text);
          }
        }
      }
    }

    // Thinking-only models (e.g. Qwen, DeepSeek) may stream reasoning tokens
    // but never produce a TextContent block. Fall back to thinking blocks.
    if (!assistantTexts.length) {
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        const message = messages[i];
        if (message && message.role === 'assistant' && Array.isArray(message.content)) {
          for (let j = message.content.length - 1; j >= 0; j -= 1) {
            const block = message.content[j];
            if (block && block.type === 'thinking' && typeof block.thinking === 'string') {
              const text = block.thinking.trim();
              if (text) assistantTexts.push(text);
            }
          }
        }
      }
    }

    for (const text of assistantTexts) {
      // Try a strict parse first.
      try {
        return serialize(JSON.parse(text));
      } catch {}

      // Otherwise, look for a fenced ```json ... ``` block and parse that.
      const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
      if (fenced) {
        try {
          return serialize(JSON.parse(fenced[1].trim()));
        } catch {}
      }

      // Last resort: pull out the first balanced JSON object/array.
      const balanced = extractFirstJson(text);
      if (balanced) {
        try {
          return serialize(JSON.parse(balanced));
        } catch {}
      }
    }

    if (assistantTexts.length) {
      // The model replied with prose that contains no JSON. Wrap the most
      // recent text in { text } so the caller's `parseJSONMessage` still
      // receives valid JSON and the existing normalizer can surface a
      // validation error rather than the agent failing with a parse error.
      return JSON.stringify({ text: assistantTexts[0] });
    }

    throw new Error(piRunError('Pi did not produce a final answer; no assistant text was found.'));
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    if (typeof unsubscribe === 'function') {
      try {
        unsubscribe();
      } catch {}
    }
    try {
      session.dispose();
    } catch {}
  }
};

/** @param {(() => void) | null} callback */
const setOnPiModelsLoaded = (callback) => {
  onPiModelsLoaded = callback;
};

module.exports = {
  DEFAULT_PI_MODEL,
  FALLBACK_PI_MODEL,
  PI_NOT_FOUND_CODE,
  PI_NOT_FOUND_MESSAGE,
  PI_TIMEOUT_MS,
  getCachedPiModels,
  getPiModels,
  isPiInstalled,
  isPiNotFoundError,
  normalizePiModel,
  runPi,
  setOnPiModelsLoaded,
};
