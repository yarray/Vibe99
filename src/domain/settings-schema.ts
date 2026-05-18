/**
 * Settings Schema Definition
 *
 * Data-driven schema for Settings validation and sanitization.
 * Schema defines valid types, ranges, and defaults for each setting.
 *
 * Design principles:
 * - Schema as data (P13): Behavior defined by schema structure
 * - TypeScript-native (P2): No external validation libraries
 * - Minimal abstraction (P1): Small set of composable primitives
 * - Error prevention (P3): Invalid values auto-repair to valid defaults
 *
 * @module domain/settings-schema
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Primitive value types supported by the schema.
 */
export type PrimitiveType = 'string' | 'number' | 'boolean' | 'enum';

/**
 * Union type for valid enum values.
 */
export type EnumValue = string | number | boolean;

/**
 * Base schema for all field types.
 */
interface BaseFieldSchema {
  /** Type of the field */
  type: PrimitiveType;
  /** Default value if field is missing or invalid */
  default: unknown;
  /** Optional: Human-readable description for user feedback */
  description?: string;
}

/**
 * Schema for string fields.
 */
interface StringFieldSchema extends BaseFieldSchema {
  type: 'string';
  default: string;
  /** Optional: Minimum length (inclusive) */
  minLength?: number;
  /** Optional: Maximum length (inclusive) */
  maxLength?: number;
  /** Optional: Valid string values (enum-like for strings) */
  validValues?: string[];
  /** Optional: Trim whitespace before validation */
  trim?: boolean;
  /** Optional: Function to transform value */
  transform?: (value: string) => string;
}

/**
 * Schema for number fields.
 */
interface NumberFieldSchema extends BaseFieldSchema {
  type: 'number';
  default: number;
  /** Optional: Minimum value (inclusive) */
  min?: number;
  /** Optional: Maximum value (inclusive) */
  max?: number;
  /** Optional: Round to N decimal places */
  decimals?: number;
  /** Optional: Round to nearest multiple of step (e.g. 10 for widths) */
  step?: number;
  /** Optional: Integer-only check */
  integer?: boolean;
}

/**
 * Schema for boolean fields.
 */
interface BooleanFieldSchema extends BaseFieldSchema {
  type: 'boolean';
  default: boolean;
}

/**
 * Schema for enum fields (fixed set of values).
 */
interface EnumFieldSchema<T extends EnumValue> extends BaseFieldSchema {
  type: 'enum';
  default: T;
  /** Array of valid values */
  values: readonly T[];
}

/**
 * Union type for all field schemas.
 */
export type FieldSchema =
  | StringFieldSchema
  | NumberFieldSchema
  | BooleanFieldSchema
  | EnumFieldSchema<EnumValue>;

/**
 * Schema definition for a settings object.
 * Keys are field names, values are field schemas.
 */
export type SettingsSchema<T extends Record<string, unknown>> = {
  [K in keyof T]: FieldSchema;
};

// ---------------------------------------------------------------------------
// Validation Result
// ---------------------------------------------------------------------------

/**
 * Result of validating a single field.
 */
export interface FieldValidationResult {
  /** Field name */
  field: string;
  /** Whether the value was valid */
  valid: boolean;
  /** The sanitized value (original if valid, default if not) */
  sanitizedValue: unknown;
  /** Original value before sanitization */
  originalValue: unknown;
  /** Default value used (if invalid) */
  defaultValue?: unknown;
  /** Human-readable description of what was fixed */
  fixDescription?: string;
}

/**
 * Result of validating a full settings object.
 */
export interface ValidationResult<T extends Record<string, unknown>> {
  /** The sanitized settings object */
  sanitized: T;
  /** Array of fields that were fixed (empty if all valid) */
  fixedFields: FieldValidationResult[];
  /** Whether any fields were invalid */
  hasFixes: boolean;
}

// ---------------------------------------------------------------------------
// Settings Field Schemas
// ---------------------------------------------------------------------------

/**
 * Schema for AppSettings UI fields.
 *
 * Each field defines:
 * - Type: The expected data type
 * - Default: Fallback value if missing/invalid
 * - Constraints: Valid range or values
 * - Description: For user feedback
 */
export const appSettingsSchema: SettingsSchema<AppSettingsUi> = {
  fontSize: {
    type: 'number',
    default: 13,
    min: 10,
    max: 24,
    integer: true,
    description: 'Font size in pixels',
  },
  fontFamily: {
    type: 'string',
    default: '',
    trim: true,
    transform: (value) => value || '', // Empty string means use platform default
    description: 'Font family CSS string',
  },
  paneOpacity: {
    type: 'number',
    default: 0.8,
    min: 0.55,
    max: 1.0,
    decimals: 2,
    description: 'Pane background opacity (0.55 - 1.0)',
  },
  paneMaskOpacity: {
    type: 'number',
    default: 0.75,
    min: 0.0,
    max: 1.0,
    decimals: 2,
    description: 'Pane mask overlay opacity (0.0 - 1.0)',
  },
  paneWidth: {
    type: 'number',
    default: 720,
    min: 520,
    max: 2000,
    step: 10,
    integer: true,
    description: 'Pane width in pixels (520 - 2000, multiples of 10)',
  },
  webglEnabled: {
    type: 'boolean',
    default: true,
    description: 'Enable 3D acceleration (requires restart)',
  },
  breathingIntensity: {
    type: 'enum',
    default: 'mild',
    values: ['none', 'mild', 'intense'] as const,
    description: 'Activity alert breathing animation intensity',
  },
  activityAlertDebounceMs: {
    type: 'number',
    default: 30000,
    min: 3000,
    max: 300000,
    integer: true,
    description: 'Activity alert debounce time in milliseconds (3s - 5min)',
  },
};

// ---------------------------------------------------------------------------
// Schema Type Inference
// ---------------------------------------------------------------------------

/**
 * Infer the settings type from its schema.
 * Extracts the default value types from each field schema.
 */
export type InferSettingsType<T extends SettingsSchema<Record<string, unknown>>> = {
  [K in keyof T]: T[K] extends NumberFieldSchema
    ? number
    : T[K] extends StringFieldSchema
      ? string
      : T[K] extends BooleanFieldSchema
        ? boolean
        : T[K] extends EnumFieldSchema<infer V>
          ? V
          : never;
};

/**
 * The type of AppSettings inferred from the schema.
 */
export type AppSettingsUi = InferSettingsType<typeof appSettingsSchema>;

// ---------------------------------------------------------------------------
// Legacy Migration Types
// ---------------------------------------------------------------------------

/**
 * Raw settings format that may come from persistence or older versions.
 * All fields are optional to handle partial/legacy data.
 */
export type PersistedSettingsRaw = {
  version?: number;
  ui?: Partial<AppSettingsUi & {
    shortcuts: Record<string, unknown>;
    paneMaskAlpha?: number;
    breathingAlertEnabled?: boolean;
  }>;
};

// ---------------------------------------------------------------------------
// Sanitization Functions
// ---------------------------------------------------------------------------

/**
 * Sanitize a string field according to its schema.
 */
function sanitizeString(
  value: unknown,
  schema: StringFieldSchema,
): { sanitized: string; fixed: boolean; description?: string } {
  if (typeof value !== 'string') {
    return {
      sanitized: schema.default,
      fixed: true,
      description: schema.description
        ? `Invalid ${schema.description}, using default`
        : 'Invalid string, using default',
    };
  }

  let result = value;

  // Apply trim if configured
  if (schema.trim) {
    result = result.trim();
  }

  // Apply custom transform
  if (schema.transform) {
    result = schema.transform(result);
  }

  // Check min length
  if (schema.minLength !== undefined && result.length < schema.minLength) {
    return {
      sanitized: schema.default,
      fixed: true,
      description: schema.description
        ? `${schema.description} too short (min ${schema.minLength}), using default`
        : `String too short (min ${schema.minLength}), using default`,
    };
  }

  // Check max length
  if (schema.maxLength !== undefined && result.length > schema.maxLength) {
    return {
      sanitized: schema.default,
      fixed: true,
      description: schema.description
        ? `${schema.description} too long (max ${schema.maxLength}), using default`
        : `String too long (max ${schema.maxLength}), using default`,
    };
  }

  // Check valid values (enum-like)
  if (schema.validValues && !schema.validValues.includes(result)) {
    return {
      sanitized: schema.default,
      fixed: true,
      description: schema.description
        ? `Invalid ${schema.description} value, using default`
        : 'Invalid string value, using default',
    };
  }

  return { sanitized: result, fixed: false };
}

/**
 * Sanitize a number field according to its schema.
 */
function sanitizeNumber(
  value: unknown,
  schema: NumberFieldSchema,
): { sanitized: number; fixed: boolean; description?: string } {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return {
      sanitized: schema.default,
      fixed: true,
      description: schema.description
        ? `Invalid ${schema.description}, using default`
        : 'Invalid number, using default',
    };
  }

  let result = value;

  // Apply rounding to decimals
  if (schema.decimals !== undefined) {
    const factor = Math.pow(10, schema.decimals);
    result = Math.round(result * factor) / factor;
  }

  // Apply step rounding
  if (schema.step !== undefined) {
    result = Math.round(result / schema.step) * schema.step;
  }

  // Apply integer constraint
  if (schema.integer) {
    result = Math.round(result);
  }

  // Check min/max
  const clamped =
    schema.min !== undefined && schema.max !== undefined
      ? Math.max(schema.min, Math.min(schema.max, result))
      : schema.min !== undefined
        ? Math.max(schema.min, result)
        : schema.max !== undefined
          ? Math.min(schema.max, result)
          : result;

  if (clamped !== result) {
    return {
      sanitized: clamped,
      fixed: true,
      description: schema.description
        ? `${schema.description} out of range, clamped to ${clamped}`
        : `Number out of range, clamped to ${clamped}`,
    };
  }

  return { sanitized: result, fixed: false };
}

/**
 * Sanitize a boolean field according to its schema.
 */
function sanitizeBoolean(
  value: unknown,
  schema: BooleanFieldSchema,
): { sanitized: boolean; fixed: boolean; description?: string } {
  if (typeof value !== 'boolean') {
    return {
      sanitized: schema.default,
      fixed: true,
      description: schema.description
        ? `Invalid ${schema.description}, using default`
        : 'Invalid boolean, using default',
    };
  }
  return { sanitized: value, fixed: false };
}

/**
 * Sanitize an enum field according to its schema.
 */
function sanitizeEnum<T extends EnumValue>(
  value: unknown,
  schema: EnumFieldSchema<T>,
): { sanitized: T; fixed: boolean; description?: string } {
  // Check if value is in the valid values array
  if (schema.values.includes(value as T)) {
    return { sanitized: value as T, fixed: false };
  }

  return {
    sanitized: schema.default,
    fixed: true,
    description: schema.description
      ? `Invalid ${schema.description}, using default`
      : 'Invalid enum value, using default',
  };
}

/**
 * Sanitize a single field according to its schema.
 *
 * Public API for validating individual fields.
 */
export function sanitizeField(
  fieldName: string,
  value: unknown,
  schema: FieldSchema,
): FieldValidationResult {
  const originalValue = value;

  let result: FieldValidationResult;

  switch (schema.type) {
    case 'string': {
      const stringSchema = schema as StringFieldSchema;
      const { sanitized, fixed, description } = sanitizeString(value, stringSchema);
      result = {
        field: fieldName,
        valid: !fixed,
        sanitizedValue: sanitized,
        originalValue,
        defaultValue: fixed ? stringSchema.default : undefined,
        fixDescription: description,
      };
      break;
    }
    case 'number': {
      const numberSchema = schema as NumberFieldSchema;
      const { sanitized, fixed, description } = sanitizeNumber(value, numberSchema);
      result = {
        field: fieldName,
        valid: !fixed,
        sanitizedValue: sanitized,
        originalValue,
        defaultValue: fixed ? numberSchema.default : undefined,
        fixDescription: description,
      };
      break;
    }
    case 'boolean': {
      const booleanSchema = schema as BooleanFieldSchema;
      const { sanitized, fixed, description } = sanitizeBoolean(value, booleanSchema);
      result = {
        field: fieldName,
        valid: !fixed,
        sanitizedValue: sanitized,
        originalValue,
        defaultValue: fixed ? booleanSchema.default : undefined,
        fixDescription: description,
      };
      break;
    }
    case 'enum': {
      const enumSchema = schema as EnumFieldSchema<EnumValue>;
      const { sanitized, fixed, description } = sanitizeEnum(value, enumSchema);
      result = {
        field: fieldName,
        valid: !fixed,
        sanitizedValue: sanitized,
        originalValue,
        defaultValue: fixed ? enumSchema.default : undefined,
        fixDescription: description,
      };
      break;
    }
    default: {
      // Unknown type - use default
      result = {
        field: fieldName,
        valid: false,
        sanitizedValue: (schema as BaseFieldSchema).default,
        originalValue,
        defaultValue: (schema as BaseFieldSchema).default,
        fixDescription: 'Unknown field type, using default',
      };
    }
  }

  return result;
}

/**
 * Validate and sanitize settings against a schema.
 *
 * Returns the sanitized settings and a list of any fixes applied.
 * This is the main entry point for settings validation.
 *
 * @param raw - The raw settings object (may be partial/invalid)
 * @param schema - The schema to validate against
 * @returns ValidationResult with sanitized settings and fix details
 */
export function validateAndSanitizeSettings<T extends Record<string, unknown>>(
  raw: Partial<T>,
  schema: SettingsSchema<T>,
): ValidationResult<T> {
  const sanitized = {} as T;
  const fixedFields: FieldValidationResult[] = [];

  for (const [key, fieldSchema] of Object.entries(schema)) {
    const value = raw[key as keyof T];
    const result = sanitizeField(key, value, fieldSchema as FieldSchema);

    sanitized[key as keyof T] = result.sanitizedValue as T[keyof T];

    if (!result.valid) {
      fixedFields.push(result);
    }
  }

  return {
    sanitized,
    fixedFields,
    hasFixes: fixedFields.length > 0,
  };
}

/**
 * Format validation results for console logging.
 *
 * Produces a human-readable summary of what was fixed.
 *
 * @param result - The validation result
 * @returns Formatted string for logging
 */
export function formatValidationResult<T extends Record<string, unknown>>(
  result: ValidationResult<T>,
): string {
  if (!result.hasFixes) {
    return 'All settings are valid.';
  }

  const lines = ['Settings validation: Some values were auto-fixed:'];

  for (const fix of result.fixedFields) {
    const original = JSON.stringify(fix.originalValue);
    const sanitized = JSON.stringify(fix.sanitizedValue);
    const description = fix.fixDescription || 'Invalid value';

    lines.push(
      `  - ${fix.field}: ${original} → ${sanitized} (${description})`,
    );
  }

  return lines.join('\n');
}

/**
 * Settings validation reporter interface.
 *
 * Callbacks for reporting validation results.
 */
export interface ValidationReporter {
  /** Log a validation result */
  logResult(result: ValidationResult<Record<string, unknown>>): void;
  /** Report a specific fix */
  logFix(fix: FieldValidationResult): void;
}

/**
 * Console-based validation reporter.
 *
 * Logs validation results to the browser console.
 */
export class ConsoleValidationReporter implements ValidationReporter {
  logResult<T extends Record<string, unknown>>(result: ValidationResult<T>): void {
    if (result.hasFixes) {
      console.info(formatValidationResult(result));
    }
  }

  logFix(fix: FieldValidationResult): void {
    console.info(
      `[Settings] Fixed ${fix.field}:`,
      fix.originalValue,
      '→',
      fix.sanitizedValue,
      fix.fixDescription || '',
    );
  }
}

/**
 * Silent validation reporter.
 *
 * Suppresses all validation output.
 */
export class SilentValidationReporter implements ValidationReporter {
  logResult<T extends Record<string, unknown>>(): void {
    // Silent - no output
  }

  logFix(): void {
    // Silent - no output
  }
}

/**
 * Create default settings from a schema.
 *
 * @param schema - The settings schema
 * @returns Default settings object
 */
export function createDefaultSettings<T extends Record<string, unknown>>(
  schema: SettingsSchema<T>,
): T {
  const defaults = {} as T;

  for (const [key, fieldSchema] of Object.entries(schema)) {
    defaults[key as keyof T] = (fieldSchema as BaseFieldSchema).default as T[keyof T];
  }

  return defaults;
}

/**
 * Check if a value matches a field schema type.
 *
 * Useful for runtime type checking before validation.
 *
 * @param value - The value to check
 * @param schema - The field schema
 * @returns True if value matches the expected type
 */
export function matchesSchemaType(value: unknown, schema: FieldSchema): boolean {
  switch (schema.type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'enum':
      return (schema as EnumFieldSchema<EnumValue>).values.includes(value as EnumValue);
    default:
      return false;
  }
}
