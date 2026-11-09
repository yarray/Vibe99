import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { waitForAppReady } from '../helpers/app-launch.js';
import { resetSettings } from '../helpers/settings-helpers.js';
import { cleanupApp } from '../helpers/app-cleanup.js';
import { waitForCondition } from '../helpers/wait-for.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..', '..');
const binaryName = process.platform === 'win32' ? 'vibe99ctl.exe' : 'vibe99ctl';

let ctlBinary = null;

/**
 * Locate the CLI binary next to the app binary, building it once if the app
 * build did not already produce it.
 */
function resolveCtlBinary() {
  if (ctlBinary) return ctlBinary;

  for (const profile of ['release', 'debug']) {
    const candidate = path.join(projectRoot, 'src-tauri', 'target', profile, binaryName);
    if (fs.existsSync(candidate)) {
      ctlBinary = candidate;
      return ctlBinary;
    }
  }

  const build = spawnSync('cargo', ['build', '--bin', 'vibe99ctl'], {
    cwd: path.join(projectRoot, 'src-tauri'),
    encoding: 'utf8',
  });
  if (build.status !== 0) {
    throw new Error(`failed to build vibe99ctl:\n${build.stderr || build.stdout}`);
  }

  const built = path.join(projectRoot, 'src-tauri', 'target', 'debug', binaryName);
  if (!fs.existsSync(built)) {
    throw new Error(`vibe99ctl not found at ${built}`);
  }
  ctlBinary = built;
  return ctlBinary;
}

function runCtl(args) {
  const result = spawnSync(resolveCtlBinary(), args, {
    encoding: 'utf8',
    timeout: 15000,
  });
  return {
    status: result.status,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
  };
}

async function readTerminalFontSize() {
  return browser.execute(() => {
    const el = document.querySelector('.terminal-host');
    const term = el ? el._xterm : null;
    return term ? term.options.fontSize : null;
  });
}

async function loadSettings() {
  return browser.execute(() => window.__TAURI__.core.invoke('settings_load'));
}

describe('vibe99ctl settings', () => {
  beforeEach(async () => {
    await waitForAppReady();
    await resetSettings();
  });

  afterEach(async () => {
    await cleanupApp();
  });

  it('applies a setting to the running UI without a restart', async () => {
    const result = runCtl(['settings', 'set', 'fontSize', '18']);
    expect(result.status).toBe(0);

    const applied = JSON.parse(result.stdout);
    expect(applied.ok).toBe(true);
    expect(applied.changed.fontSize).toBe(18);

    await waitForCondition(async () => (await readTerminalFontSize()) === 18, 5000, 200);

    const persisted = await loadSettings();
    expect(persisted.ui.fontSize).toBe(18);
  });

  it('rejects an out-of-range value with a field-named error', async () => {
    const result = runCtl(['settings', 'set', 'fontSize', '99']);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('fontSize: expected integer 10-24, got 99');

    const persisted = await loadSettings();
    expect(persisted.ui.fontSize).toBe(13);
  });

  it('reports every invalid field in one call', async () => {
    const result = runCtl([
      'settings', 'set', '--json',
      '{"fontSize": 99, "breathingIntensity": "loud"}',
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('fontSize: expected integer 10-24, got 99');
    expect(result.stderr).toContain('breathingIntensity: expected one of none|mild|intense, got "loud"');
  });

  it('reads back a single setting, including enum values', async () => {
    const set = runCtl(['settings', 'set', 'breathingIntensity', 'intense']);
    expect(set.status).toBe(0);

    const get = runCtl(['settings', 'get', 'breathingIntensity']);
    expect(get.status).toBe(0);
    expect(JSON.parse(get.stdout)).toBe('intense');
  });

  it('accepts an explicit JSON value', async () => {
    const result = runCtl([
      'settings', 'set', 'quakeLayouts', '--json',
      '{"layout-1": {"position": "bottom", "height": 50}}',
    ]);
    expect(result.status).toBe(0);

    const persisted = await loadSettings();
    expect(persisted.ui.quakeLayouts['layout-1']).toEqual({ position: 'bottom', height: 50 });
  });

  it('lists every writable key in the schema', () => {
    const result = runCtl(['settings', 'schema']);
    expect(result.status).toBe(0);

    const schema = JSON.parse(result.stdout);
    const keys = Object.keys(schema.fields);
    for (const key of [
      'fontSize',
      'fontFamily',
      'paneOpacity',
      'paneMaskOpacity',
      'paneWidth',
      'webglEnabled',
      'breathingIntensity',
      'activityAlertDebounceMs',
      'layoutHotkeys',
      'quakeLayouts',
    ]) {
      expect(keys).toContain(key);
    }
    expect(schema.fields.fontSize.min).toBe(10);
    expect(schema.fields.fontSize.max).toBe(24);
  });
});
