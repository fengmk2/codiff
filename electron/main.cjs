const { existsSync } = require('node:fs');
const { dirname, join, relative, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, ipcMain, Menu, nativeTheme, screen, shell } = require('electron');
const { listRepositoryHistory, readRepositoryState } = require('./git-state.cjs');

const root = dirname(__dirname);
const windowRepositories = new Map();

const getLaunchPath = () => resolve(process.env.CODIFF_REPOSITORY_PATH || process.cwd());

const createWindow = (repositoryPath) => {
  const display = screen.getPrimaryDisplay();
  const { height, width } = display.workAreaSize;
  const window = new BrowserWindow({
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#141414' : '#ffffff',
    center: true,
    height: Math.max(720, Math.floor(height * 0.86)),
    minHeight: 520,
    minWidth: 880,
    show: false,
    title: `Codiff - ${repositoryPath}`,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: join(__dirname, 'preload.cjs'),
    },
    width: Math.max(1120, Math.floor(width * 0.86)),
  });

  windowRepositories.set(window.webContents.id, repositoryPath);
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => windowRepositories.delete(window.webContents.id));

  const rendererURL = process.env.ELECTRON_RENDERER_URL;
  if (rendererURL) {
    window.loadURL(rendererURL);
  } else {
    window.loadURL(pathToFileURL(join(root, 'dist/index.html')).toString());
  }
};

const lock = app.requestSingleInstanceLock({ repositoryPath: getLaunchPath() });

if (!lock) {
  app.quit();
} else {
  app.setName('Codiff');
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin'
        ? [
            {
              label: app.name,
              submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }],
            },
          ]
        : []),
      {
        label: 'File',
        submenu: [process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' }],
      },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          {
            accelerator: 'CommandOrControl+Alt+J',
            click: (_menuItem, browserWindow) => browserWindow?.webContents.toggleDevTools(),
            label: 'Toggle Developer Tools',
          },
        ],
      },
    ]),
  );

  app.on('second-instance', (event, commandLine, workingDirectory, additionalData) => {
    createWindow(resolve(additionalData?.repositoryPath || workingDirectory));
  });

  app.on('ready', () => createWindow(getLaunchPath()));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(getLaunchPath());
    }
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}

ipcMain.handle('codiff:getRepositoryState', async (event, source) => {
  const repositoryPath = windowRepositories.get(event.sender.id) || getLaunchPath();
  return readRepositoryState(repositoryPath, source);
});

ipcMain.handle('codiff:getRepositoryHistory', async (event, limit) => {
  const repositoryPath = windowRepositories.get(event.sender.id) || getLaunchPath();
  return listRepositoryHistory(repositoryPath, limit);
});

ipcMain.handle('codiff:showInFolder', async (event, filePath) => {
  const repositoryPath = windowRepositories.get(event.sender.id) || getLaunchPath();
  const state = await readRepositoryState(repositoryPath);
  const absolutePath = resolve(state.root, filePath);

  if (existsSync(absolutePath)) {
    shell.showItemInFolder(absolutePath);
  } else {
    shell.openPath(state.root);
  }
});

ipcMain.handle('codiff:getRelativePath', async (event, filePath) => {
  const repositoryPath = windowRepositories.get(event.sender.id) || getLaunchPath();
  const state = await readRepositoryState(repositoryPath);
  return relative(state.root, filePath);
});
