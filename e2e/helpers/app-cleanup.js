import { getTabCount, waitForAppReady } from './app-launch.js';

async function closePaneByTabIndex(index) {
  const tabs = await $$('#tabs-list .tab');
  const closeBtn = await tabs[index]?.$('.tab-close');
  if (!closeBtn) return false;
  await browser.pause(1500);
  try {
    await closeBtn.click();
  } catch (e) {
    if (e.message && e.message.includes('click intercepted')) {
      await browser.execute((el) => el.click(), closeBtn);
    } else {
      throw e;
    }
  }
  await browser.pause(2000);
  return true;
}

async function restorePaneCount(targetCount = 3) {
  await waitForAppReady(1);
  let count = await getTabCount();

  while (count < targetCount) {
    const addBtn = await $('#tabs-add');
    if (!(await addBtn.isExisting())) return;
    await browser.execute((el) => el.click(), addBtn);
    await browser.pause(500);
    count = await getTabCount();
  }

  while (count > targetCount) {
    const closed = await closePaneByTabIndex(count - 1);
    if (!closed) return;
    count = await getTabCount();
  }
}

export async function cleanupApp() {
  // Dismiss any open overlays by pressing Escape multiple times
  for (let i = 0; i < 5; i++) {
    await browser.keys('Escape');
    await browser.pause(100);
  }

  try {
    const panel = await $('#settings-panel');
    if (panel && (await panel.isExisting())) {
      const cls = await panel.getAttribute('class');
      if (!cls.includes('is-hidden')) {
        await browser.keys('Escape');
        await browser.pause(100);
      }
    }
  } catch {
    // Panel may already be gone.
  }

  try {
    await restorePaneCount(3);
  } catch {
    // Some lifecycle tests intentionally close the last pane/window.
  }
}
