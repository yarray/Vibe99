import { waitForElement, waitForCondition } from './wait-for.js';

export async function waitForAppReady() {
  await waitForElement('#stage', 15000);
  await waitForCondition(
    async () => {
      const panes = await $$('.pane');
      return panes.length >= 3;
    },
    15000,
    500,
  );
  await waitForCondition(
    async () => {
      const tabs = await $$('#tabs-list .tab');
      return tabs.length >= 3;
    },
    10000,
    500,
  );
}

export async function getPaneCount() {
  const panes = await $$('.pane');
  return panes.length;
}

export async function getTabCount() {
  const tabs = await $$('#tabs-list .tab');
  return tabs.length;
}

export async function getFocusedPane() {
  return await $('.pane.is-focused');
}

export async function getPaneByIndex(index) {
  const panes = await $$('.pane');
  return panes[index] || null;
}
