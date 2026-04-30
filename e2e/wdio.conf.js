import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const isWindows = os.platform() === 'win32';
const binaryExt = isWindows ? '.exe' : '';

const releaseBinary = path.join(projectRoot, 'src-tauri', 'target', 'release', `vibe99${binaryExt}`);
const debugBinary = path.join(projectRoot, 'src-tauri', 'target', 'debug', `vibe99${binaryExt}`);
const binaryPath = fs.existsSync(releaseBinary) ? releaseBinary : debugBinary;

const appDataDir = isWindows
  ? path.join(os.homedir(), 'AppData', 'Roaming', 'com.vibe99.app')
  : path.join(os.homedir(), '.local', 'share', 'com.vibe99.app');
const runAppShim = path.join(__dirname, 'run-app.sh');
const linuxbrewGlibc = '/home/linuxbrew/.linuxbrew/Cellar/glibc/2.39/lib/ld-linux-x86-64.so.2';
const needsRuntimeShim = !isWindows && fs.existsSync(linuxbrewGlibc);
const applicationPath = needsRuntimeShim && fs.existsSync(runAppShim) ? runAppShim : binaryPath;

let tauriDriver;
let xvfb;
let shutdown = false;

function startXvfb() {
  if (isWindows) return Promise.resolve();
  const display = ':98';
  xvfb = spawn('Xvfb', [display, '-screen', '0', '1280x1024x24'], {
    stdio: [null, process.stdout, process.stderr],
  });

  xvfb.on('error', (error) => {
    console.error('Xvfb error:', error);
    process.exit(1);
  });

  xvfb.on('exit', (code) => {
    if (!shutdown) {
      console.error('Xvfb exited unexpectedly with code:', code);
      process.exit(1);
    }
  });

  process.env.DISPLAY = display;
  return new Promise((resolve) => setTimeout(resolve, 1000));
}

function stopXvfb() {
  if (xvfb) {
    xvfb.kill();
    xvfb = null;
  }
}

function startTauriDriver() {
  if (tauriDriver) return;
  const driverPath = path.resolve(os.homedir(), '.cargo', 'bin', `tauri-driver${binaryExt}`);
  const args = [];
  if (isWindows) {
    const nativeDriver = path.join(__dirname, 'bin', 'msedgedriver.exe');
    args.push('--native-driver', nativeDriver);
  }

  tauriDriver = spawn(driverPath, args, {
    stdio: [null, process.stdout, process.stderr],
    env: { ...process.env },
  });

  tauriDriver.on('error', (error) => {
    console.error('tauri-driver error:', error);
    process.exit(1);
  });

  tauriDriver.on('exit', (code) => {
    if (!shutdown) {
      console.error('tauri-driver exited unexpectedly with code:', code);
      process.exit(1);
    }
  });

  return new Promise((resolve) => setTimeout(resolve, 2000));
}

function stopTauriDriver() {
  shutdown = true;
  if (tauriDriver) {
    tauriDriver.kill();
    tauriDriver = null;
  }
}

export const config = {
  host: '127.0.0.1',
  port: 4444,
  specs: ['./tests/**/*.spec.js'],
  exclude: [],
  maxInstances: 1,

  capabilities: [
    {
      maxInstances: 1,
      'tauri:options': {
        application: applicationPath,
      },
    },
  ],

  reporters: ['spec'],
  framework: 'mocha',
  mochaOpts: {
    ui: 'bdd',
    timeout: 60000,
    grep: process.env.E2E_GREP || undefined,
  },

  onPrepare: async () => {
    if (!fs.existsSync(binaryPath)) {
      throw new Error(
        `Application binary not found at ${binaryPath}. ` +
        `Run 'npm run tauri:build' from the project root first.`,
      );
    }

    await startXvfb();
    await startTauriDriver();
  },

  beforeSession: () => {
    const settingsFile = path.join(appDataDir, 'settings.json');
    if (fs.existsSync(settingsFile)) {
      fs.unlinkSync(settingsFile);
    }
  },

  onComplete: () => {
    stopTauriDriver();
    stopXvfb();
  },
};

for (const signal of ['exit', 'SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    stopTauriDriver();
    stopXvfb();
    if (signal !== 'exit') process.exit(0);
  });
}
