import type { Bridge } from '../bridge';

export interface QuakeViewportPayload {
  leftInset?: number;
  topInset?: number;
  rightInset?: number;
  bottomInset?: number;
  width?: number;
  height?: number;
}

export interface QuakeViewDeps {
  bridge: Bridge;
  layoutId: string;
}

export interface QuakeView {
  init: () => void;
  dispose: () => void;
}

function applyViewport(viewport: QuakeViewportPayload): void {
  const style = document.documentElement.style;
  style.setProperty('--quake-left-inset', `${Math.max(0, viewport.leftInset ?? 0)}px`);
  style.setProperty('--quake-top-inset', `${Math.max(0, viewport.topInset ?? 0)}px`);
  style.setProperty('--quake-right-inset', `${Math.max(0, viewport.rightInset ?? 0)}px`);
  style.setProperty('--quake-bottom-inset', `${Math.max(0, viewport.bottomInset ?? 0)}px`);
  if (viewport.width && viewport.width > 0) {
    style.setProperty('--quake-width', `${viewport.width}px`);
  }
  if (viewport.height && viewport.height > 0) {
    style.setProperty('--quake-height', `${viewport.height}px`);
  }
  console.debug('[quake] viewport received', viewport);
  requestAnimationFrame(() =>
    window.dispatchEvent(new Event('resize'))
  );
}

export function createQuakeView(deps: QuakeViewDeps): QuakeView {
  const { bridge, layoutId } = deps;
  const cleanups: (() => void)[] = [];

  function init(): void {
    document.body.classList.add('is-quake-window');

    const removeViewportListener = bridge.listen<QuakeViewportPayload>('quake:viewport', applyViewport);
    cleanups.push(removeViewportListener);

    const removeBlurListener = bridge.listen<void>('tauri://blur', () => {
      bridge.toggleLayoutWindow(layoutId).catch(() => {});
    });
    cleanups.push(removeBlurListener);
  }

  function dispose(): void {
    document.body.classList.remove('is-quake-window');
    for (const cleanup of cleanups) cleanup();
    cleanups.length = 0;
  }

  return { init, dispose };
}
