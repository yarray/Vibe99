/**
 * Settings field catalogue parity tests.
 *
 * `settings-fields.json` is the single source of truth shared with the Rust
 * backend (CLI validation + settings sanitization). This suite is the drift
 * alarm: it fails as soon as the JSON catalogue and the zod schema the UI
 * validates against disagree on which fields exist, their types, their
 * defaults, or their numeric range.
 *
 * @module domain/settings-fields.test
 */

import { describe, expect, it } from 'vitest';
import spec from './settings-fields.json';
import {
  appSettingsSchema,
  getDefaultSettings,
  validateField,
} from './settings-schema.js';

type FieldName = keyof typeof appSettingsSchema.shape;

interface FieldSpec {
  type: 'integer' | 'number' | 'boolean' | 'string' | 'enum' | 'stringMap' | 'objectMap';
  min?: number;
  max?: number;
  step?: number;
  decimals?: number;
  values?: string[];
  default: unknown;
  description: string;
}

const fields = spec.fields as Record<string, FieldSpec>;
const keys = Object.keys(fields).sort();

function validate(key: string, value: unknown) {
  return validateField(key as FieldName, value);
}

describe('settings field catalogue', () => {
  it('covers exactly the fields the UI schema validates', () => {
    expect(keys).toEqual(Object.keys(appSettingsSchema.shape).sort());
  });

  it('describes every field for the agent-facing schema', () => {
    for (const key of keys) {
      expect(fields[key].description, key).toMatch(/\S/);
      expect(fields[key].type, key).toBeTruthy();
    }
  });

  it('declares the same defaults as the UI schema', () => {
    const defaults = getDefaultSettings() as Record<string, unknown>;
    for (const key of keys) {
      expect(fields[key].default, key).toEqual(defaults[key]);
    }
  });

  it('declares defaults the UI schema accepts unchanged', () => {
    for (const key of keys) {
      const result = validate(key, fields[key].default);
      expect(result.error, key).toBeUndefined();
      expect(result.sanitizedValue, key).toEqual(fields[key].default);
    }
  });

  it('declares the JS type the UI schema produces', () => {
    const expected: Record<FieldSpec['type'], string> = {
      integer: 'number',
      number: 'number',
      boolean: 'boolean',
      string: 'string',
      enum: 'string',
      stringMap: 'object',
      objectMap: 'object',
    };
    for (const key of keys) {
      const result = validate(key, fields[key].default);
      expect(typeof result.sanitizedValue, key).toBe(expected[fields[key].type]);
    }
  });

  it('declares the same enum options as the UI schema', () => {
    for (const key of keys) {
      const field = fields[key];
      if (field.type !== 'enum') continue;
      // The field may be a `ZodDefault` wrapper around the enum.
      const schema = appSettingsSchema.shape[key as FieldName] as unknown as {
        options?: string[];
        unwrap?: () => { options?: string[] };
      };
      const options = schema.options ?? schema.unwrap?.().options;
      expect(options, key).toBeDefined();
      expect([...options!].sort(), key).toEqual([...field.values!].sort());
    }
  });

  it('declares numeric bounds the UI schema accepts at both ends', () => {
    for (const key of keys) {
      const field = fields[key];
      if (field.min === undefined || field.max === undefined) continue;

      for (const bound of [field.min, field.max]) {
        const result = validate(key, bound);
        expect(result.error, `${key} at ${bound}`).toBeUndefined();
        expect(result.sanitizedValue as number, `${key} at ${bound}`).toBeGreaterThanOrEqual(
          field.min,
        );
        expect(result.sanitizedValue as number, `${key} at ${bound}`).toBeLessThanOrEqual(
          field.max,
        );
      }
    }
  });

  it('never lets the UI schema silently leave a declared range', () => {
    for (const key of keys) {
      const field = fields[key];
      if (field.min === undefined || field.max === undefined) continue;

      for (const out of [field.min - 1000, field.max + 1000]) {
        const result = validate(key, out);
        if (result.error) continue; // rejected outright — fine
        // Clamped instead of rejected is fine too, but it must land inside.
        expect(result.sanitizedValue as number, `${key} given ${out}`).toBeGreaterThanOrEqual(
          field.min,
        );
        expect(result.sanitizedValue as number, `${key} given ${out}`).toBeLessThanOrEqual(
          field.max,
        );
      }
    }
  });

  it('keeps integer fields integral in the UI schema', () => {
    for (const key of keys) {
      const field = fields[key];
      if (field.type !== 'integer') continue;
      const result = validate(key, Math.round((field.min ?? 0) + 0.5));
      expect(Number.isInteger(result.sanitizedValue), key).toBe(true);
    }
  });
});
