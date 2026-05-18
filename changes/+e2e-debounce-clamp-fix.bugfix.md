Fix activity alert debounce input clamping - out-of-range values are now properly clamped to 3s minimum and 300s maximum, matching the zod schema validation.
