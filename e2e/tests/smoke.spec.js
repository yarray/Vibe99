import { waitForAppReady, getPaneCount, getTabCount } from '../helpers/app-launch.js';
import { waitForTerminalReady, getTerminalText, writeToTerminal, clearCapturedOutput } from '../helpers/terminal-helpers.js';
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
    await browser.pause(1000);

    const text = await getTerminalText(0);
    expect(text.includes('echo hello')).toBe(true);
  });

  after(async () => {
    await cleanupApp();
  });
});
