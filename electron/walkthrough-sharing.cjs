// @ts-check

const CLOUDFLARE_EMAIL_SUFFIX = '@cloudflare.com';
const CLOUDFLARE_SHARE_SERVER_URL = 'https://codiff.cloudflare.dev';
const PUBLIC_SHARE_SERVER_URL = 'https://api.codiff.dev';

/** @param {string | undefined} email */
const isCloudflareEmail = (email) =>
  typeof email === 'string' && email.trim().toLowerCase().endsWith(CLOUDFLARE_EMAIL_SUFFIX);

/**
 * @param {{
 *   email?: string;
 *   overrideUrl?: string;
 *   username?: string;
 * }} options
 */
const resolveWalkthroughShareTarget = ({ email, overrideUrl, username }) => {
  const serviceUrlOverride = overrideUrl?.trim().replace(/\/+$/, '');

  if (isCloudflareEmail(email)) {
    return {
      authenticated: !serviceUrlOverride,
      internal: true,
      serviceUrl: serviceUrlOverride || CLOUDFLARE_SHARE_SERVER_URL,
    };
  }

  if (username === 'cpojer') {
    return {
      authenticated: false,
      internal: false,
      serviceUrl: serviceUrlOverride || PUBLIC_SHARE_SERVER_URL,
    };
  }

  return null;
};

/** @param {{overrideUrl?: string}} options */
const resolvePlanShareTarget = ({ overrideUrl }) => {
  const serviceUrlOverride = overrideUrl?.trim().replace(/\/+$/, '');
  return {
    authenticated: !serviceUrlOverride,
    internal: true,
    serviceUrl: serviceUrlOverride || CLOUDFLARE_SHARE_SERVER_URL,
  };
};

module.exports = {
  resolvePlanShareTarget,
  resolveWalkthroughShareTarget,
};
