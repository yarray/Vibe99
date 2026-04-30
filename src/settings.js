import * as ShortcutsRegistry from './shortcuts-registry.js';

export function getDefaultFontFamily(platform) {
  if (platform === 'win32' || platform === 'windows') {
    return 'Consolas, "Cascadia Mono", "Courier New", monospace';
  }
  if (platform === 'darwin') {
    return 'Menlo, Monaco, "SF Mono", monospace';
  }
  return '"DejaVu Sans Mono", "Liberation Mono", "Ubuntu Mono", monospace';
}

export function createSettingsManager(deps) {
  const {
    bridge,
    reportError,
    applyCallback,
    paneActivityWatcher,
  } = deps;

  const fontSizeInput = document.getElementById('font-size-input');
  const fontFamilyInput = document.getElementById('font-family-input');
  const paneWidthRange = document.getElementById('pane-width-range');
  const paneWidthInput = document.getElementById('pane-width-input');
  const paneOpacityRange = document.getElementById('pane-opacity-range');
  const paneOpacityInput = document.getElementById('pane-opacity-input');
  const paneMaskOpacityRange = document.getElementById('pane-mask-alpha-range');
  const paneMaskOpacityInput = document.getElementById('pane-mask-alpha-input');
  const breathingToggle = document.getElementById('breathing-alert-toggle');
  const breathingDot = document.getElementById('breathing-alert-dot');
  const breathingRow = document.getElementById('breathing-alert-row');

  const settings = {
    fontSize: 13,
    fontFamily: getDefaultFontFamily(bridge.platform),
    paneOpacity: 0.8,
    paneMaskOpacity: 0.75,
    paneWidth: 720,
    breathingAlertEnabled: true,
  };

  let pendingSettingsSave = null;

  function applySettings() {
    document.documentElement.style.setProperty('--app-font-size', `${settings.fontSize}px`);
    document.documentElement.style.setProperty('--app-font-family', settings.fontFamily);
    document.documentElement.style.setProperty('--pane-opacity', settings.paneOpacity.toFixed(2));
    document.documentElement.style.setProperty('--pane-bg-mask-opacity', settings.paneMaskOpacity.toFixed(2));
    document.documentElement.style.setProperty('--pane-width', `${settings.paneWidth}px`);
    fontSizeInput.value = String(settings.fontSize);
    fontFamilyInput.value = settings.fontFamily;
    paneWidthRange.value = String(settings.paneWidth);
    paneWidthInput.value = String(settings.paneWidth);
    paneOpacityRange.value = settings.paneOpacity.toFixed(2);
    paneOpacityInput.value = settings.paneOpacity.toFixed(2);
    paneMaskOpacityRange.value = settings.paneMaskOpacity.toFixed(2);
    paneMaskOpacityInput.value = settings.paneMaskOpacity.toFixed(2);
    breathingToggle.checked = settings.breathingAlertEnabled;
    breathingDot.classList.toggle('is-active', settings.breathingAlertEnabled);
    paneActivityWatcher.setGlobalEnabled(settings.breathingAlertEnabled);
  }

  function applyPersistedSettings(nextSettings) {
    if (!nextSettings || typeof nextSettings !== 'object') {
      return;
    }

    const uiSettings =
      nextSettings && typeof nextSettings.ui === 'object' && nextSettings.ui !== null
        ? nextSettings.ui
        : nextSettings;

    if (Number.isFinite(uiSettings.fontSize)) {
      settings.fontSize = uiSettings.fontSize;
    }

    if (typeof uiSettings.fontFamily === 'string') {
      settings.fontFamily = uiSettings.fontFamily;
    }

    if (Number.isFinite(uiSettings.paneOpacity)) {
      settings.paneOpacity = Math.max(0.55, Math.min(1, uiSettings.paneOpacity));
    }

    if (Number.isFinite(uiSettings.paneMaskOpacity)) {
      settings.paneMaskOpacity = Math.max(0, Math.min(1, uiSettings.paneMaskOpacity));
    }

    // Migrate legacy paneMaskAlpha → paneMaskOpacity
    if (Number.isFinite(uiSettings.paneMaskAlpha) && !Number.isFinite(uiSettings.paneMaskOpacity)) {
      settings.paneMaskOpacity = Math.max(0, Math.min(1, uiSettings.paneMaskAlpha));
    }

    // Migrate v3 inverted mask opacity: old value was 1 - overlay opacity.
    if (nextSettings?.version != null && nextSettings.version < 4) {
      settings.paneMaskOpacity = 1 - settings.paneMaskOpacity;
    }

    if (Number.isFinite(uiSettings.paneWidth)) {
      settings.paneWidth = uiSettings.paneWidth;
    }

    if (typeof uiSettings.breathingAlertEnabled === 'boolean') {
      settings.breathingAlertEnabled = uiSettings.breathingAlertEnabled;
    }

    // Load keyboard shortcuts
    if (typeof uiSettings.shortcuts === 'object' && uiSettings.shortcuts !== null) {
      ShortcutsRegistry.loadShortcutsFromSettings(uiSettings);
    } else {
      ShortcutsRegistry.loadShortcutsFromSettings({});
    }
  }

  function buildSettingsPayloadForCurrentWindow() {
    return {
      version: 6,
      ui: {
        ...settings,
        shortcuts: ShortcutsRegistry.getShortcutsForSave(),
      },
    };
  }

  function scheduleSettingsSave() {
    if (pendingSettingsSave !== null) {
      window.clearTimeout(pendingSettingsSave);
    }

    pendingSettingsSave = window.setTimeout(() => {
      pendingSettingsSave = null;
      bridge.saveSettings(buildSettingsPayloadForCurrentWindow()).catch(reportError);
    }, 150);
  }

  function flushSettingsSave() {
    if (pendingSettingsSave !== null) {
      window.clearTimeout(pendingSettingsSave);
      pendingSettingsSave = null;
    }
    void bridge.saveSettings(buildSettingsPayloadForCurrentWindow()).catch(reportError);
  }

  // Font size
  fontSizeInput.addEventListener('change', () => {
    const nextValue = Number(fontSizeInput.value);
    if (!Number.isFinite(nextValue)) {
      applySettings();
      return;
    }

    settings.fontSize = Math.max(10, Math.min(24, Math.round(nextValue)));
    applySettings();
    applyCallback();
    scheduleSettingsSave();
  });

  // Font family
  fontFamilyInput.addEventListener('change', () => {
    settings.fontFamily = fontFamilyInput.value.trim() || getDefaultFontFamily(bridge.platform);
    applySettings();
    applyCallback();
    scheduleSettingsSave();
  });

  // Pane width
  function updatePaneWidth(nextValue) {
    const parsedValue = Number(nextValue);
    if (!Number.isFinite(parsedValue)) {
      applySettings();
      return;
    }

    settings.paneWidth = Math.max(520, Math.min(2000, Math.round(parsedValue / 10) * 10));
    applySettings();
    applyCallback();
    scheduleSettingsSave();
  }

  paneWidthRange.addEventListener('input', () => {
    updatePaneWidth(paneWidthRange.value);
  });

  paneWidthInput.addEventListener('change', () => {
    updatePaneWidth(paneWidthInput.value);
  });

  // Pane opacity
  function updatePaneOpacity(nextValue) {
    const parsedValue = Number(nextValue);
    if (!Number.isFinite(parsedValue)) {
      applySettings();
      return;
    }

    settings.paneOpacity = Math.max(0.55, Math.min(1, Number(parsedValue.toFixed(2))));
    applySettings();
    scheduleSettingsSave();
  }

  paneOpacityRange.addEventListener('input', () => {
    updatePaneOpacity(paneOpacityRange.value);
  });

  paneOpacityInput.addEventListener('change', () => {
    updatePaneOpacity(paneOpacityInput.value);
  });

  // Pane mask opacity
  function updatePaneMaskOpacity(nextValue) {
    const parsedValue = Number(nextValue);
    if (!Number.isFinite(parsedValue)) {
      applySettings();
      return;
    }

    settings.paneMaskOpacity = Math.max(0, Math.min(1, Number(parsedValue.toFixed(2))));
    applySettings();
    scheduleSettingsSave();
  }

  paneMaskOpacityRange.addEventListener('input', () => {
    updatePaneMaskOpacity(paneMaskOpacityRange.value);
  });

  paneMaskOpacityInput.addEventListener('change', () => {
    updatePaneMaskOpacity(paneMaskOpacityInput.value);
  });

  // Breathing alert
  function toggleBreathingAlert() {
    breathingToggle.checked = !breathingToggle.checked;
    settings.breathingAlertEnabled = breathingToggle.checked;
    breathingDot.classList.toggle('is-active', settings.breathingAlertEnabled);
    paneActivityWatcher.setGlobalEnabled(settings.breathingAlertEnabled);
    scheduleSettingsSave();
  }

  breathingRow.addEventListener('click', () => {
    toggleBreathingAlert();
  });

  breathingToggle.addEventListener('change', () => {
    settings.breathingAlertEnabled = breathingToggle.checked;
    breathingDot.classList.toggle('is-active', settings.breathingAlertEnabled);
    paneActivityWatcher.setGlobalEnabled(settings.breathingAlertEnabled);
    scheduleSettingsSave();
  });

  return {
    get settings() {
      return settings;
    },
    applySettings,
    applyPersistedSettings,
    scheduleSettingsSave,
    flushSettingsSave,
  };
}
