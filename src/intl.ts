// SPDX-FileCopyrightText: 2020-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Package-private Intl formatting implementation used by `Translator`. Formatting
 * functions and input/option types are also publicly re-exported from
 * `@unilarva/translator`; validation and bounded formatter caches remain internal.
 * Unlike the translator's methods, these functions propagate errors without logging.
 *
 * SPDX-FileCopyrightText: 2020-2026 Lari Natri <lari.natri@iki.fi>
 * SPDX-License-Identifier: Apache-2.0
 *
 * @packageDocumentation
 * @module intl
 * @author Lari Natri
 */

/** A calendar date without time-zone or time-of-day semantics. */
export interface CalendarDate {
  /** Integer Gregorian year; the complete date must fit the native Date range. */
  year: number;
  /** One-based integer month from 1 through 12. */
  month: number;
  /** Integer day from 1 through the number of days in the given month and year. */
  day: number;
}

/** A clock time without date or time-zone semantics. */
export interface ClockTime {
  /** Integer hour from 0 through 23. */
  hour: number;
  /** Integer minute from 0 through 59. */
  minute: number;
  /** Integer second from 0 through 59; omitted defaults to zero, shown by default only if supplied on this clock or either range endpoint. */
  second?: number;
}

/** Locale override shared by formatting methods. */
export interface LocaleFormatOptions {
  /** Overrides the language argument; tags are trimmed, underscore-normalized, and canonicalized. */
  language?: string;
}

/** Number formatting options with an optional language override. */
export type NumberFormatOptions = Intl.NumberFormatOptions & LocaleFormatOptions;

/** Native relative-time options with a locale override; defaults to long, numeric-always output. */
export type RelativeTimeFormatOptions = Intl.RelativeTimeFormatOptions & LocaleFormatOptions;

/** Native plural-rule and rounding options with a locale override; defaults to cardinal rules. */
export type PluralSelectOptions = Intl.PluralRulesOptions & LocaleFormatOptions;

/** Currency formatting requires an explicit ISO 4217 currency code. */
export interface CurrencyFormatOptions extends Intl.NumberFormatOptions, LocaleFormatOptions {
  /** Required three-letter ASCII code, uppercased before formatting; existence is not checked. */
  currency: string;
}

const DATE_FORBIDDEN_OPTIONS = [
  "timeStyle",
  "hour",
  "minute",
  "second",
  "fractionalSecondDigits",
  "dayPeriod",
  "hour12",
  "hourCycle",
  "timeZone",
  "timeZoneName",
] as const;
type DateForbiddenOption = (typeof DATE_FORBIDDEN_OPTIONS)[number];

/**
 * Calendar-only native options and locale override. Clock and zone fields are
 * forbidden, including inherited or explicitly undefined properties at runtime.
 * Private UTC anchoring preserves calendar fields without time-zone conversion.
 */
export type DateFormatOptions = Omit<Intl.DateTimeFormatOptions, DateForbiddenOption> & {
  [Option in DateForbiddenOption]?: never;
} & LocaleFormatOptions;

/**
 * Native instant formatting options with a required explicit output zone. The zone
 * must be a nonblank primitive string supported by Intl; no host/UTC default is inferred.
 * Defaults to medium date and short time only when no styles or display components
 * are defined. Explicit styles/components replace those defaults; modifiers alone do not.
 */
export type DateTimeFormatOptions = Omit<Intl.DateTimeFormatOptions, "timeZone"> &
  LocaleFormatOptions & {
    /** Required output zone, independent of the Date's input offset and formatting locale. */
    timeZone: string;
  };

const CLOCK_FORBIDDEN_OPTIONS = [
  "dateStyle",
  "era",
  "year",
  "month",
  "day",
  "weekday",
  "timeZone",
  "timeZoneName",
] as const;
type ClockForbiddenOption = (typeof CLOCK_FORBIDDEN_OPTIONS)[number];

/**
 * Native clock-only options with an optional language override. Calendar and zone
 * fields are forbidden even when explicitly undefined; long/full styles are excluded
 * because they include a zone. Formatting internally uses UTC without conversion.
 */
export type TimeFormatOptions = Omit<
  Intl.DateTimeFormatOptions,
  ClockForbiddenOption | "timeStyle"
> & { [Option in ClockForbiddenOption]?: never } & {
  /** Optional style replacing default clock components; only `short` and `medium` are supported. */
  timeStyle?: "short" | "medium";
} & LocaleFormatOptions;

/** Single-weekday and recurring weekday-range width and optional language override. */
export interface WeekdayFormatOptions extends LocaleFormatOptions {
  /** Localized name width; defaults to `long`. */
  width?: "long" | "short" | "narrow";
  /** Forbidden, including inherited or explicitly undefined properties at runtime. */
  timeZone?: never;
  /** Forbidden: weekday output never exposes the private synthetic zone. */
  timeZoneName?: never;
}

// Bound both retained formatter count and key size because public options are caller-controlled.
const CACHE_LIMIT = 64;
const MAX_CACHE_KEY_LENGTH = 2048;
const numberFormatters = new Map<string, Intl.NumberFormat>();
const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();
const relativeTimeFormatters = new Map<string, Intl.RelativeTimeFormat>();
const pluralRules = new Map<string, Intl.PluralRules>();

/** Creates an order-independent primitive-options key, or skips unsafe/oversized caching. */
function formatterKey(language: string, options: object): string | undefined {
  const entries = Object.entries(options);
  // Object-valued coercions can be stateful, so only stable primitive option snapshots are cached.
  if (
    entries.some(
      ([, value]) =>
        value !== null &&
        value !== undefined &&
        typeof value !== "string" &&
        typeof value !== "boolean" &&
        !(typeof value === "number" && Number.isFinite(value)),
    )
  ) {
    return undefined;
  }
  entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  const key = JSON.stringify([
    language,
    entries.map(([name, value]) => [name, typeof value, value]),
  ]);
  return key.length <= MAX_CACHE_KEY_LENGTH ? key : undefined;
}

/** Inspects data properties without invoking getters; richer options retain native property reads. */
function nativeFormatterKey(language: string, options: object): string | undefined {
  const prototype = Object.getPrototypeOf(options);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(options);
  if (Object.values(descriptors).some(descriptor => !("value" in descriptor))) return undefined;
  return formatterKey(
    language,
    Object.fromEntries(
      Object.entries(descriptors)
        .filter(([name]) => name !== "language")
        .map(([name, descriptor]) => [name, descriptor.value]),
    ),
  );
}

/** Reuses or creates a formatter with bounded LRU eviction; undefined keys bypass the cache. */
function cachedFormatter<T>(cache: Map<string, T>, key: string | undefined, create: () => T): T {
  if (key === undefined) return create();
  const existing = cache.get(key);
  if (existing !== undefined) {
    cache.delete(key);
    cache.set(key, existing);
    return existing;
  }
  const formatter = create();
  // Refresh-on-hit above makes the first entry the least recently used one.
  if (cache.size === CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(key, formatter);
  return formatter;
}

/** Normalizes a locale tag and canonicalizes it; empty or invalid tags throw RangeError. */
function locale(language: string): string {
  const normalized = language.trim().replaceAll("_", "-");
  if (!normalized) throw new RangeError("Language tag must not be empty");
  return Intl.getCanonicalLocales(normalized)[0];
}

/** Returns a finite numeric input or throws a labeled RangeError. */
function finiteNumber(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be a finite number`);
  return value;
}

/** Validates a Gregorian calendar date anchored at UTC midnight; Date objects are not calendars. */
function parseCalendarDate(value: string | CalendarDate): Date {
  if (typeof value === "object" && value !== null) {
    let timestamp: number | undefined;
    try {
      // Native slots identify cross-realm Dates without consulting overridable methods.
      timestamp = Date.prototype.getTime.call(value);
    } catch {
      // CalendarDate records have no native Date slots.
    }
    if (timestamp !== undefined) {
      throw new RangeError(
        "Calendar date formatting does not accept Date instants; use formatDateTime",
      );
    }
  }
  let calendar: CalendarDate;
  if (typeof value === "string") {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) throw new RangeError("Date string must use YYYY-MM-DD format");
    calendar = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  } else {
    calendar = value as CalendarDate;
  }
  const { year, month, day } = calendar;
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new RangeError("Calendar date fields must be integers");
  }
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  // setUTCFullYear avoids the constructor's special handling of years 0 through 99.
  date.setUTCFullYear(year, month - 1, day);
  // Date normalizes overflowing fields, so round-trip them to reject impossible dates.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new RangeError("Calendar date is out of range");
  }
  return date;
}

/** Copies native Date slots without consulting overridable methods or input coercions. */
function detachInstant(value: Date): Date {
  let timestamp: number;
  try {
    timestamp = Date.prototype.getTime.call(value);
  } catch {
    throw new TypeError("Datetime formatting requires a Date instant");
  }
  if (!Number.isFinite(timestamp)) throw new RangeError("Date instant must be valid");
  return new Date(timestamp);
}

/** Validated clock fields retaining whether seconds should be included by default. */
interface ParsedClockTime extends Required<ClockTime> {
  /** Whether seconds were supplied, including an explicit zero. */
  hasExplicitSeconds: boolean;
}

/** Validates strict clock strings or integer fields; omitted seconds become zero. */
function parseClockTime(value: string | ClockTime): ParsedClockTime {
  let time: ClockTime;
  let hasExplicitSeconds: boolean;
  if (typeof value === "string") {
    const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
    if (!match) throw new RangeError("Time string must use HH:MM or HH:MM:SS format");
    hasExplicitSeconds = match[3] !== undefined;
    time = {
      hour: Number(match[1]),
      minute: Number(match[2]),
      second: match[3] === undefined ? undefined : Number(match[3]),
    };
  } else {
    time = value;
    hasExplicitSeconds = time.second !== undefined;
  }
  const second = time.second === undefined ? 0 : time.second;
  if (
    !Number.isInteger(time.hour) ||
    !Number.isInteger(time.minute) ||
    !Number.isInteger(second) ||
    time.hour < 0 ||
    time.hour > 23 ||
    time.minute < 0 ||
    time.minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    throw new RangeError("Clock time is out of range");
  }
  return { hour: time.hour, minute: time.minute, second, hasExplicitSeconds };
}

/**
 * Formats a finite number using native Intl options and locale defaults.
 *
 * @param value - Finite number to format.
 * @param language - Locale tag, unless overridden by `options.language`.
 * @param options - Native number options and optional locale override; defaults to `{}`.
 * @returns Localized number text.
 * @throws {RangeError} If the number is nonfinite or the effective locale/options are invalid.
 * @throws {TypeError} If native Intl rejects a required option or incompatible option combination.
 */
export function formatNumber(
  value: number,
  language: string,
  options: NumberFormatOptions = {},
): string {
  return numberFormatter(language, options).format(finiteNumber(value, "Number"));
}

/** Prepares the number option snapshot and reuses its formatter across result forms. */
function numberFormatter(language: string, options: NumberFormatOptions): Intl.NumberFormat {
  const { language: languageOverride, ...intlOptions } = options;
  const tag = locale(languageOverride ?? language);
  return cachedFormatter(
    numberFormatters,
    formatterKey(tag, intlOptions),
    () => new Intl.NumberFormat(tag, intlOptions),
  );
}

/**
 * Formats a finite number as native structured parts using Intl defaults.
 * @param value - Finite number; numeric strings and bigint are not accepted.
 * @param language - Locale tag, unless overridden by `options.language`.
 * @param options - Native number options and locale override; defaults to `{}`.
 * @returns Fresh, caller-owned mutable parts and records in native order; no HTML is produced.
 * @throws {RangeError} If the number is nonfinite or the effective locale/options are invalid.
 * @throws {TypeError} If Intl rejects options, or `Intl.NumberFormat.prototype.formatToParts`
 * is unavailable; use a supporting runtime or consumer-provided polyfill.
 */
export function formatNumberToParts(
  value: number,
  language: string,
  options: NumberFormatOptions = {},
): Intl.NumberFormatPart[] {
  const formatter = numberFormatter(language, options);
  const number = finiteNumber(value, "Number");
  if (typeof formatter.formatToParts !== "function") {
    throw new TypeError(
      "Intl.NumberFormat.prototype.formatToParts is unavailable; use a supporting runtime or consumer-provided polyfill",
    );
  }
  return formatter.formatToParts(number);
}

/**
 * Formats two finite numbers as a native localized range, without sorting or collapsing endpoints.
 * @param start - Finite starting number; numeric strings and bigint are not accepted.
 * @param end - Finite ending number; descending ranges, signed zero, and rounding retain native semantics.
 * @param language - Locale tag, unless overridden by `options.language`.
 * @param options - Native number options and locale override; defaults to Intl defaults.
 * @returns Native range text, including shared affixes and approximation for equal/rounded endpoints.
 * @throws {RangeError} If either endpoint is nonfinite or the effective locale/options are invalid.
 * @throws {TypeError} If Intl rejects options, or `Intl.NumberFormat.prototype.formatRange`
 * is unavailable; use a supporting runtime or consumer-provided polyfill.
 */
export function formatNumberRange(
  start: number,
  end: number,
  language: string,
  options: NumberFormatOptions = {},
): string {
  return numberRange(numberFormatter(language, options), start, end);
}

/** Validates numeric endpoints and checks only the requested native string-range capability. */
function numberRange(formatter: Intl.NumberFormat, start: number, end: number): string {
  finiteNumber(start, "Range start");
  finiteNumber(end, "Range end");
  if (typeof formatter.formatRange !== "function") {
    throw new TypeError(
      "Intl.NumberFormat.prototype.formatRange is unavailable; use a supporting runtime or consumer-provided polyfill",
    );
  }
  return formatter.formatRange(start, end);
}

/**
 * Formats two finite numbers as native structured range parts, without sorting or collapsing endpoints.
 * @param start - Finite starting number; numeric strings and bigint are not accepted.
 * @param end - Finite ending number; descending ranges, signed zero, and rounding retain native semantics.
 * @param language - Locale tag, unless overridden by `options.language`.
 * @param options - Native number options and locale override; defaults to Intl defaults.
 * @returns Fresh, caller-owned mutable parts and records, preserving native order, literals,
 * approximation signs, and `startRange`/`endRange`/`shared` sources; no HTML is produced.
 * @throws {RangeError} If either endpoint is nonfinite or the effective locale/options are invalid.
 * @throws {TypeError} If Intl rejects options, or `Intl.NumberFormat.prototype.formatRangeToParts`
 * is unavailable; use a supporting runtime or consumer-provided polyfill.
 */
export function formatNumberRangeToParts(
  start: number,
  end: number,
  language: string,
  options: NumberFormatOptions = {},
): Intl.NumberRangeFormatPart[] {
  return numberRangeParts(numberFormatter(language, options), start, end);
}

/** Validates numeric endpoints and returns fresh native parts after a call-time capability check. */
function numberRangeParts(
  formatter: Intl.NumberFormat,
  start: number,
  end: number,
): Intl.NumberRangeFormatPart[] {
  finiteNumber(start, "Range start");
  finiteNumber(end, "Range end");
  if (typeof formatter.formatRangeToParts !== "function") {
    throw new TypeError(
      "Intl.NumberFormat.prototype.formatRangeToParts is unavailable; use a supporting runtime or consumer-provided polyfill",
    );
  }
  return formatter.formatRangeToParts(start, end);
}

/**
 * Formats a signed relative amount in an explicit unit; does not calculate date differences.
 * Negative values describe the past and positive values the future, using native Intl defaults.
 *
 * @param value - Finite signed amount; fractions and negative zero retain native Intl semantics.
 * @param unit - Native singular or plural unit from year through second, including quarter and week.
 * @param language - Locale tag, unless overridden by `options.language`.
 * @param options - Native relative-time options and locale override; defaults to `{}`.
 * @returns Localized relative-time text, not a live clock or automatically chosen unit.
 * @throws {RangeError} If the amount is nonfinite or the effective locale, unit, or options are invalid.
 * @throws {TypeError} If native Intl rejects option or unit coercion.
 */
export function formatRelativeTime(
  value: number,
  unit: Intl.RelativeTimeFormatUnit,
  language: string,
  options: RelativeTimeFormatOptions = {},
): string {
  return relativeTimeFormatter(language, options).format(
    finiteNumber(value, "Relative time amount"),
    unit,
  );
}

/** Retains original native option reads while sharing the relative-time formatter cache. */
function relativeTimeFormatter(
  language: string,
  options: RelativeTimeFormatOptions,
): Intl.RelativeTimeFormat {
  const tag = locale(options.language ?? language);
  return cachedFormatter(
    relativeTimeFormatters,
    nativeFormatterKey(tag, options),
    () => new Intl.RelativeTimeFormat(tag, options),
  );
}

/**
 * Formats a signed relative amount in an explicit unit as native structured parts.
 * @param value - Finite amount; negative means past, positive means future, with native signed-zero semantics.
 * @param unit - Native singular or plural unit; no date difference or automatic unit selection occurs.
 * @param language - Locale tag, unless overridden by `options.language`.
 * @param options - Native options and locale override; defaults to long, numeric-always output.
 * @returns Fresh, caller-owned mutable parts and records; literals may lack `unit`. No HTML is produced.
 * @throws {RangeError} If the amount is nonfinite or the effective locale, unit, or options are invalid.
 * @throws {TypeError} If Intl rejects coercion, or `Intl.RelativeTimeFormat.prototype.formatToParts`
 * is unavailable; use a supporting runtime or consumer-provided polyfill.
 */
export function formatRelativeTimeToParts(
  value: number,
  unit: Intl.RelativeTimeFormatUnit,
  language: string,
  options: RelativeTimeFormatOptions = {},
): Intl.RelativeTimeFormatPart[] {
  const formatter = relativeTimeFormatter(language, options);
  const number = finiteNumber(value, "Relative time amount");
  if (typeof formatter.formatToParts !== "function") {
    throw new TypeError(
      "Intl.RelativeTimeFormat.prototype.formatToParts is unavailable; use a supporting runtime or consumer-provided polyfill",
    );
  }
  return formatter.formatToParts(number, unit);
}

/**
 * Selects a native plural category, not a translated phrase or catalog key.
 * Native rounding options affect selection; no translation fallback or message parsing occurs.
 *
 * @param value - Finite number; negative and fractional values follow native plural rules.
 * @param language - Locale tag, unless overridden by `options.language`.
 * @param options - Native plural-rule/rounding options and locale override; defaults to cardinal rules.
 * @returns One of `zero`, `one`, `two`, `few`, `many`, or `other` for the effective locale.
 * @throws {RangeError} If the number is nonfinite or the effective locale/options are invalid.
 * @throws {TypeError} If native Intl rejects option coercion.
 */
export function selectPlural(
  value: number,
  language: string,
  options: PluralSelectOptions = {},
): Intl.LDMLPluralRule {
  const tag = locale(options.language ?? language);
  return cachedFormatter(
    pluralRules,
    nativeFormatterKey(tag, options),
    () => new Intl.PluralRules(tag, options),
  ).select(finiteNumber(value, "Plural value"));
}

/**
 * Formats a finite amount, forcing currency style and uppercasing the currency code.
 * Code syntax is validated, not membership in the ISO 4217 registry.
 *
 * @param value - Finite currency amount.
 * @param language - Locale tag, unless overridden by `options.language`.
 * @param options - Required currency code plus native number options and locale override.
 * @returns Localized currency text with native Intl currency defaults.
 * @throws {RangeError} If the code is not three ASCII letters, the amount is nonfinite,
 * or the effective locale/options are invalid.
 * @throws {TypeError} If native Intl rejects a required option or incompatible option combination.
 */
export function formatCurrency(
  value: number,
  language: string,
  options: CurrencyFormatOptions,
): string {
  return currencyFormatter(language, options).format(finiteNumber(value, "Currency amount"));
}

/** Validates and normalizes currency options once for all currency result forms. */
function currencyFormatter(language: string, options: CurrencyFormatOptions): Intl.NumberFormat {
  if (!options || !/^[A-Za-z]{3}$/.test(options.currency)) {
    throw new RangeError("Currency must be a three-letter ISO 4217 code");
  }
  const { language: languageOverride, currency, ...intlOptions } = options;
  const tag = locale(languageOverride ?? language);
  const formatOptions: Intl.NumberFormatOptions = {
    ...intlOptions,
    style: "currency",
    currency: currency.toUpperCase(),
  };
  return cachedFormatter(
    numberFormatters,
    formatterKey(tag, formatOptions),
    () => new Intl.NumberFormat(tag, formatOptions),
  );
}

/**
 * Formats a finite amount as native parts, forcing currency style and uppercasing the code.
 * @param value - Finite currency amount; numeric strings and bigint are not accepted.
 * @param language - Locale tag, unless overridden by `options.language`.
 * @param options - Required three-letter ASCII currency code, native number options, and locale override.
 * Code syntax is validated, not registry membership; native currency defaults apply.
 * @returns Fresh, caller-owned mutable parts and records in native order; no HTML is produced.
 * @throws {RangeError} If the code is malformed, the amount is nonfinite, or locale/options are invalid.
 * @throws {TypeError} If Intl rejects options, or `Intl.NumberFormat.prototype.formatToParts`
 * is unavailable; use a supporting runtime or consumer-provided polyfill.
 */
export function formatCurrencyToParts(
  value: number,
  language: string,
  options: CurrencyFormatOptions,
): Intl.NumberFormatPart[] {
  const formatter = currencyFormatter(language, options);
  const number = finiteNumber(value, "Currency amount");
  if (typeof formatter.formatToParts !== "function") {
    throw new TypeError(
      "Intl.NumberFormat.prototype.formatToParts is unavailable; use a supporting runtime or consumer-provided polyfill",
    );
  }
  return formatter.formatToParts(number);
}

/**
 * Formats two finite amounts as a native currency range, forcing currency style and uppercasing the code.
 * @param start - Finite starting amount; numeric strings and bigint are not accepted.
 * @param end - Finite ending amount; descending ranges, signed zero, and rounding retain native semantics.
 * @param language - Locale tag, unless overridden by `options.language`.
 * @param options - Required three-letter ASCII currency code, native number options, and locale override.
 * Code syntax is validated, not registry membership; native currency defaults apply.
 * @returns Native currency range text with shared affixes and equal/rounded-endpoint approximation.
 * @throws {RangeError} If the code is malformed, either amount is nonfinite, or locale/options are invalid.
 * @throws {TypeError} If Intl rejects options, or `Intl.NumberFormat.prototype.formatRange`
 * is unavailable; use a supporting runtime or consumer-provided polyfill.
 */
export function formatCurrencyRange(
  start: number,
  end: number,
  language: string,
  options: CurrencyFormatOptions,
): string {
  return numberRange(currencyFormatter(language, options), start, end);
}

/**
 * Formats two finite amounts as native currency range parts, forcing currency style and uppercasing the code.
 * @param start - Finite starting amount; numeric strings and bigint are not accepted.
 * @param end - Finite ending amount; descending ranges, signed zero, and rounding retain native semantics.
 * @param language - Locale tag, unless overridden by `options.language`.
 * @param options - Required three-letter ASCII currency code, native number options, and locale override.
 * Code syntax is validated, not registry membership; native currency defaults apply.
 * @returns Fresh, caller-owned mutable parts and records, preserving native order, literals,
 * approximation signs, and `startRange`/`endRange`/`shared` sources; no HTML is produced.
 * @throws {RangeError} If the code is malformed, either amount is nonfinite, or locale/options are invalid.
 * @throws {TypeError} If Intl rejects options, or `Intl.NumberFormat.prototype.formatRangeToParts`
 * is unavailable; use a supporting runtime or consumer-provided polyfill.
 */
export function formatCurrencyRangeToParts(
  start: number,
  end: number,
  language: string,
  options: CurrencyFormatOptions,
): Intl.NumberRangeFormatPart[] {
  return numberRangeParts(currencyFormatter(language, options), start, end);
}

/**
 * Formats Gregorian calendar fields without time-zone conversion or synthetic clock output.
 * Numeric year/month/day defaults are merged unless `dateStyle` is defined.
 *
 * @param value - Strict `YYYY-MM-DD` string or integer calendar-date record; never a Date instant.
 * @param language - Locale tag, unless overridden by `options.language`.
 * @param options - Date-only native options and locale override; defaults to `{}`. Clock/zone fields are forbidden even if undefined or inherited.
 * @returns Localized calendar date text.
 * @throws {RangeError} If the date is malformed, impossible, or outside the native Date
 * range, or the effective locale/options are invalid.
 * @throws {TypeError} If native Intl rejects incompatible styles and component options.
 */
export function formatDate(
  value: string | CalendarDate,
  language: string,
  options: DateFormatOptions = {},
): string {
  const { formatter, date } = prepareDate(value, language, options);
  return formatter.format(date);
}

/** Shares calendar validation and date-only option snapshots across result forms. */
function prepareDate(value: string | CalendarDate, language: string, options: DateFormatOptions) {
  const date = parseCalendarDate(value);
  const { language: languageOverride, ...providedOptions } = calendarOptions(options);
  return {
    formatter: dateFormatter(languageOverride ?? language, providedOptions),
    date,
  };
}

/** Rejects forbidden calendar fields by presence, without invoking their getters. */
function calendarOptions(options: DateFormatOptions): DateFormatOptions {
  for (const option of DATE_FORBIDDEN_OPTIONS) {
    if (option in options) {
      throw new RangeError(`Calendar date formatting does not support ${option}`);
    }
  }
  return options;
}

/** Applies date defaults and private UTC anchoring for calendar single values and pairs. */
function dateFormatter(
  language: string,
  providedOptions: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const defaults: Intl.DateTimeFormatOptions =
    providedOptions.dateStyle === undefined
      ? { year: "numeric", month: "numeric", day: "numeric" }
      : {};
  const tag = locale(language);
  const formatOptions: Intl.DateTimeFormatOptions = {
    ...defaults,
    ...providedOptions,
    timeZone: "UTC",
  };
  return cachedFormatter(
    dateTimeFormatters,
    formatterKey(tag, formatOptions),
    () => new Intl.DateTimeFormat(tag, formatOptions),
  );
}

/**
 * Formats Gregorian calendar fields as native structured parts without zone conversion.
 * @param value - Strict `YYYY-MM-DD` string or integer calendar-date record; Date instants are rejected.
 * @param language - Locale tag, unless overridden by `options.language`.
 * @param options - Date-only options; numeric year/month/day default unless dateStyle is defined. Clock/zone fields are forbidden even if undefined or inherited.
 * @returns Fresh, caller-owned mutable native parts and records, not HTML. Native whitespace may differ from string formatting.
 * @throws {RangeError} If the date, effective locale, or options are invalid.
 * @throws {TypeError} If Intl rejects options, or `Intl.DateTimeFormat.prototype.formatToParts`
 * is unavailable; use a supporting runtime or consumer-provided polyfill.
 */
export function formatDateToParts(
  value: string | CalendarDate,
  language: string,
  options: DateFormatOptions = {},
): Intl.DateTimeFormatPart[] {
  const { formatter, date } = prepareDate(value, language, options);
  return dateTimeParts(formatter, date);
}

/** Validates and orders calendar endpoints before reading date-only options. */
function prepareDateRange(
  start: string | CalendarDate,
  end: string | CalendarDate,
  language: string,
  options: DateFormatOptions,
) {
  const first = parseCalendarDate(start);
  const last = parseCalendarDate(end);
  // Newer hosts can accept reversed native ranges; retain the ordered date-pair contract on all hosts.
  if (first > last) {
    throw new RangeError("Date range start must not be later than end");
  }
  const { language: languageOverride, ...providedOptions } = calendarOptions(options);
  return {
    formatter: dateFormatter(languageOverride ?? language, providedOptions),
    start: first,
    end: last,
  };
}

/**
 * Formats Gregorian calendar dates as a native localized range without zone conversion.
 * @param start - Strict `YYYY-MM-DD` string or integer calendar record; never a Date instant.
 * @param end - Calendar string/record not earlier than start; equal endpoints retain native behavior.
 * @param language - Locale tag, unless overridden by `options.language`.
 * @param options - Date-only options; numeric year/month/day defaults unless dateStyle is defined.
 * Clock/zone fields are forbidden even if undefined or inherited.
 * @returns Native localized range text, without package-selected separators or endpoint collapse.
 * @throws {RangeError} If endpoints are invalid, incompatible, reversed, or locale/options are invalid.
 * @throws {TypeError} If Intl rejects options, or `Intl.DateTimeFormat.prototype.formatRange`
 * is unavailable; use a supporting runtime or consumer-provided polyfill.
 */
export function formatDateRange(
  start: string | CalendarDate,
  end: string | CalendarDate,
  language: string,
  options: DateFormatOptions = {},
): string {
  const pair = prepareDateRange(start, end, language, options);
  return dateTimeRange(pair.formatter, pair.start, pair.end);
}

/**
 * Formats Gregorian calendar dates as native range parts without zone conversion.
 * @param start - Strict `YYYY-MM-DD` string or integer calendar record; never a Date instant.
 * @param end - Calendar string/record not earlier than start; equal endpoints retain native behavior.
 * @param language - Locale tag, unless overridden by `options.language`.
 * @param options - Date-only options; numeric date defaults unless dateStyle is defined.
 * Clock/zone fields are forbidden even if undefined or inherited.
 * @returns Fresh, caller-owned mutable native parts and records, preserving order, literals and
 * `startRange`/`endRange`/`shared` source metadata; no HTML is produced.
 * @throws {RangeError} If endpoints are invalid, incompatible, reversed, or locale/options are invalid.
 * @throws {TypeError} If Intl rejects options, or `Intl.DateTimeFormat.prototype.formatRangeToParts`
 * is unavailable; use a supporting runtime or consumer-provided polyfill.
 */
export function formatDateRangeToParts(
  start: string | CalendarDate,
  end: string | CalendarDate,
  language: string,
  options: DateFormatOptions = {},
): Intl.DateTimeRangeFormatPart[] {
  const pair = prepareDateRange(start, end, language, options);
  return dateTimeRangeParts(pair.formatter, pair.start, pair.end);
}

/** Native display fields that replace datetime defaults when defined (modifiers do not). */
const DATETIME_DISPLAY_OPTIONS = [
  "dateStyle",
  "timeStyle",
  "era",
  "year",
  "month",
  "day",
  "weekday",
  "hour",
  "minute",
  "second",
  "fractionalSecondDigits",
  "dayPeriod",
  "timeZoneName",
] as const;

/**
 * Reads/validates the zone once, then language, then remaining enumerable own options.
 * Inherited/non-enumerable zones are retained explicitly, never lost to object spread.
 * Callers detach all instants before entering this helper; native coercion occurs last.
 */
function instantFormatter(language: string, options: DateTimeFormatOptions): Intl.DateTimeFormat {
  const timeZone = options?.timeZone;
  if (typeof timeZone !== "string" || !timeZone.trim()) {
    throw new RangeError("Datetime formatting requires an explicit nonblank string timeZone");
  }
  const languageOverride = options.language;
  const providedOptions: Record<string, unknown> = {};
  for (const name of Object.keys(options)) {
    if (name !== "timeZone" && name !== "language") {
      Object.defineProperty(providedOptions, name, {
        value: (options as unknown as Record<string, unknown>)[name],
        enumerable: true,
      });
    }
  }
  const defaults: Intl.DateTimeFormatOptions = DATETIME_DISPLAY_OPTIONS.some(
    name => providedOptions[name] !== undefined,
  )
    ? {}
    : { dateStyle: "medium", timeStyle: "short" };
  const formatOptions: Intl.DateTimeFormatOptions = {
    ...defaults,
    ...Object.fromEntries(
      Object.entries(providedOptions).filter(([, value]) => value !== undefined),
    ),
    timeZone,
  };
  const tag = locale(languageOverride ?? language);
  return cachedFormatter(
    dateTimeFormatters,
    formatterKey(tag, formatOptions),
    () => new Intl.DateTimeFormat(tag, formatOptions),
  );
}

/**
 * Formats a real instant in an explicitly chosen output zone, never an inferred host zone.
 * @param value - Valid native Date, including cross-realm Dates; native slots are copied before option reads/coercion.
 * @param language - Locale tag, unless overridden by options.language; locale never selects a zone.
 * @param options - Required primitive nonblank timeZone and native options. Defaults to medium date/short time
 * only when no styles/display fields are defined; explicit styles/components replace defaults.
 * @returns Native localized instant text; a Date retains no original input zone.
 * @throws {RangeError} If the Date is invalid, zone is absent/nonstring/blank/unsupported, or locale/options are invalid.
 * @throws {TypeError} If value has no native Date slots, Intl rejects options/coercion, or
 * Intl.DateTimeFormat.prototype.format is unavailable; use a supporting runtime or consumer-provided polyfill.
 */
export function formatDateTime(
  value: Date,
  language: string,
  options: DateTimeFormatOptions,
): string {
  const date = detachInstant(value);
  const formatter = instantFormatter(language, options);
  if (typeof formatter.format !== "function") {
    throw new TypeError(
      "Intl.DateTimeFormat.prototype.format is unavailable; use a supporting runtime or consumer-provided polyfill",
    );
  }
  return formatter.format(date);
}

/**
 * Formats an explicitly zoned instant as native structured parts.
 * @param value - Valid native Date; detached before option reads/coercion, ignoring overridden methods.
 * @param language - Locale tag unless options.language overrides it; no translation fallback.
 * @param options - Required explicit primitive nonblank timeZone and native options; medium date/short time
 * defaults only without defined styles/display components. Modifiers alone retain defaults.
 * @returns Fresh caller-owned mutable parts/records in native order, not HTML; whitespace may differ from strings.
 * @throws {RangeError} If the instant, required zone, locale or options are invalid.
 * @throws {TypeError} If value lacks Date slots, Intl rejects options, or Intl.DateTimeFormat.prototype.formatToParts
 * is unavailable; use a supporting runtime or consumer-provided polyfill.
 */
export function formatDateTimeToParts(
  value: Date,
  language: string,
  options: DateTimeFormatOptions,
): Intl.DateTimeFormatPart[] {
  const date = detachInstant(value);
  return dateTimeParts(instantFormatter(language, options), date);
}

/** Copies and orders both instants before any option access, including the required zone. */
function prepareInstantRange(
  start: Date,
  end: Date,
  language: string,
  options: DateTimeFormatOptions,
) {
  const first = detachInstant(start);
  const last = detachInstant(end);
  if (first > last) throw new RangeError("Datetime range start must not be later than end");
  return { formatter: instantFormatter(language, options), start: first, end: last };
}

/**
 * Formats ordered real instants as a native range in an explicitly chosen output zone.
 * @param start - Valid native Date; both endpoints are detached before option reads/coercion.
 * @param end - Valid native Date not earlier than start; equality retains native range behavior.
 * @param language - Locale tag unless options.language overrides it; never determines the zone.
 * @param options - Required primitive nonblank timeZone and native options; defaults to medium date/short time
 * only without defined styles/display components. Explicit projections replace defaults.
 * @returns Native range text, without endpoint collapse or package-selected punctuation.
 * @throws {RangeError} If endpoints are invalid/reversed, zone missing/invalid, or locale/options invalid.
 * @throws {TypeError} If endpoints lack Date slots, Intl rejects options, or Intl.DateTimeFormat.prototype.formatRange
 * is unavailable; use a supporting runtime or consumer-provided polyfill.
 */
export function formatDateTimeRange(
  start: Date,
  end: Date,
  language: string,
  options: DateTimeFormatOptions,
): string {
  const pair = prepareInstantRange(start, end, language, options);
  return dateTimeRange(pair.formatter, pair.start, pair.end);
}

/**
 * Formats ordered, explicitly zoned instants as native structured range parts.
 * @param start - Valid native Date; both endpoints are detached before option reads/coercion.
 * @param end - Valid native Date not earlier than start; equality retains native range behavior.
 * @param language - Locale tag unless options.language overrides it; no translation fallback.
 * @param options - Required primitive nonblank timeZone and native options; medium date/short time defaults
 * only without defined styles/display components. Modifiers alone retain defaults.
 * @returns Fresh caller-owned mutable native parts/records preserving order, literals and
 * startRange/endRange/shared sources; no HTML. Joined parts may differ from string whitespace.
 * @throws {RangeError} If endpoints, ordering, required zone, locale or options are invalid.
 * @throws {TypeError} If endpoints lack Date slots, Intl rejects options, or Intl.DateTimeFormat.prototype.formatRangeToParts
 * is unavailable; use a supporting runtime or consumer-provided polyfill.
 */
export function formatDateTimeRangeToParts(
  start: Date,
  end: Date,
  language: string,
  options: DateTimeFormatOptions,
): Intl.DateTimeRangeFormatPart[] {
  const pair = prepareInstantRange(start, end, language, options);
  return dateTimeRangeParts(pair.formatter, pair.start, pair.end);
}

/** Checks only the requested native string-range capability at call time. */
function dateTimeRange(formatter: Intl.DateTimeFormat, start: Date, end: Date): string {
  if (typeof formatter.formatRange !== "function") {
    throw new TypeError(
      "Intl.DateTimeFormat.prototype.formatRange is unavailable; use a supporting runtime or consumer-provided polyfill",
    );
  }
  return formatter.formatRange(start, end);
}

/** Returns fresh native range parts after checking only this operation's host capability. */
function dateTimeRangeParts(
  formatter: Intl.DateTimeFormat,
  start: Date,
  end: Date,
): Intl.DateTimeRangeFormatPart[] {
  if (typeof formatter.formatRangeToParts !== "function") {
    throw new TypeError(
      "Intl.DateTimeFormat.prototype.formatRangeToParts is unavailable; use a supporting runtime or consumer-provided polyfill",
    );
  }
  return formatter.formatRangeToParts(start, end);
}

/** Checks only the requested native parts capability, without probing during import or string calls. */
function dateTimeParts(formatter: Intl.DateTimeFormat, date: Date): Intl.DateTimeFormatPart[] {
  if (typeof formatter.formatToParts !== "function") {
    throw new TypeError(
      "Intl.DateTimeFormat.prototype.formatToParts is unavailable; use a supporting runtime or consumer-provided polyfill",
    );
  }
  return formatter.formatToParts(date);
}

/**
 * Formats a strict clock time without time-zone conversion. Without `timeStyle`,
 * defaults to numeric hour and two-digit minute, plus two-digit second when supplied;
 * defined component options override these defaults.
 *
 * @param value - Strict `HH:MM`/`HH:MM:SS` string or integer clock-time record.
 * @param language - Locale tag, unless overridden by `options.language`.
 * @param options - Clock-only options and locale override; defaults to `{}`.
 * @returns Localized clock text, using locale-specific hour-cycle defaults.
 * @throws {RangeError} If clock fields are invalid, a calendar/zone option is present,
 * `timeStyle` is long/full, or the effective locale/options are invalid.
 * @throws {TypeError} If native Intl rejects incompatible styles and component options.
 */
export function formatTime(
  value: string | ClockTime,
  language: string,
  options: TimeFormatOptions = {},
): string {
  const { formatter, date } = prepareTime(value, language, options);
  return formatter.format(date);
}

/** Shares clock restrictions, parsing, seconds defaults, and UTC formatter caching across result forms. */
function prepareTime(value: string | ClockTime, language: string, options: TimeFormatOptions) {
  const { language: languageOverride, ...providedOptions } = clockOptions(options);
  const time = parseClockTime(value);
  const date = clockDate(time);
  return {
    formatter: clockFormatter(
      time.hasExplicitSeconds,
      languageOverride ?? language,
      providedOptions,
    ),
    date,
  };
}

/** Enforces clock-only restrictions while retaining the existing option snapshot/read order. */
function clockOptions(options: TimeFormatOptions) {
  for (const option of CLOCK_FORBIDDEN_OPTIONS) {
    if (option in options) {
      throw new RangeError(`Clock time formatting does not support ${option}`);
    }
  }
  const { language: languageOverride, ...providedOptions } = options;
  if (["long", "full"].includes(providedOptions.timeStyle ?? "")) {
    throw new RangeError("Clock time formatting supports only short or medium timeStyle");
  }
  return { language: languageOverride, ...providedOptions };
}

/** Anchors clock fields to one UTC day without inferring an overnight interval. */
function clockDate(time: ParsedClockTime): Date {
  return new Date(Date.UTC(1970, 0, 1, time.hour, time.minute, time.second));
}

/** Applies seconds-presence defaults and reuses the UTC formatter across result forms. */
function clockFormatter(
  hasExplicitSeconds: boolean,
  language: string,
  providedOptions: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const defaults: Intl.DateTimeFormatOptions =
    providedOptions.timeStyle === undefined
      ? {
          hour: "numeric",
          minute: "2-digit",
          ...(hasExplicitSeconds ? { second: "2-digit" as const } : {}),
        }
      : {};
  const tag = locale(language);
  const formatOptions: Intl.DateTimeFormatOptions = {
    ...defaults,
    // Undefined components must not erase clock defaults and trigger Intl's date-only fallback.
    ...Object.fromEntries(
      Object.entries(providedOptions).filter(([, value]) => value !== undefined),
    ),
    timeZone: "UTC",
  };
  return cachedFormatter(
    dateTimeFormatters,
    formatterKey(tag, formatOptions),
    () => new Intl.DateTimeFormat(tag, formatOptions),
  );
}

/**
 * Formats a clock time as native parts without date or zone labels or time-zone conversion.
 * @param value - Strict `HH:MM`/`HH:MM:SS` string or integer clock-time record.
 * @param language - Locale tag, unless overridden by `options.language`.
 * @param options - Clock-only options; defaults to hour/minute and seconds when supplied, including zero.
 * Defined components override defaults; short/medium styles replace them. Date/zone fields are forbidden even if undefined.
 * @returns Fresh, caller-owned mutable native parts and records, not HTML; native whitespace may differ from string formatting.
 * @throws {RangeError} If clock fields, locale/options, or clock-only restrictions are invalid.
 * @throws {TypeError} If Intl rejects options, or `Intl.DateTimeFormat.prototype.formatToParts`
 * is unavailable; use a supporting runtime or consumer-provided polyfill.
 */
export function formatTimeToParts(
  value: string | ClockTime,
  language: string,
  options: TimeFormatOptions = {},
): Intl.DateTimeFormatPart[] {
  const { formatter, date } = prepareTime(value, language, options);
  return dateTimeParts(formatter, date);
}

/** Prepares a same-day clock pair with one shared seconds default and explicit ordering. */
function prepareTimeRange(
  start: string | ClockTime,
  end: string | ClockTime,
  language: string,
  options: TimeFormatOptions,
) {
  const { language: languageOverride, ...providedOptions } = clockOptions(options);
  const first = parseClockTime(start);
  const last = parseClockTime(end);
  const startDate = clockDate(first);
  const endDate = clockDate(last);
  if (startDate > endDate) {
    throw new RangeError(
      "Clock range start must not be later than end; overnight ranges are not inferred",
    );
  }
  return {
    formatter: clockFormatter(
      first.hasExplicitSeconds || last.hasExplicitSeconds,
      languageOverride ?? language,
      providedOptions,
    ),
    start: startDate,
    end: endDate,
  };
}

/**
 * Formats an ordered same-day clock range without date/zone labels or time-zone conversion.
 * @param start - Strict `HH:MM`/`HH:MM:SS` string or integer clock record.
 * @param end - Clock endpoint not earlier than start; use explicitly zoned datetime ranges for real cross-midnight instants.
 * @param language - Locale tag, unless overridden by `options.language`.
 * @param options - Clock-only options. Without a style, defaults to hour/minute plus seconds if
 * either endpoint supplied them (including zero). Defined components override defaults; short/medium
 * styles replace them. Date/zone fields are forbidden even if undefined.
 * @returns Native localized clock range text; no overnight inference or synthetic date/zone output.
 * @throws {RangeError} If endpoints are invalid/reversed or clock restrictions, locale/options are invalid.
 * @throws {TypeError} If Intl rejects options, or `Intl.DateTimeFormat.prototype.formatRange`
 * is unavailable; use a supporting runtime or consumer-provided polyfill.
 */
export function formatTimeRange(
  start: string | ClockTime,
  end: string | ClockTime,
  language: string,
  options: TimeFormatOptions = {},
): string {
  const pair = prepareTimeRange(start, end, language, options);
  return dateTimeRange(pair.formatter, pair.start, pair.end);
}

/**
 * Formats an ordered same-day clock range as native parts without synthetic date/zone fields.
 * @param start - Strict `HH:MM`/`HH:MM:SS` string or integer clock record.
 * @param end - Clock endpoint not earlier than start; use explicitly zoned datetime ranges for real cross-midnight instants.
 * @param language - Locale tag, unless overridden by `options.language`.
 * @param options - Clock-only options; hour/minute and pair-aware seconds default unless a short/medium
 * style is set. Defined components override defaults; date/zone fields are forbidden even if undefined.
 * @returns Fresh, caller-owned mutable native parts and records, preserving order, literals and
 * `startRange`/`endRange`/`shared` sources; no HTML or synthetic date/zone fields are produced.
 * @throws {RangeError} If endpoints are invalid/reversed or clock restrictions, locale/options are invalid.
 * @throws {TypeError} If Intl rejects options, or `Intl.DateTimeFormat.prototype.formatRangeToParts`
 * is unavailable; use a supporting runtime or consumer-provided polyfill.
 */
export function formatTimeRangeToParts(
  start: string | ClockTime,
  end: string | ClockTime,
  language: string,
  options: TimeFormatOptions = {},
): Intl.DateTimeRangeFormatPart[] {
  const pair = prepareTimeRange(start, end, language, options);
  return dateTimeRangeParts(pair.formatter, pair.start, pair.end);
}

/**
 * Formats a weekday numbered Monday 0 through Sunday 6 without host-zone dependence.
 *
 * @param weekday - Integer from 0 (Monday) through 6 (Sunday).
 * @param language - Locale tag, unless overridden by `options.language`.
 * @param options - Name width and locale override; defaults to `{}` with `long` width. Zone fields are forbidden even if undefined or inherited.
 * @returns Localized weekday name in the requested width.
 * @throws {RangeError} If the weekday, effective locale, or width is invalid, or a zone field is present.
 */
export function formatWeekday(
  weekday: number,
  language: string,
  options: WeekdayFormatOptions = {},
): string {
  const { formatter, date } = prepareWeekday(weekday, language, options);
  return formatter.format(date);
}

/** Shares weekday validation, UTC anchoring, width defaults, and formatter caching across result forms. */
function prepareWeekday(weekday: number, language: string, options: WeekdayFormatOptions) {
  const date = weekdayDate(weekday);
  return { formatter: weekdayFormatter(language, options), date };
}

/** Validates a Monday-zero index without coercion and anchors it to a private UTC week. */
function weekdayDate(weekday: number): Date {
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    throw new RangeError("Weekday must be an integer from 0 (Monday) through 6 (Sunday)");
  }
  return new Date(Date.UTC(1970, 0, 5 + weekday));
}

/** Retains single-weekday zone checks and language/width reads for all weekday operations. */
function weekdayFormatter(language: string, options: WeekdayFormatOptions): Intl.DateTimeFormat {
  for (const option of ["timeZone", "timeZoneName"] as const) {
    if (option in options) throw new RangeError(`Weekday formatting does not support ${option}`);
  }
  const tag = locale(options.language ?? language);
  const formatOptions: Intl.DateTimeFormatOptions = {
    weekday: options.width ?? "long",
    timeZone: "UTC",
  };
  return cachedFormatter(
    dateTimeFormatters,
    formatterKey(tag, formatOptions),
    () => new Intl.DateTimeFormat(tag, formatOptions),
  );
}

/**
 * Formats a Monday-based weekday as native parts without host-zone dependence.
 * @param weekday - Integer from 0 (Monday) through 6 (Sunday).
 * @param language - Locale tag, unless overridden by `options.language`.
 * @param options - Name width and locale override; defaults to long width. Zone fields are forbidden even if undefined or inherited.
 * @returns Fresh, caller-owned mutable native parts and records in native order, not HTML.
 * @throws {RangeError} If the weekday, effective locale, or width is invalid, or a zone field is present.
 * @throws {TypeError} If Intl rejects coercion, or `Intl.DateTimeFormat.prototype.formatToParts`
 * is unavailable; use a supporting runtime or consumer-provided polyfill.
 */
export function formatWeekdayToParts(
  weekday: number,
  language: string,
  options: WeekdayFormatOptions = {},
): Intl.DateTimeFormatPart[] {
  const { formatter, date } = prepareWeekday(weekday, language, options);
  return dateTimeParts(formatter, date);
}

/** Validates both indices before option reads; descending endpoints wrap forward through Sunday. */
function prepareWeekdayRange(
  start: number,
  end: number,
  language: string,
  options: WeekdayFormatOptions,
) {
  const first = weekdayDate(start);
  const last = weekdayDate(end);
  if (end < start) last.setUTCDate(last.getUTCDate() + 7);
  return { formatter: weekdayFormatter(language, options), start: first, end: last };
}

/**
 * Formats a forward inclusive recurring weekday span, not real dates or an elapsed duration.
 * @param start - Integer from 0 (Monday) through 6 (Sunday), without coercion.
 * @param end - Monday-zero integer; descending pairs wrap through Sunday, equality means one weekday.
 * @param language - Locale tag unless options.language overrides it; no translation fallback.
 * @param options - Name width (default long) and locale override. Zone fields are forbidden even
 * when inherited or undefined; narrow labels can be ambiguous and retain native semantics.
 * @returns Native range text without package-selected punctuation, endpoint collapse or zone conversion.
 * Grouping noncontiguous days and schedule rules remain application-owned.
 * @throws {RangeError} If either index, locale or width is invalid, or a zone field is present.
 * @throws {TypeError} If Intl rejects coercion, or Intl.DateTimeFormat.prototype.formatRange
 * is unavailable; use a supporting runtime or consumer-provided polyfill.
 */
export function formatWeekdayRange(
  start: number,
  end: number,
  language: string,
  options: WeekdayFormatOptions = {},
): string {
  const pair = prepareWeekdayRange(start, end, language, options);
  return dateTimeRange(pair.formatter, pair.start, pair.end);
}

/**
 * Formats a forward inclusive recurring weekday span as native structured range parts.
 * @param start - Integer from 0 (Monday) through 6 (Sunday), without coercion.
 * @param end - Monday-zero integer; descending pairs wrap through Sunday, equality means one weekday.
 * @param language - Locale tag unless options.language overrides it; no translation fallback.
 * @param options - Width (default long) and locale override; zone fields are forbidden even if
 * inherited or undefined. Native narrow-label ambiguity is preserved; schedule grouping is application-owned.
 * @returns Fresh caller-owned mutable native parts/records preserving order, literals and
 * startRange/endRange/shared sources, without synthetic date/zone fields or HTML. Joined parts
 * may differ from string whitespace; equal endpoints still use the native range operation.
 * @throws {RangeError} If either index, locale or width is invalid, or a zone field is present.
 * @throws {TypeError} If Intl rejects coercion, or Intl.DateTimeFormat.prototype.formatRangeToParts
 * is unavailable; use a supporting runtime or consumer-provided polyfill.
 */
export function formatWeekdayRangeToParts(
  start: number,
  end: number,
  language: string,
  options: WeekdayFormatOptions = {},
): Intl.DateTimeRangeFormatPart[] {
  const pair = prepareWeekdayRange(start, end, language, options);
  return dateTimeRangeParts(pair.formatter, pair.start, pair.end);
}
