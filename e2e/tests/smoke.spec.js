import { waitForAppReady, getPaneCount, getTabCount } from '../helpers/app-launch.js';
import { waitForTerminalReady, waitForTerminalOutput, writeToTerminal, clearCapturedOutput } from '../helpers/terminal-helpers.js';
import { cleanupApp } from '../helpers/app-cleanup.js';

describe('Vibe99 smoke test', () => {
  it('launches with 3 default panes visible', async () => {
    await waitForAppReady();

    const paneCount = await getPaneCount();
    expect(paneCount).toBe(3);

    const tabCount = await getTabCount();
    expect(tabCount).toBe(3);
  });

  it('renders xterm terminals in each pane', async () => {
    await waitForTerminalReady(0);
    await waitForTerminalReady(1);
    await waitForTerminalReady(2);
  });

  it('accepts keyboard input in the focused terminal', async () => {
    await clearCapturedOutput(0);
    await writeToTerminal(0, 'echo hello\n');
    await waitForTerminalOutput('hello', 0, 15000);
  });

  after(async () => {
    await cleanupApp();
  });
});
