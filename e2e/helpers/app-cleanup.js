export async function cleanupApp() {
  try {
    const settingsBtn = await $('#tabs-settings');
    if (settingsBtn) {
      await settingsBtn.click();
      await browser.pause(200);
    }
  } catch {
    // Settings panel may already be closed.
  }

  try {
    const panel = await $('#settings-panel');
    if (panel && (await panel.isExisting())) {
      const isHidden = await panel.getProperty('classList').then(
        (cls) => cls.contains('is-hidden'),
      );
      if (!isHidden) {
        await browser.keys('Escape');
        await browser.pause(100);
      }
    }
  } catch {
    // Panel may already be gone.
  }
}
