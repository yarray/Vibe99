export async function waitForElement(selector, timeout = 10000) {
  const el = await $(selector);
  await el.waitForExist({ timeout });
  return el;
}

export async function waitForElementClickable(selector, timeout = 10000) {
  const el = await $(selector);
  await el.waitForClickable({ timeout });
  return el;
}

export async function waitForCondition(fn, timeout = 10000, interval = 500) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const result = await fn();
      if (result) return result;
    } catch {
      // Element may not exist yet — keep polling.
    }
    await browser.pause(interval);
  }
  throw new Error(`waitForCondition timed out after ${timeout}ms`);
}
