import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const electronPackageName = process.platform === 'win32' ? 'electron-windows' : 'electron';
const electronMainPath = require.resolve(electronPackageName);
const electronCli = path.join(path.dirname(electronMainPath), 'cli.js');
const electronArgs = ['.'];

if (process.argv.includes('--capture')) {
  process.env.VIBE99_CAPTURE = '1';
}

const result = spawnSync(process.execPath, [electronCli, ...electronArgs], {
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
