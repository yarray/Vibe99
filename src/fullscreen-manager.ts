import { setIcon } from './icons';

export interface FullscreenManagerDeps {
  bridge: {
    isWindowFullscreen: (() => Promise<boolean>) | undefined;
    setWindowFullscreen: ((fullscreen: boolean) => Promise<void>) | undefined;
  };
  fullscreenButtonEl: HTMLElement;
  reportError: (error: unknown) => void;
}

export interface FullscreenManager {
  isFullscreenSupported: () => boolean;
  toggleFullscreen: () => Promise<void>;
  updateFullscreenButton: () => Promise<void>;
}

/** Element with vendor-prefixed fullscreen methods (Safari). */
interface FullscreenElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void>;
}

/** Document with vendor-prefixed fullscreen properties (Safari). */
interface FullscreenDocument extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void>;
}

export function createFullscreenManager({ bridge, fullscreenButtonEl, reportError }: FullscreenManagerDeps): FullscreenManager {
  function isNativeFullscreenSupported(): boolean {
    return (
      typeof bridge.isWindowFullscreen === 'function' &&
      typeof bridge.setWindowFullscreen === 'function'
    );
  }

  function isDomFullscreenSupported(): boolean {
    const docEl = document.documentElement as FullscreenElement;
    return Boolean(
      document.documentElement.requestFullscreen ||
      docEl.webkitRequestFullscreen
    );
  }

  function isFullscreenSupported(): boolean {
    return isNativeFullscreenSupported() || isDomFullscreenSupported();
  }

  function getDomFullscreenElement(): Element | null {
    const fsDoc = document as FullscreenDocument;
    return (
      document.fullscreenElement ??
      fsDoc.webkitFullscreenElement ??
      null
    );
  }

  async function getIsFullscreen(): Promise<boolean> {
    if (isNativeFullscreenSupported()) {
      return bridge.isWindowFullscreen!();
    }
    return Boolean(getDomFullscreenElement());
  }

  async function updateFullscreenButton(): Promise<void> {
    const isFs = await getIsFullscreen().catch((): false => false);
    fullscreenButtonEl.classList.toggle('is-fullscreen', Boolean(isFs));
    fullscreenButtonEl.setAttribute('aria-label', isFs ? 'Exit fullscreen' : 'Enter fullscreen');
    setIcon(fullscreenButtonEl, isFs ? 'minimize' : 'maximize', 18);
  }

  async function toggleFullscreen(): Promise<void> {
    if (!isFullscreenSupported()) {
      return;
    }

    if (isNativeFullscreenSupported()) {
      const isFs = await bridge.isWindowFullscreen!();
      await bridge.setWindowFullscreen!(!isFs);
      await updateFullscreenButton();
      return;
    }

    const fsDoc = document as FullscreenDocument;
    const docEl = document.documentElement as FullscreenElement;

    if (getDomFullscreenElement()) {
      if (document.exitFullscreen) {
        await document.exitFullscreen();
      } else if (fsDoc.webkitExitFullscreen) {
        await fsDoc.webkitExitFullscreen();
      }
    } else {
      if (docEl.requestFullscreen) {
        await docEl.requestFullscreen();
      } else if (docEl.webkitRequestFullscreen) {
        await docEl.webkitRequestFullscreen();
      }
    }
  }

  function hideFullscreenButtonIfUnsupported(): void {
    if (!isFullscreenSupported()) {
      fullscreenButtonEl.classList.add('is-hidden');
    }
  }

  function handleFullscreenShortcut(event: KeyboardEvent): void {
    if (event.key !== 'F11' || !isFullscreenSupported()) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    toggleFullscreen().catch(reportError);
  }

  // Wire up global listeners
  document.addEventListener('fullscreenchange', () => {
    updateFullscreenButton().catch(reportError);
  });
  document.addEventListener('webkitfullscreenchange', () => {
    updateFullscreenButton().catch(reportError);
  });
  window.addEventListener('keydown', handleFullscreenShortcut, true);

  fullscreenButtonEl.addEventListener('click', () => {
    toggleFullscreen().catch(reportError);
  });

  hideFullscreenButtonIfUnsupported();
  updateFullscreenButton().catch(reportError);

  return {
    isFullscreenSupported,
    toggleFullscreen,
    updateFullscreenButton,
  };
}
