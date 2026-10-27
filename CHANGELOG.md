# Changelog

## Unreleased

- **Breaking:** Restrict all four `formatDate*` APIs to calendar strings/records and date-only options;
  Date inputs and clock/zone options are rejected. Move instants to the four `formatDateTime*` APIs
  with required explicit `timeZone` options. Defaults are medium date plus short time unless styles
  or display components are defined. Weekdays also reject zone options. See the usage guide's
  temporal migration; no mixed-input compatibility overloads are retained.
- Add native structured parts for numbers, currencies, relative times, calendars, datetimes, clocks,
  and weekdays, plus number/currency/calendar/datetime/clock/weekday ranges, through helpers and
  Translator methods. Parts are fresh and caller-owned with native range source metadata. Clock
  ranges use same-day ordering and pair-aware seconds; recurring contiguous weekday spans wrap
  forward through Sunday, with equal endpoints meaning one weekday. Unsupported native operations
  fail only when called, without affecting imports or unrelated formatting.
- Extend opt-in `intlDomExtension()` with text-only number, currency, calendar, clock, weekday and
  datetime range pairs and temporal styles, all supporting custom prefixes. Datetime pairs privately
  parse strict offset-bearing timestamps, require an explicit output zone and always supply both
  date/time styles (independent medium/short defaults, unlike core projections). Invalid markers and
  options preserve old content and valid siblings; native strings and binding refreshes are retained.
  No public parser, single-datetime marker or parts rendering is added.
- Require TypeScript `ES2023` libraries, or `ES2022` plus `ES2023.Intl`, instead of ES2022 alone.
  Root declarations remain DOM-free; the JavaScript target stays ES2022 and the Node minimum stays
  `22.13.0`.

## 0.3.0 - 2026-10-05

- Add ordered multiple fallback languages through `TranslatorOptions.additionalFallbackLanguages`
  (default `[]`), `setAdditionalFallbackLanguages()`, `getAdditionalFallbackLanguages()`, and
  `getFallbackLanguages()`. Lookup expands requested, active, primary, and each additional tag to
  parents in order with stable candidate deduplication, before optional first-stored arbitrary
  fallback and missing policy. Frozen canonical snapshots retain primary matches within extras;
  the combined getter uniquely lists primary then extras without parent expansion or active/requested
  candidates. Dense string arrays are fully validated and snapshotted before assignment, with
  `TypeError` for invalid array shapes/types and `RangeError` for invalid tags. Existing singular
  fallback APIs remain primary-only; changing primary retains extras, and `[]` resets only extras.
- Add independent `copyFrom()` option `additionalFallbackLanguages` (default `false`); the existing
  `fallbackLanguage` flag copies only primary. Selected lists copy exactly regardless of catalog/registry
  merge or replace mode and commit before active-language events. Display-name lookup uses additional
  fallback parent chains without separately inserting active language for explicit requests. Fallback
  changes emit no existing events and require `binding.update()` even with catalog autorefresh enabled.
  Formatting locale, exact-active registry direction, and language controls remain independent of
  translation fallback. Missing-log details add `additionalFallbackLanguages` only for nonempty extras,
  preserving the old details shape otherwise.
- Add root-exported `createTypedTranslate()` for opt-in compile-time key checking from an explicit
  string union or key-first catalog type witness. The witness is not read, validated, imported, or
  retained; envelope imports keep full runtime validation. Calls delegate with unmodified options
  to the live translator, preserving lookup behavior and exact errors. Existing string-key APIs
  remain unchanged; no generated tooling, runtime dependency, module, or subpath is added.
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
