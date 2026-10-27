# Changelog

## Unreleased

- Add DOM-free `formatNumberRange()`, `formatNumberRangeToParts()`, `formatCurrencyRange()`, and
  `formatCurrencyRangeToParts()` helpers and matching Translator methods. Reuse family options,
  defaults, and formatter caches with finite number endpoints only, without coercion. Preserve native
  descending ranges, signed zero, equal/rounded approximation, and shared affixes. Range parts are
  fresh mutable `Intl.NumberRangeFormatPart[]` and records, retaining native `source` metadata and
  `approximatelySign`. Methods log original failures with operation-specific range events before
  rethrowing the identical error; standalone helpers throw without logging. Missing native
  `Intl.NumberFormat.prototype.formatRange` or `formatRangeToParts` produces a method-specific
  call-time `TypeError` with runtime/polyfill guidance, without breaking imports or unrelated
  operations. No fallback, polyfill, dependency, DOM behavior, or state events are added; date and
  clock ranges remain future work.
- Add DOM-free `formatNumberToParts()`, `formatCurrencyToParts()`, `formatRelativeTimeToParts()`,
  `formatDateToParts()`, `formatTimeToParts()`, and `formatWeekdayToParts()` helpers and matching
  Translator methods. Results are fresh, mutable, caller-owned native parts
  arrays and records, retaining existing strict inputs, locale overrides, and native defaults;
  relative-time literal parts may lack `unit`. Methods log original failures with operation-specific
  events before rethrowing the same error; standalone helpers throw without logging. Missing native
  `formatToParts` methods produce actionable call-time `TypeError`s without breaking imports or
  unrelated formatting. No HTML, DOM markers, or runtime dependencies are added.
- Date, clock-time, and weekday parts return `Intl.DateTimeFormatPart[]`, sharing existing parsing,
  options, and formatter caches with string calls. Preserve UTC calendar dates versus explicit/host-zone
  instants, clock restrictions and seconds-presence defaults, and Monday-zero weekday numbering.
  Clock parts expose no synthetic date or zone. Native date/time parts can differ from string output
  in literal whitespace; existing string return types and behavior remain unchanged.
- Require TypeScript `ES2023` libraries, or `ES2022` plus `ES2023.Intl`, instead of ES2022 alone.
  Root declarations remain usable without DOM or Node ambient types. The emitted JavaScript target
  stays ES2022 and the Node minimum stays `22.13.0`; newer declarations do not supply runtime polyfills.

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
