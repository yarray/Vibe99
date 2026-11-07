/**
 * Agent-facing settings schema.
 *
 * The field catalogue — types, ranges, defaults, descriptions — lives in
 * `src/domain/settings-fields.json`, shared with the frontend zod schema so the
 * two can never silently drift (parity is enforced by
 * `src/domain/settings-fields.test.ts`).
 *
 * This module gives that catalogue two behaviors:
 *
 * - [`validate`] — strict. Used by `settings.set` *before* anything is
 *   persisted, so an agent gets `fontSize: expected integer 10-24, got 99`
 *   rather than a silent clamp or a silently dropped key.
 * - [`coerce`] — lenient. Used by `sanitize_ui_config` while loading a settings
 *   file that may predate the current schema: out-of-range values are clamped
 *   instead of rejected, so a hand-edited file can never break startup.
 *
 * Writable keys are the fields of the `ui` block of `settings.json`; `settings
 * get/set` resolve a bare field name there, so agents never need to know the
 * `ui` nesting.
 *
 * @module commands/settings_schema
 */

use serde_json::{json, Map, Value};
use std::sync::OnceLock;

/// The shared field catalogue. Embedded at compile time so the CLI binary and
/// the app always agree on the schema it shipped with.
pub const SPEC_SOURCE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../src/domain/settings-fields.json"
));

fn spec() -> &'static Map<String, Value> {
    static SPEC: OnceLock<Map<String, Value>> = OnceLock::new();
    SPEC.get_or_init(|| {
        let root: Value =
            serde_json::from_str(SPEC_SOURCE).expect("settings-fields.json must be valid JSON");
        root.get("fields")
            .and_then(Value::as_object)
            .cloned()
            .expect("settings-fields.json must contain a 'fields' object")
    })
}

/// All writable UI settings, sorted by key (`serde_json` maps are ordered).
pub fn fields() -> &'static Map<String, Value> {
    spec()
}

/// The spec for a single writable setting, or `None` if the key is unknown.
pub fn field(key: &str) -> Option<&'static Value> {
    spec().get(key)
}

pub fn is_field(key: &str) -> bool {
    spec().contains_key(key)
}

/// Sorted list of writable setting keys.
pub fn keys() -> Vec<&'static str> {
    spec().keys().map(String::as_str).collect()
}

/// The document returned by `vibe99ctl settings schema`.
pub fn schema_document() -> Value {
    json!({ "fields": spec() })
}

// ---------------------------------------------------------------------------
// Strict validation (agent input)
// ---------------------------------------------------------------------------

/// Validate a value for `key`, returning its canonical form.
///
/// Text inputs are accepted for typed fields because `vibe99ctl settings set`
/// passes the command line verbatim; the field type decides how the text is
/// read. Any failure names the field, the accepted shape and the offending
/// value, e.g. `fontSize: expected integer 10-24, got 99`.
pub fn validate(key: &str, raw: &Value) -> Result<Value, String> {
    let field_spec = field(key).ok_or_else(|| {
        format!("unknown setting `{key}` — run `vibe99ctl settings schema` to list writable keys")
    })?;
    validate_value(key, field_spec, raw)
}

fn validate_value(path: &str, field_spec: &Value, raw: &Value) -> Result<Value, String> {
    let expected = describe(field_spec);
    let mismatch = || format!("{path}: expected {expected}, got {}", compact(raw));

    match kind(field_spec) {
        "integer" => {
            let n = number_in(raw).ok_or_else(mismatch)?;
            if n.fract() != 0.0 {
                return Err(mismatch());
            }
            let n = check_bounds(field_spec, n).ok_or_else(mismatch)?;
            Ok(json!(apply_step(field_spec, n) as i64))
        }
        "number" => {
            let n = number_in(raw).ok_or_else(mismatch)?;
            let n = check_bounds(field_spec, n).ok_or_else(mismatch)?;
            Ok(json!(round_decimals(field_spec, n)))
        }
        "boolean" => boolean_in(raw).map(Value::Bool).ok_or_else(mismatch),
        "string" => raw
            .as_str()
            .map(|s| Value::String(s.trim().to_string()))
            .ok_or_else(mismatch),
        "enum" => {
            let value = raw.as_str().ok_or_else(mismatch)?;
            if allowed_values(field_spec).iter().any(|v| *v == value) {
                Ok(Value::String(value.to_string()))
            } else {
                Err(mismatch())
            }
        }
        "stringMap" => {
            let object = object_in(raw).ok_or_else(mismatch)?;
            let mut out = Map::new();
            for (key, value) in &object {
                let text = value.as_str().ok_or_else(|| {
                    format!("{path}.{key}: expected string, got {}", compact(value))
                })?;
                out.insert(key.clone(), Value::String(text.to_string()));
            }
            Ok(Value::Object(out))
        }
        "objectMap" => {
            let object = object_in(raw).ok_or_else(mismatch)?;
            let props = field_spec
                .get("itemProperties")
                .and_then(Value::as_object);
            let mut out = Map::new();
            for (entry_key, entry) in &object {
                let entry_path = format!("{path}.{entry_key}");
                let mut validated = object_in(entry).ok_or_else(|| {
                    format!("{entry_path}: expected object, got {}", compact(entry))
                })?;
                // Known properties are validated; unknown ones pass through,
                // mirroring the zod schema's `.passthrough()`.
                if let Some(props) = props {
                    for (prop_key, prop_spec) in props {
                        if let Some(prop_value) = validated.remove(prop_key) {
                            let checked = validate_value(
                                &format!("{entry_path}.{prop_key}"),
                                prop_spec,
                                &prop_value,
                            )?;
                            validated.insert(prop_key.clone(), checked);
                        }
                    }
                }
                out.insert(entry_key.clone(), Value::Object(validated));
            }
            Ok(Value::Object(out))
        }
        other => Err(format!("{path}: unsupported schema type `{other}`")),
    }
}

// ---------------------------------------------------------------------------
// Lenient coercion (settings file contents)
// ---------------------------------------------------------------------------

/// Coerce a raw settings value into the valid range, falling back to the
/// schema default when the value is missing or unusable.
pub fn coerce(key: &str, raw: Option<&Value>) -> Value {
    match field(key) {
        Some(field_spec) => coerce_value(field_spec, raw),
        None => Value::Null,
    }
}

fn coerce_value(field_spec: &Value, raw: Option<&Value>) -> Value {
    let default = || {
        field_spec
            .get("default")
            .cloned()
            .unwrap_or(Value::Null)
    };
    let Some(raw) = raw.filter(|v| !v.is_null()) else {
        return default();
    };

    match kind(field_spec) {
        "integer" => match number_in(raw) {
            Some(n) => {
                let n = clamp(field_spec, apply_step(field_spec, n.round()));
                json!(n as i64)
            }
            None => default(),
        },
        "number" => match number_in(raw) {
            Some(n) => json!(round_decimals(field_spec, clamp(field_spec, n))),
            None => default(),
        },
        "boolean" => boolean_in(raw).map(Value::Bool).unwrap_or_else(default),
        "string" => raw
            .as_str()
            .map(|s| {
                let trimmed = s.trim();
                if trimmed.is_empty() {
                    default()
                } else {
                    Value::String(trimmed.to_string())
                }
            })
            .unwrap_or_else(default),
        "enum" => raw
            .as_str()
            .and_then(|s| {
                let lower = s.to_lowercase();
                allowed_values(field_spec)
                    .iter()
                    .find(|allowed| **allowed == lower.as_str())
                    .map(|allowed| Value::String((*allowed).to_string()))
            })
            .unwrap_or_else(default),
        "stringMap" => raw
            .as_object()
            .map(|object| {
                let filtered: Map<String, Value> = object
                    .iter()
                    .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), json!(s))))
                    .collect();
                Value::Object(filtered)
            })
            .unwrap_or_else(default),
        "objectMap" => raw
            .as_object()
            .map(|object| Value::Object(object.clone()))
            .unwrap_or_else(default),
        _ => default(),
    }
}

// ---------------------------------------------------------------------------
// Schema helpers
// ---------------------------------------------------------------------------

fn kind(field_spec: &Value) -> &str {
    field_spec
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("")
}

fn allowed_values<'a>(field_spec: &'a Value) -> Vec<&'a str> {
    field_spec
        .get("values")
        .and_then(Value::as_array)
        .map(|values| values.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default()
}

/// Human-readable accepted shape, used verbatim in error messages.
fn describe(field_spec: &Value) -> String {
    let base = match kind(field_spec) {
        "integer" => "integer",
        "number" => "number",
        "boolean" => "boolean",
        "string" => "string",
        "enum" => {
            let values = allowed_values(field_spec);
            return format!("one of {}", values.join("|"));
        }
        "stringMap" => "object mapping string to string",
        "objectMap" => "object keyed by id",
        other => other,
    };

    match (
        field_spec.get("min").and_then(Value::as_f64),
        field_spec.get("max").and_then(Value::as_f64),
    ) {
        (Some(min), Some(max)) => format!("{base} {}-{}", fmt_num(min), fmt_num(max)),
        (Some(min), None) => format!("{base} >= {}", fmt_num(min)),
        (None, Some(max)) => format!("{base} <= {}", fmt_num(max)),
        (None, None) => base.to_string(),
    }
}

/// `1.0` → `"1"`, `0.55` → `"0.55"` — error messages read like the docs.
fn fmt_num(n: f64) -> String {
    format!("{n}")
}

/// Render a value the way the user typed it. `vibe99ctl` transports bare
/// arguments as text, so a `settings set fontSize 99` arrives as the string
/// `"99"`; quoting it in the error would blame the user for a transport
/// detail.
fn compact(value: &Value) -> String {
    if let Value::String(text) = value {
        let trimmed = text.trim();
        if trimmed.parse::<f64>().is_ok() {
            return trimmed.to_string();
        }
        if matches!(trimmed.to_lowercase().as_str(), "true" | "false") {
            return trimmed.to_lowercase();
        }
    }
    serde_json::to_string(value).unwrap_or_default()
}

fn number_in(value: &Value) -> Option<f64> {
    let n = match value {
        Value::Number(n) => n.as_f64()?,
        Value::String(s) => s.trim().parse().ok()?,
        _ => return None,
    };
    n.is_finite().then_some(n)
}

fn boolean_in(value: &Value) -> Option<bool> {
    match value {
        Value::Bool(b) => Some(*b),
        Value::String(s) => match s.trim().to_lowercase().as_str() {
            "true" => Some(true),
            "false" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

/// Accept an object, or a JSON object encoded as text (CLI `--json` and bare
/// `settings set key '{"..."}'` both arrive as the latter).
fn object_in(value: &Value) -> Option<Map<String, Value>> {
    match value {
        Value::Object(object) => Some(object.clone()),
        Value::String(text) => {
            let parsed: Value = serde_json::from_str(text).ok()?;
            parsed.as_object().cloned()
        }
        _ => None,
    }
}

fn check_bounds(field_spec: &Value, n: f64) -> Option<f64> {
    let min = field_spec.get("min").and_then(Value::as_f64);
    let max = field_spec.get("max").and_then(Value::as_f64);
    let below = min.is_some_and(|min| n < min);
    let above = max.is_some_and(|max| n > max);
    (!below && !above).then_some(n)
}

fn clamp(field_spec: &Value, n: f64) -> f64 {
    let min = field_spec.get("min").and_then(Value::as_f64);
    let max = field_spec.get("max").and_then(Value::as_f64);
    let mut n = n;
    if let Some(min) = min {
        n = n.max(min);
    }
    if let Some(max) = max {
        n = n.min(max);
    }
    n
}

fn apply_step(field_spec: &Value, n: f64) -> f64 {
    match field_spec.get("step").and_then(Value::as_f64) {
        Some(step) if step > 0.0 => clamp(field_spec, (n / step).round() * step),
        _ => n,
    }
}

fn round_decimals(field_spec: &Value, n: f64) -> f64 {
    match field_spec.get("decimals").and_then(Value::as_u64) {
        Some(decimals) => {
            let factor = 10f64.powi(decimals as i32);
            clamp(field_spec, (n * factor).round() / factor)
        }
        None => n,
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn validate_err(key: &str, raw: Value) -> String {
        validate(key, &raw).expect_err("value should be rejected")
    }

    #[test]
    fn every_field_declares_the_pieces_validation_needs() {
        for (key, field_spec) in fields() {
            assert!(
                field_spec.get("type").and_then(Value::as_str).is_some(),
                "{key} is missing a type"
            );
            assert!(
                field_spec.get("default").is_some(),
                "{key} is missing a default"
            );
            assert!(
                field_spec
                    .get("description")
                    .and_then(Value::as_str)
                    .is_some_and(|d| !d.is_empty()),
                "{key} is missing a description"
            );
            // The declared default must itself be a valid value.
            validate(key, field_spec.get("default").unwrap())
                .unwrap_or_else(|e| panic!("{key} default is invalid: {e}"));
        }
    }

    #[test]
    fn schema_document_lists_every_writable_key() {
        let document = schema_document();
        let listed = document["fields"].as_object().unwrap();
        assert_eq!(listed.len(), fields().len());
        for key in keys() {
            assert!(listed.contains_key(key), "{key} missing from schema document");
        }
    }

    #[test]
    fn error_names_the_field_and_the_accepted_range() {
        assert_eq!(
            validate_err("fontSize", json!(99)),
            "fontSize: expected integer 10-24, got 99"
        );
        assert_eq!(
            validate_err("paneOpacity", json!(0.1)),
            "paneOpacity: expected number 0.55-1, got 0.1"
        );
        assert_eq!(
            validate_err("breathingIntensity", json!("loud")),
            "breathingIntensity: expected one of none|mild|intense, got \"loud\""
        );
        assert_eq!(
            validate_err("webglEnabled", json!("yes")),
            "webglEnabled: expected boolean, got \"yes\""
        );
        assert_eq!(
            validate_err("fontFamily", json!(5)),
            "fontFamily: expected string, got 5"
        );
    }

    #[test]
    fn error_shows_cli_text_values_as_typed() {
        // `vibe99ctl settings set fontSize 99` sends the bare argument as text.
        assert_eq!(
            validate_err("fontSize", json!("99")),
            "fontSize: expected integer 10-24, got 99"
        );
        assert_eq!(
            validate_err("webglEnabled", json!("1")),
            "webglEnabled: expected boolean, got 1"
        );
        // Non-scalar text stays quoted so the user can see what was read.
        assert_eq!(
            validate_err("breathingIntensity", json!("loud")),
            "breathingIntensity: expected one of none|mild|intense, got \"loud\""
        );
    }

    #[test]
    fn integer_fields_reject_fractions_and_accept_text() {
        assert!(validate("fontSize", &json!(13.5)).is_err());
        assert_eq!(validate("fontSize", &json!("15")).unwrap(), json!(15));
        assert_eq!(validate("fontSize", &json!(15)).unwrap(), json!(15));
        assert!(validate("fontSize", &json!(9)).is_err());
        assert!(validate("fontSize", &json!(25)).is_err());
        assert!(validate("fontSize", &json!(10)).is_ok());
        assert!(validate("fontSize", &json!(24)).is_ok());
    }

    #[test]
    fn pane_width_snaps_to_its_step() {
        assert_eq!(validate("paneWidth", &json!(725)).unwrap(), json!(730));
        assert_eq!(validate("paneWidth", &json!("521")).unwrap(), json!(520));
    }

    #[test]
    fn number_fields_round_to_declared_decimals() {
        assert_eq!(validate("paneOpacity", &json!(0.777)).unwrap(), json!(0.78));
        assert_eq!(validate("paneMaskOpacity", &json!(0)).unwrap(), json!(0.0));
    }

    #[test]
    fn string_fields_are_trimmed_and_may_be_empty() {
        assert_eq!(
            validate("fontFamily", &json!("  Fira Code  ")).unwrap(),
            json!("Fira Code")
        );
        assert_eq!(validate("fontFamily", &json!("")).unwrap(), json!(""));
    }

    #[test]
    fn object_fields_accept_text_and_validate_nested_properties() {
        let value = validate("quakeLayouts", &json!("{\"layout-1\":{\"height\":50}}"))
            .expect("JSON text should be accepted");
        assert_eq!(value, json!({"layout-1": {"height": 50}}));
        assert_eq!(
            validate_err(
                "quakeLayouts",
                json!({"layout-1": {"height": 5}})
            ),
            "quakeLayouts.layout-1.height: expected integer 30-100, got 5"
        );
        assert_eq!(
            validate_err(
                "quakeLayouts",
                json!({"layout-1": {"position": "middle"}})
            ),
            "quakeLayouts.layout-1.position: expected one of top|bottom, got \"middle\""
        );
    }

    #[test]
    fn string_map_fields_reject_non_string_values() {
        assert_eq!(
            validate("layoutHotkeys", &json!({"layout-1": "F1"})).unwrap(),
            json!({"layout-1": "F1"})
        );
        assert_eq!(
            validate_err("layoutHotkeys", json!({"layout-1": 1})),
            "layoutHotkeys.layout-1: expected string, got 1"
        );
    }

    #[test]
    fn unknown_key_is_an_actionable_error() {
        let message = validate_err("fontSizes", json!(15));
        assert!(message.starts_with("unknown setting `fontSizes`"), "{message}");
        assert!(message.contains("settings schema"), "{message}");
    }

    #[test]
    fn coerce_clamps_instead_of_rejecting() {
        assert_eq!(coerce("fontSize", Some(&json!(99))), json!(24));
        assert_eq!(coerce("fontSize", Some(&json!(1))), json!(10));
        assert_eq!(coerce("paneOpacity", Some(&json!(0.1))), json!(0.55));
        assert_eq!(coerce("paneWidth", Some(&json!(733))), json!(730));
        assert_eq!(coerce("breathingIntensity", Some(&json!("MILD"))), json!("mild"));
        assert_eq!(coerce("breathingIntensity", Some(&json!("loud"))), json!("mild"));
        assert_eq!(coerce("webglEnabled", Some(&json!("nope"))), json!(true));
        assert_eq!(coerce("layoutHotkeys", Some(&json!({"a": 1, "b": "F1"}))), json!({"b": "F1"}));
    }

    #[test]
    fn coerce_falls_back_to_declared_defaults() {
        for key in keys() {
            let default = field(key).unwrap().get("default").unwrap();
            assert_eq!(&coerce(key, None), default, "{key} default mismatch");
            assert_eq!(
                &coerce(key, Some(&Value::Null)),
                default,
                "{key} null default mismatch"
            );
        }
    }
}
