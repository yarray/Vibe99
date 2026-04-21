import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const packageJsonPath = require.resolve('@homebridge/node-pty-prebuilt-multiarch/package.json');
const packageRoot = path.dirname(packageJsonPath);
const prebuildRoot = path.join(packageRoot, 'prebuilds', `${process.platform}-${process.arch}`);

function getAbiFromFilename(fileName) {
  const match = /^node\.abi(\d+)(?:\.musl)?\.node$/.exec(fileName);
  return match ? Number(match[1]) : null;
}

function selectNodePrebuild() {
  if (!fs.existsSync(prebuildRoot)) {
    return null;
  }

  const fileNames = fs.readdirSync(prebuildRoot);
  const currentNodeAbi = Number(process.versions.modules);
  const muslSuffix = fs.existsSync('/etc/alpine-release') ? '.musl.node' : '.node';
  const exactNodeCandidate = `node.abi${currentNodeAbi}${muslSuffix}`;

  if (fileNames.includes(exactNodeCandidate)) {
    return exactNodeCandidate;
  }

  const candidates = fileNames
    .map((fileName) => ({
      fileName,
      abi: getAbiFromFilename(fileName),
      musl: fileName.endsWith('.musl.node'),
    }))
    .filter((candidate) => candidate.abi !== null)
    .filter((candidate) => candidate.musl === muslSuffix.includes('.musl.'))
    .sort((left, right) => right.abi - left.abi);

  return candidates[0]?.fileName ?? null;
}

function ensureElectronAlias() {
  let electronVersion = process.env.npm_package_devDependencies_electron;
  let electronModules = null;

  try {
    const electronBinary = require('electron');
    electronModules = Number(
      execFileSync(electronBinary, ['-e', 'console.log(process.versions.modules)'], {
        encoding: 'utf8',
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: '1',
        },
      }).trim()
    );

    if (!electronVersion) {
      electronVersion = require('electron/package.json').version;
    }
  } catch {
    return;
  }

  const nodeSource = selectNodePrebuild();
  if (!nodeSource || !electronModules) {
    return;
  }

  const aliasName = `electron.abi${electronModules}${nodeSource.endsWith('.musl.node') ? '.musl.node' : '.node'}`;
  const aliasPath = path.join(prebuildRoot, aliasName);
  const sourcePath = path.join(prebuildRoot, nodeSource);

  if (fs.existsSync(aliasPath)) {
    return;
  }

  fs.copyFileSync(sourcePath, aliasPath);
  console.log(
    `Created node-pty Electron alias for Electron ${electronVersion}: ${aliasName} -> ${nodeSource}`
  );
}

ensureElectronAlias();
