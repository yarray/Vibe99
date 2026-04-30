/**
 * WebView2-compatible helpers for simulating user interactions
 * that WebDriver cannot reliably perform on Windows/WebView2.
 */

/**
 * Set an input element's value AND dispatch the events needed
 * for React/framework change handlers to fire on WebView2.
 * WebDriver's setValue() alone doesn't trigger these events.
 */
export async function setInputValue(selectorOrElement, value) {
  const el = typeof selectorOrElement === 'string'
    ? await $(selectorOrElement)
    : selectorOrElement;
  if (!el) throw new Error('Element not found for setInputValue');

  await browser.execute((element, val) => {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value',
    )?.set || Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value',
    )?.set;
    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(element, val);
    } else {
      element.value = val;
    }
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, el, value);
  await browser.pause(100);
}

/**
 * Dispatch a dblclick event on an element.
 * Uses PointerEvent where available for better WebView2 compatibility.
 */
export async function dispatchDblClick(element) {
  await browser.execute((el) => {
    const rect = el.getBoundingClientRect();
    const cx = Math.floor(rect.left + rect.width / 2);
    const cy = Math.floor(rect.top + rect.height / 2);
    const opts = {
      bubbles: true,
      cancelable: true,
      clientX: cx,
      clientY: cy,
    };
    // Try PointerEvent first, fall back to MouseEvent
    try {
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
      el.dispatchEvent(new PointerEvent('pointerup', opts));
      el.dispatchEvent(new PointerEvent('click', { ...opts, detail: 1 }));
      el.dispatchEvent(new PointerEvent('pointerdown', { ...opts, detail: 2 }));
      el.dispatchEvent(new PointerEvent('pointerup', { ...opts, detail: 2 }));
      el.dispatchEvent(new PointerEvent('click', { ...opts, detail: 2 }));
      el.dispatchEvent(new MouseEvent('dblclick', opts));
    } catch {
      el.dispatchEvent(new MouseEvent('dblclick', opts));
    }
  }, element);
  await browser.pause(200);
}

/**
 * Trigger a real WebDriver double-click. WebView2 ignores many synthetic
 * dblclick events because they are not trusted, so tests that need the app's
 * pointer pipeline should prefer this helper.
 */
export async function nativeDoubleClick(element) {
  await element.waitForClickable({ timeout: 5000 });
  try {
    await element.doubleClick();
  } catch {
    await browser
      .action('pointer', { parameters: { pointerType: 'mouse' } })
      .move({ origin: element })
      .down({ button: 0 })
      .up({ button: 0 })
      .pause(80)
      .down({ button: 0 })
      .up({ button: 0 })
      .perform();
  }
  await browser.pause(300);
}

/**
 * Click an element via JS to bypass overlay interception on WebView2.
 */
export async function jsClick(selectorOrElement) {
  const el = typeof selectorOrElement === 'string'
    ? await $(selectorOrElement)
    : selectorOrElement;
  if (!el) throw new Error('Element not found for jsClick');
  await browser.execute((e) => e.click(), el);
  await browser.pause(200);
}

/**
 * Dispatch a contextmenu MouseEvent on an element.
 */
export async function dispatchContextMenu(element) {
  await browser.execute((el) => {
    const rect = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: Math.floor(rect.left + rect.width / 2),
      clientY: Math.floor(rect.top + rect.height / 2),
    }));
  }, element);
  await browser.pause(300);
}
