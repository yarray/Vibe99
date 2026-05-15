import * as ShortcutsRegistry from './shortcuts-registry';
import type { Bridge } from './bridge';
import { showConfirmDialog } from './confirm-dialog';

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export type BreathingIntensity = 'none' | 'mild' | 'intense';

export interface AppSettings {
  fontSize: number;
  fontFamily: string;
  paneOpacity: number;
  paneMaskOpacity: number;
  paneWidth: number;
  webglEnabled: boolean;
  breathingIntensity: BreathingIntensity;
  activityAlertDebounceMs: number;
}

export interface SettingsManagerDeps {
  bridge: Bridge;
  reportError: (error: unknown) => void;
  applyCallback: () => void;
  paneActivityWatcher: {
    setGlobalEnabled: (enabled: boolean) => void;
    setSettleMs: (ms: number) => void;
  };
  onBreathingIntensityChange?: (intensity: BreathingIntensity) => void;
  onToggleFloatWindow?: () => Promise<void>;
  getFloatWindowOpen?: () => boolean;
  requestAppRestart?: () => void;
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
    breathingAlertEnabled?: boolean;
  }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getDefaultFontFamily(platform: string): string {
  if (platform === 'win32' || platform === 'windows') {
    return 'Consolas, "Cascadia Mono", "Courier New", "Microsoft YaHei", monospace';
  }
  if (platform === 'darwin') {
    return 'Menlo, Monaco, "SF Mono", "PingFang SC", monospace';
  }
  return '"DejaVu Sans Mono", "Liberation Mono", "Ubuntu Mono", "Noto Sans CJK SC", monospace';
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
    onBreathingIntensityChange,
  } = deps;

  const fontSizeInput = document.getElementById('font-size-input') as HTMLInputElement;
  const fontFamilyInput = document.getElementById('font-family-input') as HTMLInputElement;
  const paneWidthRange = document.getElementById('pane-width-range') as HTMLInputElement;
  const paneWidthInput = document.getElementById('pane-width-input') as HTMLInputElement;
  const paneOpacityRange = document.getElementById('pane-opacity-range') as HTMLInputElement;
  const paneOpacityInput = document.getElementById('pane-opacity-input') as HTMLInputElement;
  const paneMaskOpacityRange = document.getElementById('pane-mask-alpha-range') as HTMLInputElement;
  const paneMaskOpacityInput = document.getElementById('pane-mask-alpha-input') as HTMLInputElement;
  const breathingSegments = document.getElementById('breathing-intensity-segments') as HTMLElement;
  const webglToggle = document.getElementById('webgl-toggle') as HTMLInputElement;
  const webglDot = document.getElementById('webgl-dot') as HTMLElement;
  const webglRow = document.getElementById('webgl-row') as HTMLElement;
  const floatWindowToggle = document.getElementById('float-window-toggle') as HTMLInputElement;
  const floatWindowDot = document.getElementById('float-window-dot') as HTMLElement;
  const floatWindowRow = document.getElementById('float-window-row') as HTMLElement;
  const debounceInput = document.getElementById('activity-alert-debounce-input') as HTMLInputElement;

  const settings: AppSettings = {
    fontSize: 13,
    fontFamily: getDefaultFontFamily(bridge.platform),
    paneOpacity: 0.8,
    paneMaskOpacity: 0.75,
    paneWidth: 720,
    webglEnabled: true,
    breathingIntensity: 'mild',
    activityAlertDebounceMs: 30000,
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
    breathingSegments.querySelectorAll('.settings-segmented-btn').forEach((btn) => {
      const value = (btn as HTMLElement).dataset.value ?? '';
      const isActive = value === settings.breathingIntensity;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-checked', String(isActive));
    });
    onBreathingIntensityChange?.(settings.breathingIntensity);
    webglToggle.checked = settings.webglEnabled;
    webglDot.classList.toggle('is-active', settings.webglEnabled);
    // Sync float window toggle dot with current runtime state
    const floatOpen = deps.getFloatWindowOpen?.() ?? false;
    floatWindowToggle.checked = floatOpen;
    floatWindowDot.classList.toggle('is-active', floatOpen);
    // Apply debounce setting (input is in seconds)
    debounceInput.value = String(settings.activityAlertDebounceMs / 1000);
    paneActivityWatcher.setSettleMs(settings.activityAlertDebounceMs);
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

    if (typeof uiSettings.breathingIntensity === 'string') {
      const valid: BreathingIntensity[] = ['none', 'mild', 'intense'];
      if (valid.includes(uiSettings.breathingIntensity as BreathingIntensity)) {
        settings.breathingIntensity = uiSettings.breathingIntensity as BreathingIntensity;
      }
    } else if (typeof uiSettings.breathingAlertEnabled === 'boolean') {
      settings.breathingIntensity = uiSettings.breathingAlertEnabled ? 'intense' : 'none';
    }

    if (typeof uiSettings.webglEnabled === 'boolean') {
      settings.webglEnabled = uiSettings.webglEnabled;
    }

    if (Number.isFinite(uiSettings.activityAlertDebounceMs)) {
      settings.activityAlertDebounceMs = Math.max(3000, Math.min(300000, uiSettings.activityAlertDebounceMs!));
    }

    // Load keyboard shortcuts
    if (uiSettings.shortcuts && typeof uiSettings.shortcuts === 'object') {
      ShortcutsRegistry.loadShortcutsFromSettings(uiSettings.shortcuts);
    } else {
      ShortcutsRegistry.loadShortcutsFromSettings({});
    }
  }

  function buildSettingsPayloadForCurrentWindow(): PersistedSettings {
    return {
      version: 6,
      ui: {
        ...settings,
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

  // Breathing alert
  breathingSegments.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.settings-segmented-btn') as HTMLElement | null;
    if (!btn) return;
    const value = btn.dataset.value as BreathingIntensity | undefined;
    if (!value) return;
    settings.breathingIntensity = value;
    applySettings();
    scheduleSettingsSave();
  });

  // WebGL (3D acceleration)
  async function applyAndPromptRestart(): Promise<void> {
    webglToggle.checked = settings.webglEnabled;
    webglDot.classList.toggle('is-active', settings.webglEnabled);
    const restart = await showConfirmDialog({
      title: '3D acceleration',
      message: '3D acceleration change will take effect after restart. Restart now?',
      confirmLabel: 'Restart',
      cancelLabel: 'Later',
    });
    if (restart) {
      bridge.saveSettings(buildSettingsPayloadForCurrentWindow() as unknown as import('./bridge').SettingsData)
        .then(() => { deps.requestAppRestart?.(); })
        .catch(reportError);
    } else {
      scheduleSettingsSave();
    }
  }

  webglRow.addEventListener('click', () => {
    settings.webglEnabled = !settings.webglEnabled;
    applyAndPromptRestart();
  });

  webglToggle.addEventListener('change', () => {
    settings.webglEnabled = webglToggle.checked;
    applyAndPromptRestart();
  });

  // Float window toggle
  floatWindowRow.addEventListener('click', async () => {
    if (deps.onToggleFloatWindow) {
      await deps.onToggleFloatWindow();
    }
    const floatOpen = deps.getFloatWindowOpen?.() ?? false;
    floatWindowToggle.checked = floatOpen;
    floatWindowDot.classList.toggle('is-active', floatOpen);
  });

  // Activity alert debounce time
  debounceInput.addEventListener('change', () => {
    const seconds = Number(debounceInput.value);
    if (!Number.isFinite(seconds)) {
      applySettings();
      return;
    }
    settings.activityAlertDebounceMs = Math.max(3000, Math.min(300000, seconds * 1000));
    applySettings();
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
