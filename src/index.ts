// SPDX-FileCopyrightText: 2020-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Public root entry for the DOM-free translator, locale formatting, semantic rich text, and types.
 * Browser binding is provided separately by `@unilarva/translator/dom`.
 *
 * SPDX-FileCopyrightText: 2020-2026 Lari Natri <lari.natri@iki.fi>
 * SPDX-License-Identifier: Apache-2.0
 *
 * @packageDocumentation
 * @module index
 * @author Lari Natri
 */

export { createTypedTranslate, normalizeLanguageTag, Translator } from "./translator.js";
export {
  formatCurrency,
  formatDate,
  formatNumber,
  formatRelativeTime,
  formatTime,
  formatWeekday,
  selectPlural,
} from "./intl.js";
export { parseRichText, translateRichText } from "./rich-text.js";
export type {
  CalendarDate,
  ClockTime,
  CurrencyFormatOptions,
  DateFormatOptions,
  LocaleFormatOptions,
  NumberFormatOptions,
  PluralSelectOptions,
  RelativeTimeFormatOptions,
  TimeFormatOptions,
  WeekdayFormatOptions,
} from "./intl.js";
export type {
  RichTextNode,
  RichTextTagNode,
  RichTextTextNode,
  TranslateRichTextOptions,
} from "./rich-text.js";
export type {
  LanguageData,
  LanguageChangeEvent,
  LanguageImportMode,
  LanguageInfo,
  LanguageMetadata,
  LanguageRegistryChangeEvent,
  LanguageRegistryData,
  LanguageTranslationMap,
  MissingTranslationPolicy,
  MultilingualData,
  TranslateOptions,
  TranslationAbortSignal,
  TranslationBundle,
  TranslationCatalogChangeEvent,
  TranslationFetchResponse,
  TranslationImportIssue,
  TranslationImportOptions,
  TranslationImportReport,
  TranslationInterpolationValue,
  TranslationLanguageMap,
  TranslationLoadOptions,
  TranslationRequestCache,
  TranslatorCopyOptions,
  TranslatorFetch,
  TranslatorLogComponent,
  TranslatorLogEntry,
  TranslatorLogger,
  TranslatorLogLevel,
  TranslatorOptions,
  TranslatorI18nRoot,
  TranslationValue,
} from "./types.js";
