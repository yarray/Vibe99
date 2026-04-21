const { app, BrowserWindow, ipcMain, Menu, nativeImage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pty = require('./pty.js');
const { loadConfig, saveConfig } = require('./dist/config.js');

const PTY_PACKAGE_NAME = '@homebridge/node-pty-prebuilt-multiarch';
const SETTINGS_FILE_NAME = 'settings.json';
const APP_ID = 'com.vibe99.app';
const APP_ICON_PNG_PATH = path.join(__dirname, '..', 'assets', 'icons', 'icon.png');
const APP_ICON_ICO_PATH = path.join(__dirname, '..', 'assets', 'icons', 'icon.ico');

const isCaptureMode = process.env.VIBE99_CAPTURE === '1';
const terminalSessions = new Map();

function getDefaultWorkingDirectory() {
  return app.isPackaged ? app.getPath('home') : process.cwd();
}

function getCaptureOutputPath() {
  return path.join(os.tmpdir(), 'vibe99-prototype.png');
}

function getSettingsFilePath() {
  return path.join(app.getPath('userData'), SETTINGS_FILE_NAME);
}

function ensurePtyHelperExecutable() {
  if (process.platform !== 'darwin') {
    return;
  }

  const nodePtyRoot = path.dirname(require.resolve(`${PTY_PACKAGE_NAME}/package.json`)).replace(
    `${path.sep}app.asar${path.sep}`,
    `${path.sep}app.asar.unpacked${path.sep}`
  );

  const helperCandidates = [
    path.join(nodePtyRoot, 'build', 'Release', 'spawn-helper'),
    path.join(
      nodePtyRoot,
      'prebuilds',
      process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64',
      'spawn-helper'
    ),
  ];

  for (const helperPath of helperCandidates) {
    try {
      fs.chmodSync(helperPath, 0o755);
      return;
    } catch {}
  }
}

function isExecutableFile(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function getShellLaunchConfigs() {
  if (process.platform === 'win32') {
    return [
      { shell: process.env.VIBE99_WINDOWS_SHELL, args: [] },
      { shell: 'powershell.exe', args: [] },
      { shell: 'pwsh.exe', args: [] },
      { shell: process.env.ComSpec, args: [] },
      { shell: 'cmd.exe', args: [] },
    ].filter((candidate) => typeof candidate.shell === 'string' && candidate.shell.length > 0);
  }

  const candidates = [];

  if (process.env.SHELL && path.isAbsolute(process.env.SHELL)) {
    candidates.push(process.env.SHELL);
  }

  if (process.platform === 'darwin') {
    candidates.push('/bin/zsh', '/bin/bash', '/bin/sh');
  } else {
    candidates.push('/bin/bash', '/bin/sh');
  }

  return [...new Set(candidates)]
    .filter((shell) => isExecutableFile(shell))
    .map((shell) => ({ shell, args: ['-il'] }));
}

function getSpawnWorkingDirectory(cwd) {
  const preferredCwd = cwd || getDefaultWorkingDirectory();

  try {
    if (fs.statSync(preferredCwd).isDirectory()) {
      return preferredCwd;
    }
  } catch {}

  return app.getPath('home');
}

function destroyTerminalSession(paneId) {
  const session = terminalSessions.get(paneId);
  if (!session) {
    return;
  }

  try {
    session.pty.kill();
  } catch {}

  terminalSessions.delete(paneId);
}

function destroyAllTerminalSessions() {
  for (const paneId of terminalSessions.keys()) {
    destroyTerminalSession(paneId);
  }
}

ipcMain.handle('vibe99:terminal-create', (event, payload) => {
  const { paneId, cols, rows, cwd } = payload;
  destroyTerminalSession(paneId);

  const webContents = event.sender;
  const spawnCwd = getSpawnWorkingDirectory(cwd);
  const shellConfigs = getShellLaunchConfigs();
  let terminalPty;
  let lastError;

  for (const { shell, args } of shellConfigs) {
    try {
      terminalPty = pty.spawn(shell, args, {
        name: 'xterm-256color',
        cols: Math.max(20, cols || 80),
        rows: Math.max(8, rows || 24),
        cwd: spawnCwd,
        ...(process.platform === 'win32'
          ? {
              useConpty: false,
            }
          : {}),
        env: {
          ...process.env,
          COLORTERM: 'truecolor',
          TERM: 'xterm-256color',
        },
      });
      console.log(`pty-spawn-success shell=${shell} cwd=${spawnCwd}`);
      break;
    } catch (error) {
      lastError = error;
      console.error(`pty-spawn-failed shell=${shell} cwd=${spawnCwd}`, error);
    }
  }

  if (!terminalPty) {
    throw lastError ?? new Error(`No executable shell found for cwd ${spawnCwd}`);
  }

  terminalPty.onData((data) => {
    if (!webContents.isDestroyed()) {
      webContents.send('vibe99:terminal-data', { paneId, data });
    }
  });

  terminalPty.onExit((exitEvent) => {
    terminalSessions.delete(paneId);
    if (!webContents.isDestroyed()) {
      webContents.send('vibe99:terminal-exit', { paneId, exitCode: exitEvent.exitCode });
    }
  });

  terminalSessions.set(paneId, {
    pty: terminalPty,
    webContentsId: webContents.id,
  });

  return { paneId };
});

ipcMain.handle('vibe99:terminal-write', (_event, payload) => {
  const { paneId, data } = payload;
  const session = terminalSessions.get(paneId);
  if (session) {
    session.pty.write(data);
  }
});

ipcMain.handle('vibe99:terminal-resize', (_event, payload) => {
  const { paneId, cols, rows } = payload;
  const session = terminalSessions.get(paneId);
  if (session) {
    session.pty.resize(Math.max(20, cols || 80), Math.max(8, rows || 24));
  }
});

ipcMain.handle('vibe99:terminal-destroy', (_event, payload) => {
  destroyTerminalSession(payload.paneId);
});

ipcMain.handle('vibe99:window-close', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (window) {
    window.close();
  }
});

ipcMain.handle('vibe99:settings-load', () => loadConfig(getSettingsFilePath()));

ipcMain.handle('vibe99:settings-save', (_event, payload) =>
  saveConfig(getSettingsFilePath(), payload)
);

ipcMain.handle('vibe99:show-context-menu', (event, payload) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) {
    return;
  }

  const sendMenuAction = (action) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send('vibe99:menu-action', {
        action,
        paneId: payload.paneId ?? null,
      });
    }
  };

  let template = [];

  if (payload.kind === 'terminal') {
    template = [
      {
        label: 'Copy',
        enabled: Boolean(payload.hasSelection),
        click: () => sendMenuAction('terminal-copy'),
      },
      {
        label: 'Paste',
        enabled: Boolean(payload.hasClipboardText),
        click: () => sendMenuAction('terminal-paste'),
      },
      {
        label: 'Paste Image',
        enabled: Boolean(payload.hasClipboardImage),
        click: () => sendMenuAction('terminal-paste-image'),
      },
      {
        type: 'separator',
      },
      {
        label: 'Select All',
        click: () => sendMenuAction('terminal-select-all'),
      },
    ];
  } else if (payload.kind === 'tab') {
    template = [
      {
        label: 'Rename Tab',
        click: () => sendMenuAction('tab-rename'),
      },
      {
        label: 'Close Tab',
        enabled: Boolean(payload.canClose),
        click: () => sendMenuAction('tab-close'),
      },
    ];
  }

  if (template.length === 0) {
    return;
  }

  Menu.buildFromTemplate(template).popup({
    window,
    x: Number.isFinite(payload.x) ? Math.round(payload.x) : undefined,
    y: Number.isFinite(payload.y) ? Math.round(payload.y) : undefined,
  });
});

function createWindow() {
  const window = new BrowserWindow({
    width: 1600,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#111111',
    autoHideMenuBar: true,
    icon:
      process.platform === 'win32'
        ? APP_ICON_ICO_PATH
        : process.platform === 'linux'
          ? APP_ICON_PNG_PATH
          : undefined,
    show: !isCaptureMode,
    webPreferences: {
      additionalArguments: [`--vibe99-default-cwd=${getDefaultWorkingDirectory()}`],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  window.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`renderer-console[level=${level}] ${sourceId}:${line} ${message}`);
  });

  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`preload-error ${preloadPath}`, error);
  });

  window.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

  if (isCaptureMode) {
    window.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const snapshot = await window.webContents.executeJavaScript(`
            (() => ({
              tabs: document.getElementById('tabs-list')?.childElementCount ?? -1,
              status: document.getElementById('status-label')?.textContent ?? null,
              bodyText: document.body.innerText.slice(0, 200),
              hasRendererApi: typeof window.vibe99 !== 'undefined'
            }))()
          `);
          console.log('capture-snapshot', JSON.stringify(snapshot));
        } catch (error) {
          console.error('capture-snapshot-error', error);
        }
        const image = await window.webContents.capturePage();
        fs.writeFileSync(getCaptureOutputPath(), image.toPNG());
        app.quit();
      }, 2500);
    });
  }
}

app.whenReady().then(() => {
  ensurePtyHelperExecutable();

  if (process.platform === 'win32') {
    app.setAppUserModelId(APP_ID);
  }

  if (process.platform === 'darwin') {
    app.dock.setIcon(nativeImage.createFromPath(APP_ICON_PNG_PATH));
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('before-quit', () => {
  destroyAllTerminalSessions();
});

app.on('window-all-closed', () => {
  app.quit();
});
