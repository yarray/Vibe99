import { setIcon } from './icons.js';

export function createFullscreenManager({ bridge, fullscreenButtonEl, reportError }) {
  function isNativeFullscreenSupported() {
    return (
      typeof bridge.isWindowFullscreen === 'function' &&
      typeof bridge.setWindowFullscreen === 'function'
    );
  }

  function isDomFullscreenSupported() {
    return (
      document.documentElement.requestFullscreen ||
      document.documentElement.webkitRequestFullscreen ||
      false
    );
  }

  function isFullscreenSupported() {
    return isNativeFullscreenSupported() || isDomFullscreenSupported();
  }

  function getDomFullscreenElement() {
    return (
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      null
    );
  }

  async function getIsFullscreen() {
    if (isNativeFullscreenSupported()) {
      return bridge.isWindowFullscreen();
    }
    return Boolean(getDomFullscreenElement());
  }

  async function updateFullscreenButton() {
    const isFs = await getIsFullscreen().catch(() => false);
    fullscreenButtonEl.classList.toggle('is-fullscreen', Boolean(isFs));
    fullscreenButtonEl.setAttribute('aria-label', isFs ? 'Exit fullscreen' : 'Enter fullscreen');
    setIcon(fullscreenButtonEl, isFs ? 'minimize' : 'maximize', 18);
  }

  async function toggleFullscreen() {
    if (!isFullscreenSupported()) {
      return;
    }

    if (isNativeFullscreenSupported()) {
      const isFs = await bridge.isWindowFullscreen();
      await bridge.setWindowFullscreen(!isFs);
      await updateFullscreenButton();
      return;
    }

    if (getDomFullscreenElement()) {
      if (document.exitFullscreen) {
        await document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
    } else {
      const elem = document.documentElement;
      if (elem.requestFullscreen) {
        await elem.requestFullscreen();
      } else if (elem.webkitRequestFullscreen) {
        elem.webkitRequestFullscreen();
      }
    }
  }

  function hideFullscreenButtonIfUnsupported() {
    if (!isFullscreenSupported()) {
      fullscreenButtonEl.classList.add('is-hidden');
    }
  }

  function handleFullscreenShortcut(event) {
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
