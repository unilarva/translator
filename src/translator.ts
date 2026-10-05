// SPDX-FileCopyrightText: 2020-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Package-private translator implementation; Translator, createTypedTranslate, and
 * normalizeLanguageTag are public API re-exported by the root entry.
 * Provides DOM-free catalogs, lookup, events, and file loading.
 *
 * SPDX-FileCopyrightText: 2020-2026 Lari Natri <lari.natri@iki.fi>
 * SPDX-License-Identifier: Apache-2.0
 *
 * @packageDocumentation
 * @module translator
 * @author Lari Natri
 */

import type {
  LanguageChangeEvent,
  LanguageRegistryChangeEvent,
  LanguageInfo,
  MissingTranslationPolicy,
  MultilingualData,
  TranslateOptions,
  TranslationBundle,
  TranslationCatalogChangeEvent,
  TranslationFetchResponse,
  TranslationImportOptions,
  TranslationImportReport,
  TranslationLanguageMap,
  TranslationLoadOptions,
  TranslatorCopyOptions,
  TranslatorFetch,
  TranslatorLogger,
  TranslatorOptions,
  TranslationValue,
} from "./types.js";
import { emitTranslatorLog, observeCallbackResult } from "./logging.js";
import { interpolate } from "./interpolation.js";
import {
  formatCurrency as formatCurrencyValue,
  formatDate as formatDateValue,
  formatNumber as formatNumberValue,
  formatRelativeTime as formatRelativeTimeValue,
  formatTime as formatTimeValue,
  formatWeekday as formatWeekdayValue,
  selectPlural as selectPluralValue,
  type CalendarDate,
  type ClockTime,
  type CurrencyFormatOptions,
  type DateFormatOptions,
  type NumberFormatOptions,
  type PluralSelectOptions,
  type RelativeTimeFormatOptions,
  type TimeFormatOptions,
  type WeekdayFormatOptions,
} from "./intl.js";

const I18N_ROOT_KEY = "translator-i18n";
const MULTILINGUAL_DATA_KEY = "multilingual-data";
const LANGUAGE_DATA_KEY = "language-data";
const LANGUAGES_KEY = "languages";

/**
 * Creates a live lookup function restricted to an explicit application-owned key union.
 * Type checking does not guarantee that a key exists in the translator's current catalog.
 * @param translator - Translator whose current lookup behavior is used on every call.
 * @returns Lookup accepting the chosen keys and ordinary TranslateOptions; errors propagate unchanged.
 */
export function createTypedTranslate<Key extends string>(
  translator: Translator,
): (key: Key, options?: TranslateOptions) => string;
/**
 * Creates a live lookup function whose keys are inferred from a key-first catalog.
 * The catalog is a type witness only: it is not read, retained, validated, or imported.
 * @param translator - Translator whose current lookup behavior is used on every call.
 * @param catalog - Key-first multilingual data; retain literal keys with an inferred type or satisfies.
 * @returns Lookup restricted to the catalog's string keys, with ordinary TranslateOptions.
 */
export function createTypedTranslate<Catalog extends MultilingualData>(
  translator: Translator,
  catalog: Catalog,
): (key: Extract<keyof Catalog, string>, options?: TranslateOptions) => string;
/** Delegates typed lookup to the live translator without capturing any catalog state. */
export function createTypedTranslate(
  translator: Translator,
  _catalog?: MultilingualData,
): (key: string, options?: TranslateOptions) => string {
  return (key, options) => translator.translateKey(key, options);
}

/**
 * Canonicalizes a BCP 47 tag using Intl after trimming and replacing underscores with hyphens.
 *
 * @param language - Language tag to normalize; no registry membership is required.
 * @returns Canonical language tag.
 * @throws TypeError if the input is not a string.
 * @throws RangeError if the trimmed tag is empty or Intl rejects its syntax.
 */
export function normalizeLanguageTag(language: string): string {
  if (typeof language !== "string") throw new TypeError("Language tag must be a string");
  const normalized = language.trim().replaceAll("_", "-");
  if (!normalized) throw new RangeError("Language tag must not be empty");
  return Intl.getCanonicalLocales(normalized)[0];
}

/** Builds a progressively truncated lookup chain; absent or invalid tags yield no candidates. */
function languageLookupChain(language: string | null | undefined): string[] {
  if (!language) return [];
  let canonical: string;
  try {
    canonical = normalizeLanguageTag(language);
  } catch {
    return [];
  }
  return canonicalLanguageLookupChain(canonical);
}

/** Removes one trailing subtag at a time from an already canonical language tag. */
function canonicalLanguageLookupChain(canonical: string): string[] {
  const chain: string[] = [];
  const parts = canonical.split("-");
  while (parts.length > 0) {
    chain.push(parts.join("-"));
    parts.pop();
  }
  return chain;
}

/** Creates independent zeroed counters and an empty issue list for one import. */
function freshReport(): TranslationImportReport {
  return { importedKeys: 0, importedValues: 0, importedLanguages: 0, issues: [] };
}

/** Copies both map levels while preserving key and language insertion order. */
function cloneTranslations(
  source: ReadonlyMap<string, ReadonlyMap<string, string>>,
): Map<string, Map<string, string>> {
  const clone = new Map<string, Map<string, string>>();
  for (const [key, languages] of source) clone.set(key, new Map(languages));
  return clone;
}

/** Accepts plain records, including null-prototype and foreign-realm records, but not arrays. */
function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype === null || prototype === Object.prototype) return true;
  // A foreign realm's Object.prototype has its own native Object constructor.
  const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor")?.value;
  return (
    Object.getPrototypeOf(prototype) === null &&
    typeof constructor === "function" &&
    Function.prototype.toString.call(constructor) === Function.prototype.toString.call(Object)
  );
}

/** Compares values and language order, which determines arbitrary-language fallback. */
function sameTranslationValues(
  left: ReadonlyMap<string, string> | undefined,
  right: ReadonlyMap<string, string> | null | undefined,
): boolean {
  if (!left || !right) return !left && !right;
  if (left.size !== right.size) return false;
  const entries = right.entries();
  for (const [language, value] of left) {
    const entry = entries.next().value;
    if (!entry || entry[0] !== language || entry[1] !== value) return false;
  }
  return true;
}

/** Validates the required namespace/catalog envelope, recording issues instead of throwing. */
function unwrapTranslationData(
  value: unknown,
  report: TranslationImportReport,
): Record<string, unknown> | null {
  if (!isRecord(value)) {
    report.issues.push({
      path: "",
      code: "invalid-root",
      message: "Translation data root must be a plain object.",
    });
    return null;
  }
  if (!Object.prototype.hasOwnProperty.call(value, I18N_ROOT_KEY)) {
    report.issues.push({
      path: "",
      code: "invalid-root",
      message: `Translation data must contain the '${I18N_ROOT_KEY}' root property.`,
    });
    return null;
  }
  const wrapped = value[I18N_ROOT_KEY];
  if (!isRecord(wrapped)) {
    report.issues.push({
      path: I18N_ROOT_KEY,
      code: "invalid-root",
      message: `Translation data '${I18N_ROOT_KEY}' value must be a plain object.`,
    });
    return null;
  }
  if (
    !Object.prototype.hasOwnProperty.call(wrapped, MULTILINGUAL_DATA_KEY) &&
    !Object.prototype.hasOwnProperty.call(wrapped, LANGUAGE_DATA_KEY)
  ) {
    report.issues.push({
      path: I18N_ROOT_KEY,
      code: "invalid-root",
      message: `Translation data '${I18N_ROOT_KEY}' must contain '${MULTILINGUAL_DATA_KEY}' or '${LANGUAGE_DATA_KEY}'.`,
    });
    return null;
  }
  return wrapped;
}

/** Joins validated string arrays without separators, leaving strings unchanged. */
function stringifyValue(value: TranslationValue): string {
  return typeof value === "string" ? value : value.join("");
}

/** Validates programmer-controlled missing-value policy before changing state. */
function validateMissingPolicy(policy: MissingTranslationPolicy): void {
  if (!["empty", "key", "bracketed", "text", "throw"].includes(policy)) {
    throw new TypeError(`Translator: unsupported missing translation policy: ${String(policy)}`);
  }
}

/** Validates and detaches import options, including source replacement primitives. */
function snapshotImportOptions(options: TranslationImportOptions): TranslationImportOptions {
  if (!isRecord(options)) throw new TypeError("Translator: import options must be a plain object");
  const mode = options.mode === undefined ? "merge" : options.mode;
  const languageMode = options.languageMode === undefined ? "merge" : options.languageMode;
  if (mode !== "merge" && mode !== "replace-keys" && mode !== "replace-all") {
    throw new TypeError(`Translator: unsupported translation import mode: ${String(mode)}`);
  }
  if (languageMode !== "merge" && languageMode !== "replace" && languageMode !== "ignore") {
    throw new TypeError(`Translator: unsupported language import mode: ${String(languageMode)}`);
  }
  const replacements: Record<string, string | number | boolean | null | undefined> =
    Object.create(null);
  if (options.replacements !== undefined) {
    if (!isRecord(options.replacements)) {
      throw new TypeError("Translator: replacements must be a plain object");
    }
    for (const [key, value] of Object.entries(options.replacements)) {
      if (value != null && !["string", "number", "boolean"].includes(typeof value)) {
        throw new TypeError("Translator: replacement values must be primitives");
      }
      replacements[key] = value as string | number | boolean | null | undefined;
    }
  }
  return { mode, languageMode, replacements };
}

/**
 * DOM-free translation store, language resolver, interpolation service, and locale formatter.
 * Catalog languages and selectable-language metadata are independent. Translation values are
 * plain text; consumers remain responsible for safe rendering in their chosen context.
 */
export class Translator {
  readonly #translations = new Map<string, Map<string, string>>();
  readonly #languages = new Map<string, LanguageInfo>();
  readonly #listeners = new Set<(event: LanguageChangeEvent) => void>();
  readonly #languageChanges: LanguageChangeEvent[] = [];
  #emittingLanguageChange = false;
  readonly #languageRegistryListeners = new Set<(event: LanguageRegistryChangeEvent) => void>();
  #emittingLanguageRegistryChange = false;
  #languageRegistryChangePending = false;
  #languageRegistryRevision = 0;
  readonly #catalogListeners = new Set<(event: TranslationCatalogChangeEvent) => void>();
  #catalogRevision = 0;
  #emittingCatalogChange = false;
  #catalogChangePending = false;
  #language: string;
  #fallbackLanguage: string;
  #missingTranslationPolicy: MissingTranslationPolicy;
  #missingTranslationText: string;
  #fallbackToAnyLanguage: boolean;
  #logger: TranslatorLogger | null;
  #fetch: TranslatorFetch | null;
  #defaultLanguageCandidates: readonly string[] = [];

  /**
   * Creates an empty catalog and registers English display metadata without browser globals.
   *
   * @param options - Configuration; active/fallback tags default to `en`, missing policy to
   * `empty`, missing text to `MISSING`, and arbitrary-language fallback to true.
   * @throws TypeError for invalid configuration types or an unsupported missing policy.
   * @throws RangeError for empty or syntactically invalid language tags.
   */
  public constructor(options: TranslatorOptions = {}) {
    if (!isRecord(options as unknown))
      throw new TypeError("Translator: options must be a plain object");
    this.#language = normalizeLanguageTag(options.language === undefined ? "en" : options.language);
    this.#fallbackLanguage = normalizeLanguageTag(
      options.fallbackLanguage === undefined ? "en" : options.fallbackLanguage,
    );
    this.#missingTranslationPolicy =
      options.missingTranslationPolicy === undefined ? "empty" : options.missingTranslationPolicy;
    this.#missingTranslationText =
      options.missingTranslationText === undefined ? "MISSING" : options.missingTranslationText;
    this.#fallbackToAnyLanguage =
      options.fallbackToAnyLanguage === undefined ? true : options.fallbackToAnyLanguage;
    validateMissingPolicy(this.#missingTranslationPolicy);
    if (typeof this.#missingTranslationText !== "string") {
      throw new TypeError("Translator: missing translation text must be a string");
    }
    if (typeof this.#fallbackToAnyLanguage !== "boolean") {
      throw new TypeError("Translator: fallbackToAnyLanguage must be a boolean");
    }
    if (options.logger !== undefined && typeof options.logger !== "function") {
      throw new TypeError("Translator: logger must be a function when provided");
    }
    this.#logger = options.logger ?? null;
    this.#fetch = options.fetch ?? null;
    if (this.#fetch !== null && typeof this.#fetch !== "function") {
      throw new TypeError("Translator: fetch must be a function or null");
    }
    this.#refreshDefaultLanguageCandidates();
    this.addLanguage({ code: "en", nativeName: "English", englishName: "English" });
  }

  /**
   * Returns the active canonical language tag.
   * @returns Current tag, independent of registry membership and translation availability.
   */
  public getLanguage(): string {
    return this.#language;
  }

  /**
   * Changes language and notifies subscribers. Reentrant calls queue every transition FIFO;
   * queued state becomes active only after the current event finishes notifying subscribers.
   * Listener exceptions and promise rejections are logged without interrupting delivery.
   *
   * @param language - Tag to canonicalize; no catalog or registry membership is required.
   * @param options - Set force to true to refresh even an unchanged tag; defaults to false.
   * @returns Whether a transition or forced refresh was accepted, including a queued one.
   * @throws TypeError for invalid language/options types.
   * @throws RangeError for an empty or syntactically invalid language tag.
   */
  public setLanguage(language: string, options: { force?: boolean } = {}): boolean {
    if (!isRecord(options) || (options.force !== undefined && typeof options.force !== "boolean")) {
      throw new TypeError("Translator: language options must contain an optional boolean force");
    }
    const normalized = normalizeLanguageTag(language);
    const previousLanguage = this.#languageChanges.at(-1)?.language ?? this.#language;
    const forced = options.force === true;
    if (normalized === previousLanguage && !forced) return false;
    this.#languageChanges.push(Object.freeze({ language: normalized, previousLanguage, forced }));
    if (this.#emittingLanguageChange) return true;
    this.#emittingLanguageChange = true;
    try {
      while (this.#languageChanges.length > 0) {
        const event = this.#languageChanges.shift()!;
        this.#language = event.language;
        this.#refreshDefaultLanguageCandidates();
        /** Reports isolated failures from the current language-change notification. */
        const reportFailure = (error: unknown): void => {
          emitTranslatorLog(
            this.#logger,
            "error",
            "translator",
            "language-change-listener-failed",
            "A language-change listener failed.",
            { ...event },
            error,
          );
        };
        for (const listener of [...this.#listeners]) {
          try {
            observeCallbackResult(listener(event), reportFailure);
          } catch (error) {
            reportFailure(error);
          }
        }
      }
    } finally {
      this.#emittingLanguageChange = false;
    }
    return true;
  }

  /**
   * Returns the configured canonical fallback language.
   * @returns Fallback tag used after requested and active language candidates.
   */
  public getFallbackLanguage(): string {
    return this.#fallbackLanguage;
  }

  /**
   * Sets the language used after requested and active language lookup fail, without emitting events.
   * @param language - Fallback tag to canonicalize.
   * @throws TypeError for a non-string tag; RangeError for an empty or invalid tag.
   */
  public setFallbackLanguage(language: string): void {
    this.#fallbackLanguage = normalizeLanguageTag(language);
    this.#refreshDefaultLanguageCandidates();
  }

  /**
   * Registers detached, frozen display metadata, replacing metadata for an existing canonical tag.
   * Effective changes notify registry subscribers; existing registration order is preserved.
   * @param language - Tag and optional names/direction; translations and active tags are unchanged.
   * @throws TypeError for invalid metadata types/direction; RangeError for an empty or invalid tag.
   */
  public addLanguage(language: LanguageInfo): void {
    if (!isRecord(language) || typeof language.code !== "string") {
      throw new TypeError("Translator: language must contain a string code");
    }
    if (language.nativeName !== undefined && typeof language.nativeName !== "string") {
      throw new TypeError("Translator: language nativeName must be a string when provided");
    }
    if (language.englishName !== undefined && typeof language.englishName !== "string") {
      throw new TypeError("Translator: language englishName must be a string when provided");
    }
    if (
      language.direction !== undefined &&
      language.direction !== "ltr" &&
      language.direction !== "rtl"
    ) {
      throw new TypeError("Translator: language direction must be ltr or rtl when provided");
    }
    const code = normalizeLanguageTag(language.code);
    const info = Object.freeze({
      code,
      ...(language.nativeName === undefined ? {} : { nativeName: language.nativeName }),
      ...(language.englishName === undefined ? {} : { englishName: language.englishName }),
      ...(language.direction === undefined ? {} : { direction: language.direction }),
    });
    const previous = this.#languages.get(code);
    if (
      previous &&
      previous.nativeName === info.nativeName &&
      previous.englishName === info.englishName &&
      previous.direction === info.direction
    ) {
      return;
    }
    this.#languages.set(code, info);
    this.#emitLanguageRegistryChange();
  }

  /**
   * Returns an immutable registry snapshot in registration order.
   * @returns Frozen array of frozen language records, detached from future registry changes.
   */
  public getLanguages(): readonly Readonly<LanguageInfo>[] {
    return Object.freeze([...this.#languages.values()]);
  }

  /**
   * Removes display metadata without changing translations or active languages.
   * @param language - Tag to canonicalize and remove.
   * @returns Whether metadata existed; only successful removal notifies registry subscribers.
   * @throws TypeError for a non-string tag; RangeError for an empty or invalid tag.
   */
  public removeLanguage(language: string): boolean {
    const removed = this.#languages.delete(normalizeLanguageTag(language));
    if (removed) this.#emitLanguageRegistryChange();
    return removed;
  }

  /** Clears all display metadata; notifies only when nonempty, leaving catalogs/active tags intact. */
  public clearLanguages(): void {
    if (this.#languages.size === 0) return;
    this.#languages.clear();
    this.#emitLanguageRegistryChange();
  }

  /**
   * Looks through the requested tag's truncated chain, then the configured fallback chain.
   * @param language - Requested tag; defaults to the active tag.
   * @returns First registered native name, English name, or code; otherwise the canonical input.
   * @throws TypeError or RangeError for invalid input only if no registered candidate was found.
   */
  public getLanguageDisplayName(language: string = this.#language): string {
    for (const candidate of [
      ...languageLookupChain(language),
      ...languageLookupChain(this.#fallbackLanguage),
    ]) {
      const info = this.#languages.get(candidate);
      if (info) return info.nativeName || info.englishName || info.code;
    }
    return normalizeLanguageTag(language);
  }

  /**
   * Subscribes synchronously to future language changes, without an initial notification.
   * @param listener - Receives frozen events; throws/rejections are logged, promises not awaited.
   * @returns Idempotent unsubscribe function; registering the same function twice is deduplicated.
   * @throws TypeError if listener is not a function.
   */
  public subscribe(listener: (event: LanguageChangeEvent) => void): () => void {
    if (typeof listener !== "function") {
      throw new TypeError("Translator: language-change listener must be a function");
    }
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Subscribes synchronously to future registry changes; nested changes coalesce to a new snapshot.
   * @param listener - Receives frozen events; throws/rejections are logged, promises not awaited.
   * @returns Idempotent unsubscribe function; no initial notification is delivered.
   * @throws TypeError if listener is not a function.
   */
  public subscribeLanguages(listener: (event: LanguageRegistryChangeEvent) => void): () => void {
    if (typeof listener !== "function") {
      throw new TypeError("Translator: language-registry listener must be a function");
    }
    this.#languageRegistryListeners.add(listener);
    return () => this.#languageRegistryListeners.delete(listener);
  }

  /**
   * Subscribes synchronously to future catalog changes; nested changes coalesce to the latest revision.
   * @param listener - Receives frozen events; throws/rejections are logged, promises not awaited.
   * @returns Idempotent unsubscribe function; no initial notification is delivered.
   * @throws TypeError if listener is not a function.
   */
  public subscribeCatalog(listener: (event: TranslationCatalogChangeEvent) => void): () => void {
    if (typeof listener !== "function") {
      throw new TypeError("Translator: catalog-change listener must be a function");
    }
    this.#catalogListeners.add(listener);
    return () => this.#catalogListeners.delete(listener);
  }

  /**
   * Updates the missing-translation policy without emitting change events.
   * @param policy - Empty, key, bracketed key, configured text, or throwing behavior.
   * @throws TypeError for an unsupported policy, leaving the previous policy unchanged.
   */
  public setMissingTranslationPolicy(policy: MissingTranslationPolicy): void {
    validateMissingPolicy(policy);
    this.#missingTranslationPolicy = policy;
  }

  /**
   * Updates the literal text returned by the `text` missing-translation policy.
   * @param text - Missing text, not subject to interpolation.
   * @throws TypeError if text is not a string.
   */
  public setMissingTranslationText(text: string): void {
    if (typeof text !== "string") {
      throw new TypeError("Translator: missing translation text must be a string");
    }
    this.#missingTranslationText = text;
  }

  /**
   * Updates or clears the structured diagnostic sink.
   * @param logger - Synchronous diagnostic receiver, or null to disable logging.
   * @throws TypeError if logger is neither a function nor null.
   */
  public setLogger(logger: TranslatorLogger | null): void {
    if (logger !== null && typeof logger !== "function") {
      throw new TypeError("Translator: logger must be a function or null");
    }
    this.#logger = logger;
  }

  /**
   * Validates and imports a required-envelope bundle, concatenating arrays and canonicalizing tags.
   * Merge imports can accept valid parts despite issues. Issues abort replace-keys imports and
   * replace-all on a nonempty catalog, or metadata replacement on a nonempty registry when
   * the bundle supplies languages. These blocked imports leave both stores unchanged.
   * Effective catalog/registry changes notify subscribers after both stores are committed.
   *
   * @param data - Untrusted bundle containing `translator-i18n` and at least one catalog property.
   * @param options - Independent catalog/metadata modes (both default to merge) and replacements.
   * @returns Accepted-entry counts and validation issues; data validation is reported, not thrown.
   * @throws TypeError for invalid options, modes, or nonprimitive replacement values.
   */
  public importTranslations(
    data: TranslationBundle | unknown,
    options: TranslationImportOptions = {},
  ): TranslationImportReport {
    options = snapshotImportOptions(options);
    const mode = options.mode!;
    const languageMode = options.languageMode!;
    const report = freshReport();
    const root = unwrapTranslationData(data, report);
    if (!root) {
      this.#logImport(report);
      return report;
    }

    const incoming = new Map<string, Map<string, string>>();
    const incomingLanguages = new Map<string, LanguageInfo>();
    const hasLanguageRegistry = Object.prototype.hasOwnProperty.call(root, LANGUAGES_KEY);
    const validKeys = new Set<string>();
    const normalizedLanguages = new Map<string, string | null>();
    const replacements = Object.entries(options.replacements ?? {})
      .filter(([key]) => key.length > 0)
      .map(([key, value]) => [key, value == null ? "" : String(value)] as const)
      .sort((a, b) => b[0].length - a[0].length);

    /** Caches canonical tags or invalid-tag sentinels for this import. */
    const normalizeImportedLanguage = (rawLanguage: string): string | null => {
      if (normalizedLanguages.has(rawLanguage)) return normalizedLanguages.get(rawLanguage)!;
      let language: string | null;
      try {
        language = normalizeLanguageTag(rawLanguage);
      } catch {
        language = null;
      }
      // Catalogs repeat a small set of tags for many keys, so normalize each spelling once.
      normalizedLanguages.set(rawLanguage, language);
      return language;
    };

    /** Validates, replaces, and stages one value, counting accepted occurrences including overwrites. */
    const addValue = (key: string, language: string, rawValue: unknown, path: string): boolean => {
      let validValue = typeof rawValue === "string";
      if (Array.isArray(rawValue)) {
        validValue = true;
        for (let index = 0; index < rawValue.length; index++) {
          if (
            !Object.prototype.hasOwnProperty.call(rawValue, index) ||
            typeof rawValue[index] !== "string"
          ) {
            validValue = false;
            break;
          }
        }
      }
      if (!validValue) {
        report.issues.push({
          path,
          code: "invalid-value",
          message: "Translation value must be a string or an array of strings.",
        });
        return false;
      }
      let value = stringifyValue(rawValue as TranslationValue);
      for (const [from, to] of replacements) value = value.replaceAll(from, () => to);
      const languages = incoming.get(key) ?? new Map<string, string>();
      languages.set(language, value);
      incoming.set(key, languages);
      validKeys.add(key);
      report.importedValues++;
      return true;
    };

    if (languageMode !== "ignore" && hasLanguageRegistry) {
      const rawLanguages = root[LANGUAGES_KEY];
      if (!isRecord(rawLanguages)) {
        report.issues.push({
          path: `${I18N_ROOT_KEY}.${LANGUAGES_KEY}`,
          code: "invalid-language-registry",
          message: "Language registry data must be a plain object.",
        });
      } else {
        for (const [rawCode, rawMetadata] of Object.entries(rawLanguages)) {
          const path = `${I18N_ROOT_KEY}.${LANGUAGES_KEY}.${rawCode}`;
          const code = normalizeImportedLanguage(rawCode);
          if (code === null) {
            report.issues.push({
              path,
              code: "invalid-language",
              message: "Language tag must be a valid non-empty BCP 47 tag.",
            });
            continue;
          }
          if (
            !isRecord(rawMetadata) ||
            Object.keys(rawMetadata).some(
              name => name !== "nativeName" && name !== "englishName" && name !== "direction",
            ) ||
            (rawMetadata.nativeName !== undefined && typeof rawMetadata.nativeName !== "string") ||
            (rawMetadata.englishName !== undefined &&
              typeof rawMetadata.englishName !== "string") ||
            (rawMetadata.direction !== undefined &&
              rawMetadata.direction !== "ltr" &&
              rawMetadata.direction !== "rtl")
          ) {
            report.issues.push({
              path,
              code: "invalid-language-metadata",
              message:
                "Language metadata must contain only optional string display names and direction (ltr or rtl).",
            });
            continue;
          }
          incomingLanguages.set(
            code,
            Object.freeze({
              code,
              ...(rawMetadata.nativeName === undefined
                ? {}
                : { nativeName: rawMetadata.nativeName }),
              ...(rawMetadata.englishName === undefined
                ? {}
                : { englishName: rawMetadata.englishName }),
              ...(rawMetadata.direction === undefined ? {} : { direction: rawMetadata.direction }),
            }),
          );
          report.importedLanguages++;
        }
      }
    }

    for (const [bundleName, rawBundle] of Object.entries(root)) {
      if (bundleName !== MULTILINGUAL_DATA_KEY && bundleName !== LANGUAGE_DATA_KEY) continue;
      const bundlePath = `${I18N_ROOT_KEY}.${bundleName}`;
      if (!isRecord(rawBundle)) {
        report.issues.push({
          path: bundlePath,
          code: "invalid-data-bundle",
          message: `Translation data '${bundleName}' must be a plain object.`,
        });
        continue;
      }

      if (bundleName === MULTILINGUAL_DATA_KEY) {
        for (const [key, rawLanguages] of Object.entries(rawBundle)) {
          const keyPath = `${bundlePath}.${key}`;
          if (key.length === 0) {
            report.issues.push({
              path: keyPath,
              code: "invalid-key",
              message: "Translation key must not be empty.",
            });
            continue;
          }
          if (!isRecord(rawLanguages)) {
            report.issues.push({
              path: keyPath,
              code: "invalid-key-bundle",
              message: "Translation key value must be a plain language map object.",
            });
            continue;
          }
          if (Object.keys(rawLanguages).length === 0) {
            incoming.set(key, incoming.get(key) ?? new Map<string, string>());
            validKeys.add(key);
          }
          for (const [rawLanguage, rawValue] of Object.entries(
            rawLanguages as TranslationLanguageMap,
          )) {
            const language = normalizeImportedLanguage(rawLanguage);
            if (language === null) {
              report.issues.push({
                path: `${keyPath}.${rawLanguage}`,
                code: "invalid-language",
                message: "Language tag must be a valid non-empty BCP 47 tag.",
              });
              continue;
            }
            addValue(key, language, rawValue, `${keyPath}.${rawLanguage}`);
          }
        }
        continue;
      }

      for (const [rawLanguage, rawTranslations] of Object.entries(rawBundle)) {
        const languagePath = `${bundlePath}.${rawLanguage}`;
        const language = normalizeImportedLanguage(rawLanguage);
        if (language === null) {
          report.issues.push({
            path: languagePath,
            code: "invalid-language",
            message: "Language tag must be a valid non-empty BCP 47 tag.",
          });
          continue;
        }
        if (!isRecord(rawTranslations)) {
          report.issues.push({
            path: languagePath,
            code: "invalid-language-bundle",
            message: "Language value must be a plain translation key map object.",
          });
          continue;
        }
        for (const [key, rawValue] of Object.entries(rawTranslations)) {
          if (key.length === 0) {
            report.issues.push({
              path: `${languagePath}.${key}`,
              code: "invalid-key",
              message: "Translation key must not be empty.",
            });
            continue;
          }
          addValue(key, language, rawValue, `${languagePath}.${key}`);
        }
      }
    }
    report.importedKeys = validKeys.size;

    const destructiveImportBlocked =
      report.issues.length > 0 &&
      (mode === "replace-keys" ||
        (mode === "replace-all" && this.#translations.size > 0) ||
        (hasLanguageRegistry && languageMode === "replace" && this.#languages.size > 0));
    if (destructiveImportBlocked) {
      report.issues.push({
        path: "",
        code: "destructive-import-aborted",
        message: `The ${mode} import was not applied because the bundle contains validation issues.`,
      });
      report.importedKeys = 0;
      report.importedValues = 0;
      report.importedLanguages = 0;
      this.#logImport(report, mode);
      return report;
    }
    if (validKeys.size === 0 && incomingLanguages.size === 0 && report.issues.length > 0) {
      this.#logImport(report, mode);
      return report;
    }

    const updates = new Map<string, Map<string, string> | null>();
    for (const key of validKeys) {
      const languages = incoming.get(key) ?? new Map<string, string>();
      if (mode === "merge") {
        const merged = new Map(this.#translations.get(key));
        for (const [language, value] of languages) merged.set(language, value);
        updates.set(key, merged.size > 0 ? merged : null);
      } else {
        updates.set(key, languages.size > 0 ? languages : null);
      }
    }

    // Prepare every affected map before committing, without copying unrelated catalog entries.
    const catalogChanged =
      (mode === "replace-all" &&
        this.#translations.size !== [...updates.values()].filter(Boolean).length) ||
      [...updates].some(
        ([key, languages]) => !sameTranslationValues(this.#translations.get(key), languages),
      );
    if (mode === "replace-all") this.#translations.clear();
    for (const [key, languages] of updates) {
      if (languages) this.#translations.set(key, languages);
      else this.#translations.delete(key);
    }
    let registryChanged = false;
    if (languageMode !== "ignore" && hasLanguageRegistry) {
      const previousLanguages = this.getLanguages();
      if (languageMode === "replace") this.#languages.clear();
      for (const [code, info] of incomingLanguages) this.#languages.set(code, info);
      registryChanged = !this.#sameLanguages(previousLanguages, this.getLanguages());
    }
    const registryRevision = this.#languageRegistryRevision;
    if (catalogChanged) this.#emitCatalogChange();
    // A catalog callback may already have notified the registry's final committed state.
    if (registryChanged && this.#languageRegistryRevision === registryRevision) {
      this.#emitLanguageRegistryChange();
    }
    this.#logImport(report, mode);
    return report;
  }

  /**
   * Replaces all languages for one key without retaining caller-owned maps; an empty map removes it.
   * @param key - Nonempty translation key.
   * @param translations - Plain language record or map-like ReadonlyMap of string values.
   * @returns Replacement import report; invalid tags/values abort replacement and preserve the key.
   * @throws TypeError for an invalid key, container, or malformed map entry.
   */
  public setTranslation(
    key: string,
    translations: Readonly<Record<string, string>> | ReadonlyMap<string, string>,
  ): TranslationImportReport {
    if (typeof key !== "string" || key.length === 0) {
      throw new TypeError("Translator: translation key must be a non-empty string");
    }
    const mapLike = translations as ReadonlyMap<string, string> | null;
    const isMap =
      mapLike !== null &&
      typeof mapLike === "object" &&
      typeof mapLike.entries === "function" &&
      typeof mapLike.get === "function" &&
      typeof mapLike.has === "function";
    if (!isMap && !isRecord(translations)) {
      throw new TypeError("Translator: translations must be a plain record or a ReadonlyMap");
    }
    const languageRecord: Record<string, string> = Object.create(null);
    const entries = isMap ? mapLike!.entries() : Object.entries(translations);
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string") {
        throw new TypeError(
          "Translator: translation entries must contain a string language and value",
        );
      }
      const [language, value] = entry;
      languageRecord[language] = value;
    }
    return this.importTranslations(
      { [I18N_ROOT_KEY]: { [MULTILINGUAL_DATA_KEY]: { [key]: languageRecord } } },
      { mode: "replace-keys" },
    );
  }

  /**
   * Returns a defensive snapshot of all translations.
   * @returns Independent outer/inner maps in insertion order; not runtime-frozen despite readonly types.
   */
  public getTranslationData(): ReadonlyMap<string, ReadonlyMap<string, string>> {
    return cloneTranslations(this.#translations);
  }

  /**
   * Copies selected state once, without sharing mutable data, listeners, logger, fetch, or policies.
   * Commits selected catalogs/metadata and fallback before active-language notification.
   * @param source - Translator whose state is snapshotted; later source changes are not followed.
   * @param options - Copies catalogs/metadata by default, not active/fallback tags; defaults to merge.
   * @throws TypeError for a non-Translator source, invalid options, flags, or mode.
   */
  public copyFrom(source: Translator, options: TranslatorCopyOptions = {}): void {
    if (source === null || typeof source !== "object" || !(#translations in source)) {
      throw new TypeError("Translator: copy source must be a Translator instance");
    }
    if (!isRecord(options)) throw new TypeError("Translator: copy options must be a plain object");
    const {
      translations = true,
      languageMetadata = true,
      activeLanguage = false,
      fallbackLanguage = false,
      mode = "merge",
    } = options;
    for (const [name, value] of Object.entries({
      translations,
      languageMetadata,
      activeLanguage,
      fallbackLanguage,
    })) {
      if (typeof value !== "boolean") {
        throw new TypeError(`Translator: copy option ${name} must be a boolean`);
      }
    }
    if (mode !== "merge" && mode !== "replace") {
      throw new TypeError(`Translator: unsupported copy mode: ${String(mode)}`);
    }

    const incoming = translations
      ? cloneTranslations(source.#translations)
      : new Map<string, Map<string, string>>();
    if (translations && mode === "merge") {
      for (const [key, values] of incoming) {
        const merged = new Map(this.#translations.get(key));
        for (const [language, value] of values) merged.set(language, value);
        incoming.set(key, merged);
      }
    }
    const catalogChanged =
      translations &&
      ((mode === "replace" && this.#translations.size !== incoming.size) ||
        [...incoming].some(
          ([key, values]) => !sameTranslationValues(this.#translations.get(key), values),
        ));
    const languages = new Map<string, LanguageInfo>();
    if (languageMetadata) {
      if (mode === "merge") {
        for (const [code, info] of this.#languages) languages.set(code, info);
      }
      for (const [code, info] of source.#languages) {
        languages.set(code, Object.freeze({ ...info }));
      }
    }
    const registryChanged =
      languageMetadata && !this.#sameLanguages(this.getLanguages(), [...languages.values()]);
    const language = source.#language;
    const fallback = source.#fallbackLanguage;

    // Commit both stores and fallback before active-language subscribers can observe the copy.
    if (translations) {
      if (mode === "replace") this.#translations.clear();
      for (const [key, values] of incoming) this.#translations.set(key, values);
    }
    if (languageMetadata) {
      this.#languages.clear();
      for (const [code, info] of languages) this.#languages.set(code, info);
    }
    if (fallbackLanguage) this.setFallbackLanguage(fallback);
    const catalogRevision = this.#catalogRevision;
    const registryRevision = this.#languageRegistryRevision;
    if (activeLanguage) this.setLanguage(language);
    // Earlier callbacks may already have notified the final committed state.
    if (catalogChanged && this.#catalogRevision === catalogRevision) this.#emitCatalogChange();
    if (registryChanged && this.#languageRegistryRevision === registryRevision) {
      this.#emitLanguageRegistryChange();
    }
  }

  /** Clears all translations, notifying catalog subscribers only when nonempty; metadata is unchanged. */
  public clearTranslations(): void {
    if (this.#translations.size === 0) return;
    this.#translations.clear();
    this.#emitCatalogChange();
  }

  /**
   * Resolves requested, active, then fallback tags, truncating each one subtag at a time.
   * If enabled, arbitrary fallback uses the key's first stored language. Empty stored strings
   * count as translations; missing-policy output is not interpolated.
   * @param key - Translation key; an empty key returns empty text without missing diagnostics.
   * @param options - Optional first-choice language and interpolation values; interpolation defaults to true.
   * @returns Plain text with placeholders/doubled braces processed, or the configured missing result.
   * @throws TypeError for a nonboolean interpolate option; Error for missing keys under the throw policy.
   */
  public translateKey(key: string, options: TranslateOptions = {}): string {
    if (options.interpolate !== undefined && typeof options.interpolate !== "boolean") {
      throw new TypeError("Translator: interpolate must be a boolean when provided");
    }
    if (!key) return "";
    const languages = this.#translations.get(key);
    if (languages) {
      const candidates =
        options.language === undefined
          ? this.#defaultLanguageCandidates
          : this.#languageCandidates(options.language);
      for (const candidate of candidates) {
        if (languages.has(candidate)) {
          const value = languages.get(candidate)!;
          return options.interpolate === false ? value : interpolate(value, options.values);
        }
      }
      if (this.#fallbackToAnyLanguage) {
        const first = languages.values().next();
        if (!first.done) {
          return options.interpolate === false
            ? first.value
            : interpolate(first.value, options.values);
        }
      }
    }
    return this.#handleMissingTranslation(key);
  }

  /**
   * Formats a finite number using the active language unless overridden.
   * @param value - Finite numeric value.
   * @param options - Intl number options and optional language override; defaults to Intl defaults.
   * @returns Locale-formatted number.
   * @throws RangeError for nonfinite values; locale/Intl option errors are logged and rethrown.
   */
  public formatNumber(value: number, options: NumberFormatOptions = {}): string {
    return this.#format("number-format-failed", () =>
      formatNumberValue(value, this.#language, options),
    );
  }

  /**
   * Formats a signed relative amount in an explicit unit using the active language unless overridden.
   * @param value - Finite amount; negative means past and positive means future.
   * @param unit - Native singular or plural relative-time unit; no automatic unit selection occurs.
   * @param options - Intl relative-time options and locale override; defaults to long/numeric-always.
   * @returns Localized relative-time text; does not calculate date differences or update over time.
   * @throws RangeError for nonfinite values; locale/unit/Intl errors are logged and rethrown.
   */
  public formatRelativeTime(
    value: number,
    unit: Intl.RelativeTimeFormatUnit,
    options: RelativeTimeFormatOptions = {},
  ): string {
    return this.#format("relative-time-format-failed", () =>
      formatRelativeTimeValue(value, unit, this.#language, options),
    );
  }

  /**
   * Selects a plural category using the active language unless overridden; does not translate messages.
   * @param value - Finite number, including negative and fractional values.
   * @param options - Intl plural-rule/rounding options and locale override; defaults to cardinal rules.
   * @returns Native category `zero`, `one`, `two`, `few`, `many`, or `other`.
   * @throws RangeError for nonfinite values; locale/Intl option errors are logged and rethrown.
   */
  public selectPlural(value: number, options: PluralSelectOptions = {}): Intl.LDMLPluralRule {
    return this.#format("plural-select-failed", () =>
      selectPluralValue(value, this.#language, options),
    );
  }

  /**
   * Formats a finite amount with forced currency style and an uppercased currency code.
   * @param value - Finite currency amount.
   * @param options - Required three-letter currency code, Intl options, and optional language override.
   * @returns Locale-formatted amount using the active language unless overridden.
   * @throws RangeError for a nonfinite amount or malformed code; Intl errors are logged and rethrown.
   */
  public formatCurrency(value: number, options: CurrencyFormatOptions): string {
    return this.#format("currency-format-failed", () =>
      formatCurrencyValue(value, this.#language, options),
    );
  }

  /**
   * Formats an instant or calendar date; calendar-only values force UTC to avoid date shifts.
   * @param value - Valid Date, strict YYYY-MM-DD string, or integer calendar fields.
   * @param options - Intl date options and language override; without styles, numeric date fields default.
   * @returns Locale-formatted date; Date instants use the host time zone unless explicitly overridden.
   * @throws RangeError for invalid dates; locale/Intl option errors are logged and rethrown.
   */
  public formatDate(value: Date | string | CalendarDate, options: DateFormatOptions = {}): string {
    return this.#format("date-format-failed", () =>
      formatDateValue(value, this.#language, options),
    );
  }

  /**
   * Formats clock fields without time-zone conversion, defaulting to hour/minute and explicit seconds.
   * @param value - Strict HH:MM or HH:MM:SS string, or integer clock fields (seconds default to zero).
   * @param options - Zone-free Intl clock options and language override; short/medium styles are supported.
   * @returns Locale-formatted clock time using the active language unless overridden.
   * @throws RangeError for invalid clocks or forbidden date/zone options; Intl errors are logged and rethrown.
   */
  public formatTime(value: string | ClockTime, options: TimeFormatOptions = {}): string {
    return this.#format("time-format-failed", () =>
      formatTimeValue(value, this.#language, options),
    );
  }

  /**
   * Formats a weekday numbered Monday 0 through Sunday 6.
   * @param weekday - Integer from 0 to 6.
   * @param options - Name width (defaults to long) and optional language override.
   * @returns Localized weekday name using the active language unless overridden.
   * @throws RangeError for out-of-range weekdays; locale/Intl errors are logged and rethrown.
   */
  public formatWeekday(weekday: number, options: WeekdayFormatOptions = {}): string {
    return this.#format("weekday-format-failed", () =>
      formatWeekdayValue(weekday, this.#language, options),
    );
  }

  /**
   * Fetches JSON concurrently with no-cache, stages imports in URL order, then commits before events.
   * Replace-all catalogs and replace metadata apply only to the first file; later files merge.
   * Fetch/JSON failure or cancellation before commit leaves stores untouched by this load.
   * Validation issues remain per-file reports and do not reject the whole load.
   *
   * @param urls - Nonempty URL strings; an empty list returns no reports after option/abort validation.
   * @param options - Import options, fetch override, and optional native-compatible abort signal.
   * @returns One import report per URL in input order.
   * @throws TypeError for invalid options, URLs, fetch, or signal; Error if fetch is unavailable or
   * a response has ok false. Fetch/JSON failures and original abort reasons propagate as rejections.
   */
  public async loadTranslationFiles(
    urls: readonly string[],
    options: TranslationLoadOptions = {},
  ): Promise<readonly TranslationImportReport[]> {
    const importOptions = snapshotImportOptions(options);
    const signal = options.signal;
    const requestedFetch = options.fetch;
    const requestedUrls = [...urls];
    if (requestedUrls.some(url => typeof url !== "string" || url.length === 0)) {
      throw new TypeError("Translator: translation URLs must be non-empty strings");
    }
    if (requestedFetch !== undefined && typeof requestedFetch !== "function") {
      throw new TypeError("Translator: fetch must be a function when provided");
    }
    if (
      signal !== undefined &&
      (signal === null ||
        typeof signal !== "object" ||
        typeof signal.aborted !== "boolean" ||
        (signal.onabort !== null && typeof signal.onabort !== "function") ||
        typeof signal.throwIfAborted !== "function" ||
        typeof signal.addEventListener !== "function" ||
        typeof signal.removeEventListener !== "function" ||
        typeof signal.dispatchEvent !== "function")
    ) {
      throw new TypeError("Translator: signal must be an abort signal");
    }
    signal?.throwIfAborted();
    if (requestedUrls.length === 0) return [];
    const globalFetch = (globalThis as { fetch?: TranslatorFetch }).fetch;
    const fetchImpl =
      requestedFetch ??
      this.#fetch ??
      (typeof globalFetch === "function" ? globalFetch.bind(globalThis) : null);
    if (!fetchImpl) throw new Error("No fetch implementation is available");

    let responses: unknown[];
    try {
      signal?.throwIfAborted();
      responses = await Promise.all(
        requestedUrls.map(async url => {
          signal?.throwIfAborted();
          const response: TranslationFetchResponse = await fetchImpl(url, {
            cache: "no-cache",
            signal,
          });
          if (response.ok === false) {
            throw new Error(
              `Could not load translations from ${url}: ${response.status ?? "HTTP error"}${
                response.statusText ? ` ${response.statusText}` : ""
              }`,
            );
          }
          return response.json();
        }),
      );
      signal?.throwIfAborted();
    } catch (error) {
      signal?.throwIfAborted();
      emitTranslatorLog(
        this.#logger,
        "error",
        "translator",
        "translation-load-failed",
        "Translation file loading failed.",
        { urls: requestedUrls },
        error,
      );
      throw error;
    }

    // Staging has no subscribers or logger. Failed imports cannot expose temporary state or
    // roll back writes made by application callbacks; callbacks run only after the final commit.
    signal?.throwIfAborted();
    const staged = new Translator();
    for (const [key, languages] of this.#translations) staged.#translations.set(key, languages);
    staged.#languages.clear();
    for (const [code, info] of this.#languages) staged.#languages.set(code, info);
    const reports: TranslationImportReport[] = [];
    const modes: TranslationImportOptions["mode"][] = [];
    responses.forEach((data, index) => {
      const mode =
        index === 0 || importOptions.mode !== "replace-all" ? importOptions.mode : "merge";
      modes.push(mode);
      reports.push(
        staged.importTranslations(data, {
          mode,
          languageMode:
            index === 0 || importOptions.languageMode !== "replace"
              ? importOptions.languageMode
              : "merge",
          replacements: importOptions.replacements,
        }),
      );
    });
    const registryChanged = !this.#sameLanguages(this.getLanguages(), staged.getLanguages());
    const catalogChanged =
      this.#translations.size !== staged.#translations.size ||
      [...staged.#translations].some(
        ([key, languages]) => !sameTranslationValues(this.#translations.get(key), languages),
      );
    signal?.throwIfAborted();
    this.#translations.clear();
    for (const [key, languages] of staged.#translations) this.#translations.set(key, languages);
    this.#languages.clear();
    for (const [code, info] of staged.#languages) this.#languages.set(code, info);
    const registryRevision = this.#languageRegistryRevision;
    if (catalogChanged) this.#emitCatalogChange();
    if (registryChanged && this.#languageRegistryRevision === registryRevision) {
      this.#emitLanguageRegistryChange();
    }
    for (const [index, report] of reports.entries()) {
      this.#logImport(report, modes[index]);
    }
    return reports;
  }

  /** Logs a missing key and returns or throws according to the configured policy. */
  #handleMissingTranslation(key: string): string {
    emitTranslatorLog(
      this.#logger,
      "warn",
      "translator",
      "missing-translation",
      `Missing translation: ${key}`,
      { key, language: this.#language, fallbackLanguage: this.#fallbackLanguage },
    );
    switch (this.#missingTranslationPolicy) {
      case "key":
        return key;
      case "bracketed":
        return `[${key}]`;
      case "text":
        return this.#missingTranslationText;
      case "throw":
        throw new Error(`Missing translation: ${key}`);
      case "empty":
      default:
        return "";
    }
  }

  /** Prepends valid requested candidates to cached defaults, deduplicating in priority order. */
  #languageCandidates(requestedLanguage: string): readonly string[] {
    const candidates = new Set(languageLookupChain(requestedLanguage));
    for (const candidate of this.#defaultLanguageCandidates) candidates.add(candidate);
    return [...candidates];
  }

  /** Rebuilds the deduplicated active/fallback lookup chain after either tag changes. */
  #refreshDefaultLanguageCandidates(): void {
    // Active and fallback tags are already canonical, and change far less often than lookups occur.
    this.#defaultLanguageCandidates = [
      ...new Set([
        ...canonicalLanguageLookupChain(this.#language),
        ...canonicalLanguageLookupChain(this.#fallbackLanguage),
      ]),
    ];
  }

  /** Emits isolated registry snapshots, coalescing reentrant mutations into the next snapshot. */
  #emitLanguageRegistryChange(): void {
    this.#languageRegistryRevision++;
    if (this.#emittingLanguageRegistryChange) {
      this.#languageRegistryChangePending = true;
      return;
    }
    this.#emittingLanguageRegistryChange = true;
    try {
      do {
        this.#languageRegistryChangePending = false;
        const event: LanguageRegistryChangeEvent = Object.freeze({
          languages: this.getLanguages(),
        });
        /** Reports isolated failures from the current registry notification. */
        const reportFailure = (error: unknown): void => {
          emitTranslatorLog(
            this.#logger,
            "error",
            "translator",
            "language-registry-listener-failed",
            "A language-registry listener failed.",
            { languages: event.languages },
            error,
          );
        };
        for (const listener of [...this.#languageRegistryListeners]) {
          try {
            observeCallbackResult(listener(event), reportFailure);
          } catch (error) {
            reportFailure(error);
          }
        }
      } while (this.#languageRegistryChangePending);
    } finally {
      this.#emittingLanguageRegistryChange = false;
      this.#languageRegistryChangePending = false;
    }
  }

  /** Emits isolated synchronous catalog events, coalescing nested mutations. */
  #emitCatalogChange(): void {
    this.#catalogRevision++;
    if (this.#emittingCatalogChange) {
      this.#catalogChangePending = true;
      return;
    }
    this.#emittingCatalogChange = true;
    try {
      do {
        this.#catalogChangePending = false;
        const event: TranslationCatalogChangeEvent = Object.freeze({
          revision: this.#catalogRevision,
        });
        /** Reports isolated failures from the current catalog notification. */
        const reportFailure = (error: unknown): void => {
          emitTranslatorLog(
            this.#logger,
            "error",
            "translator",
            "catalog-change-listener-failed",
            "A catalog-change listener failed.",
            { revision: event.revision },
            error,
          );
        };
        for (const listener of [...this.#catalogListeners]) {
          try {
            observeCallbackResult(listener(event), reportFailure);
          } catch (error) {
            reportFailure(error);
          }
        }
      } while (this.#catalogChangePending);
    } finally {
      this.#emittingCatalogChange = false;
      this.#catalogChangePending = false;
    }
  }

  /** Compares registration order and all supported display metadata fields. */
  #sameLanguages(
    left: readonly Readonly<LanguageInfo>[],
    right: readonly Readonly<LanguageInfo>[],
  ): boolean {
    return (
      left.length === right.length &&
      left.every(
        (language, index) =>
          language.code === right[index]?.code &&
          language.nativeName === right[index]?.nativeName &&
          language.englishName === right[index]?.englishName &&
          language.direction === right[index]?.direction,
      )
    );
  }

  /** Runs a locale formatter, logging failures before rethrowing the original error. */
  #format<T extends string>(event: string, format: () => T): T {
    try {
      return format();
    } catch (error) {
      emitTranslatorLog(
        this.#logger,
        "error",
        "intl",
        event,
        "Locale formatting failed.",
        { language: this.#language },
        error,
      );
      throw error;
    }
  }

  /** Emits import counters/issues with severity and summary reflecting validation or rejection. */
  #logImport(report: TranslationImportReport, mode?: TranslationImportOptions["mode"]): void {
    const aborted = report.issues.some(issue => issue.code === "destructive-import-aborted");
    emitTranslatorLog(
      this.#logger,
      report.issues.length > 0 ? "warn" : "debug",
      "translator",
      report.issues.length > 0 ? "translation-import-issues" : "translation-imported",
      aborted
        ? "Translation import was rejected because a destructive import contained validation issues."
        : report.issues.length > 0
          ? "Translation data was imported with validation issues."
          : "Translation data was imported.",
      {
        mode: mode ?? "merge",
        importedKeys: report.importedKeys,
        importedValues: report.importedValues,
        importedLanguages: report.importedLanguages,
        issues: report.issues,
      },
    );
  }
}
