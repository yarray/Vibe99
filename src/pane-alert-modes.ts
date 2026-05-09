// Alert mode configuration types.
//
// Each mode defines how a pane activity alert manifests. The `mode` field
// discriminates the union — CSS animation, shell hook, or future extensions.
// Persisted as part of AppSettings and drives the alert strategy factory.

export type AlertMode = 'css-animation' | 'hook-script';

export interface CssAnimationAlertConfig {
  mode: 'css-animation';
}

// Hook script mode: runs shell commands on alert start/stop. Uses the
// existing Shell Profile system for shell selection.
export interface HookScriptAlertConfig {
  mode: 'hook-script';
  /** Shell profile ID to resolve the executable. null = system default. */
  shellProfileId: string | null;
  /** Command executed when an alert fires. Empty = no-op. */
  onStartCommand: string;
  /** Command executed when an alert clears. Empty = no-op. */
  onStopCommand: string;
}

export type AlertModeConfig = CssAnimationAlertConfig | HookScriptAlertConfig;

export const DEFAULT_ALERT_CONFIG: AlertModeConfig = { mode: 'css-animation' };
