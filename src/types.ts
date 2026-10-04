// SPDX-FileCopyrightText: 2020-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Package-private type definitions; exports re-exported by the root are public API.
 *
 * SPDX-FileCopyrightText: 2020-2026 Lari Natri <lari.natri@iki.fi>
 * SPDX-License-Identifier: Apache-2.0
 *
 * @packageDocumentation
 * @module types
 * @author Lari Natri
 */

/** One translation value in a JSON-compatible bundle. String arrays join without a separator. */
export type TranslationValue = string | readonly string[];

/** Language tag to translation value map for one translation key. */
export type TranslationLanguageMap = Record<string, TranslationValue>;

/** Translation key to language map, optimized for editing languages side by side. */
export type MultilingualData = Record<string, TranslationLanguageMap>;

/** Translation key to one value in a language-specific bundle. */
export type LanguageTranslationMap = Record<string, TranslationValue>;

/** Language tag to its translation key/value map. */
export type LanguageData = Record<string, LanguageTranslationMap>;

/** Display metadata for one language, keyed separately by its language code. */
export interface LanguageMetadata {
  /** Language name in its own language; preferred over the English name for display. */
  nativeName?: string;
  /** English display name, used when the native name is absent or empty. */
  englishName?: string;
  /** Explicit base text direction; omitted metadata has an effective default of ltr. */
  direction?: "ltr" | "rtl";
}

/** Canonicalizable language tag to display metadata map. */
export type LanguageRegistryData = Record<string, LanguageMetadata>;

/** Recognized data bundles inside the translation namespace; at least one catalog is required. */
export type TranslatorI18nRoot =
  | {
      /** Key-first catalog; an empty language map can remove a key in replacement modes. */
      "multilingual-data": MultilingualData;
      /** Optional language-first catalog, processed in root property order. */
      "language-data"?: LanguageData;
      /** Optional selectable-language metadata, independent of catalog languages. */
      languages?: LanguageRegistryData;
    }
  | {
      /** Optional key-first catalog, processed in root property order. */
      "multilingual-data"?: MultilingualData;
      /** Language-first catalog; later values overwrite earlier key/language pairs. */
      "language-data": LanguageData;
      /** Optional selectable-language metadata, independent of catalog languages. */
      languages?: LanguageRegistryData;
    };

/** Required root envelope accepted by translation imports. */
export interface TranslationBundle {
  /** Required namespace containing catalogs and optional language metadata. */
  "translator-i18n": TranslatorI18nRoot;
}

/** Runtime placeholder value; null and undefined become empty text, others use String conversion. */
export type TranslationInterpolationValue = string | number | boolean | null | undefined;

/**
 * Missing lookup result: empty string, key, `[key]`, configured text, or a thrown Error.
 * Applied only after requested, active, fallback, and optional arbitrary-language lookup fail.
 */
export type MissingTranslationPolicy = "empty" | "key" | "bracketed" | "text" | "throw";

/** Structured translator diagnostic severity. */
export type TranslatorLogLevel = "debug" | "warn" | "error";

/** Package component that emitted a structured diagnostic. */
export type TranslatorLogComponent = "translator" | "dom" | "intl" | "rich-text";

/** Structured diagnostic emitted through a configured logger. */
export interface TranslatorLogEntry {
  /** Diagnostic severity. */
  level: TranslatorLogLevel;
  /** Package component responsible for the diagnostic. */
  component: TranslatorLogComponent;
  /** Stable machine-readable event identifier. */
  event: string;
  /** Human-readable diagnostic summary. */
  message: string;
  /** Detached immutable plain-data context; opaque objects retain their identity. */
  details?: Readonly<Record<string, unknown>>;
  /** Original error when an operation failed. */
  error?: unknown;
}

/**
 * Receives synchronous diagnostics; returned promises are not awaited and failures are ignored.
 *
 * @param entry - Frozen diagnostic with detached plain-data details and the original error.
 */
export type TranslatorLogger = (entry: Readonly<TranslatorLogEntry>) => void;

/** Language display metadata. */
export interface LanguageInfo extends LanguageMetadata {
  /** Language tag; registration canonicalizes it after trimming and replacing underscores. */
  code: string;
}

/** Event emitted after the selectable-language registry changes. */
export interface LanguageRegistryChangeEvent {
  /** Detached immutable snapshot in registration order. */
  readonly languages: readonly Readonly<LanguageInfo>[];
}

/** Immutable event emitted after effective catalog content changes. */
export interface TranslationCatalogChangeEvent {
  /** Monotonically increasing revision; reentrant changes may be coalesced. */
  readonly revision: number;
}

/** Merge or replace optional bundle metadata, or ignore it without validating it. */
export type LanguageImportMode = "merge" | "replace" | "ignore";

/** One non-fatal issue found while importing translation data. */
export interface TranslationImportIssue {
  /** Dot-separated bundle location; empty for root-level or aborted-import issues. */
  path: string;
  /** Machine-readable validation or destructive-import rejection reason. */
  code:
    | "invalid-root"
    | "invalid-data-bundle"
    | "invalid-key-bundle"
    | "invalid-key"
    | "invalid-language-bundle"
    | "invalid-language-registry"
    | "invalid-language-metadata"
    | "invalid-language"
    | "invalid-value"
    | "destructive-import-aborted";
  /** Human-readable explanation of the issue. */
  message: string;
}

/** Result of importing one translation bundle. */
export interface TranslationImportReport {
  /** Distinct accepted keys, including empty key maps; zero when a destructive import aborts. */
  importedKeys: number;
  /** Accepted value occurrences, including overwrites; zero when a destructive import aborts. */
  importedValues: number;
  /** Accepted metadata occurrences; zero when ignored or a destructive import aborts. */
  importedLanguages: number;
  /** Validation issues in encounter order; valid parts may still have been imported. */
  issues: TranslationImportIssue[];
}

/** Options for importing a translation bundle. */
export interface TranslationImportOptions {
  /** Merge values, replace incoming keys, or replace the whole catalog. Defaults to `merge`. */
  mode?: "merge" | "replace-keys" | "replace-all";
  /** Controls optional `languages` metadata independently. Defaults to `merge`. */
  languageMode?: LanguageImportMode;
  /**
   * Literal source replacements applied sequentially, longest keys first, before runtime interpolation.
   * Empty keys are ignored; null/undefined become empty text; other values use String conversion.
   */
  replacements?: Readonly<Record<string, string | number | boolean | null | undefined>>;
}

/** Selects independent snapshots to copy from another Translator. */
export interface TranslatorCopyOptions {
  /** Copy translation values. Defaults to true. */
  translations?: boolean;
  /** Copy registered language display metadata. Defaults to true. */
  languageMetadata?: boolean;
  /** Copy the active language. Defaults to false. */
  activeLanguage?: boolean;
  /** Copy the fallback language. Defaults to false. */
  fallbackLanguage?: boolean;
  /** Merge or replace each selected catalog/registry. Defaults to `merge`. */
  mode?: "merge" | "replace";
}

/** Options for one translation lookup. */
export interface TranslateOptions {
  /** First lookup language; invalid tags are skipped. Defaults to the active language. */
  language?: string;
  /** Own-property values for `{name}` placeholders; missing names remain unchanged. */
  values?: Readonly<Record<string, TranslationInterpolationValue>>;
  /** Defaults to true. Disable when a downstream parser owns interpolation and brace decoding. */
  interpolate?: boolean;
}

/** Event emitted after the active language changes or is explicitly refreshed. */
export interface LanguageChangeEvent {
  /** Canonical language active while this event is delivered. */
  readonly language: string;
  /** Canonical language preceding this queued transition. */
  readonly previousLanguage: string;
  /** Whether the caller requested notification even for an unchanged language. */
  readonly forced: boolean;
}

/** DOM-free native-compatible abort signal. Event payloads remain opaque to the core. */
export interface TranslationAbortSignal {
  /** Whether cancellation has been requested. */
  readonly aborted: boolean;
  /** Original cancellation reason, thrown by throwIfAborted after cancellation. */
  readonly reason: unknown;
  /** Abort callback, or null; bivariant typing preserves native event payload compatibility. */
  onabort: { callback(event: unknown): void }["callback"] | null;
  /** Throws the original abort reason when aborted. */
  throwIfAborted(): void;
  /**
   * Native EventTarget-compatible listener registration.
   * @param args - Event type, listener, and optional native-compatible options.
   */
  addEventListener(...args: unknown[]): void;
  /**
   * Native EventTarget-compatible listener removal.
   * @param args - Event type, listener, and optional native-compatible options.
   */
  removeEventListener(...args: unknown[]): void;
  /**
   * Dispatches an opaque native-compatible event.
   * @param event - Event to dispatch.
   * @returns False when a cancelable event was canceled, following native EventTarget semantics.
   */
  dispatchEvent(event: unknown): boolean;
}

/** Minimal response required by translation file loading. */
export interface TranslationFetchResponse {
  /** Explicit false rejects loading; omission is accepted for minimal fetch adapters. */
  ok?: boolean;
  /** HTTP status included in errors when ok is false. */
  status?: number;
  /** Optional HTTP status explanation included in load errors. */
  statusText?: string;
  /**
   * Parses the response body; parsing rejection fails loading before any staged commit.
   * @returns Untrusted JSON value to validate as a translation bundle.
   */
  json(): Promise<unknown>;
}

/** Cache modes accepted by the fetch-compatible translation loader. */
export type TranslationRequestCache =
  "default" | "no-store" | "reload" | "no-cache" | "force-cache" | "only-if-cached";

/**
 * Fetch-compatible function used by translation file loading.
 *
 * @param input - Translation JSON URL.
 * @param init - Loader request settings, with cache set to `no-cache` and an optional abort signal.
 * @returns Response whose JSON body will be validated as a translation bundle.
 */
export type TranslatorFetch = (
  input: string,
  init?: { cache?: TranslationRequestCache; signal?: TranslationAbortSignal },
) => Promise<TranslationFetchResponse>;

/** Options for loading and importing translation JSON files. */
export interface TranslationLoadOptions extends TranslationImportOptions {
  /** Per-load fetch override, preferred over the constructor fetch and global fetch. */
  fetch?: TranslatorFetch;
  /** Cancellation checked before requests and commit; abort throws the original reason. */
  signal?: TranslationAbortSignal;
}

/** Translator construction options. */
export interface TranslatorOptions {
  /** Initial active tag, canonicalized on construction. Defaults to `en`. */
  language?: string;
  /** Lookup fallback tag, canonicalized on construction. Defaults to `en`. */
  fallbackLanguage?: string;
  /** Result policy after all lookup candidates fail. Defaults to `empty`. */
  missingTranslationPolicy?: MissingTranslationPolicy;
  /** Text returned by the `text` missing policy. Defaults to `MISSING`. */
  missingTranslationText?: string;
  /** Use the key's first stored language after normal lookup fails. Defaults to true. */
  fallbackToAnyLanguage?: boolean;
  /** Optional structured diagnostic sink. No logging occurs by default. */
  logger?: TranslatorLogger;
  /** Default file loader; null or omission allows load-time override or global fetch fallback. */
  fetch?: TranslatorFetch | null;
}
