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
  - [Plural, Select, And Compiled Messages](#plural-select-and-compiled-messages)
  - [Catalog Generation And Extraction](#catalog-generation-and-extraction)
  - [Intl Formatting Parts And Ranges](#intl-formatting-parts-and-ranges)
  - [Framework Adapters](#framework-adapters)
  - [Rich Grammar And Asynchronous Rendering](#rich-grammar-and-asynchronous-rendering)
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

The root entry's emitted declaration must remain usable with TypeScript's `ES2022` library and no
DOM library. Do not export browser-native request or DOM types from it. DOM-dependent APIs and
types belong in `src/dom.ts` or modules reachable only through that entry.

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

Owns pure, DOM-free `Intl` adapters. Calendar and clock inputs preserve their supplied fields through
UTC-based formatting; Date objects separately represent instants with consumer-selected or host
time zones. Clock-only options must not expose their synthetic date or zone. Reuse formatter instances
through bounded caches keyed by canonical locale and effective primitive options; bypass caching when
option coercion or the host
time zone can remain observable between calls.

Relative-time formatting and plural-category selection are thin adapters over
`Intl.RelativeTimeFormat` and `Intl.PluralRules`. Their root-exported option types intersect native
options with `LocaleFormatOptions`; Translator methods resolve the active language or per-call
`options.language` override and delegate to these adapters. Require finite number inputs without
coercion, throwing `RangeError` otherwise. Preserve native unit and option validation/coercion,
including singular/plural relative-time units, long/numeric-always defaults, cardinal plural rules,
and digit/rounding effects on categories. Return `Intl.LDMLPluralRule` labels rather than messages.

Keep a separate bounded cache for each Intl family using the existing shared cache policy and
canonical locale/effective primitive option keys. Object-valued option coercions bypass caching;
the new helpers inspect data-property descriptors for cache keys and pass original options to Intl.
Accessors and custom prototypes bypass caching to retain native option reads without invoking unknown
getters. Cache reuse must not hide observable coercion. Host locale negotiation and data determine support,
not catalog fallback. Do not add automatic unit selection, date differences, clocks, timers, plural
message compilation, runtime dependencies, or DOM markers for these helpers. Consumers selecting
message keys from categories must align the rule language with the resolved message language;
ordinary translation fallback does not guarantee that alignment.

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
  fixture uses only `ES2022` and `types: []`, with neither DOM nor Node ambient declarations.

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

These are candidate directions, not release commitments. The package is already published, with
`0.3.0` as its first public release. Keep subsequent work focused rather than adding speculative
framework or plugin machinery. Prefer additive, opt-in APIs that preserve the existing grammar,
events, ownership, and rendering guarantees instead of silently repurposing them.
This section lists unimplemented work only; existing capabilities belong in Source Modules and
Core Data Flows above, with their consumer contracts in `USAGE.md`.

### Inserted Markup Observation

An optional DOM mutation observer could handle inserted markup independently of language and catalog
changes; explicit updates should remain available and disposal must release the observer.
Do not conflate markup observation with
catalog changes or lookup-policy changes.

### Plural, Select, And Compiled Messages

Plural/select messages or ICU integration should use an explicit message API or separately identified
compiled-message format, not reinterpret ordinary `{name}`
strings. Message compilation is separate from native plural-category selection.
Replacing the default interpolation grammar would be a documented compatibility change;
the preferred approach is additive and opt-in. Keep compilation or dependency-heavy integrations
outside the zero-runtime-dependency core.

### Catalog Generation And Extraction

Separate tooling could generate key declarations or extract catalogs from application sources.
Preserve the dynamic string-key API and runtime validation for downloaded or parsed data even when
authoring tools produce statically checked bundles;
do not expand the wrapper into a generic translator or a catalog build pipeline.

### Intl Formatting Parts And Ranges

Formatting parts and ranges could be added as named helpers and Translator methods without
changing existing signatures. Retain the distinction between calendar values, clock values, and
Date instants, and keep locale-data dependence and formatter-cache behavior explicit.

### Framework Adapters

Framework integration may need a versioned, referentially stable snapshot API for external-store
subscriptions. Add that API when an adapter needs it; do not silently change the detached snapshot
ownership of `getTranslationData()` or `getLanguages()`. Keep framework-specific lifecycle and
dependencies in adapters rather than the core or ordinary DOM binding.

### Rich Grammar And Asynchronous Rendering

Broader token grammar or asynchronous rendering should use separate opt-in APIs. Keep ordinary rich
tokens attribute-free, URLs consumer-owned, and current extension callbacks synchronous and
unawaited. An asynchronous API would need explicit ordering, cancellation, stale-result, and disposal
semantics. Replacing the current grammar, node variants, or callback contract could break consumers
and would require a documented compatibility change; it is not necessary for the additive roadmap.

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

The package is already published, so the initial publication bootstrap is no longer a release step.
Subsequent releases should use the selected CI provider configured as the package's npm trusted
publisher, publishing the qualified candidate with provenance; do not repeat bootstrap publication.
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
