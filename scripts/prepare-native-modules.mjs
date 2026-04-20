import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const WINDOWS_ELECTRON_VERSION = '29.4.6';
const WINDOWS_ELECTRON_ABI = '121';

function exitOnFailure(result, description) {
  if (!result.error && result.status === 0) {
    return;
  }

  if (result.error) {
    throw result.error;
  }

  console.error(`${description} failed with exit code ${result.status ?? 'unknown'}.`);
  process.exit(result.status ?? 1);
}

function downloadFile(url, destinationPath) {
  const result = spawnSync(
    'curl.exe',
    ['-L', '--retry', '3', '--connect-timeout', '20', '--max-time', '180', '-o', destinationPath, url],
    {
      stdio: 'inherit',
      env: process.env,
    }
  );

  exitOnFailure(result, `download from ${url}`);
}

function extractTarGz(archivePath, destinationPath) {
  fs.mkdirSync(destinationPath, { recursive: true });
  const result = spawnSync('C:\\Windows\\System32\\tar.exe', ['-xf', archivePath, '-C', destinationPath], {
    stdio: 'inherit',
    env: process.env,
  });

  exitOnFailure(result, `extract ${archivePath}`);
}

function prepareWindowsPtyRuntime() {
  const packageJsonPath = require.resolve('@homebridge/node-pty-prebuilt-multiarch/package.json');
  const packageRoot = path.dirname(packageJsonPath);
  const assetName = `node-pty-prebuilt-multiarch-v0.13.1-electron-v${WINDOWS_ELECTRON_ABI}-win32-${process.arch}.tar.gz`;
  const assetUrl = `https://github.com/homebridge/node-pty-prebuilt-multiarch/releases/download/v0.13.1/${assetName}`;
  const archivePath = path.join(os.tmpdir(), assetName);

  downloadFile(assetUrl, archivePath);
  extractTarGz(archivePath, packageRoot);

  const postInstallPath = path.join(packageRoot, 'scripts', 'post-install.js');
  const postInstall = spawnSync(process.execPath, [postInstallPath], {
    stdio: 'inherit',
    env: process.env,
  });

  exitOnFailure(postInstall, 'node-pty Windows post-install');
}

if (process.platform === 'win32') {
  const electronWindowsPackageJsonPath = require.resolve('electron-windows/package.json');
  const electronWindowsRoot = path.dirname(electronWindowsPackageJsonPath);
  const electronWindowsVersion = require(electronWindowsPackageJsonPath).version;

  if (electronWindowsVersion !== WINDOWS_ELECTRON_VERSION) {
    console.error(
      `Unexpected Windows Electron version ${electronWindowsVersion}; expected ${WINDOWS_ELECTRON_VERSION}.`
    );
    process.exit(1);
  }

  const electronInstall = spawnSync(process.execPath, [path.join(electronWindowsRoot, 'install.js')], {
    stdio: 'inherit',
    env: process.env,
  });
  exitOnFailure(electronInstall, 'electron-windows install');

  prepareWindowsPtyRuntime();
  process.exit(0);
}

await import('./ensure-node-pty-runtime.mjs');
