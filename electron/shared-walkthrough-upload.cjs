// @ts-check

const poll = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {{
 *   openExternal: (url: string) => Promise<void>;
 *   serviceUrl: string;
 *   snapshot: unknown;
 * }} options
 */
const uploadSharedWalkthrough = async ({ openExternal, serviceUrl, snapshot }) => {
  const baseUrl = serviceUrl.replace(/\/+$/, '');
  const intentResponse = await fetch(`${baseUrl}/api/upload-intents`, { method: 'POST' });
  if (!intentResponse.ok) {
    throw new Error(`Codiff share service rejected upload intent (${intentResponse.status}).`);
  }

  /** @type {{claimUrl: string; code: string; pollUrl: string; secret: string}} */
  const intent = await intentResponse.json();
  await openExternal(intent.claimUrl);

  let uploadToken = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const pollResponse = await fetch(intent.pollUrl);
    if (pollResponse.ok) {
      const result = await pollResponse.json();
      if (result.status === 'claimed' && typeof result.uploadToken === 'string') {
        uploadToken = result.uploadToken;
        break;
      }
    } else if (pollResponse.status === 410) {
      throw new Error('Codiff share link expired before it was authorized.');
    }
    await poll(1000);
  }

  if (!uploadToken) {
    throw new Error('Codiff share upload was not authorized in time.');
  }

  const uploadResponse = await fetch(`${baseUrl}/api/uploads`, {
    body: JSON.stringify(snapshot),
    headers: {
      authorization: `Bearer ${uploadToken}`,
      'content-type': 'application/json',
      'x-codiff-upload-code': intent.code,
    },
    method: 'POST',
  });
  const result = await uploadResponse.json().catch(() => null);
  if (!uploadResponse.ok || result?.status !== 'uploaded' || typeof result.url !== 'string') {
    throw new Error(result?.error || `Codiff share upload failed (${uploadResponse.status}).`);
  }

  return result.url;
};

module.exports = {
  uploadSharedWalkthrough,
};
