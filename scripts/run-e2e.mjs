import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync, spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const e2eDir = path.join(projectRoot, 'e2e');
const isWindows = os.platform() === 'win32';
const wdioBin = path.join(e2eDir, 'node_modules', '.bin', isWindows ? 'wdio.cmd' : 'wdio');

function printHelp() {
  console.log(`Run Vibe99 e2e tests.

Usage:
  npm run test:e2e
  npm run test:e2e -- layout
  npm run test:e2e -- --spec ./tests/layout.spec.js
  npm run test:e2e -- layout --grep "opens layout in new window"

Options:
  --spec, -s <file>    WDIO spec path. Short names like "layout" map to ./tests/layout.spec.js.
  --grep, -g <text>    Run Mocha tests whose full title matches the text or regex.
  -v                   Verbose (info level).
  -vv                  Very verbose (info + debug level).
  --help, -h           Show this help.

Any other options are passed through to WDIO.
`);
}

function normalizeSpec(value) {
  let spec = value.replaceAll('\\', '/');

  if (spec.startsWith('e2e/')) {
    spec = spec.slice('e2e/'.length);
  }

  if (spec.includes('*')) {
    return spec;
  }

  if (!spec.includes('/')) {
    spec = spec.endsWith('.spec.js') ? spec : `${spec}.spec.js`;
    return `./tests/${spec}`;
  }

  if (spec.startsWith('tests/')) {
    return `./${spec}`;
  }

  return spec;
}

function requireValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

const args = process.argv.slice(2);
const LOG_LEVELS = ['warn', 'info', 'debug'];
const specs = [];
const passThrough = [];
let grep = '';
let verbosity = 0;

try {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }

    if (arg === '--grep' || arg === '-g') {
      grep = requireValue(args, i, arg);
      i += 1;
      continue;
    }

    if (arg.startsWith('--grep=')) {
      grep = arg.slice('--grep='.length);
      continue;
    }

    if (arg === '--spec' || arg === '-s') {
      specs.push(normalizeSpec(requireValue(args, i, arg)));
      i += 1;
      continue;
    }

    if (arg.startsWith('--spec=')) {
      specs.push(normalizeSpec(arg.slice('--spec='.length)));
      continue;
    }

    if (arg === '-vv') {
      verbosity = 2;
      continue;
    }

    if (arg === '-v') {
      verbosity = Math.min(verbosity + 1, 2);
      continue;
    }

    if (arg.startsWith('-')) {
      passThrough.push(arg);
      continue;
    }

    specs.push(normalizeSpec(arg));
  }
} catch (error) {
  console.error(error.message);
  console.error('Run `npm run e2e -- --help` for usage.');
  process.exit(1);
}

if (!fs.existsSync(wdioBin)) {
  console.log('e2e dependencies not found — installing...');
  execSync('npm install', { cwd: e2eDir, stdio: 'inherit' });
}

const wdioArgs = ['run', 'wdio.conf.js'];
for (const spec of specs) {
  wdioArgs.push('--spec', spec);
}
wdioArgs.push(...passThrough);

const child = spawn(wdioBin, wdioArgs, {
  cwd: e2eDir,
  env: {
    ...process.env,
    E2E_GREP: grep,
    E2E_LOG_LEVEL: LOG_LEVELS[verbosity],
  },
  shell: isWindows,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
