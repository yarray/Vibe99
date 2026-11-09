import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { waitForAppReady, getTabCount } from '../helpers/app-launch.js';
import { waitForCondition } from '../helpers/wait-for.js';
import { cleanupApp } from '../helpers/app-cleanup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..', '..');
const isWindows = process.platform === 'win32';

// ---------------------------------------------------------------------------
// CLI helpers
// ---------------------------------------------------------------------------

function ctlBinaryPath() {
  const name = isWindows ? 'vibe99ctl.exe' : 'vibe99ctl';
  return path.join(projectRoot, 'src-tauri', 'target', 'debug', name);
}

let resolvedBinary = null;

/** Resolve the CLI binary, building it if the debug build did not produce it. */
function ctlBinary() {
  if (resolvedBinary) return resolvedBinary;
  const binary = ctlBinaryPath();
  if (!fs.existsSync(binary)) {
    execFileSync('cargo', ['build', '--bin', 'vibe99ctl'], {
      cwd: path.join(projectRoot, 'src-tauri'),
      stdio: 'inherit',
    });
  }
  if (!fs.existsSync(binary)) {
    throw new Error(`vibe99ctl not found at ${binary}`);
  }
  resolvedBinary = binary;
  return binary;
}

/**
 * Run a vibe99ctl command against the app under test.
 * Returns the exit status plus captured streams so failures can be asserted.
 */
function runCtl(args) {
  try {
    const stdout = execFileSync(ctlBinary(), args, { encoding: 'utf8', timeout: 30000 });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    return {
      status: typeof error.status === 'number' ? error.status : 1,
      stdout: error.stdout ? error.stdout.toString() : '',
      stderr: error.stderr ? error.stderr.toString() : String(error),
    };
  }
}

function runCtlJson(args) {
  const result = runCtl(args);
  if (result.status !== 0) {
    throw new Error(`vibe99ctl ${args.join(' ')} failed: ${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('vibe99ctl profile management', () => {
  const createdIds = [];

  /** Create a profile via the CLI and remember it for cleanup. */
  function createProfile(args) {
    const result = runCtlJson(args);
    expect(result.profile).toBeTruthy();
    createdIds.push(result.profile.id);
    return result;
  }

  afterEach(async () => {
    while (createdIds.length > 0) {
      const id = createdIds.pop();
      runCtl(['profile', 'delete', id]);
    }
  });

  after(async () => {
    await cleanupApp();
  });

  beforeEach(async () => {
    await waitForAppReady();
  });

  it('creates a profile with the args passed through verbatim', () => {
    const name = `e2e-ssh-${Date.now()}`;
    const result = createProfile([
      'profile',
      'create',
      '--name',
      name,
      '--command',
      'ssh',
      '--args',
      '-t',
      'host',
      'tmux new -A -s work',
    ]);

    // The id is derived from the name; separate tokens with spaces are
    // re-quoted so the PTY parser sees one remote-command argument.
    expect(result.profile.id).toBe(name);
    expect(result.profile.command).toBe('ssh');
    expect(result.profile.args).toBe('-t host "tmux new -A -s work"');

    const listed = runCtlJson(['shell', 'list']);
    const listedProfile = listed.profiles.find((p) => p.id === name);
    expect(listedProfile).toBeTruthy();
    expect(listedProfile.args).toBe('-t host "tmux new -A -s work"');
  });

  it('keeps a fully quoted remote command intact', () => {
    const name = `e2e-tmux-${Date.now()}`;
    const rawArgs = '-t host "tmux new -A -s work"';
    const result = createProfile([
      'profile',
      'create',
      '--name',
      name,
      '--command',
      'ssh',
      '--args',
      rawArgs,
    ]);

    expect(result.profile.args).toBe(rawArgs);
  });

  it('updates a profile', () => {
    const name = `e2e-update-${Date.now()}`;
    const created = createProfile(['profile', 'create', '--name', name, '--command', 'ssh']);

    const updated = runCtlJson([
      'profile',
      'update',
      created.profile.id,
      '--name',
      `${name}-renamed`,
      '--command',
      '/bin/zsh',
    ]);

    expect(updated.profile.name).toBe(`${name}-renamed`);
    expect(updated.profile.command).toBe('/bin/zsh');

    const listed = runCtlJson(['profile', 'list']);
    const listedProfile = listed.profiles.find((p) => p.id === created.profile.id);
    expect(listedProfile.name).toBe(`${name}-renamed`);
  });

  it('rejects a duplicate id instead of overwriting the profile', () => {
    const name = `e2e-duplicate-${Date.now()}`;
    createProfile(['profile', 'create', '--name', name, '--command', 'ssh']);

    const duplicate = runCtl(['profile', 'create', '--name', name, '--command', '/bin/zsh']);

    expect(duplicate.status).not.toBe(0);
    expect(duplicate.stderr).toContain('already exists');

    // The original profile is untouched.
    const listed = runCtlJson(['profile', 'list']);
    const listedProfile = listed.profiles.find((p) => p.id === name);
    expect(listedProfile.command).toBe('ssh');
  });

  it('refuses to modify auto-detected profiles', () => {
    const detectedId = isWindows ? 'powershell' : 'bash';

    const deleted = runCtl(['profile', 'delete', detectedId]);
    expect(deleted.status).not.toBe(0);
    expect(deleted.stderr).toContain('auto-detected');

    const updated = runCtl(['profile', 'update', detectedId, '--name', 'Nope']);
    expect(updated.status).not.toBe(0);
    expect(updated.stderr).toContain('auto-detected');
  });

  it('opens a pane that runs the profile command', async function () {
    if (isWindows) {
      this.skip();
    }

    const marker = 'VIBE99_PROFILE_MARKER';
    const name = `e2e-open-${Date.now()}`;

    // Capture terminal output before creating the pane so its very first
    // output (the marker) is not missed.
    await browser.execute(() => {
      window.__e2e_cli_profile_output = {};
      return window.__TAURI__.event.listen('vibe99:terminal-data', (event) => {
        const { paneId, data } = event.payload;
        window.__e2e_cli_profile_output[paneId] =
          (window.__e2e_cli_profile_output[paneId] || '') + data;
      });
    });

    const tabsBefore = await getTabCount();

    const result = runCtlJson([
      'profile',
      'create',
      '--name',
      name,
      '--command',
      '/bin/sh',
      '--open',
      '--args',
      '-c',
      `echo ${marker}; exec /bin/sh`,
    ]);
    createdIds.push(result.profile.id);

    expect(typeof result.pane).toBe('string');
    expect(result.pane.length).toBeGreaterThan(0);

    await waitForCondition(async () => (await getTabCount()) === tabsBefore + 1, 10000, 300);

    await waitForCondition(
      async () =>
        browser.execute((paneId) => {
          const raw = window.__e2e_cli_profile_output?.[paneId] || '';
          return raw.replace(/\x1b\[[^@-~]*[@-~]/g, '').includes('VIBE99_PROFILE_MARKER');
        }, result.pane),
      15000,
      500,
    );
  });
});
