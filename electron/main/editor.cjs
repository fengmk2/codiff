// @ts-check

const { execFile } = require('node:child_process');

/**
 * @typedef {{args: Array<string>; command: string}} EditorCommand
 */

/** @param {{platform?: NodeJS.Platform; shell: import('electron').Shell}} options */
const createEditorOpener = ({ platform = process.platform, shell }) => {
  /** @param {string} command */
  const parseEditorCommand = (command) =>
    command.match(/"[^"]+"|'[^']+'|\S+/g)?.map((part) => part.replace(/^['"]|['"]$/g, '')) ?? [];

  /** @param {string} command @param {ReadonlyArray<string>} args */
  const runEditorCommand = (command, args) =>
    new Promise((resolveCommand) => {
      execFile(command, args, { windowsHide: true }, (error) => resolveCommand(!error));
    });

  /** @param {string} absolutePath @returns {Array<EditorCommand>} */
  const getEditorCommands = (absolutePath) => {
    /** @type {Array<EditorCommand>} */
    const commands = [];
    const customEditor = process.env.CODIFF_EDITOR;
    if (customEditor) {
      const [command, ...args] = parseEditorCommand(customEditor);
      if (command) {
        const hasFilePlaceholder = args.some((arg) => arg.includes('{file}'));
        commands.push({
          args:
            args.length > 0
              ? [
                  ...args.map((arg) => arg.replaceAll('{file}', absolutePath)),
                  ...(hasFilePlaceholder ? [] : [absolutePath]),
                ]
              : [absolutePath],
          command,
        });
      }
    }

    for (const command of ['/opt/homebrew/bin/code', '/usr/local/bin/code', 'code']) {
      commands.push({
        args: ['-g', absolutePath],
        command,
      });
    }

    if (platform === 'darwin') {
      commands.push({
        args: ['-a', 'Visual Studio Code', absolutePath],
        command: 'open',
      });
      commands.push({
        args: ['-t', absolutePath],
        command: 'open',
      });
    }

    return commands;
  };

  /** @param {string} absolutePath */
  const openFileInEditor = async (absolutePath) => {
    for (const { args, command } of getEditorCommands(absolutePath)) {
      if (await runEditorCommand(command, args)) {
        return;
      }
    }

    await shell.openPath(absolutePath);
  };

  return {
    getEditorCommands,
    openFileInEditor,
    parseEditorCommand,
  };
};

module.exports = { createEditorOpener };
