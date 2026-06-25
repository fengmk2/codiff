// @ts-check

const { readFileSync } = require('node:fs');
const { readConfig } = require('./config.cjs');
const { readLocalIdentity } = require('./local-identity.cjs');
const { createSharedPlanSnapshot } = require('./shared-plan.cjs');
const { uploadSnapshot } = require('./headless-walkthrough-share.cjs');
const { resolvePlanShareTarget } = require('./walkthrough-sharing.cjs');

/**
 * @param {{
 *   agent?: 'claude' | 'codex' | 'opencode' | 'pi';
 *   codiffVersion: string;
 *   openExternal: (url: string) => Promise<void>;
 *   planFile: string;
 *   serviceUrlOverride?: string;
 *   sessionId?: string;
 * }} options
 */
const sharePlanFile = async ({
  agent,
  codiffVersion,
  openExternal,
  planFile,
  serviceUrlOverride,
  sessionId,
}) => {
  const config = readConfig();
  const uploader = readLocalIdentity();
  const content = readFileSync(planFile, 'utf8');
  const review = {
    document: {
      id: `plan:${planFile}`,
      path: planFile,
      version: '',
    },
    threads: [],
    version: /** @type {const} */ (1),
  };

  return uploadSnapshot({
    codiffVersion,
    openExternal,
    serviceUrlOverride,
    snapshot: createSharedPlanSnapshot({
      agent,
      codiffVersion,
      content,
      filePath: planFile,
      review,
      sessionId,
      theme: config.settings.theme,
    }),
    target: resolvePlanShareTarget({ overrideUrl: serviceUrlOverride }),
    uploader,
  });
};

module.exports = {
  sharePlanFile,
};
