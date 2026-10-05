# `@unilarva/translator` Usage Guide

This guide documents the public consumer contract. Start with the
[README quick start](./README.md#quick-start) if you only need basic translation lookup and DOM
updates. Package internals and contributor workflows are documented in
[ARCHITECTURE.md](./ARCHITECTURE.md).

## Contents

- [Setup And Entry Points](#setup-and-entry-points)
  - [Constructor Defaults](#constructor-defaults)
- [Server And Worker Integration](#server-and-worker-integration)
- [Translation Bundles And Imports](#translation-bundles-and-imports)
  - [Import Reports](#import-reports)
  - [Import Options](#import-options)
  - [Direct Updates And Snapshots](#direct-updates-and-snapshots)
  - [Copying Between Translators](#copying-between-translators)
- [Translation Lookup](#translation-lookup)
- [Languages](#languages)
  - [Browser Language Example](#browser-language-example)
- [Loading Files](#loading-files)
- [Locale Formatting](#locale-formatting)
  - [Relative Time And Plural Selection](#relative-time-and-plural-selection)
- [Logging](#logging)
- [DOM Binding](#dom-binding)
  - [Native Language Select](#native-language-select)
  - [Details Language Dropdown](#details-language-dropdown)
  - [Multiple Language Controls](#multiple-language-controls)
  - [Scoped And Nested Bindings](#scoped-and-nested-bindings)
  - [Markers](#markers)
- [Formatting Extension](#formatting-extension)
- [Semantic Rich Translations](#semantic-rich-translations)
- [Custom DOM Extensions](#custom-dom-extensions)
- [Localized Resources](#localized-resources)
- [Security Model](#security-model)
- [Public API Index](#public-api-index)

## Setup And Entry Points

```sh
npm install @unilarva/translator
```

The package is ESM-only, targets ES2022, and has no runtime dependencies. Node.js consumers require
Node `22.13.0` or newer. Browser and worker support depends on the host's ES2022 and `Intl` support.

The root entry is DOM-free:

```ts
import { Translator, formatDate, normalizeLanguageTag, parseRichText } from "@unilarva/translator";
```

Import browser integration separately:

```ts
import { bindTranslator, intlDomExtension, richTextDomExtension } from "@unilarva/translator/dom";
```

Only `@unilarva/translator`, `@unilarva/translator/dom`, and the metadata subpath
`@unilarva/translator/package.json` are public exports. Do not import implementation files from
`dist/`.

### Constructor Defaults

`new Translator()` starts with an empty translation catalog and the following configuration:

| Option                     | Default                   | Purpose                                                 |
| -------------------------- | ------------------------- | ------------------------------------------------------- |
| `language`                 | `"en"`                    | Active lookup and formatting language.                  |
| `fallbackLanguage`         | `"en"`                    | Fallback lookup language.                               |
| `missingTranslationPolicy` | `"empty"`                 | Result after all lookup candidates fail.                |
| `missingTranslationText`   | `"MISSING"`               | Text used only with the `"text"` missing policy.        |
| `fallbackToAnyLanguage`    | `true`                    | Use the key's first stored language as a last fallback. |
| `logger`                   | None                      | Optional structured diagnostic callback.                |
| `fetch`                    | Global fetch when loading | Optional default fetch-compatible implementation.       |

English display metadata is registered initially, even when another active language is configured.
Use `clearLanguages()` before adding your own choices if English should not appear in the registry.
No translations are supplied automatically. For visible missing keys during development, choose
`missingTranslationPolicy: "key"` or `"bracketed"`.

## Server And Worker Integration

Use per-call language overrides when sharing a catalog between requests; avoid changing a shared
translator's active language for each request:

```ts
import { Translator } from "@unilarva/translator";

const translator = new Translator({ fallbackLanguage: "en" });
translator.importTranslations({
  "translator-i18n": {
    "multilingual-data": {
      greeting: { en: "Hello {name}", fi: "Hei {name}" },
    },
  },
});

export function greetingFor(language: string, name: string): string {
  return translator.translateKey("greeting", { language, values: { name } });
}

greetingFor("fi", "Ada"); // "Hei Ada", without changing the active language.
```

This override still uses the ordinary requested, active, and fallback lookup chain. Validate or
negotiate request languages in the application. An invalid lookup override is skipped rather than
throwing; it is not a language-negotiation API. Use separate instances when requests need different
catalogs or policies. Escape returned strings at the final HTML output boundary, or let a framework
render them as text. Workers use the same DOM-free entry.

## Translation Bundles And Imports

Every input requires a `translator-i18n` root namespace with at least one recognized data bundle.
`multilingual-data` maps each key to its language values, which keeps translations for a manually
edited key adjacent:

```json
{
  "translator-i18n": {
    "multilingual-data": {
      "greeting": { "en": "Hello", "fi": "Hei" },
      "farewell": { "en": "Goodbye", "fi": "Näkemiin" }
    }
  }
}
```

`language-data` maps each language to its key/value record. It can contain one language for
on-demand loading or several language-oriented resources:

```json
{
  "translator-i18n": {
    "language-data": {
      "fi": {
        "greeting": "Hei",
        "long-message": ["Ensimmäinen osa. ", "Toinen osa."]
      },
      "sv": {
        "greeting": "Hej"
      }
    }
  }
}
```

Values are strings or dense arrays of strings. Arrays are concatenated during import, which lets JSON
authors split long source lines without introducing separators. Sparse arrays are rejected. Plain
records from another JavaScript realm are accepted; class instances are not plain bundle records.

Optional `languages` metadata registers selectable language names and direction independently of
translation values:

```json
{
  "translator-i18n": {
    "languages": {
      "en": { "nativeName": "English", "englishName": "English" },
      "fi": { "nativeName": "Suomi", "englishName": "Finnish" },
      "ar": { "englishName": "Arabic", "direction": "rtl" }
    },
    "multilingual-data": {
      "greeting": { "en": "Hello", "fi": "Hei" }
    }
  }
}
```

Language codes are map keys so imports can merge by canonical BCP 47 code. Registry metadata does
not create translations, and catalog languages do not automatically become selectable registry
entries.

Both bundle forms may occur in the same namespace. Recognized properties are processed in their
JavaScript object enumeration order, which preserves JSON source order for the named
`multilingual-data` and `language-data` properties. Later values for the same key and canonical
language overwrite earlier values under the default merge behavior:

```json
{
  "translator-i18n": {
    "multilingual-data": {
      "greeting": { "en": "Hello", "fi": "Hei" }
    },
    "language-data": {
      "fi": { "greeting": "Terve" }
    }
  }
}
```

Here the final Finnish `greeting` is `Terve`. Reversing the two properties reverses their
precedence. Standard parsed objects cannot represent duplicate properties, so split repeated data
across the two recognized forms or across separately loaded files instead of repeating a property
name.

### Import Reports

`importTranslations()` accepts parsed or otherwise untrusted input and returns a report with
imported key, value, and registry-language counts plus non-fatal validation issues:

```ts
const report = translator.importTranslations(bundle);

for (const issue of report.issues) {
  console.warn(issue.code, issue.path, issue.message);
}
```

Unwrapped translation objects, namespaces without recognized data, malformed bundle records,
language tags, and values are rejected or reported before they enter the store. The parser never
infers one schema from another. Use the report rather than assuming every entry from a partially
valid input was accepted. Translation keys must be nonempty strings; whitespace within a nonempty
key is significant.

### Import Options

Use named options for update behavior and source substitutions:

```ts
translator.importTranslations(bundle, {
  mode: "merge",
  languageMode: "merge",
  replacements: { "%CURRENT_YEAR%": 2026 },
});
```

`replacements` performs literal source-token substitution across every value in that import before
the strings enter the translation store. Replacement values are stringified, nullish values become
empty strings, and longer source tokens are applied first. The stored strings then work with normal
lookup and automatic DOM language changes without passing replacement data again. To change an
import-time replacement, reimport the affected translations. Replacement text is literal: `$&`,
`$$`, and other JavaScript replacement-string sequences have no special meaning.

Import replacements are distinct from lookup-time interpolation: the replacement keys are arbitrary
literal strings such as `%CURRENT_YEAR%`, while lookup `values` fill named `{name}` placeholders
for one translation call.

Import modes are explicit:

- `merge` is the default. Imported languages overwrite matching values while other languages and
  keys remain.
- `replace-keys` replaces the complete language map of every valid key present in the bundle. Keys
  absent from the bundle remain.
- `replace-all` clears all existing keys before importing the bundle.

Destructive imports are guarded separately from ordinary validation. An issue-bearing
`replace-keys` import is not applied. An issue-bearing `replace-all` import is not applied when the
translator already contains translations; it may import its valid subset when the store was empty,
because no existing data can be lost. Rejected imports include a `destructive-import-aborted` issue
and report zero imported keys and values.

For example, importing `multilingual-data` containing `{ greeting: { fi: "Terve" } }` over data
containing `{ greeting: { en: "Hello", fi: "Hei" } }` keeps English in `merge` mode and removes
English in `replace-keys` mode.

The independent `languageMode` applies only when the bundle contains `languages`:

- `merge` is the default. Supplied metadata is added or replaced by canonical code while other
  registry entries remain.
- `replace` replaces the complete registry with valid supplied metadata. An issue-bearing replace
  cannot erase an existing registry.
- `ignore` skips the `languages` property entirely, including validation. Use it for third-party
  bundles whose language choices must not affect the application UI.

If `languages` is absent, the registry remains unchanged in every mode. Translation modes never
clear registry entries, and language modes never change translation values. When loading several
files with `loadTranslationFiles()`, `replace` applies to the first file and later files merge, just
as `replace-all` applies only to the first translation file.

### Direct Updates And Snapshots

Use `setTranslation()` to replace the complete language map for one key and
`clearTranslations()` to empty the store. `getTranslationData()` returns a detached snapshot;
changing the returned maps does not mutate the translator. `setTranslation()` accepts a language
record or a `ReadonlyMap`, including maps created in another realm. An empty language map deliberately
removes that key; malformed input must not be used as a deletion mechanism.

Observe catalog changes independently of active-language and registry changes:

```ts
import type { TranslationCatalogChangeEvent } from "@unilarva/translator";

const unsubscribeCatalog = translator.subscribeCatalog((event: TranslationCatalogChangeEvent) => {
  console.log("Catalog revision", event.revision);
  renderTranslations(translator.getTranslationData());
});

translator.setTranslation("greeting", { en: "Welcome" });
translator.setTranslation("obsolete-key", {});
unsubscribeCatalog();
```

The immutable event has a readonly, monotonically increasing `revision` per translator instance,
not per subscriber. Subscribing does not emit an initial event. Notifications run synchronously,
once per effective catalog change from import, copy, set, or clear. Identical updates, absent-key removal
through an empty language map, empty-store clearing, and rejected updates are silent. A successful
multi-file load emits at most one catalog event after the complete transaction commits. Reentrant
catalog mutations coalesce and finish with the current revision, potentially skipping intermediate
revision notifications; callback failures are isolated.
Catalog events do not emit active-language or registry events.
Per-key language ordering is part of effective content because first-available fallback uses that
order; changing only top-level key ordering is not a catalog change.

DOM bindings subscribe to catalog changes by default. To manually batch synchronous imports without
intermediate DOM refreshes, opt out when creating the binding:

```ts
const binding = bindTranslator(translator, document.documentElement, {
  updateOnCatalogChange: false,
});
translator.importTranslations(commonBundle);
translator.importTranslations(pageBundle);
binding.update();
```

The option affects only this binding's catalog subscription; language changes still update it,
enabled document-direction synchronization still reacts to registry changes, and
other catalog subscribers still receive events. `setFallbackLanguage()`,
`setMissingTranslationPolicy()`, and `setMissingTranslationText()` emit neither catalog nor
active-language events. Call `binding.update()` after changing those lookup policies. Newly inserted
markup likewise needs an explicit update; the package does not install a mutation observer. Use
`setLanguage(translator.getLanguage(), { force: true })` only when all language subscribers also need
to refresh.

### Copying Between Translators

Use `copyFrom(source, options?)` to reuse an existing translator's data without linking the two
instances. By default it merges translation values and registered language metadata, preserving the
receiving translator's active and fallback languages:

```ts
const previewTranslator = new Translator({ language: "pt" });
previewTranslator.copyFrom(appTranslator);
```

The exported `TranslatorCopyOptions` type describes the independent selections:

| Option             | Default   | Meaning                                                          |
| ------------------ | --------- | ---------------------------------------------------------------- |
| `translations`     | `true`    | Copy all stored translation keys and language values.            |
| `languageMetadata` | `true`    | Copy the registered language codes and display metadata.         |
| `activeLanguage`   | `false`   | Copy the source's current active language.                       |
| `fallbackLanguage` | `false`   | Copy the source's configured fallback language.                  |
| `mode`             | `"merge"` | Merge or replace each selected translation catalog and registry. |

In `merge` mode, source values overwrite matching key/language pairs while other target keys and
values remain. Source metadata replaces the complete metadata entry for a matching language code;
other target registry entries remain. Existing language order is preserved, and new entries append
in source order. In `replace` mode, each selected catalog or registry becomes an exact snapshot of
the source, including its ordering; an empty source clears that selected target store. Unselected
categories remain unchanged in either mode.

```ts
// Replace both data stores, but keep the preview's independently selected active language.
previewTranslator.copyFrom(appTranslator, {
  mode: "replace",
  fallbackLanguage: true,
});

// Copy only language settings, without changing translations or metadata.
previewTranslator.copyFrom(appTranslator, {
  translations: false,
  languageMetadata: false,
  activeLanguage: true,
  fallbackLanguage: true,
});
```

Copies are detached, one-time snapshots. Later catalog, registry, or language changes do not
propagate in either direction. `copyFrom()` does not copy missing-value policies, arbitrary-language
fallback policy, loggers, fetch implementations, subscriptions, DOM bindings, or interpolation
values. It copies stored strings as-is, without reapplying import replacements or interpolation.
The method returns `void` and throws `TypeError` for an invalid source instance or options before
changing target state.

Selected stores and fallback settings commit before callbacks run. An active-language change is
notified first, followed by at most one catalog event and one registry event for effective changes;
unchanged categories are silent. Existing callback-failure isolation and reentrant notification
rules apply. Callbacks can mutate the target; their changes are not rolled back, and a category
already notified by a callback is not notified again for the same final state. A copy requested
inside an active-language subscriber queues its selected active-language transition through the
ordinary FIFO mechanism, while data and fallback changes commit immediately.

DOM bindings refresh automatically on catalog or active-language changes. A fallback-only change
does not emit an event; call `binding.update()` if its rendered output needs refreshing. See
[scoped and nested bindings](#scoped-and-nested-bindings) for a complete independent-preview setup.

## Translation Lookup

```ts
translator.translateKey("greeting", {
  language: "fi-FI",
  values: { name: "Ada" },
});
```

Translation strings are plain text: HTML entities such as `&amp;`, `&nbsp;`, and `&shy;`
are not decoded and appear verbatim in the built-in DOM binding. Use the Unicode characters
themselves, or Unicode escapes in JavaScript/TypeScript or JSON source. For example, the soft hyphen
(`&shy;` in HTML) is `\u00AD` and allows an optional word break, displaying a hyphen when that break
is used:

```ts
const label = "inter\u00ADnational";
```

The source parser converts `\u00AD` into the character before the translator receives the string;
the translator does not decode literal backslash escapes. Soft hyphens are useful for wrapping long
words in narrow UI labels without a permanently visible hyphen.

Lookup-time interpolation uses `{name}` placeholders and the `values` supplied to that individual
`translateKey()` call. Values are stringified and remain ordinary text; they are never parsed as
HTML. A placeholder without a matching own property remains unchanged, while a nullish supplied
value becomes an empty string. Use this for request- or component-specific values such as names and
counts; use import-time `replacements` for catalog-wide source substitutions.

Double braces escape placeholder-shaped text on every lookup, including calls without `values`.
`{{name}}` renders as the literal text `{name}` even when a `name` value exists.
`{{{name}}}` renders an interpolated value surrounded
by literal braces. Other brace text, such as `{ a, b }`, is not placeholder syntax and remains
unchanged.

For an application-owned parsing or message-compilation pipeline, use
`translateKey(key, { interpolate: false })` to obtain the resolved raw string without decoding braces
or applying `values`. The default is `true`. Rich-text helpers use raw lookup internally, recognize
tokens first, and then interpolate text nodes exactly once; inserted values never become tokens.

Lookup checks, in order:

1. The explicitly requested language and progressively less-specific subtags.
2. The current language and progressively less-specific subtags.
3. The fallback language and progressively less-specific subtags.
4. The first available value for the key when `fallbackToAnyLanguage` is enabled.
5. The configured missing-translation policy.

For example, `fi-FI` falls back to `fi`. Duplicate candidates are checked only once.

`fallbackToAnyLanguage` defaults to `true`, because an available translation is often preferable
to no translation. Disable it when missing values must remain visible:

```ts
const strictTranslator = new Translator({
  language: "fi",
  fallbackLanguage: "en",
  fallbackToAnyLanguage: false,
  missingTranslationPolicy: "text",
  missingTranslationText: "MISSING",
});
```

Missing policies are `empty`, `key`, `bracketed`, `text`, and `throw`. They can also be changed at
runtime with `setMissingTranslationPolicy()` and `setMissingTranslationText()`. Invalid policies,
non-string missing text, and invalid programmer options throw rather than silently changing policy.

## Languages

Public language tags use canonical, hyphenated BCP 47 form. `normalizeLanguageTag()` also accepts
underscore separators and returns the canonical form or throws for an invalid tag.

Change the active and fallback languages through the translator:

```ts
translator.setLanguage("fi-FI");
translator.setFallbackLanguage("en");
```

Register optional language metadata with plain values:

```ts
translator.addLanguage({
  code: "fi",
  nativeName: "Suomi",
  englishName: "Finnish",
});

translator.getLanguageDisplayName("fi"); // "Suomi"
```

`LanguageInfo` extends `LanguageMetadata` with a canonical `code`. Both `addLanguage()` and bundle
`languages` entries accept optional `direction?: "ltr" | "rtl"` metadata, for example
`translator.addLanguage({ code: "ar", direction: "rtl" })`. Omitted direction is effectively
`"ltr"`; snapshots retain the optional shape rather than inserting a default `direction` field.

The registry is observable and preserves registration order:

```ts
const languages = translator.getLanguages(); // Detached immutable snapshot.

const unsubscribeLanguages = translator.subscribeLanguages(({ languages }) => {
  renderAvailableLanguages(languages);
});

translator.removeLanguage("fi");
translator.clearLanguages();
unsubscribeLanguages();
```

`addLanguage()`, `removeLanguage()`, and `clearLanguages()` affect only registry metadata. They never
add or remove translations, change the active or fallback language, or constrain `setLanguage()`.
Removing the active language leaves it active. `setLanguage()` accepts any valid BCP 47 tag whether
or not it is registered. Registry codes use the same canonicalization as active and catalog
languages: for example, `EN_us` becomes `en-US` and `zh_hant_tw` becomes `zh-Hant-TW`.

Subscriptions return their cleanup function:

```ts
const unsubscribe = translator.subscribe(({ language }) => {
  console.log("Language changed", language);
});

translator.setLanguage("fi");
unsubscribe();
```

Subscriber failures are reported through the optional structured logger and do not prevent later
subscribers from updating. Pass `{ force: true }` to `setLanguage()` only when consumers need a
refresh notification even though the canonical language did not change.

Subscriber callbacks run synchronously. Returned promises are not awaited, but their rejections are
observed and reported through the same failure diagnostics. Asynchronous work has no event-ordering
or cancellation guarantee; coordinate it in the application rather than relying on subscriptions to
wait for it.

Event objects are immutable. Reentrant active-language changes are delivered in FIFO order, so every
subscriber receives each transition before the next state becomes active. Calling `setLanguage()`
inside a subscriber queues the transition; `getLanguage()` still returns the current event's language
until that event finishes notifying subscribers. Registry changes coalesce reentrant
updates and finish with the current immutable registry snapshot. Registering the same callback twice
deduplicates the subscription; either returned cleanup function removes that callback. Use separate
callback functions when registrations need independent lifetimes.

The core does not read browser preferences, persist language choices, render a language picker, or
decide which languages an application should expose. Those are application policies. The optional
DOM helpers below bind a consumer-owned native select or details dropdown after the application
makes those decisions.

### Browser Language Example

After populating the registry, a browser consumer can treat it as the application's supported list.
This example tries each browser preference as a normalized full tag first, then as its two-letter
primary language, and finally uses the translator's configured fallback:

```ts
import { normalizeLanguageTag, type Translator } from "@unilarva/translator";

function applyBrowserLanguage(translator: Translator): string {
  const registered = new Set(translator.getLanguages().map(language => language.code));
  const requested =
    typeof navigator === "undefined"
      ? []
      : navigator.languages.length > 0
        ? navigator.languages
        : [navigator.language];

  for (const rawLanguage of requested) {
    let full: string;
    try {
      full = normalizeLanguageTag(rawLanguage);
    } catch {
      continue;
    }

    const primary = full.split("-")[0]!;
    const candidates = primary !== full && /^[a-z]{2}$/.test(primary) ? [full, primary] : [full];

    for (const candidate of candidates) {
      if (!registered.has(candidate)) continue;
      translator.setLanguage(candidate);
      return candidate;
    }
  }

  const fallback = translator.getFallbackLanguage();
  translator.setLanguage(fallback);
  return fallback;
}
```

Call this only after `addLanguage()` calls or bundle imports have established the registry. The
fallback does not need to be registered because the registry controls selectable application
choices rather than restricting `setLanguage()`.

## Loading Files

`loadTranslationFiles()` loads one or more JSON URLs:

```ts
const abortController = new AbortController();
const reports = await translator.loadTranslationFiles(["/i18n/common.json", "/i18n/page.json"], {
  signal: abortController.signal,
  mode: "replace-all",
});

for (const report of reports) {
  if (report.issues.length > 0) console.warn("Catalog issues", report.issues);
}
```

These URLs must serve JSON in the [bundle envelope](#translation-bundles-and-imports), not bare
key/value records. Browser-relative URLs resolve through browser fetch; Node's native fetch needs
absolute URLs. For local Node files, read and parse the JSON in application code and pass it to
`importTranslations()` instead.

For language-on-demand loading, add the selected language to the existing catalog before activating
it, rather than clearing other loaded languages:

```ts
// Application-owned allowlist; do not construct source URLs from arbitrary user input.
const languageFiles = new Map([
  ["en", "/i18n/en.json"],
  ["fi", "/i18n/fi.json"],
]);

async function loadAndSelectLanguage(language: string): Promise<void> {
  const url = languageFiles.get(language);
  if (!url) throw new RangeError("Unsupported language");
  const reports = await translator.loadTranslationFiles([url], { mode: "merge" });
  if (reports.some(report => report.issues.length > 0)) {
    throw new Error("Review the catalog import issues before selecting this language");
  }
  translator.setLanguage(language);
}

await loadAndSelectLanguage("fi");
```

Accepted entries may already have committed when reports contain issues; the check above prevents
selection, not partial import. Serialize calls to this recipe or add application-owned cancellation
if users can request another language while a file is still loading. A native language-control
binding changes the language immediately; this asynchronous recipe is for an application-owned
selection handler, not an automatic loader installed by those controls.

Requests may complete concurrently, but their results are imported in caller order, including
duplicate URLs. All responses must be fetched, pass the HTTP status check, and parse as JSON before
imports begin. A request or JSON failure therefore leaves existing translations unchanged.

When the requested first mode is `replace-all`, only the first file uses that mode; later files
merge into its result. Imports are staged as one transaction: catalog and registry subscribers see
only the successfully committed final state, never intermediate file results. A thrown import failure leaves
both the catalog and registry unchanged. Validation issues returned by `importTranslations()` remain
report data and are returned to the caller; inspect every report. A transaction with validation
issues may still commit the accepted data under the ordinary import-mode guards.

The loader snapshots import options and replacement values before its first asynchronous wait.
Mutating the caller's options while requests are pending does not change their import policy.
Independent overlapping loads commit in completion order; applications that require latest-request
wins should cancel or serialize requests themselves.

The loader supports `AbortSignal` and an injected fetch-compatible function, supplied either to the
method or the `Translator` constructor. It sends requests with `cache: "no-cache"`. The application
owns URL selection, origin policy, authentication, retry behavior, and resource limits.

An already-aborted signal rejects before any request starts. The signal is checked again before
commit, so cancellation during response parsing or staging leaves both catalog and registry
unchanged and emits no change events, even if injected fetching ignores cancellation. Rejections
preserve the signal's abort reason when supplied.

The exported `TranslationAbortSignal` is a DOM-free structural type compatible with native signals
and native `fetch`; it is not a signal implementation or polyfill. Pass a genuine platform
`AbortSignal` when using platform fetching. No DOM or Node ambient types are needed merely to consume
the core declarations.

## Locale Formatting

The DOM-free entry provides strict `Intl`-backed formatting. Translator methods use the active
language unless an option overrides it:

```ts
translator.formatNumber(1234.5);
translator.formatCurrency(12, {
  currency: "EUR",
  minimumFractionDigits: 0,
});
translator.formatDate("2026-09-30", { year: "2-digit" });
translator.formatTime("09:30");
translator.formatWeekday(0, { width: "short" }); // Monday = 0
translator.formatRelativeTime(-1, "day");
translator.selectPlural(2); // A plural-category label, not a phrase.
```

The root entry also exports standalone `formatNumber()`, `formatCurrency()`, `formatDate()`,
`formatTime()`, `formatWeekday()`, `formatRelativeTime()`, and `selectPlural()` functions for code
that does not need a translator instance. They take the language as an explicit argument.

```ts
import { formatCurrency, formatDate } from "@unilarva/translator";

formatCurrency(12.5, "fi-FI", { currency: "EUR" });
formatDate("2026-09-30", "en-GB", { dateStyle: "long" });
translator.formatNumber(1234.5, { language: "en-US" }); // Per-call locale override.
```

Contracts are intentionally narrow:

- Currency identifiers are required and use three ASCII letters, normalized to uppercase. Validation
  follows `Intl` syntax, not membership in a maintained ISO currency registry.
- Date strings use `YYYY-MM-DD` and are formatted as calendar dates without local time-zone shifts.
- Time strings use `HH:MM` or `HH:MM:SS` and are formatted as clock times without local time-zone
  shifts.
- Clock-time options cannot request date components or a time-zone label; no synthetic date or zone
  is exposed in the formatted result.
- Clock `timeStyle` accepts only `short` or `medium`; `long` and `full` implicitly include a zone and
  are rejected.
- Supplying seconds, including `:00`, preserves seconds in the default formatted output.
- Weekdays are integers from Monday `0` through Sunday `6`.
- Standard `dateStyle` and `timeStyle` options replace the corresponding default fields.

`formatDate()` also accepts a `Date` instant, including a Date from another realm. For instants, the
host time zone is used unless `timeZone` is supplied. Calendar strings and `{ year, month, day }`
values instead force UTC to preserve the supplied date, overriding any `timeZone` option. Requesting
time components for a calendar value formats its synthetic midnight, not a real-world instant.

Invalid inputs and invalid recognized `Intl` option values throw. Unknown option names can be ignored
by `Intl`; the adapters do not validate every future platform option. Translator methods log failures
first when a logger is configured, then rethrow them. Exact locale output depends on the host's
`Intl` implementation and installed locale data.

### Relative Time And Plural Selection

The root entry exports these additive APIs and option types:

```ts
type RelativeTimeFormatOptions = Intl.RelativeTimeFormatOptions & LocaleFormatOptions;
type PluralSelectOptions = Intl.PluralRulesOptions & LocaleFormatOptions;

function formatRelativeTime(
  value: number,
  unit: Intl.RelativeTimeFormatUnit,
  language: string,
  options?: RelativeTimeFormatOptions,
): string;
function selectPlural(
  value: number,
  language: string,
  options?: PluralSelectOptions,
): Intl.LDMLPluralRule;
```

Both functions default `options` to `{}`. The corresponding Translator methods are
`formatRelativeTime(value, unit, options = {})` and `selectPlural(value, options = {})`, with the
same value, unit, option, and return types. They use the active language unless `options.language`
overrides it. `LocaleFormatOptions` supplies that shared language override.

```ts
import { formatRelativeTime, selectPlural } from "@unilarva/translator";

formatRelativeTime(-1, "day", "en"); // "1 day ago"
formatRelativeTime(-1, "days", "en", { numeric: "auto" }); // "yesterday"
translator.formatRelativeTime(2, "week", { language: "en", style: "short" });
selectPlural(1, "en"); // "one"
translator.selectPlural(2, { language: "en" }); // "other"
selectPlural(2, "en", { type: "ordinal" }); // "two"
selectPlural(1.2, "en", { maximumFractionDigits: 0 }); // "one" after rounding
```

`formatRelativeTime()` delegates to `Intl.RelativeTimeFormat`, preserving its native defaults:
`style: "long"` and `numeric: "always"`. Negative values describe the past and positive values the
future. Native singular and plural unit names are supported: `year(s)`, `quarter(s)`, `month(s)`,
`week(s)`, `day(s)`, `hour(s)`, `minute(s)`, and `second(s)`. The application chooses the unit and
computes any date difference; the helper does not choose units, read a clock, or install timers.

`selectPlural()` delegates to `Intl.PluralRules`, defaulting to `type: "cardinal"`. It returns an
`Intl.LDMLPluralRule` category: `zero`, `one`, `two`, `few`, `many`, or `other`. These are rule labels,
not translated phrases or a universal singular/plural distinction; languages use different subsets.
Native digit and rounding options affect which category is selected. The helper does not compile
plural messages or select translation keys automatically.

If you use a category to choose a message key, the plural-rule language must match the language of
the resolved message. Ordinary translation fallback can resolve a different language and therefore
produce a mismatch. Use complete category-message coverage for the intended language and explicitly
use that same language for both rule selection and message lookup; an override alone does not disable
the ordinary lookup fallback chain.

Both helpers require a finite JavaScript number. `NaN`, infinities, numeric strings, and other
non-number inputs throw `RangeError`, with no numeric string coercion. Units and native `Intl`
options retain native validation and coercion rather than a separate package allowlist. Translator
methods log the original error through `relative-time-format-failed` or `plural-select-failed`,
respectively, then rethrow that same error. Standalone helpers throw without translator logging.

Locale support and exact results depend on the host's `Intl` implementation and locale data, not on
the translation catalog or its fallback policy. Each formatter family uses a bounded cache under
the existing shared cache policy; object-valued option coercions bypass caching so their observable
behavior is preserved. The new helpers also bypass caching for accessor properties and custom option
prototypes, preserving native reads of inherited and non-enumerable options without invoking unknown
option getters. These helpers remain DOM-free and add no runtime dependencies or DOM markers.

## Logging

No logging occurs by default. Supply a structured callback to adapt diagnostics to any logging
facility:

```ts
const translator = new Translator({
  logger(entry) {
    appLogger[entry.level](entry.message, {
      component: entry.component,
      event: entry.event,
      ...entry.details,
      error: entry.error,
    });
  },
});
```

Entries contain a stable `event`, severity, package component, message, optional details, and an
optional original error. Consumer logger failures are ignored and never alter translation
behavior. Pass the same logger to `bindTranslator()` to receive binding and extension diagnostics,
or replace the translator logger later with `setLogger()`.

Log entries and their array/plain-record detail containers are detached and deeply frozen. Opaque
objects, including the optional original `error`, retain their identity and are not copied or frozen.

Logger callbacks run synchronously. Returned promises are not awaited; their rejections are silently
ignored like synchronous logger exceptions, without recursive diagnostics or unhandled rejections.

Logger details may contain keys, import issue data, URL lists, or original errors. Apply the same
data-handling policy used for other application diagnostics.

## DOM Binding

```ts
import { bindTranslator } from "@unilarva/translator/dom";

const binding = bindTranslator(translator, document.documentElement, {
  updateDocumentLanguage: true,
  updateDocumentDirection: true,
  logger,
});

const counter = document.querySelector("[data-i18n='penny-count']")!;
binding.setValues(counter, { count: 5 });
binding.setValues(counter, { count: 6 });
binding.clearValues(counter);
binding.update(newlyInsertedPanel);
binding.dispose();
```

The binding performs an initial update and automatically updates its scope after language changes
and, by default, effective catalog changes. Set `updateOnCatalogChange: false` for manual catalog
refresh with `update()`, without disabling automatic language updates.
`update(root)` includes the supplied root element and its descendants. `updateElement(element)`
updates only that element. `dispose()` removes its language and optional catalog and registry
subscriptions; it does not remove translated text.

`updateDocumentDirection` defaults to `false`, independently of `updateDocumentLanguage`. When
enabled, it writes the owning document's `html.dir` using the exact active canonical language's
registry entry: `direction ?? "ltr"`. An unregistered active language also uses `"ltr"`. There is
no script detection, progressive-subtag lookup, or translation fallback chain: an active `ar-EG`
does not inherit direction from an `ar` entry.

Direction refreshes on the initial update, manual updates, language updates, and registry changes,
even when `updateOnCatalogChange` is `false`. The registry subscription is released on disposal.
This is document-level direction only, not per-string bidi isolation or CSS mirroring; applications
own those concerns.

Ordinary content updates and extension callbacks are skipped on `script` and `style` elements,
including SVG elements: their text is an active code/style sink, not inert display text. Safe textual
attribute markers can still update those elements. Failed factory initialization removes any
installed subscriptions and DOM listeners before rethrowing, so callers can safely correct the
configuration and retry.

The missing-translation `throw` policy is deliberately fail-fast for ordinary DOM scans: a failed
lookup stops that scan, and earlier elements may already have updated. Automatic subscriber failures
are isolated from other subscribers, not converted into per-element missing-value recovery. Prefer a
nonthrowing missing policy when a production binding must update every ordinary element.

`setValues(element, values)` stores a detached snapshot for that element and updates it immediately.
Later automatic language or catalog updates render the selected translation with the same values, so
the application does not need its own language-change listener. Call `setValues()` again when the
dynamic values change. `clearValues(element)` removes the snapshot and immediately renders without
lookup values. Element-scoped storage uses weak references, allowing different instances of the same
translation key to hold different values without retaining removed elements.

### Native Language Select

`bindLanguageSelect()` connects an existing single-value native `HTMLSelectElement` to the active
language and registry. Selects with `multiple` are rejected because one translator has one active
language:

```html
<label>
  Language
  <select id="language"></select>
</label>
```

```ts
import { bindLanguageSelect } from "@unilarva/translator/dom";

const selectBinding = bindLanguageSelect(
  translator,
  document.querySelector<HTMLSelectElement>("#language")!,
);

// When the owning UI is destroyed:
selectBinding.dispose();
```

Population defaults to `true`. The binding owns all options, immediately rebuilds them from the
current registry, and rebuilds them after every later registry change. Labels use `nativeName`, then
the canonical code. Set `label: "code"` to always show codes, or supply a formatter callback. Each
option receives the canonical code as its value and `lang` attribute. Consumer code owns the
surrounding label, styles, persistence, browser-language detection, URLs, and which entries it adds
to the registry.

For uppercase UI codes such as `EN`, `FI`, and `SV`, opt in with a formatter:

```ts
const selectBinding = bindLanguageSelect(translator, select, {
  label: language => language.code.toUpperCase(),
});
```

`"code"` alone preserves canonical casing. The formatter changes display text only, not option
values or `lang` attributes, and also applies to unregistered active languages.

The binding calls `setLanguage()` for non-empty user selections and updates the selection after
external language changes. With population enabled, an unregistered active language gets a selected
temporary option appended after the registry options. Its label uses the same strategy with only
`{ code }` metadata: native-name labels fall back to the code, while custom formatters still run.
The temporary option is removed when the active language changes and replaced with a registry option
if that language is registered; no registry entry is created by the binding. Setting a select value
programmatically does not change the translator until a `change` event is dispatched.

For consumer-owned options, disable population:

```ts
const selectBinding = bindLanguageSelect(translator, select, { populate: false });
```

In this mode the binding never adds, removes, or relabels options. It only synchronizes the selected
option and forwards valid non-empty changes. Option values may contain canonicalizable language tags,
such as `EN_us`; comparison uses canonical tags without rewriting the values. Invalid tags are ignored.
If several option values normalize to the same language, the first matching option is selected.
If no option matches the active language, the selection is cleared (`selectedIndex` is `-1`).
`update()` performs an explicit synchronization in either mode. `dispose()` removes both translator
subscriptions and the DOM listener without altering the select.

Both language-control factories accept an optional `logger` for diagnostics such as ignored invalid
choice tags or malformed choice elements. Logger failures remain isolated.

### Details Language Dropdown

`bindLanguageDetails()` connects a consumer-styled native `<details>` disclosure to the same active
language and registry state. It requires a direct-child summary, a current-language marker, and a
choice-container marker owned by that control, not by a nested details control:

```html
<details id="language-details">
  <summary>
    Language:
    <span data-i18n-language-current></span>
  </summary>
  <div data-i18n-language-options></div>
</details>
```

```ts
import { bindLanguageDetails } from "@unilarva/translator/dom";

const languageDetails = document.querySelector<HTMLDetailsElement>("#language-details")!;
const detailsBinding = bindLanguageDetails(translator, languageDetails, {
  choiceClass: "button dropdown-item",
  choiceLabel: "code",
  currentLabel: "code",
});

// When the owning UI is destroyed:
detailsBinding.dispose();
```

Population defaults to `true`. The binding owns the choice container and continuously rebuilds it
from the registry. Generated choices are native `button` elements with canonical `lang` and
`data-i18n-language` attributes. `choiceClass` supplies consumer presentation classes. Choice
labels use `nativeName`, then the canonical code; set `choiceLabel: "code"` to show codes for every
generated choice instead. A formatter callback can implement application rules for individual
entries.

The current summary label also uses the native name by default. Set `currentLabel: "code"` or supply
a formatter to change it. For an unregistered active language, the same strategy receives only
`{ code }`, with optional metadata absent: native-name labels fall back to the code, while custom
formatters still run. To display uppercase codes in both the generated choices and current summary,
configure both formatters:

```ts
const detailsBinding = bindLanguageDetails(translator, languageDetails, {
  choiceLabel: language => language.code.toUpperCase(),
  currentLabel: language => language.code.toUpperCase(),
});
```

As with the select, uppercasing is opt-in and changes display text only, not canonical language codes
or `lang` attributes. The active choice remains clickable and carries
`aria-current="true"` so consumer CSS can distinguish it; set
`hideCurrent: true` only when the current choice should be omitted.

Activating an accepted choice prevents the button's default action (including form submission),
changes the translator language, closes the disclosure, and returns focus to its summary.
The helper deliberately uses ordinary disclosure and button semantics rather than ARIA
`menu` roles, which would require a different keyboard interaction model. Live registry rebuilds
preserve focus on the same choice when it remains available, or return focus to the summary when a
focused language is removed.

These focus guarantees also apply when the control is inside a shadow root. Each binding handles
only native button choices within its marked choice container whose nearest details control is its
own. Nested language controls do not activate or restyle one another's choices.

For consumer-owned buttons, use `populate: false` and place canonicalizable language tags in
`data-i18n-language`. Set `type="button"` explicitly so the choices cannot submit an enclosing form
before binding or after disposal. The binding does not rewrite consumer button types or cancel
default actions for ignored or unrelated choices. It synchronizes only the current label, button
visibility, and `aria-current` state. `update()` synchronizes explicitly, while `dispose()` removes
the click and translator subscriptions without changing the markup.

Tags are canonicalized consistently for activation and current-choice comparisons, without
rewriting consumer attributes. Invalid tags and non-button choices are ignored rather than changing
the language.

The default `attributePrefix` is `i18n`, matching `bindTranslator()`. A custom prefix changes the
complete details marker set: `attributePrefix: "preview"` uses `data-preview-language-current`,
`data-preview-language-options`, and generated or consumer-owned `data-preview-language` choices.

### Multiple Language Controls

Any number and combination of select and details bindings may share one `Translator`. Each binding
subscribes independently to active-language and registry changes. A choice made through one control,
an external `setLanguage()` call, or later registry mutation synchronously updates all live
bindings. Disposing one binding does not affect the others.

### Scoped And Nested Bindings

Every binding owns only its supplied root and reacts only to its own `Translator`. Bind the main
translator to the document for application-wide translation, or bind a translator to any subtree
for an independently selected language.

When roots overlap, use a distinct `attributePrefix` for the nested binding. The prefix changes its
complete marker namespace: `preview` produces `data-preview`, `data-preview-title`,
`data-preview-aria-label`, and the other documented marker suffixes. The outer binding then ignores
the nested markers, so both translators may safely contain identical key names.

```html
<h1 data-i18n="title"></h1>

<section id="preview">
  <h1 data-preview="title"></h1>
</section>
```

```ts
import { Translator } from "@unilarva/translator";
import { bindTranslator } from "@unilarva/translator/dom";

// appTranslator already contains the application's translations and language metadata.
const previewTranslator = new Translator({ language: "pt" });
previewTranslator.copyFrom(appTranslator, { fallbackLanguage: true });

const appBinding = bindTranslator(appTranslator, document.documentElement, {
  updateDocumentLanguage: true,
});
const previewRoot = document.querySelector<HTMLElement>("#preview")!;
previewRoot.lang = previewTranslator.getLanguage();
const unsubscribePreviewLanguage = previewTranslator.subscribe(({ language }) => {
  previewRoot.lang = language;
});
const previewBinding = bindTranslator(previewTranslator, previewRoot, {
  attributePrefix: "preview",
});

appTranslator.setLanguage("fi"); // App title changes; preview stays Portuguese.
previewTranslator.setLanguage("en"); // Only the preview changes.
```

The copy includes registered language metadata and, here, explicitly opts into the app's fallback
language while preserving the preview's active language. Later app changes do not propagate into
the preview. Call `previewTranslator.copyFrom(appTranslator)` again to merge updated data, or pass
`mode: "replace"` to also remove data absent from the app; neither changes the preview's language
settings by default. See [copying between translators](#copying-between-translators) for all options.
On teardown, dispose both DOM bindings and call `unsubscribePreviewLanguage()`.

Bindings on disjoint roots can reuse the same prefix because neither scan reaches the other root.
Nested or otherwise overlapping roots should not reuse a prefix: both bindings would match and write
the same elements. Enable `updateDocumentLanguage` and `updateDocumentDirection` only for the binding
that owns the corresponding document state; a localized preview should manage its own root `lang`
and `dir` attributes. Both options target the owning document's HTML element, not the binding root.

DOM extensions have their own marker selectors. When the nested binding uses a prefix different from
the outer binding, configure its built-in extensions to match that nested prefix. In this example,
the outer namespace is `i18n`, while the nested binding and both nested extensions use `preview`:

```ts
bindTranslator(previewTranslator, previewRoot, {
  attributePrefix: "preview",
  extensions: [
    intlDomExtension({ attributePrefix: "preview" }),
    richTextDomExtension({ attributePrefix: "preview", renderers }),
  ],
});
```

Keep the binding on a document or another persistent container. Normal root scans do not enter
`<template>` contents, but explicitly passing `template.content` or a cloned `DocumentFragment` to
`update()` translates that fragment before insertion. Inserting a fragment moves its children and
leaves the fragment empty, so a binding created on the fragment itself cannot follow the moved
nodes. Once inserted below a persistent binding root, later language changes update them normally.
Shadow roots are supported as binding and update scopes.

```ts
const binding = bindTranslator(translator, document.body);
const template = document.querySelector<HTMLTemplateElement>("#translated-card")!;
const fragment = template.content.cloneNode(true) as DocumentFragment;

binding.update(fragment);
document.querySelector("#cards")!.append(fragment);

translator.setLanguage("fi"); // Updates the inserted card through the body binding.
```

### Markers

```html
<span data-i18n="greeting"></span>
<button data-i18n="save" data-i18n-attrs="title,aria-label"></button>
<button data-i18n-title="save" data-i18n-aria-label="save">
  <svg><!-- Application-owned icon. --></svg>
</button>
<img data-i18n-alt="cover.alt" src="/validated-cover.jpg" alt="" />
```

- `data-i18n` always assigns `textContent`.
- `data-i18n-attrs` applies the same key to comma- or whitespace-separated allowlisted attributes
  in addition to content.
- `data-i18n-title`, `data-i18n-aria-label`, `data-i18n-placeholder`, and `data-i18n-alt` support
  distinct keys and attribute-only elements. Explicit markers win over `data-i18n-attrs`.
- The default shared-attribute allowlist is `title`, `aria-label`, `placeholder`, and `alt`.
- `additionalTranslatedAttributes` can opt into the known inert textual attributes
  `aria-description`, `aria-placeholder`, `aria-roledescription`, and `aria-valuetext`.
- Identifiers, form and navigation behavior, event handlers, styles, and URL-bearing attributes are
  never accepted by the built-in binding.

Without element values, built-in DOM markers leave `{name}` placeholders unchanged. Values installed
through `binding.setValues()` apply to content, explicit translated attributes, shared translated
attributes, and DOM extensions. Import-time `replacements` need no special DOM handling because they
are already part of every stored language.

## Formatting Extension

Formatting markers are opt-in:

```ts
import { bindTranslator, intlDomExtension } from "@unilarva/translator/dom";

const binding = bindTranslator(translator, document.documentElement, {
  extensions: [intlDomExtension()],
});
```

```html
<span data-i18n-number="1234.5"></span>
<span
  data-i18n-currency="12"
  data-i18n-currency-code="EUR"
  data-i18n-minimum-fraction-digits="0"
></span>
<span data-i18n-date="2026-09-30" data-i18n-year="2-digit"></span>
<span data-i18n-time="09:30"></span>
<span data-i18n-weekday="0" data-i18n-weekday-width="short"></span>
```

Optional `data-i18n-format-language` overrides the active language. An element must select exactly
one formatting kind. Formatted output is always assigned through `textContent`; invalid marker
values are reported through the binding logger. Minimum and maximum fraction-digit markers accept
unsigned decimal digits from `0` through `20` (leading zeros are allowed); blank values, surrounding
whitespace, signs, exponents, and hexadecimal notation are invalid. This conservative DOM-marker range
is narrower than options supported by some newer host `Intl` implementations.

There are no built-in relative-time or plural-selection markers. Call the core helpers from
application code; application-owned rendering and update scheduling remain explicit.

## Semantic Rich Translations

Rich translations use named semantic tokens without HTML attributes:

```json
{
  "translator-i18n": {
    "multilingual-data": {
      "museum.more-info": {
        "en": "Read more on the <website>museum website</website>.",
        "fi": "Lue lisää <website>museon verkkosivuilta</website>."
      }
    }
  }
}
```

The consumer explicitly maps every admitted token to a DOM node and owns all resulting attributes
and URLs:

```ts
import { bindTranslator, richTextDomExtension } from "@unilarva/translator/dom";

const richText = richTextDomExtension({
  renderers: {
    website(children, { document }) {
      const link = document.createElement("a");
      link.href = validatedMuseumUrl;
      link.appendChild(children);
      return link;
    },
    strong(children, { document }) {
      const strong = document.createElement("strong");
      strong.appendChild(children);
      return strong;
    },
  },
});

bindTranslator(translator, document.documentElement, {
  extensions: [richText],
});
```

```html
<p data-i18n-rich="museum.more-info"></p>
```

Only exact, balanced token names with configured renderers are interpreted. Token-like text with
attributes or self-closing syntax remains literal text, not HTML. The parser requires an array of
approved string tag names and rejects unknown exact tokens, unbalanced nesting, and nesting deeper
than 256 tags. Translation tokens cannot create attributes. `translateRichText()` accepts lookup-time
`values`; interpolation is applied to
parsed text nodes, so an interpolated `<script>` string remains text. Values installed with
`binding.setValues()` are also supplied to `richTextDomExtension()` and consumer extensions through
`TranslatorDomExtensionContext.values`. If parsing or a renderer fails, the DOM extension falls back
to the ordinary translated string through `textContent` and logs the failure.

Renderer callbacks must synchronously return a DOM node; do not pass an `async` renderer. An accidental
promise is not rendered or awaited: its rejection is observed for diagnostics and the rendering
failure uses the ordinary text fallback. This does not provide asynchronous rendering support.

The root entry exports `parseRichText()` and `translateRichText()` for applications that render
the semantic node tree themselves, including SSR. These functions do not serialize HTML or escape
for an output context; the final renderer owns that responsibility.

```ts
import { parseRichText, translateRichText } from "@unilarva/translator";

const nodes = translateRichText(translator, "museum.more-info", {
  language: "fi",
  allowedTags: ["website"],
});

const example = parseRichText("Hello <strong>{name}</strong>", ["strong"], { name: "Ada" });
// [
//   { type: "text", value: "Hello " },
//   { type: "tag", name: "strong", children: [{ type: "text", value: "Ada" }] },
// ]
```

Walk `nodes` using an application-owned renderer that admits the same token names as the browser
renderer. Never serialize arbitrary token names or interpolate text nodes into HTML without escaping.
Unlike the DOM extension's text fallback, the core parser throws for invalid exact token structure.

## Custom DOM Extensions

`TranslatorDomExtension` adds explicit selectors and consumer-defined update callbacks to the
binding lifecycle. Extensions receive the translator and structured log function, run during the
initial update, language changes, enabled catalog updates, and targeted subtree updates, and are isolated so one callback
failure does not stop other elements.

Selectors must be valid, element-local CSS selectors. Scope-dependent `:scope` selectors are rejected
at construction because discovery and targeted element updates cannot share their root-relative
meaning. Extension callbacks are synchronous: do not pass an `async` function. Accidentally returned
promises are observed for rejection diagnostics, but are not awaited and have no ordering,
cancellation, or post-disposal update guarantee.

```ts
import type { TranslatorDomExtension } from "@unilarva/translator/dom";

const statusExtension: TranslatorDomExtension = {
  selector: "[data-status-label]",
  update(element, { translator }) {
    const key = element.getAttribute("data-status-label");
    if (key) element.textContent = translator.translateKey(key);
  },
};
```

Extensions are privileged application code, not a sandbox. The built-in attribute restrictions do
not constrain what a custom callback can do. Validate selectors at development time and apply the
application's normal DOM and URL security rules inside every extension.

## Localized Resources

The built-in DOM binding deliberately does not assign translations to `src`, `href`, or other
URL-bearing attributes. Translate a stable resource identifier and let application code map it to
a validated URL:

```json
{
  "translator-i18n": {
    "multilingual-data": {
      "hero.image": {
        "en": "hero-en",
        "fi": "hero-fi"
      },
      "hero.alt": {
        "en": "People visiting the exhibition",
        "fi": "Ihmisiä näyttelyssä"
      }
    }
  }
}
```

```html
<img id="hero" data-i18n-alt="hero.alt" src="/images/hero-en.webp" alt="" />
```

```ts
const heroImages: ReadonlyMap<string, string> = new Map([
  ["hero-en", "/images/hero-en.webp"],
  ["hero-fi", "/images/hero-fi.webp"],
]);

function updateHeroImage(): void {
  const resourceId = translator.translateKey("hero.image");
  const source = heroImages.get(resourceId);
  if (source) document.querySelector<HTMLImageElement>("#hero")!.src = source;
}

updateHeroImage();
const unsubscribeImage = translator.subscribe(updateHeroImage);
const unsubscribeImageCatalog = translator.subscribeCatalog(updateHeroImage);
```

This keeps deployment paths and URL validation in application code while the package translates
the resource's textual alternative. Only explicitly mapped identifiers can select a URL; unknown
identifiers leave the existing image unchanged. On teardown, call both `unsubscribeImage()` and
`unsubscribeImageCatalog()` to release the language-change and catalog-change subscriptions.

## Security Model

The package stores context-neutral strings. It does not sanitize arbitrary HTML because ordinary
translations are never treated as HTML in the first place.

The built-in DOM binding:

- assigns ordinary content through `textContent`;
- limits translated attributes to a fixed set of inert textual attributes;
- never assigns translated URLs, styles, event handlers, identifiers, or form/navigation behavior;
- skips content updates and extensions on active `script` and `style` text sinks;
- does not enter template contents during ordinary ancestor scans.

Semantic rich-text parsing recognizes only consumer-approved, attribute-free tokens. Consumer
renderers create every resulting node and therefore own element choice, attributes, classes,
behavior, and URL validation. Custom DOM extensions have the same application-level trust as any
other DOM code and are not restricted by the built-in binding policy.

The package does not impose catalog size limits, URL origin rules, or retry policies. Consumers of
untrusted or remote catalogs should constrain resource sizes and approved origins before import.

Server renderers must escape ordinary translations and rich-text text nodes for their final output
context. Do not pre-escape stored values: the correct escaping depends on where the application
eventually emits them.

## Public API Index

The root entry exports:

- `Translator` and `normalizeLanguageTag()`;
- standalone number, currency, calendar-date, clock-time, weekday, and relative-time formatters,
  plus `selectPlural()` returning `Intl.LDMLPluralRule`;
- `RelativeTimeFormatOptions` and `PluralSelectOptions`, combining their native `Intl` options
  with `LocaleFormatOptions`;
- `parseRichText()` and `translateRichText()`;
- `TranslationCatalogChangeEvent`, `TranslatorCopyOptions`, and the TypeScript types used by translation bundles, language registries, imports, loading, logging,
  formatting, and semantic rich-text nodes.

The DOM entry exports:

- `bindTranslator()` and DOM binding option, binding, context, and extension types;
- `bindLanguageSelect()` and its option and binding types;
- `bindLanguageDetails()` and its option and binding types;
- `intlDomExtension()` and its options;
- `richTextDomExtension()` and its renderer, context, and options types.

Use package-generated TypeScript declarations for the complete signatures. The exports map is the
compatibility boundary; unexported source and `dist/` modules are internal.
