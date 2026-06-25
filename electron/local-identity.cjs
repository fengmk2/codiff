// @ts-check

const { userInfo } = require('node:os');

const readLocalIdentity = () => {
  try {
    const username = userInfo().username.trim();
    return username ? { name: username } : { name: '' };
  } catch {
    return { name: '' };
  }
};

module.exports = {
  readLocalIdentity,
};
