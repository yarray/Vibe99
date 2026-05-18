/**
 * Settings Schema Definition
 *
 * Zod-based schema for Settings validation and sanitization.
 * Schema defines valid types, ranges, and defaults for each setting.
 *
 * Design principles:
 * - Use standard solutions (P10): Leverages zod, the de-facto standard for TypeScript validation
 * - TypeScript-native (P2): Full type inference from schemas
 * - Error prevention (P3): Invalid values auto-repair to valid defaults
 * - Clear separation: Migration logic separate from schema validation
 *
 * @module domain/settings-schema
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Breathing Intensity Enum
// ---------------------------------------------------------------------------

export const breathingIntensitySchema = z.enum(['none', 'mild', 'intense']);
export type BreathingIntensity = z.infer<typeof breathingIntensitySchema>;

// ---------------------------------------------------------------------------
// Individual Field Schemas
// ---------------------------------------------------------------------------

/**
 * Font size: 10-24 pixels, integer
 */
export const fontSizeSchema = z
  .number({
    invalid_type_error: 'Font size must be a number',
    required_error: 'Font size is required',
  })
  .int({ message: 'Font size must be an integer' })
  .min(10, { message: 'Font size must be at least 10' })
  .max(24, { message: 'Font size must be at most 24' })
  .default(13);

/**
 * Font family: non-empty string, trimmed
 */
export const fontFamilySchema = z
  .string({
    invalid_type_error: 'Font family must be a string',
  })
  .trim()
  .transform((val) => val || '') // Empty means use platform default
  .default('');

/**
 * Pane opacity: 0.55-1.0, 2 decimal places
 */
export const paneOpacitySchema = z
  .number({
    invalid_type_error: 'Pane opacity must be a number',
  })
  .min(0.55, { message: 'Pane opacity must be at least 0.55' })
  .max(1.0, { message: 'Pane opacity must be at most 1.0' })
  .transform((val) => Math.round(val * 100) / 100) // 2 decimal places
  .default(0.8);

/**
 * Pane mask opacity: 0.0-1.0, 2 decimal places
 */
export const paneMaskOpacitySchema = z
  .number({
    invalid_type_error: 'Pane mask opacity must be a number',
  })
  .min(0.0, { message: 'Pane mask opacity must be at least 0.0' })
  .max(1.0, { message: 'Pane mask opacity must be at most 1.0' })
  .transform((val) => Math.round(val * 100) / 100) // 2 decimal places
  .default(0.75);

/**
 * Pane width: 520-2000 pixels, multiples of 10
 */
export const paneWidthSchema = z
  .number({
    invalid_type_error: 'Pane width must be a number',
  })
  .int({ message: 'Pane width must be an integer' })
  .min(520, { message: 'Pane width must be at least 520' })
  .max(2000, { message: 'Pane width must be at most 2000' })
  .transform((val) => Math.round(val / 10) * 10) // Round to nearest 10
  .default(720);

/**
 * WebGL enabled: boolean
 */
export const webglEnabledSchema = z
  .boolean({
    invalid_type_error: 'WebGL enabled must be a boolean',
  })
  .default(true);

/**
 * Activity alert debounce: 3000-300000 ms, integer
 */
export const activityAlertDebounceMsSchema = z
  .number({
    invalid_type_error: 'Activity alert debounce must be a number',
  })
  .int({ message: 'Activity alert debounce must be an integer' })
  .min(3000, { message: 'Activity alert debounce must be at least 3000ms' })
  .max(300000, { message: 'Activity alert debounce must be at most 300000ms' })
  .default(30000);

// ---------------------------------------------------------------------------
// Complete Settings Schema
// ---------------------------------------------------------------------------

/**
 * Complete AppSettings schema.
 *
 * All fields have defaults, so partial input will be filled with defaults.
 * Invalid values will be transformed to valid ranges or replaced with defaults.
 */
export const appSettingsSchema = z.object({
  fontSize: fontSizeSchema,
  fontFamily: fontFamilySchema,
  paneOpacity: paneOpacitySchema,
  paneMaskOpacity: paneMaskOpacitySchema,
  paneWidth: paneWidthSchema,
  webglEnabled: webglEnabledSchema,
  breathingIntensity: breathingIntensitySchema.default('mild'),
  activityAlertDebounceMs: activityAlertDebounceMsSchema,
});

/**
 * Infer the AppSettings type from the schema.
 */
export type AppSettingsUi = z.infer<typeof appSettingsSchema>;

// ---------------------------------------------------------------------------
// Validation Functions
// ---------------------------------------------------------------------------

/**
 * Validation result for a single field.
 */
export interface FieldValidationIssue {
  /** Field name */
  field: string;
  /** Original value */
  originalValue: unknown;
  /** Sanitized value */
  sanitizedValue: unknown;
  /** Error message from zod (if any) */
  error?: string;
}

/**
 * Result of validating settings.
 */
export interface ValidationResult {
  /** The sanitized settings object */
  sanitized: AppSettingsUi;
  /** Array of fields that had issues (empty if all valid) */
  issues: FieldValidationIssue[];
  /** Whether any fields were invalid */
  hasIssues: boolean;
}

/**
 * Validate and sanitize settings against the schema.
 *
 * Returns the sanitized settings with all defaults filled in,
 * and a list of any issues found during validation.
 *
 * @param raw - The raw settings object (may be partial/invalid)
 * @returns ValidationResult with sanitized settings and issue details
 */
export function validateAndSanitizeSettings(
  raw: Partial<AppSettingsUi> | unknown,
): ValidationResult {
  const rawRecord = typeof raw === 'object' && raw !== null ? raw as Partial<Record<keyof AppSettingsUi, unknown>> : {};
  const issues: FieldValidationIssue[] = [];

  // Check each field individually for issues
  for (const [key, schema] of Object.entries(appSettingsSchema.shape)) {
    const value = rawRecord[key as keyof AppSettingsUi];
    const fieldResult = (schema as z.ZodTypeAny).safeParse(value);

    if (!fieldResult.success) {
      // Get the first error message
      const errorMessage = fieldResult.error.errors?.[0]?.message ?? 'Invalid value';

      issues.push({
        field: key,
        originalValue: value,
        sanitizedValue: undefined, // Will be filled after full parse
        error: errorMessage,
      });
    }
  }

  // Do the full parse - zod will apply transforms and defaults
  const result = appSettingsSchema.safeParse(raw);

  if (result.success) {
    // Fill in sanitized values for any issues
    for (const issue of issues) {
      issue.sanitizedValue = (result.data as Record<string, unknown>)[issue.field];
    }

    return {
      sanitized: result.data,
      issues,
      hasIssues: issues.length > 0,
    };
  }

  // Fallback: return all defaults (shouldn't happen with our schema)
  const defaults = appSettingsSchema.parse({});
  for (const issue of issues) {
    issue.sanitizedValue = (defaults as Record<string, unknown>)[issue.field];
  }

  return {
    sanitized: defaults,
    issues,
    hasIssues: true,
  };
}

/**
 * Validate a single field against its schema.
 *
 * Useful for validating user input in real-time.
 *
 * @param fieldName - The name of the field
 * @param value - The value to validate
 * @returns FieldValidationIssue with sanitized value and error info
 */
export function validateField(
  fieldName: keyof AppSettingsUi,
  value: unknown,
): FieldValidationIssue {
  const fieldSchema = appSettingsSchema.shape[fieldName];
  const result = (fieldSchema as z.ZodTypeAny).safeParse(value);

  if (result.success) {
    return {
      field: fieldName,
      originalValue: value,
      sanitizedValue: result.data,
    };
  }

  // Get default by parsing an empty object
  const defaults = appSettingsSchema.parse({});
  const defaultValue = (defaults as Record<string, unknown>)[fieldName];

  const errorMessage = result.error.errors?.[0]?.message ?? 'Invalid value';

  return {
    field: fieldName,
    originalValue: value,
    sanitizedValue: defaultValue,
    error: errorMessage,
  };
}

/**
 * Get default settings.
 *
 * @returns Default settings object
 */
export function getDefaultSettings(): AppSettingsUi {
  return appSettingsSchema.parse({});
}

// ---------------------------------------------------------------------------
// Validation Reporter
// ---------------------------------------------------------------------------

/**
 * Validation reporter interface.
 */
export interface ValidationReporter {
  /** Log a validation result */
  logResult(result: ValidationResult): void;
  /** Report a specific issue */
  logIssue(issue: FieldValidationIssue): void;
}

/**
 * Console-based validation reporter.
 */
export class ConsoleValidationReporter implements ValidationReporter {
  logResult(result: ValidationResult): void {
    if (!result.hasIssues) {
      return;
    }

    console.info('[Settings] Some values were auto-fixed:');
    for (const issue of result.issues) {
      console.info(
        `  - ${issue.field}:`,
        JSON.stringify(issue.originalValue),
        '→',
        JSON.stringify(issue.sanitizedValue),
        issue.error || '',
      );
    }
  }

  logIssue(issue: FieldValidationIssue): void {
    if (issue.error) {
      console.info(
        `[Settings] Fixed ${issue.field}:`,
        issue.originalValue,
        '→',
        issue.sanitizedValue,
        issue.error,
      );
    }
  }
}

/**
 * Silent validation reporter.
 */
export class SilentValidationReporter implements ValidationReporter {
  logResult(): void {
    // Silent
  }

  logIssue(): void {
    // Silent
  }
}

// ---------------------------------------------------------------------------
// Migration Helpers
// ---------------------------------------------------------------------------

/**
 * Legacy settings that may contain deprecated fields.
 *
 * This is the input format from old settings files.
 * Migration logic should transform this before schema validation.
 */
export interface LegacySettingsInput {
  version?: number;
  ui?: Partial<{
    fontSize?: unknown;
    fontFamily?: unknown;
    paneOpacity?: unknown;
    paneMaskOpacity?: unknown;
    paneMaskAlpha?: unknown; // Deprecated: replaced by paneMaskOpacity
    paneWidth?: unknown;
    webglEnabled?: unknown;
    breathingAlertEnabled?: boolean; // Deprecated: replaced by breathingIntensity
    breathingIntensity?: unknown;
    activityAlertDebounceMs?: unknown;
    shortcuts?: Record<string, unknown>;
  }>;
}

/**
 * Migrate legacy settings to current format.
 *
 * Handles:
 * - paneMaskAlpha → paneMaskOpacity
 * - breathingAlertEnabled → breathingIntensity
 * - Version 3 inverted mask opacity
 *
 * @param raw - Raw settings from storage
 * @returns Migrated settings ready for schema validation
 */
export function migrateLegacySettings(raw: LegacySettingsInput): Partial<AppSettingsUi> {
  const ui = raw.ui ?? {};
  const result: Partial<AppSettingsUi> = {};

  // Copy current fields
  if (ui.fontSize !== undefined) result.fontSize = ui.fontSize as number;
  if (ui.fontFamily !== undefined) result.fontFamily = ui.fontFamily as string;
  if (ui.paneOpacity !== undefined) result.paneOpacity = ui.paneOpacity as number;
  if (ui.paneWidth !== undefined) result.paneWidth = ui.paneWidth as number;
  if (ui.webglEnabled !== undefined) result.webglEnabled = ui.webglEnabled as boolean;
  if (ui.breathingIntensity !== undefined) result.breathingIntensity = ui.breathingIntensity as BreathingIntensity;
  if (ui.activityAlertDebounceMs !== undefined) result.activityAlertDebounceMs = ui.activityAlertDebounceMs as number;

  // Migrate paneMaskAlpha → paneMaskOpacity
  if (ui.paneMaskAlpha !== undefined && ui.paneMaskOpacity === undefined) {
    result.paneMaskOpacity = ui.paneMaskAlpha as number;
  } else if (ui.paneMaskOpacity !== undefined) {
    result.paneMaskOpacity = ui.paneMaskOpacity as number;
  }

  // Migrate version 3 inverted mask opacity
  if (raw.version !== undefined && raw.version < 4 && result.paneMaskOpacity !== undefined) {
    result.paneMaskOpacity = 1 - result.paneMaskOpacity;
  }

  // Migrate breathingAlertEnabled → breathingIntensity
  if (ui.breathingAlertEnabled !== undefined && result.breathingIntensity === undefined) {
    result.breathingIntensity = ui.breathingAlertEnabled ? 'intense' : 'none';
  }

  return result;
}
