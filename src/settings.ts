import * as ShortcutsRegistry from './shortcuts-registry';
import type { Bridge } from './bridge';
import type { AlertMode, AlertModeConfig } from './pane-alert-modes';
import { DEFAULT_ALERT_CONFIG } from './pane-alert-modes';

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface AppSettings {
  fontSize: number;
  fontFamily: string;
  paneOpacity: number;
  paneMaskOpacity: number;
  paneWidth: number;
  breathingAlertEnabled: boolean;
  alertModeEnabled: boolean;
  alertModeConfig: AlertModeConfig;
}

export interface SettingsManagerDeps {
  bridge: Bridge;
  reportError: (error: unknown) => void;
  applyCallback: () => void;
  paneActivityWatcher: {
    setGlobalEnabled: (enabled: boolean) => void;
  };
  onAlertConfigChange?: () => void;
  getShellProfiles: () => Array<{ id: string; name: string }>;
}

export interface SettingsManager {
  readonly settings: AppSettings;
  applySettings(): void;
  applyPersistedSettings(nextSettings: unknown): void;
  scheduleSettingsSave(): void;
  flushSettingsSave(): void;
}

interface PersistedSettings {
  version: number;
  ui: AppSettings & {
    shortcuts: Record<string, ShortcutsRegistry.ShortcutOverride>;
  };
}

/** Shape expected from the persistence layer (all fields optional). */
interface PersistedSettingsRaw {
  version?: number;
  ui?: Partial<AppSettings & {
    shortcuts: Record<string, unknown>;
    paneMaskAlpha?: number;
    alertMode?: AlertMode;
    alertHookShellProfileId?: string;
    alertHookOnStartCommand?: string;
    alertHookOnStopCommand?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getDefaultFontFamily(platform: string): string {
  if (platform === 'win32' || platform === 'windows') {
    return 'Consolas, "Cascadia Mono", "Courier New", monospace';
  }
  if (platform === 'darwin') {
    return 'Menlo, Monaco, "SF Mono", monospace';
  }
  return '"DejaVu Sans Mono", "Liberation Mono", "Ubuntu Mono", monospace';
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createSettingsManager(deps: SettingsManagerDeps): SettingsManager {
  const {
    bridge,
    reportError,
    applyCallback,
    paneActivityWatcher,
    onAlertConfigChange,
    getShellProfiles,
  } = deps;

  const fontSizeInput = document.getElementById('font-size-input') as HTMLInputElement;
  const fontFamilyInput = document.getElementById('font-family-input') as HTMLInputElement;
  const paneWidthRange = document.getElementById('pane-width-range') as HTMLInputElement;
  const paneWidthInput = document.getElementById('pane-width-input') as HTMLInputElement;
  const paneOpacityRange = document.getElementById('pane-opacity-range') as HTMLInputElement;
  const paneOpacityInput = document.getElementById('pane-opacity-input') as HTMLInputElement;
  const paneMaskOpacityRange = document.getElementById('pane-mask-alpha-range') as HTMLInputElement;
  const paneMaskOpacityInput = document.getElementById('pane-mask-alpha-input') as HTMLInputElement;
  const breathingToggle = document.getElementById('breathing-alert-toggle') as HTMLInputElement;
  const breathingDot = document.getElementById('breathing-alert-dot') as HTMLElement;
  const breathingRow = document.getElementById('breathing-alert-row') as HTMLElement;
  const alertModeSection = document.getElementById('alert-mode-section') as HTMLElement;
  const alertModeSelect = document.getElementById('alert-mode-select') as HTMLSelectElement;
  const alertHookConfig = document.getElementById('alert-hook-config') as HTMLElement;
  const alertHookProfileSelect = document.getElementById('alert-hook-profile-select') as HTMLSelectElement;
  const alertHookStartCommand = document.getElementById('alert-hook-start-command') as HTMLInputElement;
  const alertHookStopCommand = document.getElementById('alert-hook-stop-command') as HTMLInputElement;

  const settings: AppSettings = {
    fontSize: 13,
    fontFamily: getDefaultFontFamily(bridge.platform),
    paneOpacity: 0.8,
    paneMaskOpacity: 0.75,
    paneWidth: 720,
    breathingAlertEnabled: true,
    alertModeEnabled: true,
    alertModeConfig: { ...DEFAULT_ALERT_CONFIG },
  };

  let pendingSettingsSave: number | null = null;

  function applySettings(): void {
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
    breathingToggle.checked = settings.alertModeEnabled;
    breathingDot.classList.toggle('is-active', settings.alertModeEnabled);
    paneActivityWatcher.setGlobalEnabled(settings.alertModeEnabled);

    if (alertModeSection) {
      alertModeSection.style.display = settings.alertModeEnabled ? '' : 'none';
    }
    if (alertModeSelect) {
      alertModeSelect.value = settings.alertModeConfig.mode;
    }
    if (alertHookConfig) {
      alertHookConfig.style.display = settings.alertModeConfig.mode === 'hook-script' ? '' : 'none';
    }
    if (alertHookProfileSelect) {
      populateProfileSelect();
      const hookConfig = settings.alertModeConfig.mode === 'hook-script' ? settings.alertModeConfig : null;
      alertHookProfileSelect.value = hookConfig?.shellProfileId ?? '';
    }
    if (alertHookStartCommand && settings.alertModeConfig.mode === 'hook-script') {
      alertHookStartCommand.value = settings.alertModeConfig.onStartCommand;
    }
    if (alertHookStopCommand && settings.alertModeConfig.mode === 'hook-script') {
      alertHookStopCommand.value = settings.alertModeConfig.onStopCommand;
    }
  }

  function populateProfileSelect(): void {
    if (!alertHookProfileSelect) return;
    const profiles = getShellProfiles();
    alertHookProfileSelect.replaceChildren();
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = 'Default shell';
    alertHookProfileSelect.appendChild(defaultOpt);
    for (const profile of profiles) {
      const opt = document.createElement('option');
      opt.value = profile.id;
      opt.textContent = profile.name || profile.id;
      alertHookProfileSelect.appendChild(opt);
    }
  }

  function applyPersistedSettings(nextSettings: unknown): void {
    if (!nextSettings || typeof nextSettings !== 'object') {
      return;
    }

    const raw = nextSettings as PersistedSettingsRaw;
    const uiSettings: NonNullable<PersistedSettingsRaw['ui']> =
      raw.ui && typeof raw.ui === 'object' && raw.ui !== null
        ? raw.ui
        : (raw as Partial<AppSettings>);

    if (Number.isFinite(uiSettings.fontSize)) {
      settings.fontSize = uiSettings.fontSize!;
    }

    if (typeof uiSettings.fontFamily === 'string') {
      settings.fontFamily = uiSettings.fontFamily;
    }

    if (Number.isFinite(uiSettings.paneOpacity)) {
      settings.paneOpacity = Math.max(0.55, Math.min(1, uiSettings.paneOpacity!));
    }

    if (Number.isFinite(uiSettings.paneMaskOpacity)) {
      settings.paneMaskOpacity = Math.max(0, Math.min(1, uiSettings.paneMaskOpacity!));
    }

    // Migrate legacy paneMaskAlpha -> paneMaskOpacity
    if (uiSettings.paneMaskAlpha !== undefined && Number.isFinite(uiSettings.paneMaskAlpha) && !Number.isFinite(uiSettings.paneMaskOpacity)) {
      settings.paneMaskOpacity = Math.max(0, Math.min(1, uiSettings.paneMaskAlpha));
    }

    // Migrate v3 inverted mask opacity: old value was 1 - overlay opacity.
    if (raw.version != null && raw.version < 4) {
      settings.paneMaskOpacity = 1 - settings.paneMaskOpacity;
    }

    if (Number.isFinite(uiSettings.paneWidth)) {
      settings.paneWidth = uiSettings.paneWidth!;
    }

    if (typeof uiSettings.breathingAlertEnabled === 'boolean') {
      settings.breathingAlertEnabled = uiSettings.breathingAlertEnabled;
      // Migrate legacy: breathingAlertEnabled → alertModeEnabled
      if (typeof uiSettings.alertModeEnabled !== 'boolean') {
        settings.alertModeEnabled = uiSettings.breathingAlertEnabled;
      }
    }

    if (typeof uiSettings.alertModeEnabled === 'boolean') {
      settings.alertModeEnabled = uiSettings.alertModeEnabled;
    }

    const persistedMode = uiSettings.alertMode;
    if (persistedMode === 'hook-script') {
      settings.alertModeConfig = {
        mode: 'hook-script',
        shellProfileId: uiSettings.alertHookShellProfileId ?? null,
        onStartCommand: uiSettings.alertHookOnStartCommand ?? '',
        onStopCommand: uiSettings.alertHookOnStopCommand ?? '',
      };
    } else {
      settings.alertModeConfig = { mode: 'css-animation' };
    }

    // Load keyboard shortcuts
    if (uiSettings.shortcuts && typeof uiSettings.shortcuts === 'object') {
      ShortcutsRegistry.loadShortcutsFromSettings(uiSettings.shortcuts);
    } else {
      ShortcutsRegistry.loadShortcutsFromSettings({});
    }
  }

  function buildSettingsPayloadForCurrentWindow(): PersistedSettings {
    const config = settings.alertModeConfig;
    return {
      version: 7,
      ui: {
        ...settings,
        alertMode: config.mode,
        alertHookShellProfileId: config.mode === 'hook-script' ? config.shellProfileId : undefined,
        alertHookOnStartCommand: config.mode === 'hook-script' ? config.onStartCommand : undefined,
        alertHookOnStopCommand: config.mode === 'hook-script' ? config.onStopCommand : undefined,
        shortcuts: ShortcutsRegistry.getShortcutsForSave(),
      },
    };
  }

  function scheduleSettingsSave(): void {
    if (pendingSettingsSave !== null) {
      window.clearTimeout(pendingSettingsSave);
    }

    pendingSettingsSave = window.setTimeout(() => {
      pendingSettingsSave = null;
      bridge.saveSettings(buildSettingsPayloadForCurrentWindow() as unknown as import('./bridge').SettingsData).catch(reportError);
    }, 150);
  }

  function flushSettingsSave(): void {
    if (pendingSettingsSave !== null) {
      window.clearTimeout(pendingSettingsSave);
      pendingSettingsSave = null;
    }
    void bridge.saveSettings(buildSettingsPayloadForCurrentWindow() as unknown as import('./bridge').SettingsData).catch(reportError);
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
  function updatePaneWidth(nextValue: string): void {
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
  function updatePaneOpacity(nextValue: string): void {
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
  function updatePaneMaskOpacity(nextValue: string): void {
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

  // Alert toggle (on/off)
  function toggleAlertEnabled(): void {
    breathingToggle.checked = !breathingToggle.checked;
    settings.alertModeEnabled = breathingToggle.checked;
    breathingDot.classList.toggle('is-active', settings.alertModeEnabled);
    paneActivityWatcher.setGlobalEnabled(settings.alertModeEnabled);
    onAlertConfigChange?.();
    applySettings();
    scheduleSettingsSave();
  }

  breathingRow.addEventListener('click', () => {
    toggleAlertEnabled();
  });

  breathingToggle.addEventListener('change', () => {
    settings.alertModeEnabled = breathingToggle.checked;
    breathingDot.classList.toggle('is-active', settings.alertModeEnabled);
    paneActivityWatcher.setGlobalEnabled(settings.alertModeEnabled);
    onAlertConfigChange?.();
    applySettings();
    scheduleSettingsSave();
  });

  // Alert mode selector
  if (alertModeSelect) {
    alertModeSelect.addEventListener('change', () => {
      const mode = alertModeSelect.value as AlertMode;
      if (mode === 'hook-script') {
        settings.alertModeConfig = {
          mode: 'hook-script',
          shellProfileId: null,
          onStartCommand: '',
          onStopCommand: '',
        };
      } else {
        settings.alertModeConfig = { mode: 'css-animation' };
      }
      onAlertConfigChange?.();
      applySettings();
      scheduleSettingsSave();
    });
  }

  // Hook script config
  if (alertHookProfileSelect) {
    alertHookProfileSelect.addEventListener('change', () => {
      if (settings.alertModeConfig.mode === 'hook-script') {
        const val = alertHookProfileSelect.value;
        settings.alertModeConfig.shellProfileId = val || null;
        onAlertConfigChange?.();
        scheduleSettingsSave();
      }
    });
  }

  if (alertHookStartCommand) {
    alertHookStartCommand.addEventListener('change', () => {
      if (settings.alertModeConfig.mode === 'hook-script') {
        settings.alertModeConfig.onStartCommand = alertHookStartCommand.value;
        onAlertConfigChange?.();
        scheduleSettingsSave();
      }
    });
  }

  if (alertHookStopCommand) {
    alertHookStopCommand.addEventListener('change', () => {
      if (settings.alertModeConfig.mode === 'hook-script') {
        settings.alertModeConfig.onStopCommand = alertHookStopCommand.value;
        onAlertConfigChange?.();
        scheduleSettingsSave();
      }
    });
  }

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
