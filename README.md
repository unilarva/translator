# `@unilarva/translator`

<p align="center">
  <img
    src="./assets/icons/unilarva-translator-logo-adaptive.svg"
    alt="@unilarva/translator logo"
    width="160"
  >
</p>

A small, framework-independent translation store with predictable runtime catalog updates,
optional typed keys, ordered language fallbacks, locale formatting, semantic rich text,
and an optional text-first DOM binding.

The package has no runtime dependencies. Its root entry works without a DOM in browsers,
servers, workers, and command-line tools; browser integration is isolated in
`@unilarva/translator/dom`.

[Quick start](#quick-start) | [Usage guide](./USAGE.md) | [Architecture](./ARCHITECTURE.md) |
[Changelog](./CHANGELOG.md)

## Highlights

- **Small core, optional DOM integration.** Use translation lookup, interpolation, locale
  formatting, and rich-text parsing without a framework or browser document. Import the separate
  DOM entry only when declarative markup updates are useful.
- **Explicit catalog updates.** Validated bundle envelopes, detailed import reports, and atomic
  `merge`, `replace-keys`, and `replace-all` modes make runtime-loaded catalog changes deliberate
  and inspectable.
- **Inert rendering by default.** The ordinary DOM binding writes `textContent` and a fixed set of
  textual attributes. It does not interpret translations as HTML or assign them to URLs, styles,
  event handlers, or navigation behavior.
- **Element-scoped dynamic values.** Attach `{name}` interpolation values to one bound element and
  update them independently. The binding retains a detached snapshot and automatically reapplies it
  when the active language or catalog changes.
- **Application-controlled rich text.** Translations can contain approved semantic tokens, while
  consumer renderers create every resulting element and own its attributes and URLs. The same
  semantic node representation is available to application-owned SSR serializers.
- **Locale-aware and deterministic.** Canonical BCP 47 language tags, ordered multiple fallback
  languages with progressive subtag fallback,
  configurable missing-value behavior, and strict `Intl` helpers for formatting, relative time,
  and plural-category selection keep lookup and formatting rules explicit.
- **Scoped UIs and synchronized language controls.** Bind a document or subtree, use independent
  translators for previews, and connect existing native selects or details dropdowns to an observable
  language registry. Direction synchronization is opt-in; styling and persistence stay application-owned.
- **Observable without a logging dependency.** Subscriptions and structured diagnostics integrate
  with application infrastructure, while failures in loggers, subscribers, and DOM extensions are
  isolated from unrelated updates.
- **TypeScript-first ESM.** Public declarations, detached translation snapshots, an encapsulated
  exports map, and a side-effect-free package support modern bundlers and tree shaking.
- **Opt-in typed keys.** [`createTypedTranslate()`](./USAGE.md#typed-keys) checks a wrapper's keys
  against a literal key-first catalog or explicit string union, without changing runtime imports
  or the dynamic `Translator` API.

> **Pre-1.0 status:** Public APIs and bundle contracts can change between minor releases. Pin the
> version and review the [changelog](./CHANGELOG.md) before upgrading.

## Guides

- [Usage guide](./USAGE.md): bundles, imports, language fallback, formatting, loading, DOM markers,
  extensions, rich text, security, and the public API.
- [Architecture](./ARCHITECTURE.md): maintainer-only module boundaries, invariants, data flows,
  testing, development, and release guidance.
- [Changelog](./CHANGELOG.md): release-level additions, changes, and removals.

## Requirements

- An ESM-capable application. The package does not provide a CommonJS build.
- Node.js `22.13.0` or newer when running the package in Node.js.
- An ES2022-capable runtime with the required `Intl` locale data.
- TypeScript consumers can use the root declarations with `ES2022` alone, without DOM or Node
  ambient types.
- A browser DOM only when using `@unilarva/translator/dom`; the root entry has no DOM requirement.

| Import                              | Purpose                                                            |
| ----------------------------------- | ------------------------------------------------------------------ |
| `@unilarva/translator`              | DOM-free translation, formatting, loading, and rich-text parsing.  |
| `@unilarva/translator/dom`          | DOM binding plus Intl and semantic rich-text DOM extensions.       |
| `@unilarva/translator/package.json` | Package metadata for build tooling; not a runtime translation API. |

Only these documented package subpaths are public. Implementation files below `dist/` are not.

## Quick Start

Install the package:

```sh
npm install @unilarva/translator
```

Create a translator, import a multilingual bundle, and translate a key:

```ts
import { Translator } from "@unilarva/translator";

const translator = new Translator({
  language: "fi",
  fallbackLanguage: "en",
  additionalFallbackLanguages: ["sv"],
  missingTranslationPolicy: "key",
});

const report = translator.importTranslations({
  "translator-i18n": {
    "multilingual-data": {
      greeting: {
        en: "Hello {name}",
        fi: "Hei {name}",
      },
    },
  },
});

if (report.issues.length > 0) {
  console.warn("Translation import issues", report.issues);
}

translator.translateKey("greeting", { values: { name: "Ada" } }); // "Hei Ada"
```

Lookup tries requested and active languages, then the primary fallback and ordered additional
fallbacks, expanding each tag to its parents before moving on. `fallbackLanguage` remains the
primary-only setting; additional fallbacks default to `[]`. See
[translation lookup](./USAGE.md#translation-lookup) for the full order and policy APIs.

Lookup-time `values` fill `{name}` placeholders for that call; `{{name}}` renders the literal text
`{name}`. Import-time `replacements` are a separate mechanism for literal source tokens that should
be fixed across the imported catalog. See
[translation bundles and imports](./USAGE.md#translation-bundles-and-imports) for the distinction.

Translation data always uses the `translator-i18n` namespace. This prevents catalog data from being
confused with adjacent metadata and lets parsed JSON be validated at runtime. For language-on-demand
files, orient the same data by language:

```json
{
  "translator-i18n": {
    "language-data": {
      "fi": {
        "greeting": "Hei {name}"
      }
    }
  }
}
```

`multilingual-data` and `language-data` may coexist in one namespace. Optional `languages` metadata
can populate the independent selectable-language registry. The detailed guide also covers ordering,
registry import policy, concatenated string arrays, validation reports, and atomic import modes.

## Browser Binding

Continue with the translator from the quick start. Add this markup before initializing the binding
(for example, load your application with a `<script type="module">`):

```html
<label>
  Language
  <select id="language"></select>
</label>
<p id="greeting" data-i18n="greeting"></p>
```

Use the optional DOM entry to translate the page and connect its language select:

```ts
import { bindLanguageSelect, bindTranslator } from "@unilarva/translator/dom";

translator.addLanguage({ code: "en", nativeName: "English" });
translator.addLanguage({ code: "fi", nativeName: "Suomi", englishName: "Finnish" });

const binding = bindTranslator(translator, document.documentElement, {
  updateDocumentLanguage: true,
});
const languageSelect = bindLanguageSelect(
  translator,
  document.querySelector<HTMLSelectElement>("#language")!,
);

const greeting = document.querySelector<HTMLParagraphElement>("#greeting")!;
binding.setValues(greeting, { name: "Ada" }); // "Hei Ada"
translator.setLanguage("en"); // "Hello Ada"; also updates html.lang and the select.
binding.setValues(greeting, { name: "Lin" }); // "Hello Lin"

// When the owning UI is destroyed, release both bindings:
languageSelect.dispose();
binding.dispose();
```

The binding performs an initial update and automatically refreshes after language and effective
catalog changes. Newly inserted markup and lookup-policy changes, including either fallback setting,
need `binding.update()` even with automatic catalog refresh enabled. Ordinary
content markers replace all child content with text; use attribute-only markers to preserve icons or
other application-owned children:

```html
<button data-i18n-aria-label="greeting">
  <svg><!-- Application-owned icon. --></svg>
</button>
```

The registry supplies offered choices but does not restrict `setLanguage()`. Applications own browser
language detection, persistence, routing, and styling. The guide covers
[details dropdowns](./USAGE.md#details-language-dropdown),
[independent nested scopes](./USAGE.md#scoped-and-nested-bindings),
[opt-in document direction](./USAGE.md#dom-binding), and
[formatting](./USAGE.md#formatting-extension) and
[semantic rich-text extensions](./USAGE.md#semantic-rich-translations).

Details dropdown bindings prevent default button actions for accepted language choices, including
form submission. Consumer-owned choice buttons should still declare `type="button"` for safety
before binding and after disposal; unrelated buttons retain their normal behavior.

For JSON catalogs hosted by your application, use
[`loadTranslationFiles()`](./USAGE.md#loading-files). The package does not require a catalog build step.

## Is It A Fit?

The package is intended for applications that want a compact runtime translator, load catalogs at
runtime, and prefer to keep rendering and URL policy under application control. It is particularly
suited to shared browser/server translation code and framework-free or custom-UI applications.

It does not provide ICU MessageFormat, catalog extraction or compilation, generated key types,
plural message compilation, or framework-specific components. `selectPlural()` returns a native
`Intl` category, not a translated phrase; applications own message selection. Relative-time formatting
requires an explicit value and unit, not dates or automatic clock updates. See
[locale formatting](./USAGE.md#locale-formatting) for both helpers and their contracts.
Applications that need compilation or framework workflows should use a package designed around them.

## Security Boundary

Translation values are context-neutral strings. Ordinary translations are not parsed as HTML,
pre-escaped for one output context, or assigned to URLs. Semantic rich-text tokens are parsed only
when explicitly requested and can create only nodes supplied by consumer renderers.

Consumer code still owns its trust boundaries: validate renderer-created attributes and URLs,
escape strings for the final SSR output context, constrain translation source URLs, and review
custom DOM extensions as privileged application code. See the full
[security model](./USAGE.md#security-model).

## License

Copyright © 2020-2026 Lari Natri. Licensed under the [Apache License, Version 2.0](./LICENSE)
(`Apache-2.0`).
