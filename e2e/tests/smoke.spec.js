import { waitForAppReady, getPaneCount, getTabCount } from '../helpers/app-launch.js';
import { waitForTerminalReady, typeInTerminal } from '../helpers/terminal-helpers.js';
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
    const textarea = await $('.xterm-helper-textarea');
    expect(textarea).toExist();
    await textarea.click();
    await typeInTerminal('echo hello');
    await browser.pause(500);

    const rows = await $$('.xterm-rows > div');
    const visible = [];
    for (const row of rows) {
      const text = await row.getText();
      if (text.trim()) visible.push(text.trim());
    }
    const hasEcho = visible.some((t) => t.includes('echo hello'));
    expect(hasEcho).toBe(true);
  });

  after(async () => {
    await cleanupApp();
  });
});
