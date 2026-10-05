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
  /** Integer second from 0 through 59; omitted defaults to zero and is not shown by default. */
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

/**
 * Native date/time options with an optional language override. Calendar-only inputs
 * always use UTC, ignoring `timeZone`; Date instants use the supplied or host zone.
 */
export type DateFormatOptions = Intl.DateTimeFormatOptions & LocaleFormatOptions;

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

/** Weekday formatting width and optional language override. */
export interface WeekdayFormatOptions extends LocaleFormatOptions {
  /** Localized name width; defaults to `long`. */
  width?: "long" | "short" | "narrow";
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

/** Copies a valid Date instant or validates a Gregorian calendar date anchored at UTC midnight. */
function parseCalendarDate(value: Date | string | CalendarDate): {
  date: Date;
  calendarOnly: boolean;
} {
  if (typeof value === "object" && value !== null) {
    let timestamp: number | undefined;
    try {
      // Native slots identify cross-realm Dates without consulting overridable methods.
      timestamp = Date.prototype.getTime.call(value);
    } catch {
      // CalendarDate records have no native Date slots.
    }
    if (timestamp !== undefined) {
      if (Number.isNaN(timestamp)) throw new RangeError("Date must be valid");
      return { date: new Date(timestamp), calendarOnly: false };
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
  return { date, calendarOnly: true };
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
  const { language: languageOverride, ...intlOptions } = options;
  const tag = locale(languageOverride ?? language);
  return cachedFormatter(
    numberFormatters,
    formatterKey(tag, intlOptions),
    () => new Intl.NumberFormat(tag, intlOptions),
  ).format(finiteNumber(value, "Number"));
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
  const tag = locale(options.language ?? language);
  return cachedFormatter(
    relativeTimeFormatters,
    nativeFormatterKey(tag, options),
    () => new Intl.RelativeTimeFormat(tag, options),
  ).format(finiteNumber(value, "Relative time amount"), unit);
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
  ).format(finiteNumber(value, "Currency amount"));
}

/**
 * Formats a Date instant or Gregorian calendar date. Calendar dates are anchored at
 * UTC midnight and ignore the supplied zone; instants honor it or use the host zone.
 * Numeric year/month/day defaults are merged unless `dateStyle` or `timeStyle` is set.
 *
 * @param value - Valid Date, strict `YYYY-MM-DD` string, or integer calendar-date record.
 * @param language - Locale tag, unless overridden by `options.language`.
 * @param options - Native date/time options and locale override; defaults to `{}`.
 * @returns Localized date/time text.
 * @throws {RangeError} If the date is malformed, impossible, or outside the native Date
 * range, or the effective locale/options are invalid.
 * @throws {TypeError} If native Intl rejects incompatible styles and component options.
 */
export function formatDate(
  value: Date | string | CalendarDate,
  language: string,
  options: DateFormatOptions = {},
): string {
  const { language: languageOverride, ...providedOptions } = options;
  const { date, calendarOnly } = parseCalendarDate(value);
  const defaults: Intl.DateTimeFormatOptions =
    providedOptions.dateStyle === undefined && providedOptions.timeStyle === undefined
      ? { year: "numeric", month: "numeric", day: "numeric" }
      : {};
  const tag = locale(languageOverride ?? language);
  const formatOptions: Intl.DateTimeFormatOptions = {
    ...defaults,
    ...providedOptions,
    ...(calendarOnly ? { timeZone: "UTC" } : {}),
  };
  // The host time zone can change between calls when an instant has no explicit zone.
  const key = formatOptions.timeZone === undefined ? undefined : formatterKey(tag, formatOptions);
  return cachedFormatter(
    dateTimeFormatters,
    key,
    () => new Intl.DateTimeFormat(tag, formatOptions),
  ).format(date);
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
  for (const option of CLOCK_FORBIDDEN_OPTIONS) {
    if (option in options) {
      throw new RangeError(`Clock time formatting does not support ${option}`);
    }
  }
  const { language: languageOverride, ...providedOptions } = options;
  if (["long", "full"].includes(providedOptions.timeStyle ?? "")) {
    throw new RangeError("Clock time formatting supports only short or medium timeStyle");
  }
  const time = parseClockTime(value);
  const date = new Date(Date.UTC(1970, 0, 1, time.hour, time.minute, time.second));
  const defaults: Intl.DateTimeFormatOptions =
    providedOptions.timeStyle === undefined
      ? {
          hour: "numeric",
          minute: "2-digit",
          ...(time.hasExplicitSeconds ? { second: "2-digit" as const } : {}),
        }
      : {};
  const tag = locale(languageOverride ?? language);
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
  ).format(date);
}

/**
 * Formats a weekday numbered Monday 0 through Sunday 6 without host-zone dependence.
 *
 * @param weekday - Integer from 0 (Monday) through 6 (Sunday).
 * @param language - Locale tag, unless overridden by `options.language`.
 * @param options - Name width and locale override; defaults to `{}` with `long` width.
 * @returns Localized weekday name in the requested width.
 * @throws {RangeError} If the weekday, effective locale, or width is invalid.
 */
export function formatWeekday(
  weekday: number,
  language: string,
  options: WeekdayFormatOptions = {},
): string {
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    throw new RangeError("Weekday must be an integer from 0 (Monday) through 6 (Sunday)");
  }
  const date = new Date(Date.UTC(1970, 0, 5 + weekday));
  const tag = locale(options.language ?? language);
  const formatOptions: Intl.DateTimeFormatOptions = {
    weekday: options.width ?? "long",
    timeZone: "UTC",
  };
  return cachedFormatter(
    dateTimeFormatters,
    formatterKey(tag, formatOptions),
    () => new Intl.DateTimeFormat(tag, formatOptions),
  ).format(date);
}
