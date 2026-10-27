# `@unilarva/translator` Architecture

This document is for package maintainers. Consumer setup and behavior belong in
[README.md](./README.md) and [USAGE.md](./USAGE.md).

## Contents

- [Design Goals](#design-goals)
- [Public Boundaries](#public-boundaries)
- [Source Modules](#source-modules)
  - [`src/types.ts`](#srctypests)
  - [`src/translator.ts`](#srctranslatorts)
  - [`src/interpolation.ts`](#srcinterpolationts)
  - [`src/intl.ts`](#srcintlts)
  - [`src/rich-text.ts`](#srcrich-textts)
  - [`src/logging.ts`](#srcloggingts)
  - [`src/dom.ts`](#srcdomts)
  - [`src/intl-dom.ts`](#srcintl-domts)
  - [`src/rich-text-dom.ts`](#srcrich-text-domts)
- [Architectural Invariants](#architectural-invariants)
  - [DOM-Free Root](#dom-free-root)
  - [Context-Neutral Values](#context-neutral-values)
  - [Explicit Bundle Envelopes](#explicit-bundle-envelopes)
  - [Atomic Destructive Imports](#atomic-destructive-imports)
  - [Deterministic Language Resolution](#deterministic-language-resolution)
  - [Inert Built-In DOM Rendering](#inert-built-in-dom-rendering)
  - [Privileged Extensions](#privileged-extensions)
  - [Snapshot Ownership](#snapshot-ownership)
  - [Catalog Observation](#catalog-observation)
- [Core Data Flows](#core-data-flows)
  - [Import](#import)
  - [Lookup](#lookup)
  - [File Loading](#file-loading)
  - [DOM Updates](#dom-updates)
  - [Semantic Rich Text](#semantic-rich-text)
- [Failure And Logging Policy](#failure-and-logging-policy)
- [Testing Strategy](#testing-strategy)
- [Development](#development)
- [Adding Or Changing Features](#adding-or-changing-features)
- [Future Enhancements](#future-enhancements)
  - [Inserted Markup Observation](#inserted-markup-observation)
  - [JSON-To-Key Declaration Generation](#json-to-key-declaration-generation)
  - [Stable Reactive Snapshots](#stable-reactive-snapshots)
  - [One Framework Adapter](#one-framework-adapter)
  - [Compiled Plural And Select Messages](#compiled-plural-and-select-messages)
  - [Source Key Extraction](#source-key-extraction)
  - [Broader Rich-Text Grammar](#broader-rich-text-grammar)
  - [Asynchronous Rendering](#asynchronous-rendering)
- [Distribution And Release](#distribution-and-release)
  - [CI And Trusted Publishing](#ci-and-trusted-publishing)
- [Documentation Ownership](#documentation-ownership)

## Design Goals

The package should remain:

- small, framework-independent, and free of runtime dependencies;
- usable without DOM declarations through its root entry;
- explicit about runtime catalog validation and destructive updates;
- inert by default at browser rendering boundaries;
- extensible through consumer-owned policies rather than package-owned application behavior;
- straightforward to test as source and as built ESM with public TypeScript declarations.

It is a runtime translator, not an extraction/compiler toolchain or UI framework. New features
should reinforce that scope rather than grow parallel systems for routing, persistence, language
selection, catalog authoring, or framework lifecycle management.

## Public Boundaries

The package exposes two library entry points and one metadata subpath:

| Public subpath                      | Source         | Responsibility                                      |
| ----------------------------------- | -------------- | --------------------------------------------------- |
| `@unilarva/translator`              | `src/index.ts` | DOM-free core, Intl helpers, and rich-text parsing. |
| `@unilarva/translator/dom`          | `src/dom.ts`   | DOM binding and built-in DOM extensions.            |
| `@unilarva/translator/package.json` | `package.json` | Tooling-readable package metadata.                  |

The root entry's emitted declaration requires TypeScript's `ES2023` library, or `ES2022` plus
`ES2023.Intl`, and must remain usable without DOM or Node ambient declarations. The JavaScript target
remains ES2022 and the Node minimum remains `22.13.0`; declaration availability does not imply host
Intl support. Do not export browser-native request or DOM types from the root. DOM-dependent APIs
and types belong in `src/dom.ts` or modules reachable only through that entry. Keep declaration
checking strict rather than hiding missing Intl types with `any`, `skipLibCheck`, or global augmentation.

The `exports` map is the package boundary. Source files and individual generated `dist/` modules
are internal even when their JavaScript happens to be present in the tarball.

## Source Modules

### `src/types.ts`

Owns public core data contracts: bundle envelopes, import modes and reports, language metadata,
translator options, interpolation, structured logging, and fetch-compatible loading types. Keep
these types independent of the DOM.

`LanguageInfo` extends `LanguageMetadata` with its canonical code. Optional
`direction?: "ltr" | "rtl"` is accepted by both `addLanguage()` and bundle `languages` metadata.
Preserve omission in registry snapshots; the effective `"ltr"` default belongs at consumption,
not in stored metadata.

### `src/translator.ts`

Owns the `Translator` state machine, `normalizeLanguageTag()`, and the root-exported
`createTypedTranslate()` wrapper:

- private translation and independently observable language-registry maps;
- bundle parsing, validation, replacement, and import reporting;
- selective one-time state copying between translator instances;
- BCP 47 normalization, primary and ordered additional fallback policy, and lookup chains;
- interpolation and missing-value policy;
- independent language and catalog subscriptions and failure isolation;
- formatter instance methods;
- ordered translation-file loading and staged commits.

Keep catalog mutation in this module so import invariants cannot diverge across entry points.

`createTypedTranslate()` adds compile-time key checking without making `Translator` generic. Its
overloads accept either an explicit string-key union or a key-first `MultilingualData` type witness,
returning a function that delegates to the original translator's `translateKey()` with options
unmodified. Do not read, validate, import, or retain the witness; runtime envelope imports retain
their full `unknown` validation boundary. Keep lookup live across mutation, copying, loading, and
language/policy changes, preserve exact errors, and add no snapshots or subscriptions. The helper
requires no separate module, dependency, or subpath and does not constrain DOM or rich-text APIs.

### `src/interpolation.ts`

Owns the shared single-pass named-value interpolation and doubled-brace escaping used by ordinary
and semantic rich translations. Keep the two translation paths on this implementation so their
syntax cannot diverge.

### `src/intl.ts`

Owns pure, DOM-free `Intl` adapters with four explicit temporal families. Calendar `formatDate*`
APIs accept only strings/CalendarDate records; clock APIs accept strings/ClockTime records; weekday
APIs accept Monday-zero indices. These preserve fields using private UTC anchors, not zone
conversion. Date-object-only `formatDateTime*` APIs require an explicit primitive output zone for every
call, with no host/UTC or translator-wide default. Keep the breaking split strict, with no legacy
overloads, aliases, or mixed-input dispatch. Reuse bounded caches keyed by canonical locale and
effective primitive options; bypass caching when observable option coercion makes reuse unsafe.

Relative-time formatting and plural-category selection are thin adapters over
`Intl.RelativeTimeFormat` and `Intl.PluralRules`. Their root-exported option types intersect native
options with `LocaleFormatOptions`; Translator methods resolve the active language or per-call
`options.language` override and delegate to these adapters. Require finite number inputs without
coercion, throwing `RangeError` otherwise. Preserve native unit and option validation/coercion,
including singular/plural relative-time units, long/numeric-always defaults, cardinal plural rules,
and digit/rounding effects on categories. Return `Intl.LDMLPluralRule` labels rather than messages.

Keep a separate bounded cache for each Intl family using the existing shared cache policy and
canonical locale/effective primitive option keys. Object-valued option coercions bypass caching;
the relative-time and plural helpers inspect data-property descriptors for cache keys and pass original
options to Intl.
Accessors and custom prototypes bypass caching to retain native option reads without invoking unknown
getters. Cache reuse must not hide observable coercion. Host locale negotiation and data determine support,
not catalog fallback. Do not add automatic unit selection, date differences, clocks, timers, plural
message compilation, runtime dependencies, or DOM markers for these helpers. Consumers selecting
message keys from categories must align the rule language with the resolved message language;
ordinary translation fallback does not guarantee that alignment.

`formatNumberToParts()`, `formatCurrencyToParts()`, `formatRelativeTimeToParts()`, `formatDateToParts()`,
`formatDateTimeToParts()`, `formatTimeToParts()`, and `formatWeekdayToParts()` expose native `formatToParts` results through root
exports and matching Translator methods. The temporal helpers return `Intl.DateTimeFormatPart[]`. Reuse
existing family-specific option types, strict numeric validation, locale/default rules, currency style
and uppercase code normalization. Preserve native relative-time unit/option reads rather than
homogenizing them with number option snapshots. Share bounded formatter caches with string calls
when effective options match; cache neither inputs nor results. Arrays and their records are fresh,
mutable, caller-owned native results, not frozen snapshots. Preserve native order and literals;
relative-time literal parts may lack `unit`. Do not tokenize strings, generate HTML, claim safe HTML,
or add DOM markers. Existing string methods retain their return types.

Calendar, datetime, clock-time, and weekday calls share the bounded date-time formatter cache and
family-specific preparation. Calendar inputs retain strict Gregorian validation and numeric
year/month/day defaults unless `dateStyle` is defined. Date objects are rejected. DateFormatOptions
forbids `timeStyle`, `hour`, `minute`, `second`, `fractionalSecondDigits`, `dayPeriod`, `hour12`,
`hourCycle`, `timeZone`, and `timeZoneName`; runtime checks must detect property presence, including
inherited/non-enumerable and explicitly undefined fields. Weekday options likewise explicitly forbid
`timeZone` and `timeZoneName`. Types model prohibitions, but cannot promise rejection of undefined
under every consumer's optional-property settings. Never expose calendar synthetic midnight.

The four datetime helpers and matching methods require DateTimeFormatOptions with `timeZone: string`.
Validate genuine native Date slots (including cross-realm Dates), ignore overridden getTime/valueOf
and coercion methods, and detach timestamps before observing options. Detach both endpoints for
ranges. Then read/validate the zone exactly once, read language, and snapshot other enumerable own
string-keyed options in enumeration order, excluding zone/language, before defaults and Intl
coercion. Honor inherited/non-enumerable zone values by retaining the same captured primitive string
for effective Intl options and cache keys; do not drop it during spreading. Other inherited or
non-enumerable Intl options are not copied. Reject missing/nonstring/blank zones; Intl validates
supported identifiers. Object-valued zone coercion is not supported, while other native option
coercions retain cache-bypass behavior. No implicit-host-zone cache branch remains.

Datetime defaults are medium date plus short time only when neither style nor any display component
is defined. Display components are weekday, era, year, month, day, hour, minute, second,
fractionalSecondDigits, dayPeriod, and timeZoneName. Defined styles/components replace both implicit
styles; undefined fields cannot erase defaults. Locale/calendar/numbering/hour-cycle/format-matching
modifiers alone retain defaults. Preserve native style/component errors and date-only/time-only
projections of explicitly zoned instants, not package-added calendar/clock coercion.

Keep clock seconds-presence defaults (including explicit zero), existing forbidden fields even when
inherited/undefined, short/medium styles only, and Monday `0` through Sunday `6` with default long
weekday width. Clock parts must never expose synthetic dates/zones. Compare each native operation
independently: DateTimeFormat string and parts literals can differ in whitespace.

`formatNumberRange()`, `formatNumberRangeToParts()`, `formatCurrencyRange()`, and
`formatCurrencyRangeToParts()` share existing number/currency option preparation and bounded
NumberFormat caches with single-value strings and parts. Require two finite `number` endpoints,
without coercion, numeric strings, bigint, or boxed numbers; invalid endpoints throw `RangeError`.
Reuse family option types, currency validation/uppercase normalization, and forced currency style.
Delegate descending ranges, equal/equal-after-rounding approximation, signed zero, rounding, and
shared affixes to native range operations. Do not sort, reject descending numeric ranges, collapse
equal endpoints, or concatenate formatted values. Range-parts calls return direct fresh mutable
`Intl.NumberRangeFormatPart[]` and records, preserving native order, literals, `approximatelySign`,
and `source` (`startRange`, `endRange`, `shared`). Cache formatters, never endpoints or results.

`formatDateRange()`, `formatDateRangeToParts()`, `formatDateTimeRange()`,
`formatDateTimeRangeToParts()`, `formatTimeRange()`, and
`formatTimeRangeToParts()` expose date-time native ranges with matching Translator methods and
`Intl.DateTimeRangeFormatPart[]` for range parts. Share date defaults, clock restrictions,
effective options and the bounded date-time cache with single-value strings and parts. Accept two
calendar endpoints (strings/records may mix) in date ranges, or two Date instants with a mandatory
explicit zone in datetime ranges. Reject Date inputs to calendar APIs and all non-Date inputs to
datetime APIs in both types and runtime checks. Read both native Date slots before option getters
or coercions can mutate caller Dates; never cache endpoint values.
Reject reversed date pairs explicitly: Node 24.22.1 accepts native reversed dates, so relying on
native rejection alone would make the ordered pair contract host-dependent. Equal dates retain
native range behavior.

Clock pairs share one synthetic UTC day. Explicitly reject reversed clocks without overnight
inference; actual dated cross-midnight intervals use Date instants in explicitly zoned datetime
ranges. Recurring overnight schedules remain application-owned rather than fabricated instants. Without
a style, include default seconds when either endpoint supplied them (including zero); defined
components override defaults, undefined components cannot erase them. Reuse all single-clock
prohibitions, including inherited/undefined fields and long/full styles. Test native clock ranges
for synthetic date/zone leakage before extending their contract; never silently filter parts or
invent localized text. Range parts preserve fresh mutable ownership, order, literals and native
source metadata. Equal ranges can have native string/parts whitespace differences. No result
caching, relative-time ranges or plural-range selection is added. Declarative field-based ranges
belong to the separate opt-in DOM adapter described below.

`formatWeekdayRange()` and `formatWeekdayRangeToParts()` are root exports with matching Translator
methods and the existing WeekdayFormatOptions. Validate both endpoints as integers Monday `0`
through Sunday `6` without coercion, preparing both anchors before observing options. Reuse the
single-weekday zone/language/width read order, long-width default, bounded date-time cache and
unsafe-coercion bypass policy. Forbid zone fields by presence even when inherited/non-enumerable or
undefined. The semantic interval is an inclusive recurring contiguous forward weekly span: anchor
Monday to `1970-01-05` UTC and add seven days to a descending end. Equal endpoints mean one weekday,
not a full week. These are neither real dates nor durations or arbitrary day sets; schedule grouping,
exceptions and occurrence generation remain consumer-owned.

Delegate directly to the requested native range operation, including equality; never concatenate
weekday labels, choose punctuation, filter parts, or disambiguate native narrow labels. Preserve
byte-for-byte native strings for the prepared inputs/options and direct fresh mutable caller-owned
`Intl.DateTimeRangeFormatPart[]` arrays/records, including literals, order and source metadata. Do not
cache endpoints/results or assume joined parts reproduce native string whitespace. Core weekday
ranges stay DOM-free; the separate Intl DOM adapter exposes weekday strings, not parts.
Datetime DOM ranges remain deferred.

Check the requested native `formatToParts`, `formatRange`, or `formatRangeToParts` method only at
call time, never during module import.
A missing method throws an actionable `TypeError` naming the method and requiring a supporting host
or consumer-provided polyfill. Calendar, datetime, clock-time, and weekday parts require
`Intl.DateTimeFormat.prototype.formatToParts`. Numeric range strings require only
`Intl.NumberFormat.prototype.formatRange`; numeric range parts require only
`Intl.NumberFormat.prototype.formatRangeToParts`. Calendar/datetime/clock/weekday range strings and parts require only
the corresponding `Intl.DateTimeFormat.prototype.formatRange` or `formatRangeToParts` method.
Name the exact missing method in the error;
absence of one range method must not disable the other or ordinary string/single-value parts calls.
Do not install polyfills or add string fallbacks;
unsupported methods must not break imports or unrelated operations. Formatting uses active/explicit locales, never catalog
fallback, and does not change translator settings or emit language, catalog, or registry events.

### `src/rich-text.ts`

Owns semantic rich-text parsing and its node representation. The parser recognizes only explicitly
approved, attribute-free token names. It never creates DOM nodes or serializes HTML. DOM extensions
may reuse an already validated tag set because their renderer configuration is immutable.

### `src/logging.ts`

Owns the internal safe logger adapter shared by core and DOM code. Consumer logger failures must
not change translation behavior.

### `src/dom.ts`

Owns ordinary DOM translation, binding lifecycle, safe textual-attribute policy, and the generic
extension contract, plus the native select and details language-control bindings. It re-exports the
built-in Intl and rich-text DOM extensions so consumers need only one browser subpath.
Repeated updates avoid unchanged DOM writes and cache parsed shared-marker
metadata by its raw attribute value, while still reacting to marker edits.

### `src/intl-dom.ts`

Maps explicit formatting markers to core formatter calls and writes their results through
`textContent`. It is opt-in so ordinary binding scans do not infer formatting behavior.

The existing `intlDomExtension()` owns five single-value kinds and corresponding number/currency/
calendar-date/clock-time/weekday range pairs. Build selectors from the configured prefix for both
start and end attributes, including orphan ends. Before writing, require exactly one single kind or
one complete nonempty pair; reject partial pairs, mixed families and single/range conflicts.
Options alone are not targets. Delegate to matching Translator methods and retain the native string
byte-for-byte, without separators, parts rendering, generated spans or HTML. Attribute values are
not catalog keys or interpolation values. Failures preserve old content and remain isolated from
valid siblings through the existing extension error boundary.

Styles apply to singles and ranges. Calendar `date-style` accepts exact untrimmed, case-sensitive
full/long/medium/short tokens and conflicts with `year` by presence, including empty attributes.
Clock `time-style` accepts only short/medium and replaces component/seconds defaults. Without styles,
preserve calendar numeric fields, clock pair-aware explicit-seconds defaults and weekday width.
Calendar forbids time-style/time-zone; clock forbids date-style/time-zone; weekday forbids both
styles/time-zone, all by presence even when empty. Number/currency must not read or validate any of
these new temporal options. Preserve legacy fraction-marker validation across all kinds, applying
fractions only to number/currency; other legacy kind-specific reads remain limited to their kind.
The full marker/options inventory belongs in [USAGE.md](./USAGE.md#formatting-extension).

Keep parsing at the DOM boundary: finite Number-compatible strings, strict calendar/clock fields and
Monday-zero weekday indices delegate to the existing core contracts. No datetime markers, timestamp
parsing or zone formatting are implemented here yet. Reuse the binding's initial/manual/language/
enabled-catalog refresh, disposal, prefix ownership, script/style exclusions and template/fragment/
shadow-root boundaries. Marker edits and inserted targets require an explicit update, not observation.

### `src/rich-text-dom.ts`

Maps the semantic node tree to consumer renderer callbacks. The package creates text nodes and
fragments; consumer callbacks create semantic elements and own all attributes and URLs.

## Architectural Invariants

### DOM-Free Root

Importing `@unilarva/translator` must not require a browser global. Its source and declarations must
remain usable by servers, workers, and command-line tools. Verify this whenever a public core type
changes.

### Context-Neutral Values

Stored values are raw strings. Do not HTML-escape during import, attach an output-context flag, or
interpret ordinary translations as markup. Escaping belongs at the final consumer output boundary.

### Explicit Bundle Envelopes

Runtime imports require a `translator-i18n` namespace containing `multilingual-data`,
`language-data`, or both. Each property has one fixed orientation; do not infer schemas or accept
ambiguous unwrapped records. The namespace distinguishes catalog entries from metadata and provides
room for deliberate format evolution.

An optional `languages` property contains language metadata keyed by language code. Its independent
`languageMode` is `merge`, `replace`, or `ignore`; ignoring must skip validation as well as mutation.
Translation import modes never imply registry replacement.

When both recognized properties occur, process them in namespace property order. Later values for
the same canonical language and key win under merge semantics. Do not regroup parsed data by bundle
type, language, or key before normalization.

### Atomic Destructive Imports

Imports build candidate state before committing it. An issue-bearing `replace-keys` operation must
not partially replace existing keys. An issue-bearing `replace-all` operation must not erase an
existing store, and an issue-bearing language `replace` must not erase an existing registry. An
empty target may accept a valid subset because there is no prior state to lose.

Any new validation step must run before the candidate is committed and must preserve report counts
for aborted imports.

### Deterministic Language Resolution

Language tags are canonical BCP 47 tags, normalized by trimming, underscore-to-hyphen conversion,
and strict canonicalization. Lookup order is requested language, active language, primary fallback,
each ordered additional fallback, optional first-stored arbitrary value, then missing policy. Each
tag contributes its parent chain before the next tag; candidate deduplication is stable across the
whole chain. Changes to this order are consumer-visible behavior.

Keep `fallbackLanguage`'s `"en"` default and getter/setter primary-only. The additional list defaults
to `[]`; changing the primary retains extras, and clearing extras never disables the primary.
Validate the entire dense string array before assignment: non-array, non-string, or sparse input
throws `TypeError`, invalid tags throw `RangeError`, and failed updates leave state intact. Deduplicate
canonically within extras only, retaining primary matches for later primary changes.

Display-name resolution checks requested/default-active tag and parents, then primary and additional
fallback parent chains. Never separately prepend active language for an explicit request or use
arbitrary catalog fallback. Retain the first registered candidate's native-name/English-name/code
semantics and canonical requested-tag result when no metadata matches. Formatting locales remain
active/explicit, not fallback-driven; direction and language controls remain exact-active/registry
concerns.

### Inert Built-In DOM Rendering

Ordinary translations use `textContent`. The built-in attribute policy is a closed list of textual
attributes. `additionalTranslatedAttributes` may opt into known entries from that closed list; it
must never turn arbitrary attribute names into translated sinks.

`textContent` is not inert on script/style elements. Skip ordinary content translation and extension
dispatch for those elements in every namespace, including detached scopes that may be inserted
later. Safe textual attributes remain a separate operation.

URL-bearing attributes, styles, event handlers, identifiers, and form or navigation behavior stay
application-owned. A request to support one of them should normally be solved by mapping a
translated identifier to validated application data, not by widening the binding.

### Privileged Extensions

Custom extensions and rich-text renderers are application code, not a sandbox. Isolate their
failures so one callback does not stop unrelated updates, but do not pretend to constrain what a
consumer callback can do.

### Snapshot Ownership

Do not expose mutable internal maps. `getTranslationData()` returns a detached snapshot, while
`getLanguages()` returns an immutable detached array of immutable metadata. Likewise, imports should
not retain caller-owned nested records.

Snapshot caller fallback arrays. `getAdditionalFallbackLanguages()` exposes frozen canonical extras;
`getFallbackLanguages()` exposes a frozen detached unique primary-then-extras list, without parent
expansion or active/requested candidates. Neither snapshot changes after subsequent policy updates.

`copyFrom()` stages already validated source values into detached maps and immutable metadata,
without round-tripping strings through bundle import, replacements, or interpolation. Selected
stores use explicit merge/replacement semantics; language settings are independent opt-in copies.
The `fallbackLanguage` and `additionalFallbackLanguages` copy flags default to false and independently
select primary and extras. Copy selected lists exactly regardless of `mode`; only catalog and registry
stores merge or replace. Commit the selected fallback chain before active-language events.
Do not transfer runtime configuration, subscriptions, or DOM bindings, or introduce a live connection
between instances.

### Catalog Observation

`subscribeCatalog()` delivers frozen `TranslationCatalogChangeEvent` objects with a readonly
monotonic per-instance `revision`, without an initial subscription notification. Notify synchronously
only when effective stored content changes after import, copy, set, or clear; no-op and rejected mutations
are silent. Reentrant mutations coalesce into a
final current-revision event, and callback failures must not block other subscribers. Language,
registry, and lookup-policy changes are separate concerns; policy setters do not emit catalog or
active-language or registry events, including both fallback setters.
Compare per-key language order as well as values because first-available fallback observes it;
top-level key ordering does not affect lookup and alone is not a content change.
Catalog callbacks run after both catalog and registry state commit. If a callback mutates and
notifies the registry, the enclosing import or file transaction must not repeat the same final
registry notification.

Copies commit both selected stores and fallback state before calling `setLanguage()` for an
opted-in active-language copy. Outside an active-language callback, that commits and notifies the
language before catalog and registry notifications. Inside such a callback, preserve the existing
FIFO transition queue rather than changing the current event's active state. Capture catalog and
registry revisions before notifying; avoid duplicate final-state notifications if earlier callbacks
have already changed and notified those categories. Never roll back callback writes.

## Core Data Flows

### Import

1. Verify the root namespace contains at least one recognized translation data property.
2. Unless ignored, validate optional registry metadata into a temporary canonical map.
3. Visit `multilingual-data` and `language-data` in namespace property order.
4. Validate each property's fixed orientation while building temporary maps and issue records.
   Accept plain records across realms, not class instances, and reject sparse string arrays.
5. Concatenate string-array values and apply configured literal source replacements before storage.
6. Evaluate whether issues make either selected destructive mode unsafe.
7. Commit only affected staged key and registry maps; avoid copying unrelated catalog entries.
8. Return counts and issues, emit catalog and registry events only for effective changes, and optionally emit
   structured diagnostics.

Keep runtime acceptance rules aligned with the public TypeScript bundle types, but retain `unknown`
input support so parsed JSON receives real validation rather than a type assertion.

### Lookup

`translateKey()` assembles the canonical candidate chain, returns the first value present for the
key, optionally falls back to the first stored language, applies missing policy, and finally
interpolates the named `values` supplied for that lookup. This is deliberately separate from
import-time literal replacements. Interpolation runs on string data and never reparses inserted
content as rich-text tokens. The parser recognizes only `{name}` with the documented name grammar;
doubled braces emit literal braces without recursively interpreting their contents.

The active/fallback candidate chain is rebuilt when the active language, primary fallback, or
additional list changes and reused
for ordinary lookups. Requested per-call language overrides prepend their own chain without changing
the deterministic resolution order. `interpolate: false` returns the resolved source without brace
decoding or value insertion, allowing the rich parser to recognize tokens before one interpolation
pass. Brace escaping otherwise applies even when lookup values are absent.
Malformed brace input must retain linear scanning behavior rather than repeatedly searching suffixes.

### File Loading

`loadTranslationFiles()` snapshots caller import policy and replacements, starts all fetches, retains
the caller's ordering and duplicates, and waits until every response has passed HTTP and JSON checks
before staging imports sequentially. A requested `replace-all` applies only to the first file; later
files merge. Language `replace` likewise applies only to the first file. Successful staging commits
both stores before at most one catalog and one registry notification; thrown import failures expose no intermediate
state. Do not roll back after notifying application callbacks, because that could erase their writes.

Validation issues are report data, not necessarily thrown failures. Maintain that distinction when
changing loader transaction behavior. Independent overlapping loads intentionally commit in
completion order. Check cancellation before requests and again before committing staged state,
preserving the signal's abort reason and emitting no events on abort. Applications own
latest-request-wins policies.

### DOM Updates

`bindTranslator()` validates its options, builds built-in and extension selectors, subscribes to
language changes and, unless `updateOnCatalogChange` is false, catalog changes, and performs an
initial scan. A scan includes the supplied element and its
descendants. Ordinary ancestor scans do not enter template contents; an explicitly supplied
`DocumentFragment` or shadow root is a valid update scope.

Each binding owns its root, translator subscriptions, and marker prefix independently. A prefix that
differs from the outer binding isolates an overlapping nested scope; without distinct prefixes,
nested bindings can intentionally or accidentally target the same elements. Built-in extensions
construct their own selectors, so their prefix must match their owning binding's prefix when
consumers want one marker namespace.

Every matching extension runs independently. `dispose()` removes all installed subscriptions and stops later
automatic updates; it does not attempt to restore old DOM content.
Opting out of catalog updates permits manual import batching with one explicit `update()` afterward;
language updates remain automatic. Lookup-policy changes and inserted markup always require explicit
updates, not synthesized catalog or language events.

`updateDocumentDirection` is opt-in (default `false`) and independent of `updateDocumentLanguage`.
It writes the owning document's `html.dir` from the exact active canonical registry entry's
`direction ?? "ltr"`, also using `"ltr"` when unregistered. Never reuse translation fallback chains
or infer direction from scripts. Initial/manual/language updates refresh direction; an independently
owned registry subscription refreshes it even with `updateOnCatalogChange: false` and must be
released on disposal or failed initialization. This does not implement per-string bidi isolation
or CSS mirroring.

Validate extension syntax and reject scope-dependent selectors before subscription. Factory failures
must remove every installed subscription and listener. Ordinary lookup failures under the `throw`
policy remain scan-wide failures; extensions instead have callback-local isolation. Extension
callbacks are synchronous, with accidental returned promises observed only for rejection logging.

The binding stores detached element-scoped interpolation snapshots in a `WeakMap`. Built-in text and
attribute markers and extension contexts receive the same snapshot. `setValues()` and
`clearValues()` synchronously update the target element, while automatic subscriptions
reuse stored values during automatic updates. Import-time replacements remain embedded in stored
translations and require no DOM state.

Language-control bindings are separate from marker scanning. With population enabled,
`bindLanguageSelect()` owns a native select's options and `bindLanguageDetails()` owns the marked
choice container's buttons; otherwise they synchronize existing choices only. Both subscribe
independently, so multiple controls bound to one translator converge on every active-language and
registry change. Neither helper creates its outer control, chooses supported languages, detects
browser preferences, persists a choice, or invents a registry entry for an unregistered active
language.

Generated selects track one temporary option for an unregistered active language, append it after
registry options, and remove it on active-language changes or replace it during registry rebuilds.
It is presentation-only, not a registry entry. Both this option and the details summary use the
configured label strategy with `{ code }` metadata when the active language is unregistered.
Consumer-owned select options are never added, removed, or relabeled; unmatched languages clear
their selection.

Details markers use the same validated `attributePrefix` convention as ordinary DOM translation
markers, producing `data-PREFIX-language-current`, `data-PREFIX-language-options`, and
`data-PREFIX-language` rather than a separate fixed namespace.

The details binding uses native disclosure and button semantics, closes and restores summary focus
after activation, and must not add ARIA menu roles without also implementing the corresponding
keyboard interaction model.

The native select is single-value only. Details structure and choice ownership must exclude nested
controls; consumer choice tags use canonical comparisons. Read focus from the owning document or
shadow root rather than assuming `ownerDocument.activeElement` identifies a shadow-hosted button.

### Semantic Rich Text

The parser creates text and named-tag nodes only after validating exact allowlisted names and
balanced nesting of at most 256 semantic tags. Interpolation is applied to text nodes after token
recognition, starting from raw-source lookup rather than already interpolated strings. The DOM extension
recursively creates text nodes and delegates each semantic element to its configured renderer. A
failure falls back to ordinary translated text.
Renderers must synchronously return nodes. Observe accidental returned promise rejections for
diagnostics, reject them as rendering results, and use the ordinary text fallback; do not add implicit
asynchronous rendering semantics.

SSR consumers use the same node representation but own context-appropriate serialization and
escaping.

## Failure And Logging Policy

Expected bad external data should generally produce import issues. Invalid programmer options and
strict formatter inputs should throw. Network, HTTP, and JSON failures in file loading should
reject.

Logging is optional observation, never control flow. Logger callbacks receive detached immutable
array/plain-record detail containers through the safe adapter; opaque objects and the original error
reference are deliberately retained.
Logger failures are ignored. Language, catalog, and registry subscribers and DOM extensions are
isolated so one consumer callback cannot prevent later callbacks or elements from updating.

Missing-translation log details include canonical `additionalFallbackLanguages` only for nonempty
extras. Preserve the previous details shape when extras are absent.

Translator relative-time and plural-selection methods log `relative-time-format-failed` and
`plural-select-failed`, respectively, with the original error, then rethrow that same error.
Parts methods use `number-format-to-parts-failed`, `currency-format-to-parts-failed`,
`relative-time-format-to-parts-failed`, `date-format-to-parts-failed`, `time-format-to-parts-failed`, and
`weekday-format-to-parts-failed`. Standalone helpers throw without logging; methods use the
safe adapter and rethrow the identical error, including option-coercion and missing-native-method
failures. Numeric range methods use `number-range-format-failed`,
`number-range-format-to-parts-failed`, `currency-range-format-failed`, and
`currency-range-format-to-parts-failed` through the same safe adapter, preserving original error
identity even when logging fails. Date/clock methods use `date-range-format-failed`,
`date-range-format-to-parts-failed`, `time-range-format-failed`, and
`time-range-format-to-parts-failed` through the same adapter. Range calls emit no language, catalog,
or registry events.
Datetime methods use `datetime-format-failed`, `datetime-format-to-parts-failed`,
`datetime-range-format-failed`, and `datetime-range-format-to-parts-failed`, preserving original
error identity even when logging fails. Calendar methods retain existing date event names.
Weekday range methods use `weekday-range-format-failed` and
`weekday-range-format-to-parts-failed` through that same safe adapter and preserve identical errors.
Preserve existing diagnostic events and detail shapes for existing string methods.

Subscriber and logger callbacks run synchronously and are never awaited. Observe accidental returned
promises/thenables through native promise assimilation: subscriber rejections emit ordinary failure
diagnostics, while logger rejections are discarded to avoid recursive logging and unhandled errors.

When adding a diagnostic, use a stable event name, the narrowest relevant component, an actionable
message, structured details, and the original error where one exists. Do not put values in log
details without considering whether consumers may treat catalogs as sensitive data.

## Testing Strategy

Tests use Node's test runner through `tsx` and Happy DOM for browser-shaped behavior:

- `tests/core.test.ts`: imports, lookup, interpolation, fallback, snapshots, subscriptions,
  loading, and logging.
- `tests/intl.test.ts`: pure formatters, invalid inputs, and formatting markers.
- `tests/dom.test.ts`: text sinks, scopes, markers, element values, allowlists, fragments, templates,
  shadow roots, document language, and disposal.
- `tests/rich-text.test.ts`: parser grammar, hostile interpolation, renderer behavior, and fallback.
- `tests/package.test.ts`: export map, dependency policy, side-effect declaration, and package files.
- `tests/release.test.ts`: release metadata, CI configuration, publisher isolation, and exact-candidate
  verification failure scenarios.
- `scripts/test-dist.mjs`: built ESM smoke test, actual packed-file inspection, clean-tarball
  installation, runtime export-boundary checks, and strict core/DOM consumer typechecks. The core
  fixture uses `ES2023` and `types: []`, with neither DOM nor Node ambient declarations. Also verify
  the narrower `ES2022` plus `ES2023.Intl` consumer configuration. Compare parts to their native
  operation, and cover fresh mutable ownership, defaults, strict inputs, locale overrides, shared
  cache/coercion behavior, error identity, and call-time missing-method diagnostics.

Numeric range coverage must compare each operation to its native counterpart, including descending,
equal and equal-after-rounding endpoints, signed zero, shared affixes, `approximatelySign`, and source
metadata. Test both endpoint validations, normalized currencies, supported rounding options, cache
reuse, mutable ownership, no state events, and missing-method isolation across imports, ordinary
formatting, single-value parts, and the other range operation. Verify all four helpers and matching
methods in source and clean installed-consumer runtime/type fixtures.

Calendar/datetime/clock range coverage compares native strings and parts with the same effective
options and detached endpoints. Cover calendar string/record mixtures, Date-to-calendar and
non-Date-to-datetime rejection, reversed/equal pairs, cross-realm Dates, invalid/forged Dates,
single/both endpoint detachment before option getters/coercions, zone read exactly once before
language and the remaining snapshot, inherited/non-enumerable zone retention, missing/invalid zones,
defaults versus modifier-only and projection options, explicit-zone DST/midnight/year boundaries,
pair-aware seconds, forbidden own/inherited/undefined options, no overnight inference, and synthetic
date/zone leakage across locales, components, styles and endpoints. Check mutable ownership, native
source metadata, shared caches, unsafe-coercion bypasses, host-TZ independence with an explicit zone, locale/state invariants and
original error identity. Source and installed fixtures cover every helper/method and remove each
date-time range method before import to verify independent call-time diagnostics. CI runs the full
gate on minimum/release Node; browser Intl smoke coverage must be verified separately or recorded as
unperformed rather than inferred from declarations or Node results.

Weekday range tests use each corresponding native operation as the oracle with Monday `1970-01-05`
UTC and end-plus-seven anchoring for wraps. Cover all 49 endpoint pairs, all three widths, representative
locales, equality, wrap, both endpoint validations and forbidden own/inherited/undefined zone fields.
Probe strings and parts for synthetic calendar/zone leakage on minimum/release Node and supported
browser engines; stop and record the exact engine/locale/options/endpoints/output counterexample
before redesigning if leakage occurs. Do not silently sanitize native output. Check fresh array/record
ownership, literals/source metadata, cache sharing/eviction and unsafe coercions, option read order,
locale overrides, no state events, original error identity and failing loggers. Source, built and
clean installed-consumer runtime/type fixtures must exercise both helpers and methods; remove each
native range method independently before import and with warm caches to verify precise call-time
diagnostics without disabling unrelated operations. Browser coverage is separate from Happy DOM.

Intl DOM coverage must compare every field-based range and custom-prefix variant to its matching
native string operation. Exercise complete/exclusive-kind validation, orphan ends, empty endpoints,
style tokens and presence-based conflicts/prohibitions, numeric non-reading of temporal options and
unchanged legacy option reads (including fraction validation across all kinds). Verify unchanged
single defaults, style replacement of seconds defaults, old-content retention, valid siblings,
initial/manual/language/catalog updates, explicit updates after marker edits, disposal and active-sink/
template/fragment/shadow-root boundaries. Keep built and installed-consumer DOM coverage aligned;
real-browser checks remain distinct from Happy DOM. Datetime DOM parsing is outside this contract.

Tests that deliberately model hostile or malformed input are contract tests, not incidental edge
cases. Preserve them when refactoring parsing or rendering.

The test project skips dependency-library checking only at the Happy DOM boundary. Source
declaration checking remains strict. Do not broaden that exception into the build configuration.

## Development

From a standalone clone, install the locked dependencies and run package scripts:

Use npm `11.15.0`, the same pinned version installed by every CI and release job. It supports both
Node `22.13.0` and Node `24`; the package's minimum consumer runtime remains Node `22.13.0`, without
an npm engine requirement. Older npm versions can produce different tarball contents; npm 9 includes
a nested asset README despite its ignore rule and fails the exact published-file gate.

```sh
npm install --global npm@11.15.0 --ignore-scripts
npm ci
npm test
npm run typecheck
npm run format:check
npm run build
npm run test:dist
```

The complete local gate is:

```sh
npm run validate
```

`validate` checks formatting, source and test types, unit tests, a clean build, installed-tarball
runtime imports, and public declaration consumption outside the workspace. The tarball check skips
package lifecycle scripts to avoid recursively running its enclosing `prepack` validation.

Keep `package-lock.json` current when dependency inputs change; standalone CI uses it for
reproducible installation.

For every package change:

- update or add tests for behavior and public boundaries;
- update `CHANGELOG.md`;
- update `README.md` or `USAGE.md` when consumer behavior changes;
- update this document when modules, invariants, data flow, or maintenance procedures change;
- verify affected consumer integrations when behavior changes.

## Adding Or Changing Features

Before adding core behavior, determine whether it is translation policy or application policy.
Persistence, browser language detection, language-choice UI, URL construction, routing, and rich
element attributes normally belong to the consumer.

For a public API change:

1. Define the smallest DOM-free type surface that supports the behavior.
2. Keep browser types behind the DOM entry.
3. Add runtime validation wherever data can arrive from JSON or JavaScript callers.
4. Add failure-isolation and hostile-input tests where callbacks or rendering are involved.
5. Check built declarations and both public runtime imports.
6. Document the contract and its security or ownership boundary.
7. Record the change and any migration in `CHANGELOG.md`.

For a new DOM extension, prefer a separate module re-exported by `src/dom.ts`. Selectors must be
explicit, outputs must have a documented sink, and extension errors must not abort unrelated DOM
updates.

## Future Enhancements

These are unimplemented candidates, not release commitments. The order below is the proposed default
implementation order, balancing general usefulness, scope, and risk; it is not a dependency chain.
Concrete consumer needs should override it, particularly for compiled plural/select messages, whose
i18n value can exceed optional DOM conveniences. Gate tooling, reactive infrastructure, adapters, and
rendering extensions on demonstrated requirements rather than implementing every item in sequence.

Prefer additive, opt-in APIs that leave existing consumers unchanged. Adding a public contract does
not inherently require breaking an existing one: use separate methods, options, tooling, or entry
points rather than changing current return types, event semantics, grammar, or callback timing.

| Order | Candidate                           | Importance / implementation gate                  | Complexity  | Public contract addition                  |
| ----- | ----------------------------------- | ------------------------------------------------- | ----------- | ----------------------------------------- |
| 1     | Inserted markup observation         | High for dynamic imperative DOM when needed       | Medium-high | Opt-in scheduling and binding lifecycle   |
| 2     | JSON-to-key declaration generation  | When external JSON makes typed keys inconvenient  | Medium      | Separate tooling inputs and output        |
| 3     | Stable reactive snapshots           | Design from a concrete framework/SSR integration  | Medium-high | Stable identity and comprehensive events  |
| 4     | One framework adapter               | When a target framework integration is required   | Medium      | Adapter lifecycle and SSR/hydration       |
| 5     | Compiled plural and select messages | High i18n value; promote when messages require it | High        | Separate evaluation and compiled catalogs |
| 6     | Source key extraction               | Separate tooling project with defined languages   | High        | Source syntax and dynamic-key policy      |
| 7     | Broader rich-text grammar           | Only with a concrete grammar requirement          | High        | Opt-in grammar and node/renderer types    |
| 8     | Asynchronous rendering              | Only when synchronous rendering is insufficient   | High        | Separate async lifecycle and completion   |

### Inserted Markup Observation

Start with a disabled-by-default observer for inserted element subtrees, not marker edits or general
selector dependency tracking. Batch nested additions, ignore removed nodes, use the owning realm,
and retain template/shadow-root boundaries. Suppress rendering feedback loops, diagnose observer-scan
failures, and disconnect on disposal or failed initialization. Define asynchronous scan scheduling
and error reporting without changing synchronous explicit updates. Renderer-created markup during
suppression still needs explicit updates. Verify scheduling and feedback prevention in real browsers;
do not conflate insertion observation with catalog or lookup-policy changes.

### JSON-To-Key Declaration Generation

Begin, if needed, with deterministic key-declaration generation from JSON bundles in separate tooling.
Preserve dynamic string keys and runtime validation; generated vocabulary does not prove downloaded
catalog validity or locale coverage. Specify accepted bundle inputs, key selection across files,
output, and errors. This needs a tooling contract, not a core runtime API change or source extraction.

### Stable Reactive Snapshots

Select a target framework and SSR use case before designing a lightweight stable snapshot and a new
subscription covering locale, catalog, registry, and lookup-policy revisions; do not clone catalogs
on every read or change existing getter ownership/event semantics. Existing subscriptions alone are
insufficient because fallback-policy setters intentionally emit none of those events. Define no-op
identity, reentrancy, and coherent transaction notifications. This is a new observation contract, not
a reason to turn detached getters into live objects or add policy events to existing channels.

### One Framework Adapter

Use the stable snapshot contract to build one separately scoped adapter for the selected framework,
not a universal framework abstraction. Keep framework dependencies outside core and translators
request-owned during SSR. Define subscription cleanup and server/client snapshot behavior; test
hydration and disposal explicitly. Adapter lifecycle is a separate public contract from core state
observation, even when the two are developed together.

### Compiled Plural And Select Messages

Choose a concrete message format/compiler before adding a separate opt-in API or compiled catalog.
Preserve ordinary `{name}` interpolation and string bundle values; compiled callbacks are trusted
consumer code, not JSON. Plural rules must use the resolved message's locale, including fallback,
not blindly the active locale. Define escaping, nested branches, missing variables, and failure
isolation. Keep compilation dependencies outside core. Prefer a thin external-compiler integration;
a bespoke nested parser/compiler brings substantially greater security and maintenance cost. A
separate evaluation API can preserve existing imports and lookups; replacing string bundle values
or ordinary interpolation would instead require a documented compatibility change.

### Source Key Extraction

Treat extraction as a separate tooling project, not an extension of JSON-to-key declaration
generation. Choose supported source languages and templates, AST tooling, key-discovery rules, and
dynamic-key policy first. Scope and maintenance cost depend on those choices. Do not add extraction
dependencies or assumptions to the runtime translator.

### Broader Rich-Text Grammar

Use a separate opt-in parser/API or explicit grammar mode for a concrete requirement. Keep ordinary
rich tokens attribute-free and URLs consumer-owned. The current exported node union is also used by
SSR consumers: adding variants can break exhaustive consumer renderers even if function signatures
remain unchanged. Reinterpreting currently literal syntax or replacing current nodes requires a
documented compatibility change; prefer a separate node contract when the representation must grow.

### Asynchronous Rendering

Keep current extensions and rich-text callbacks synchronous and unawaited. They explicitly reject or
diagnose asynchronous results today; widening their return types to accept promises is not enough.
A separate opt-in API needs completion, ordering, cancellation, stale-result, error, and disposal
semantics. Preserve synchronous fallback and failure isolation for existing consumers. Do not bundle
this work with richer grammar, message compilation, or insertion observation.

## Distribution And Release

TypeScript emits ESM and declarations from `src/` into `dist/`. Generated output is ignored by Git
and rebuilt by the package lifecycle. The exact published root-file allowlist is `package.json`,
`README.md`, `USAGE.md`, `ARCHITECTURE.md`, `CHANGELOG.md`, and `LICENSE`. The adaptive README logo
at `assets/icons/unilarva-translator-logo-adaptive.svg` is also published; other icon assets and
their source-only README are excluded. Only the explicitly
allowlisted emitted JavaScript modules and declarations may appear under `dist/`; source maps,
additional guides, configuration, and source files are not published. `scripts/packed-files.mjs`
owns the file-list assertion shared by focused tests and the actual tarball gate.

Repository, issue, and homepage metadata target `https://github.com/unilarva/translator`.

### CI And Trusted Publishing

`.github/workflows/ci.yml` and `.gitlab-ci.yml` run the complete gate on minimum Node `22.13.0`
and release Node `24`, using pinned npm `11.15.0`, and retain checksum-paired exact-pack candidates.
Packing runs `prepack`, so it does not skip package validation. Official GitHub Actions are pinned
to reviewed commit SHAs.

`.github/workflows/release.yml` accepts exact `v<package.json version>` tags. An unprivileged
qualification job validates and packs the tagged source on Node 24; a parallel job validates on
minimum Node 22.13.0. A separate publish job requires both jobs to pass and a protected tag, is
protected by the `npm` environment, and verifies the downloaded candidate's checksum, name, and version
before OIDC publication with provenance. It installs only the pinned npm CLI, with lifecycle scripts
disabled; it has no source checkout or project dependency installation.
Stable releases publish to `latest`; versions containing a prerelease suffix publish to `next`.
Candidates expire after 14 days. Complete approval and artifact verification within that window.

GitHub is the default publisher, restricted to `unilarva/translator`. Its repository variable
`TRANSLATOR_PUBLISH_PROVIDER` must be unset or `github` to permit publication. GitLab publication
is opt-in: a protected project variable set to `gitlab`, a protected release tag, GitLab.com hosted
runners, and manual deployment are required. The GitLab job starts with an empty checkout and
downloads only its pipeline's candidate; OIDC and Sigstore ID tokens are minted only for that job.
Switching providers requires matching public repository metadata and npm trust configuration.
Never enable both providers for a mirrored release tag or add a long-lived npm publishing token.

Keep the npm pin aligned across both GitHub workflows, GitLab's default and isolated publish setup,
and this development guide. Release tests assert job coverage and ordering. When updating it, verify
the npm release's Node engine range against both tested runtimes and run the complete package gate.

Use the selected CI provider configured as the package's npm trusted publisher to publish the
qualified candidate with provenance.
Keep account credentials and infrastructure setup out of published guides.

Release checklist:

1. Confirm the public repository metadata and npm scope access.
2. Update the package version and move relevant changelog entries into a release section.
3. Run `npm run validate` from the package directory.
4. Run `npm pack --dry-run` and verify the exact file list, entry points, documentation, and license.
5. Pack and install the tarball in a clean ESM consumer when exports or declarations changed.
6. Create the annotated version tag from the qualified release commit, then let the selected
   provider's protected publisher publish that tag's exact artifact with provenance.
7. Verify registry integrity against the CI candidate, signatures/provenance, the npm registry
   page, README links, and both imports.

`prepack` reruns validation, but it does not replace inspection of the actual tarball. Do not publish
from stale generated output or from a worktree containing unrelated release changes.

## Documentation Ownership

- `README.md` is the npm/GitHub landing page: positioning, requirements, quick start, minimal DOM
  setup, fit, and links.
- `USAGE.md` is the complete consumer guide: behavior, options, integration, and security contracts.
- `ARCHITECTURE.md` is maintainer-only: source ownership, invariants, tests, and release workflow.
- `CHANGELOG.md` records consumer-relevant changes by release.

Avoid copying the same detailed contract into several files. Keep a concise example on the landing
page and make the usage guide the canonical detailed explanation.

For a documentation pass, compare examples with exported signatures and constructor defaults, keep
the README's core and browser snippets usable together, and run `npm run validate`. Package tests
execute that connected quick start and check published-guide links. Keep detailed request, loading,
and rendering recipes in `USAGE.md`, not in the landing-page highlights. Metadata descriptions and
keywords should describe shipped capabilities, not proposed enhancements.
