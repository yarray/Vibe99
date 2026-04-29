import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const releaseBinary = path.join(projectRoot, 'src-tauri', 'target', 'release', 'vibe99');
const debugBinary = path.join(projectRoot, 'src-tauri', 'target', 'debug', 'vibe99');
const binaryPath = fs.existsSync(releaseBinary) ? releaseBinary : debugBinary;

let tauriDriver;
let shutdown = false;

function startTauriDriver() {
  if (tauriDriver) return;
  const driverPath = path.resolve(os.homedir(), '.cargo', 'bin', 'tauri-driver');
  tauriDriver = spawn(driverPath, [], {
    stdio: [null, process.stdout, process.stderr],
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

  // Give tauri-driver a moment to bind the port.
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
  maxInstances: 1,

  capabilities: [
    {
      maxInstances: 1,
      'tauri:options': {
        application: binaryPath,
      },
    },
  ],

  reporters: ['spec'],
  framework: 'mocha',
  mochaOpts: {
    ui: 'bdd',
    timeout: 60000,
  },

  onPrepare: () => {
    if (!fs.existsSync(binaryPath)) {
      throw new Error(
        `Application binary not found at ${binaryPath}. ` +
        `Run 'npm run tauri:build' from the project root first.`,
      );
    }
    return startTauriDriver();
  },

  onComplete: () => {
    stopTauriDriver();
  },
};

for (const signal of ['exit', 'SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    stopTauriDriver();
    if (signal !== 'exit') process.exit(0);
  });
}
