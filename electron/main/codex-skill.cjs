// @ts-check

const {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
} = require('node:fs');
const { dirname, join } = require('node:path');

/**
 * @param {{app: import('electron').App; dialog: import('electron').Dialog; root: string}} options
 */
const createCodexSkillInstaller = ({ app, dialog, root }) => {
  const getCodexSkillSourcePath = () =>
    app.isPackaged
      ? join(process.resourcesPath, 'app/codex/skills/codiff')
      : join(root, 'codex/skills/codiff');

  const getCodexSkillTargetPath = () => join(app.getPath('home'), '.codex/skills/codiff');

  /** @param {string} targetPath */
  const isInstalledCodexSkill = (targetPath) => {
    try {
      if (!existsSync(targetPath)) {
        return false;
      }

      const target = lstatSync(targetPath);
      if (!target.isSymbolicLink()) {
        return false;
      }

      return realpathSync(targetPath) === realpathSync(getCodexSkillSourcePath());
    } catch {
      return false;
    }
  };

  const getCodexSkillStatus = () => {
    const targetPath = getCodexSkillTargetPath();

    return {
      installed: isInstalledCodexSkill(targetPath),
      path: targetPath,
    };
  };

  /** @param {import('electron').BaseWindow | undefined | null} browserWindow */
  const installCodexSkill = async (browserWindow) => {
    try {
      const sourcePath = getCodexSkillSourcePath();
      const targetPath = getCodexSkillTargetPath();

      if (!existsSync(sourcePath)) {
        throw new Error(`Could not find Codex skill at ${sourcePath}.`);
      }

      mkdirSync(dirname(targetPath), { recursive: true });
      accessSync(dirname(targetPath), constants.W_OK);

      if (existsSync(targetPath)) {
        const target = lstatSync(targetPath);

        if (!target.isSymbolicLink()) {
          throw new Error(`${targetPath} already exists and is not a symlink.`);
        }

        unlinkSync(targetPath);
      }

      symlinkSync(sourcePath, targetPath, process.platform === 'win32' ? 'junction' : 'dir');

      /** @type {import('electron').MessageBoxOptions} */
      const successMessage = {
        buttons: ['OK'],
        message: `Installed the Codiff Codex skill at ${targetPath}.`,
        type: 'info',
      };
      if (browserWindow) {
        await dialog.showMessageBox(browserWindow, successMessage);
      } else {
        await dialog.showMessageBox(successMessage);
      }
      return true;
    } catch (error) {
      /** @type {import('electron').MessageBoxOptions} */
      const errorMessage = {
        buttons: ['OK'],
        detail: error instanceof Error ? error.message : String(error),
        message: 'Could not install the Codex skill.',
        type: 'error',
      };
      if (browserWindow) {
        await dialog.showMessageBox(browserWindow, errorMessage);
      } else {
        await dialog.showMessageBox(errorMessage);
      }
      return false;
    }
  };

  return {
    getCodexSkillStatus,
    installCodexSkill,
  };
};

module.exports = { createCodexSkillInstaller };
