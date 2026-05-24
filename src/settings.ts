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

/**
 * Layout UI overrides - a subset of AppSettings that can be overridden at layout level.
 */
export type LayoutUiOverrides = {
  fontSize?: number;
  fontFamily?: string;
  paneOpacity?: number;
  paneMaskOpacity?: number;
  paneWidth?: number;
  breathingIntensity?: BreathingIntensity;
};

/**
 * Resolve UI settings with three-level fallback: layout → global.
 *
 * Priority: layout.uiOverrides → global settings
 *
 * @param globalSettings - The global settings
 * @param layoutUiOverrides - Optional layout-level UI overrides
 * @returns Resolved settings with layout overrides applied
 */
export function resolveUiSettings(
  globalSettings: AppSettings,
  layoutUiOverrides?: LayoutUiOverrides,
): AppSettings {
  const resolved: AppSettings = { ...globalSettings };

  if (layoutUiOverrides) {
    if (layoutUiOverrides.fontSize !== undefined) {
      resolved.fontSize = layoutUiOverrides.fontSize;
    }
    if (layoutUiOverrides.fontFamily !== undefined) {
      resolved.fontFamily = layoutUiOverrides.fontFamily;
    }
    if (layoutUiOverrides.paneOpacity !== undefined) {
      resolved.paneOpacity = layoutUiOverrides.paneOpacity;
    }
    if (layoutUiOverrides.paneMaskOpacity !== undefined) {
      resolved.paneMaskOpacity = layoutUiOverrides.paneMaskOpacity;
    }
    if (layoutUiOverrides.paneWidth !== undefined) {
      resolved.paneWidth = layoutUiOverrides.paneWidth;
    }
    if (layoutUiOverrides.breathingIntensity !== undefined) {
      resolved.breathingIntensity = layoutUiOverrides.breathingIntensity;
    }
  }

  return resolved;
}

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
  /** Optional callback to get layout UI overrides */
  getLayoutUiOverrides?: () => LayoutUiOverrides | undefined;
  /** Optional callback to notify when layout UI overrides change */
  onLayoutUiOverridesChange?: (overrides: LayoutUiOverrides) => void;
}

export interface SettingsManager {
  readonly settings: AppSettings;
  getResolvedSettings(): AppSettings;
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
    layoutHotkeys?: unknown;
    quakeLayouts?: unknown;
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

function createPinElement(): HTMLSpanElement {
  const pin = document.createElement('span');
  pin.className = 'settings-pin';
  pin.title = 'Layout override';
  pin.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22v-8"/><path d="M12 2v2"/><path d="m19 13-7-3-7 3"/><path d="M12 8 8 5"/></svg>`;
  return pin;
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

  // -- Pin elements for layout override indicators --
  function attachPinToLabel(inputEl: HTMLElement | null): HTMLSpanElement | null {
    const label = inputEl?.previousElementSibling as HTMLElement | null;
    if (!label) return null;
    const span = label.querySelector('span');
    if (!span) return null;
    const pin = createPinElement();
    span.appendChild(pin);
    return pin;
  }

  const fontSizePin = attachPinToLabel(fontSizeInput);
  const fontFamilyPin = attachPinToLabel(fontFamilyInput);
  const paneWidthPin = attachPinToLabel(paneWidthRange);
  const paneOpacityPin = attachPinToLabel(paneOpacityRange);
  const paneMaskOpacityPin = attachPinToLabel(paneMaskOpacityRange);

  const breathingPin = (() => {
    const label = breathingSegments.parentElement;
    if (!label) return null;
    const span = label.querySelector('span');
    if (!span) return null;
    const pin = createPinElement();
    span.appendChild(pin);
    return pin;
  })();

  function applySettings(): void {
    // Get layout UI overrides if available
    const layoutUiOverrides = deps.getLayoutUiOverrides?.();
    const resolvedSettings = resolveUiSettings(settings, layoutUiOverrides);

    document.documentElement.style.setProperty('--pane-opacity', resolvedSettings.paneOpacity.toFixed(2));
    document.documentElement.style.setProperty('--pane-bg-mask-opacity', resolvedSettings.paneMaskOpacity.toFixed(2));
    document.documentElement.style.setProperty('--pane-width', `${resolvedSettings.paneWidth}px`);
    fontSizeInput.value = String(resolvedSettings.fontSize);
    fontFamilyInput.value = resolvedSettings.fontFamily;
    paneWidthRange.value = String(resolvedSettings.paneWidth);
    paneWidthInput.value = String(resolvedSettings.paneWidth);
    paneOpacityRange.value = String(resolvedSettings.paneOpacity.toFixed(2));
    paneOpacityInput.value = String(resolvedSettings.paneOpacity.toFixed(2));
    paneMaskOpacityRange.value = String(resolvedSettings.paneMaskOpacity.toFixed(2));
    paneMaskOpacityInput.value = String(resolvedSettings.paneMaskOpacity.toFixed(2));
    breathingSegments.querySelectorAll('.settings-segmented-btn').forEach((btn) => {
      const value = (btn as HTMLElement).dataset.value ?? '';
      const isActive = value === resolvedSettings.breathingIntensity;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-checked', String(isActive));
    });
    onBreathingIntensityChange?.(resolvedSettings.breathingIntensity);
    webglToggle.checked = resolvedSettings.webglEnabled;
    webglDot.classList.toggle('is-active', resolvedSettings.webglEnabled);
    // Sync float window toggle dot with current runtime state
    const floatOpen = deps.getFloatWindowOpen?.() ?? false;
    floatWindowToggle.checked = floatOpen;
    floatWindowDot.classList.toggle('is-active', floatOpen);
    // Apply debounce setting (input is in seconds)
    debounceInput.value = String(resolvedSettings.activityAlertDebounceMs / 1000);
    paneActivityWatcher.setSettleMs(resolvedSettings.activityAlertDebounceMs);

    // Update pin visibility
    fontSizePin?.classList.toggle('is-visible', layoutUiOverrides?.fontSize !== undefined);
    fontFamilyPin?.classList.toggle('is-visible', layoutUiOverrides?.fontFamily !== undefined);
    paneWidthPin?.classList.toggle('is-visible', layoutUiOverrides?.paneWidth !== undefined);
    paneOpacityPin?.classList.toggle('is-visible', layoutUiOverrides?.paneOpacity !== undefined);
    paneMaskOpacityPin?.classList.toggle('is-visible', layoutUiOverrides?.paneMaskOpacity !== undefined);
    breathingPin?.classList.toggle('is-visible', layoutUiOverrides?.breathingIntensity !== undefined);
  }

  function getResolvedSettings(): AppSettings {
    const layoutUiOverrides = deps.getLayoutUiOverrides?.();
    return resolveUiSettings(settings, layoutUiOverrides);
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

  // -- Write helpers with layout override routing --

  function writeFontSize(nextValue: number): void {
    const result = validateField('fontSize', nextValue);
    const layoutOverrides = deps.getLayoutUiOverrides?.();
    if (layoutOverrides?.fontSize !== undefined) {
      deps.onLayoutUiOverridesChange?.({ ...layoutOverrides, fontSize: result.sanitizedValue as number });
    } else {
      settings.fontSize = result.sanitizedValue as number;
      scheduleSettingsSave();
    }
    applySettings();
    applyCallback();
  }

  function writeFontFamily(nextValue: string): void {
    const result = validateField('fontFamily', nextValue);
    const sanitizedValue = (result.sanitizedValue as string) || getDefaultFontFamily(bridge.platform);
    const layoutOverrides = deps.getLayoutUiOverrides?.();
    if (layoutOverrides?.fontFamily !== undefined) {
      deps.onLayoutUiOverridesChange?.({ ...layoutOverrides, fontFamily: sanitizedValue });
    } else {
      settings.fontFamily = sanitizedValue;
      scheduleSettingsSave();
    }
    applySettings();
    applyCallback();
  }

  function writePaneWidth(nextValue: number): void {
    const result = validateField('paneWidth', nextValue);
    const layoutOverrides = deps.getLayoutUiOverrides?.();
    if (layoutOverrides?.paneWidth !== undefined) {
      deps.onLayoutUiOverridesChange?.({ ...layoutOverrides, paneWidth: result.sanitizedValue as number });
    } else {
      settings.paneWidth = result.sanitizedValue as number;
      scheduleSettingsSave();
    }
    applySettings();
    applyCallback();
  }

  function writePaneOpacity(nextValue: number): void {
    const result = validateField('paneOpacity', nextValue);
    const layoutOverrides = deps.getLayoutUiOverrides?.();
    if (layoutOverrides?.paneOpacity !== undefined) {
      deps.onLayoutUiOverridesChange?.({ ...layoutOverrides, paneOpacity: result.sanitizedValue as number });
    } else {
      settings.paneOpacity = result.sanitizedValue as number;
      scheduleSettingsSave();
    }
    applySettings();
  }

  function writePaneMaskOpacity(nextValue: number): void {
    const result = validateField('paneMaskOpacity', nextValue);
    const layoutOverrides = deps.getLayoutUiOverrides?.();
    if (layoutOverrides?.paneMaskOpacity !== undefined) {
      deps.onLayoutUiOverridesChange?.({ ...layoutOverrides, paneMaskOpacity: result.sanitizedValue as number });
    } else {
      settings.paneMaskOpacity = result.sanitizedValue as number;
      scheduleSettingsSave();
    }
    applySettings();
  }

  function writeBreathingIntensity(nextValue: BreathingIntensity): void {
    const result = validateField('breathingIntensity', nextValue);
    const layoutOverrides = deps.getLayoutUiOverrides?.();
    if (layoutOverrides?.breathingIntensity !== undefined) {
      deps.onLayoutUiOverridesChange?.({ ...layoutOverrides, breathingIntensity: result.sanitizedValue as BreathingIntensity });
    } else {
      settings.breathingIntensity = result.sanitizedValue as BreathingIntensity;
      scheduleSettingsSave();
    }
    applySettings();
  }

  // Font size
  fontSizeInput.addEventListener('change', () => {
    writeFontSize(Number(fontSizeInput.value));
  });

  // Font family
  fontFamilyInput.addEventListener('change', () => {
    writeFontFamily(fontFamilyInput.value);
  });

  // Pane width
  paneWidthRange.addEventListener('input', () => {
    writePaneWidth(Number(paneWidthRange.value));
  });

  paneWidthInput.addEventListener('change', () => {
    writePaneWidth(Number(paneWidthInput.value));
  });

  // Pane opacity
  paneOpacityRange.addEventListener('input', () => {
    writePaneOpacity(Number(paneOpacityRange.value));
  });

  paneOpacityInput.addEventListener('change', () => {
    writePaneOpacity(Number(paneOpacityInput.value));
  });

  // Pane mask opacity
  paneMaskOpacityRange.addEventListener('input', () => {
    writePaneMaskOpacity(Number(paneMaskOpacityRange.value));
  });

  paneMaskOpacityInput.addEventListener('change', () => {
    writePaneMaskOpacity(Number(paneMaskOpacityInput.value));
  });

  // Breathing alert
  breathingSegments.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.settings-segmented-btn') as HTMLElement | null;
    if (!btn) return;
    const value = btn.dataset.value as BreathingIntensity | undefined;
    if (!value) return;
    writeBreathingIntensity(value);
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
    const msValue = Number(debounceInput.value) * 1000;
    const result = validateField('activityAlertDebounceMs', msValue);
    if (result.error) {
      applySettings();
      return;
    }
    settings.activityAlertDebounceMs = result.sanitizedValue as number;
    applySettings();
    scheduleSettingsSave();
  });

  return {
    get settings() {
      return settings;
    },
    getResolvedSettings,
    applySettings,
    applyPersistedSettings,
    scheduleSettingsSave,
    flushSettingsSave,
  };
}
