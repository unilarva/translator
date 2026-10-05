# Changelog

## Unreleased

- Add DOM-free `formatRelativeTime()` and `selectPlural()` helpers and matching Translator methods,
  with root-exported `RelativeTimeFormatOptions` and `PluralSelectOptions` types. Methods use the
  active language or a per-call override and log original failures as `relative-time-format-failed`
  and `plural-select-failed` before rethrowing. Finite number inputs are required without coercion;
  native Intl defaults, unit/option validation, locale support, and rounding behavior are preserved.
  Plural results are category labels, not compiled messages. Per-family caches remain bounded under
  the shared cache policy, with object coercions bypassing caching. No runtime dependencies or DOM
  markers are added, and existing lookup and formatting contracts remain unchanged.
- Apply `bindLanguageDetails`'s `currentLabel` formatter to unregistered active languages
  with `{ code }` metadata, rather than bypassing it and displaying the raw code.
- With population enabled, `bindLanguageSelect` now displays an unregistered active language
  using a temporary option and the configured `label` strategy with `{ code }` metadata,
  rather than clearing the selection. Consumer-owned options remain unchanged.

## 0.3.0 - 2026-10-04

- First public release.
