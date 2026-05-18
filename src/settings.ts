import * as ShortcutsRegistry from './shortcuts-registry';
import type { Bridge } from './bridge';
import { showConfirmDialog } from './confirm-dialog';
import {
  type AppSettingsUi,
  type BreathingIntensity,
  ConsoleValidationReporter,
  getDefaultSettings,
  migrateLegacySettings,
  type ValidationReporter,
  validateAndSanitizeSettings,
  validateField,
} from './domain/settings-schema.js';

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

/**
 * AppSettings - Application UI settings.
 *
 * Re-exported from schema module for convenience.
 */
export type AppSettings = AppSettingsUi;
export { type BreathingIntensity };

// ---------------------------------------------------------------------------
// Public Interfaces
// ---------------------------------------------------------------------------

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
  /** Optional custom validation reporter (defaults to ConsoleValidationReporter) */
  validationReporter?: ValidationReporter;
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

/**
 * Raw settings shape from storage.
 *
 * All fields are optional to handle partial/legacy data.
 * Migration logic transforms this before schema validation.
 */
type RawSettingsFromStorage = {
  version?: number;
  ui?: Partial<{
    fontSize?: unknown;
    fontFamily?: unknown;
    paneOpacity?: unknown;
    paneMaskOpacity?: unknown;
    paneMaskAlpha?: number; // Deprecated
    paneWidth?: unknown;
    webglEnabled?: unknown;
    breathingAlertEnabled?: boolean; // Deprecated
    breathingIntensity?: unknown;
    activityAlertDebounceMs?: unknown;
    shortcuts?: Record<string, unknown>;
  }>;
};

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
    validationReporter = new ConsoleValidationReporter(),
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
    ...getDefaultSettings(),
    fontFamily: getDefaultFontFamily(bridge.platform),
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

    const raw = nextSettings as RawSettingsFromStorage;

    // Step 1: Migrate legacy settings to current format
    const migrated = migrateLegacySettings(raw);

    // Step 2: Validate and sanitize against schema
    const result = validateAndSanitizeSettings(migrated);

    // Step 3: Apply sanitized settings
    Object.assign(settings, result.sanitized);

    // Step 4: Report validation issues
    validationReporter.logResult(result);

    // Step 5: Load keyboard shortcuts (separate from schema validation)
    const uiSettings = raw.ui ?? {};
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
    const result = validateField('fontSize', nextValue);
    settings.fontSize = result.sanitizedValue as number;
    applySettings();
    applyCallback();
    scheduleSettingsSave();
  });

  // Font family
  fontFamilyInput.addEventListener('change', () => {
    const result = validateField('fontFamily', fontFamilyInput.value);
    settings.fontFamily = (result.sanitizedValue as string) || getDefaultFontFamily(bridge.platform);
    applySettings();
    applyCallback();
    scheduleSettingsSave();
  });

  // Pane width
  function updatePaneWidth(nextValue: string): void {
    const parsedValue = Number(nextValue);
    const result = validateField('paneWidth', parsedValue);
    settings.paneWidth = result.sanitizedValue as number;
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
    const result = validateField('paneOpacity', parsedValue);
    settings.paneOpacity = result.sanitizedValue as number;
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
    const result = validateField('paneMaskOpacity', parsedValue);
    settings.paneMaskOpacity = result.sanitizedValue as number;
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

    const result = validateField('breathingIntensity', value);
    settings.breathingIntensity = result.sanitizedValue as BreathingIntensity;
    applySettings();
    scheduleSettingsSave();
  });

  // WebGL (3D acceleration)
  webglRow.addEventListener('click', async () => {
    const newValue = !settings.webglEnabled;
    const restart = await showConfirmDialog({
      title: '3D acceleration',
      message: '3D acceleration change will take effect after restart. Restart now?',
      confirmLabel: 'Restart',
      cancelLabel: 'Cancel',
    });
    if (!restart) return;
    settings.webglEnabled = newValue;
    webglToggle.checked = newValue;
    webglDot.classList.toggle('is-active', newValue);
    bridge.saveSettings(buildSettingsPayloadForCurrentWindow() as unknown as import('./bridge').SettingsData)
      .then(() => { deps.requestAppRestart?.(); })
      .catch(reportError);
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
    // Convert to milliseconds for validation
    const msValue = seconds * 1000;
    const result = validateField('activityAlertDebounceMs', msValue);
    // Apply the sanitized value (zod clamps out-of-range values to min/max)
    // and let applySettings() update the input to display the clamped value.
    settings.activityAlertDebounceMs = result.sanitizedValue as number;
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
