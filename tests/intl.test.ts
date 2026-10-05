// SPDX-FileCopyrightText: 2020-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Package-private tests for strict Intl formatting and its DOM extension.
 * @packageDocumentation
 * @module intl.test
 * @author Lari Natri
 */

import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { Window } from "happy-dom";

import {
  Translator,
  formatRelativeTime,
  selectPlural,
  type PluralSelectOptions,
  type RelativeTimeFormatOptions,
  type TranslatorLogEntry,
} from "../src/index.ts";
import { bindTranslator, intlDomExtension } from "../src/dom.ts";
import {
  formatCurrency,
  formatDate,
  formatNumber,
  formatTime,
  formatWeekday,
  type ClockTime,
  type TimeFormatOptions,
} from "../src/intl.ts";
import { asElement, asParentNode } from "./dom-test-utils.ts";

test("relative time retains native units, signed amounts, options, and locale output", () => {
  const units: Intl.RelativeTimeFormatUnit[] = [
    "year",
    "quarter",
    "month",
    "week",
    "day",
    "hour",
    "minute",
    "second",
    "years",
    "quarters",
    "months",
    "weeks",
    "days",
    "hours",
    "minutes",
    "seconds",
  ];
  const choices: RelativeTimeFormatOptions[] = [
    {},
    { numeric: "auto" },
    { style: "short" },
    { style: "narrow", numeric: "auto" },
  ];
  for (const language of ["en", "fi", "ar"]) {
    for (const options of choices) {
      const native = new Intl.RelativeTimeFormat(language, options);
      for (const unit of units) {
        for (const value of [-2, -0, 0, 1, 1.5]) {
          assert.equal(
            formatRelativeTime(value, unit, language, options),
            native.format(value, unit),
          );
        }
      }
    }
  }
  assert.notEqual(formatRelativeTime(-0, "day", "en"), formatRelativeTime(0, "day", "en"));
  assert.equal(formatRelativeTime(-1, "day", "en", { numeric: "auto" }), "yesterday");
  assert.equal(formatRelativeTime(0, "day", "en", { numeric: "auto" }), "today");
});

test("plural selection follows locale, cardinal/ordinal rules, and native rounding", () => {
  const choices: PluralSelectOptions[] = [
    {},
    { type: "ordinal" },
    { minimumFractionDigits: 1 },
    { maximumFractionDigits: 0 },
    { maximumSignificantDigits: 1 },
  ];
  for (const language of ["en", "fi", "ru", "ar"]) {
    for (const options of choices) {
      const native = new Intl.PluralRules(language, options);
      for (const value of [-2, -1, -0, 0, 1, 2, 3, 5, 11, 21, 1.2, 2.5, 101]) {
        assert.equal(selectPlural(value, language, options), native.select(value));
      }
    }
  }
  assert.equal(selectPlural(1, "en"), "one");
  assert.equal(selectPlural(1, "en", { minimumFractionDigits: 1 }), "other");
  assert.equal(selectPlural(1.2, "en", { maximumFractionDigits: 0 }), "one");
  assert.equal(selectPlural(2, "en", { type: "ordinal" }), "two");
  assert.equal(selectPlural(3, "ru"), "few");
  assert.equal(selectPlural(0, "ar"), "zero");
});

test("new Intl methods use active locale or override, without modifying translator state", () => {
  const translator = new Translator({ language: "en", fallbackLanguage: "ar" });
  translator.setTranslation("item", { ar: "Fallback only" });
  let notifications = 0;
  translator.subscribe(() => notifications++);
  translator.subscribeCatalog(() => notifications++);
  translator.subscribeLanguages(() => notifications++);
  const assertLocale = (language: string): void => {
    assert.equal(
      translator.formatRelativeTime(-2, "days"),
      new Intl.RelativeTimeFormat(language).format(-2, "day"),
    );
    assert.equal(translator.selectPlural(3), new Intl.PluralRules(language).select(3));
  };
  assertLocale("en");
  translator.setLanguage("ru");
  assertLocale("ru");
  assert.equal(notifications, 1);
  const relativeOptions = { language: " en_GB ", numeric: "auto" } as const;
  assert.equal(translator.formatRelativeTime(-1, "day", relativeOptions), "yesterday");
  assert.equal(formatRelativeTime(-1, "day", "!invalid!", relativeOptions), "yesterday");
  assert.equal(translator.selectPlural(0, { language: "ar" }), "zero");
  assert.equal(selectPlural(0, "!invalid!", { language: " ar " }), "zero");
  assert.equal(translator.getLanguage(), "ru");
  assert.equal(translator.translateKey("item"), "Fallback only");
  assert.equal(notifications, 1);
  assert.deepEqual(relativeOptions, { language: " en_GB ", numeric: "auto" });
});

test("new Intl helpers preserve inherited/non-enumerable options and ignore unknown getters", () => {
  class PluralOptions implements PluralSelectOptions {
    get type(): "ordinal" {
      return "ordinal";
    }
  }
  class RelativeOptions implements RelativeTimeFormatOptions {
    get numeric(): "auto" {
      return "auto";
    }
  }
  const plural = new PluralOptions();
  const relative = new RelativeOptions();
  assert.equal(selectPlural(2, "en", plural), "two");
  assert.equal(formatRelativeTime(0, "day", "en", relative), "today");
  const nonEnumerablePlural = Object.defineProperty({}, "type", { value: "ordinal" });
  const nonEnumerableRelative = Object.defineProperty({}, "numeric", { value: "auto" });
  assert.equal(selectPlural(2, "en", nonEnumerablePlural), "two");
  assert.equal(formatRelativeTime(0, "day", "en", nonEnumerableRelative), "today");
  for (const options of [plural, relative, nonEnumerablePlural, nonEnumerableRelative, {}]) {
    Object.defineProperty(options, "ignoredOption", {
      enumerable: true,
      get() {
        throw new Error("Native Intl ignores this option");
      },
    });
    assert.equal(selectPlural(2, "en", options), new Intl.PluralRules("en", options).select(2));
    assert.equal(
      formatRelativeTime(0, "day", "en", options),
      new Intl.RelativeTimeFormat("en", options).format(0, "day"),
    );
  }
  let type: "cardinal" | "ordinal" = "cardinal";
  let numeric: "always" | "auto" = "always";
  const livePlural = {
    get type() {
      return type;
    },
  };
  const liveRelative = {
    get numeric() {
      return numeric;
    },
  };
  assert.equal(selectPlural(2, "en", livePlural), "other");
  assert.notEqual(formatRelativeTime(0, "day", "en", liveRelative), "today");
  type = "ordinal";
  numeric = "auto";
  assert.equal(selectPlural(2, "en", livePlural), "two");
  assert.equal(formatRelativeTime(0, "day", "en", liveRelative), "today");
});

test("relative time and plural selection reject nonfinite and nonnumeric values without coercion", () => {
  const object = {
    valueOf() {
      throw new Error("Must not coerce numeric input");
    },
  };
  for (const value of [NaN, Infinity, -Infinity, "1", null, undefined, 1n, object]) {
    assert.throws(() => formatRelativeTime(value as number, "day", "en"), RangeError);
    assert.throws(() => selectPlural(value as number, "en"), RangeError);
  }
  for (const language of ["", " ", "not_a_valid_locale_!"]) {
    assert.throws(() => formatRelativeTime(1, "day", language), RangeError);
    assert.throws(() => selectPlural(1, language), RangeError);
  }
  // @ts-expect-error Relative time accepts only native unit names.
  assert.throws(() => formatRelativeTime(1, "fortnight", "en"), RangeError);
  // @ts-expect-error Numeric mode is native always or auto.
  assert.throws(() => formatRelativeTime(1, "day", "en", { numeric: "sometimes" }), RangeError);
  // @ts-expect-error Style is native long, short, or narrow.
  assert.throws(() => formatRelativeTime(1, "day", "en", { style: "wide" }), RangeError);
  // @ts-expect-error Rule type is cardinal or ordinal, not message selection.
  assert.throws(() => selectPlural(1, "en", { type: "select" }), RangeError);
  assert.throws(() => selectPlural(1, "en", { minimumFractionDigits: -1 }), RangeError);
  assert.throws(
    () => selectPlural(1, "en", { minimumFractionDigits: 3, maximumFractionDigits: 2 }),
    RangeError,
  );
});

test("new Intl failure diagnostics preserve original errors even if the logger fails", () => {
  const entries: TranslatorLogEntry[] = [];
  const translator = new Translator({
    logger(entry) {
      entries.push(entry);
      throw new Error("Logger failed");
    },
  });
  const error = new Error("Option coercion failed");
  const dynamic = {
    toString() {
      throw error;
    },
  };
  const relative = { style: dynamic as unknown as "long" };
  const plural = { type: dynamic as unknown as "cardinal" };
  assert.throws(
    () => translator.formatRelativeTime(1, "day", relative),
    thrown => thrown === error,
  );
  assert.throws(
    () => translator.selectPlural(1, plural),
    thrown => thrown === error,
  );
  assert.deepEqual(
    entries.map(entry => [entry.component, entry.event, entry.error]),
    [
      ["intl", "relative-time-format-failed", error],
      ["intl", "plural-select-failed", error],
    ],
  );
  assert.throws(
    () => formatRelativeTime(1, "day", "en", relative),
    thrown => thrown === error,
  );
  assert.throws(
    () => selectPlural(1, "en", plural),
    thrown => thrown === error,
  );
  assert.equal(entries.length, 2);
  assert.throws(() => translator.formatRelativeTime(Infinity, "day"), RangeError);
  assert.throws(() => translator.selectPlural(NaN), RangeError);
  assert.deepEqual(
    entries.slice(2).map(entry => entry.event),
    ["relative-time-format-failed", "plural-select-failed"],
  );
});

test("relative-time and plural caches reuse canonical locales and snapshot effective options", t => {
  const Relative = Intl.RelativeTimeFormat;
  const Plural = Intl.PluralRules;
  let relatives = 0;
  let plurals = 0;
  t.mock.method(
    Intl,
    "RelativeTimeFormat",
    function (...args: ConstructorParameters<typeof Relative>) {
      relatives++;
      return new Relative(...args);
    },
  );
  t.mock.method(Intl, "PluralRules", function (...args: ConstructorParameters<typeof Plural>) {
    plurals++;
    return new Plural(...args);
  });
  const relativeOptions: RelativeTimeFormatOptions = { style: "short", numeric: "auto" };
  formatRelativeTime(1, "day", "en-x-reuse", relativeOptions);
  formatRelativeTime(2, "hours", "EN_x_reuse", { numeric: "auto", style: "short" });
  assert.equal(relatives, 1);
  relativeOptions.style = "narrow";
  formatRelativeTime(1, "day", "en-x-reuse", relativeOptions);
  formatRelativeTime(1, "day", "fi-x-reuse", relativeOptions);
  formatRelativeTime(1, "day", "en-x-reuse", { ...relativeOptions, language: "fi-x-reuse" });
  assert.equal(relatives, 3);
  const pluralOptions: PluralSelectOptions = { type: "ordinal", minimumFractionDigits: 0 };
  selectPlural(1, "en-x-reuse", pluralOptions);
  selectPlural(2, "EN_x_reuse", { minimumFractionDigits: 0, type: "ordinal" });
  assert.equal(plurals, 1);
  pluralOptions.type = "cardinal";
  selectPlural(1, "en-x-reuse", pluralOptions);
  selectPlural(1, "fi-x-reuse", pluralOptions);
  selectPlural(1, "en-x-reuse", { ...pluralOptions, language: "fi-x-reuse" });
  assert.equal(plurals, 3);
});

test("new Intl caches bypass observable coercion and oversized keys and evict old entries", t => {
  const Relative = Intl.RelativeTimeFormat;
  const Plural = Intl.PluralRules;
  let relatives = 0;
  let plurals = 0;
  t.mock.method(
    Intl,
    "RelativeTimeFormat",
    function (...args: ConstructorParameters<typeof Relative>) {
      relatives++;
      return new Relative(...args);
    },
  );
  t.mock.method(Intl, "PluralRules", function (...args: ConstructorParameters<typeof Plural>) {
    plurals++;
    return new Plural(...args);
  });
  let coercions = 0;
  const numeric = { toString: () => (++coercions === 1 ? "always" : "auto") };
  assert.notEqual(
    formatRelativeTime(0, "day", "en", { numeric: numeric as unknown as "auto" }),
    formatRelativeTime(0, "day", "en", { numeric: numeric as unknown as "auto" }),
  );
  assert.equal(coercions, 2);
  coercions = 0;
  const digits = { valueOf: () => coercions++ };
  assert.equal(
    selectPlural(1, "en", { minimumFractionDigits: digits as unknown as number }),
    "one",
  );
  assert.equal(
    selectPlural(1, "en", { minimumFractionDigits: digits as unknown as number }),
    "other",
  );
  assert.equal(coercions, 2);
  const oversized = { ignoredOption: "x".repeat(2048) };
  for (let count = 0; count < 2; count++) {
    formatRelativeTime(1, "day", "en", oversized as RelativeTimeFormatOptions);
    selectPlural(1, "en", oversized as PluralSelectOptions);
  }
  assert.equal(relatives, 4);
  assert.equal(plurals, 4);
  for (let index = 0; index <= 70; index++) {
    formatRelativeTime(1, "day", `en-x-bounds-${index}`);
    selectPlural(1, `en-x-bounds-${index}`);
  }
  formatRelativeTime(2, "hour", "en-x-bounds-70");
  selectPlural(2, "en-x-bounds-70");
  assert.equal(relatives, 75);
  assert.equal(plurals, 75);
  formatRelativeTime(2, "hour", "en-x-bounds-0");
  selectPlural(2, "en-x-bounds-0");
  assert.equal(relatives, 76);
  assert.equal(plurals, 76);
  for (let count = 0; count < 2; count++) {
    assert.throws(
      () => formatRelativeTime(1, "day", "en", { numeric: "invalid" as "auto" }),
      RangeError,
    );
    assert.throws(() => selectPlural(1, "en", { type: "invalid" as "cardinal" }), RangeError);
  }
  assert.equal(relatives, 78);
  assert.equal(plurals, 78);
});

test("formats numbers, currencies, calendar dates, clock times, and weekdays", () => {
  const translator = new Translator({ language: "fi" });

  assert.equal(translator.formatNumber(1234.5), new Intl.NumberFormat("fi").format(1234.5));
  assert.equal(
    translator.formatCurrency(12, { currency: "EUR", minimumFractionDigits: 0 }),
    new Intl.NumberFormat("fi", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: 0,
    }).format(12),
  );
  assert.equal(
    translator.formatDate("2026-09-30", { year: "2-digit" }),
    new Intl.DateTimeFormat("fi", {
      year: "2-digit",
      month: "numeric",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(2026, 8, 30))),
  );
  assert.equal(
    translator.formatDate("2026-09-30", { dateStyle: "long" }),
    new Intl.DateTimeFormat("fi", { dateStyle: "long", timeZone: "UTC" }).format(
      new Date(Date.UTC(2026, 8, 30)),
    ),
  );
  const year99 = new Date(0);
  year99.setUTCHours(0, 0, 0, 0);
  year99.setUTCFullYear(99, 0, 1);
  assert.equal(
    translator.formatDate("0099-01-01"),
    new Intl.DateTimeFormat("fi", {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      timeZone: "UTC",
    }).format(year99),
  );
  assert.equal(
    translator.formatTime("09:05"),
    new Intl.DateTimeFormat("fi", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(1970, 0, 1, 9, 5))),
  );
  assert.equal(
    translator.formatTime("09:05", { timeStyle: "short", language: "en-GB" }),
    new Intl.DateTimeFormat("en-GB", { timeStyle: "short", timeZone: "UTC" }).format(
      new Date(Date.UTC(1970, 0, 1, 9, 5)),
    ),
  );
  assert.equal(
    translator.formatTime("09:05:00", { language: "en-GB" }),
    new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(1970, 0, 1, 9, 5))),
  );
  const instant = new Date(Date.UTC(2026, 8, 30, 9, 5));
  assert.equal(
    translator.formatDate(instant, {
      timeStyle: "short",
      language: "en-GB",
      timeZone: "UTC",
    }),
    new Intl.DateTimeFormat("en-GB", { timeStyle: "short", timeZone: "UTC" }).format(instant),
  );
  assert.equal(translator.formatWeekday(0, { width: "short", language: "en" }), "Mon");
});

test("rejects ambiguous or invalid formatter input and logs failures", () => {
  const events: string[] = [];
  const translator = new Translator({ logger: entry => events.push(entry.event) });

  assert.throws(() => translator.formatCurrency(2, { currency: "EU" }));
  assert.throws(() => translator.formatDate("09/30/2026"));
  assert.throws(() => translator.formatTime("25:00"));
  assert.throws(() => translator.formatWeekday(7));
  assert.deepEqual(events, [
    "currency-format-failed",
    "date-format-failed",
    "time-format-failed",
    "weekday-format-failed",
  ]);
});

test("clock options reject fabricated date and zone fields at compile time and runtime", () => {
  const prohibited: TimeFormatOptions[] = [
    // @ts-expect-error Calendar styles do not belong to a clock time.
    { dateStyle: "short" },
    // @ts-expect-error Calendar eras do not belong to a clock time.
    { era: "short" },
    // @ts-expect-error Calendar years do not belong to a clock time.
    { year: "numeric" },
    // @ts-expect-error Calendar months do not belong to a clock time.
    { month: "numeric" },
    // @ts-expect-error Calendar days do not belong to a clock time.
    { day: "numeric" },
    // @ts-expect-error Calendar weekdays do not belong to a clock time.
    { weekday: "long" },
    // @ts-expect-error A clock time has no time zone, including UTC.
    { timeZone: "UTC" },
    // @ts-expect-error A clock time has no zone name.
    { timeZoneName: "long" },
    // @ts-expect-error Long time styles implicitly include a zone name.
    { timeStyle: "long" },
    // @ts-expect-error Full time styles implicitly include a zone name.
    { timeStyle: "full" },
  ];
  for (const options of prohibited) {
    assert.throws(() => formatTime("09:05", "en-GB", options), {
      name: "RangeError",
      message: /Clock time formatting/,
    });
  }
  const dateOptions: Intl.DateTimeFormatOptions = { year: "numeric" };
  // @ts-expect-error Non-literal date options must not evade the clock-only type contract.
  const clockOptions: TimeFormatOptions = dateOptions;
  assert.throws(() => formatTime("09:05", "en-GB", clockOptions), /year/);
  assert.throws(() => formatTime("09:05", "en-GB", Object.create({ weekday: "long" })), /weekday/);
});

test("clock formatting preserves allowed time fields without emitting date or zone labels", () => {
  const clockOptions: TimeFormatOptions[] = [
    {},
    { timeStyle: "short" },
    { timeStyle: "medium" },
    { hour12: false, second: "2-digit", fractionalSecondDigits: 3 },
  ];
  for (const language of ["en-GB", "fi", "ar"]) {
    for (const options of clockOptions) {
      assert.equal(
        formatTime("09:05:07", language, options),
        new Intl.DateTimeFormat(language, {
          ...(options.timeStyle === undefined
            ? { hour: "numeric", minute: "2-digit", second: "2-digit" }
            : {}),
          ...options,
          timeZone: "UTC",
        }).format(new Date(Date.UTC(1970, 0, 1, 9, 5, 7))),
      );
    }
  }
  assert.throws(
    () => formatTime({ hour: 9, minute: 5, second: null } as unknown as ClockTime, "en"),
    RangeError,
  );
  assert.equal(formatTime({ hour: 9, minute: 5, second: undefined }, "en-GB"), "9:05");
  assert.equal(formatTime("09:05", "en-GB", { hour: undefined, minute: undefined }), "9:05");
  assert.equal(
    formatTime("09:05:00", "en-GB", { hour: undefined, minute: undefined, second: undefined }),
    "9:05:00",
  );
});

test("date instants use native cross-realm timestamps and ignore overridden date methods", () => {
  const timestamp = Date.UTC(2026, 8, 30, 0, 30);
  const foreignDate: Date = runInNewContext(`new Date(${timestamp})`);
  assert.equal(foreignDate instanceof Date, false);
  const options = { timeZone: "America/Los_Angeles", dateStyle: "long" } as const;
  const expected = new Intl.DateTimeFormat("en-GB", options).format(timestamp);
  assert.equal(formatDate(foreignDate, "en-GB", options), expected);
  foreignDate.getTime = () => {
    throw new Error("Overridden getTime must not be called");
  };
  foreignDate.valueOf = () => 0;
  Object.defineProperty(foreignDate, Symbol.toPrimitive, { value: () => 0 });
  assert.equal(formatDate(foreignDate, "en-GB", options), expected);
  for (const invalid of [new Date(NaN), runInNewContext("new Date(NaN)")]) {
    assert.throws(() => formatDate(invalid, "en"), /Date must be valid/);
  }
  assert.throws(
    () =>
      formatDate(
        { [Symbol.toStringTag]: "Date", getTime: () => timestamp } as unknown as Date,
        "en",
      ),
    RangeError,
  );
});

test("date instants are detached before Intl option coercion can mutate the original", () => {
  const timestamp = Date.UTC(2026, 8, 30, 0, 30);
  const date = new Date(timestamp);
  const timeZone = {
    toString() {
      date.setTime(0);
      return "UTC";
    },
  };
  assert.equal(
    formatDate(date, "en-GB", { timeZone: timeZone as unknown as string, dateStyle: "long" }),
    new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", dateStyle: "long" }).format(timestamp),
  );
  assert.equal(date.getTime(), 0);
});

test("calendar dates remain UTC while Date instants honor the supplied zone", () => {
  const instant = new Date(Date.UTC(2026, 8, 30, 0, 30));
  const zone = "America/Los_Angeles";
  assert.notEqual(
    formatDate(instant, "en-GB", { timeZone: zone }),
    formatDate(instant, "en-GB", {
      timeZone: "UTC",
    }),
  );
  for (const calendar of ["2026-09-30", { year: 2026, month: 9, day: 30 }]) {
    assert.equal(formatDate(calendar, "en-GB", { timeZone: zone }), formatDate(calendar, "en-GB"));
    assert.equal(
      formatDate(calendar, "en-GB", { timeZone: "Not/AZone" }),
      formatDate(calendar, "en-GB"),
    );
    assert.equal(formatDate(calendar, "en-GB", { timeStyle: "short" }), "00:00");
  }
  assert.throws(() => formatDate(instant, "en-GB", { timeZone: "Not/AZone" }), RangeError);
  assert.equal(
    formatCurrency(1, "en", { currency: "ZZZ" }),
    new Intl.NumberFormat("en", { style: "currency", currency: "ZZZ" }).format(1),
  );
});

test("reuses formatters for equivalent options but distinguishes locales and effective options", t => {
  const NumberFormatter = Intl.NumberFormat;
  const DateTimeFormatter = Intl.DateTimeFormat;
  let numbers = 0;
  let dates = 0;
  t.mock.method(
    Intl,
    "NumberFormat",
    function (...args: ConstructorParameters<typeof Intl.NumberFormat>) {
      numbers++;
      return new NumberFormatter(...args);
    },
  );
  t.mock.method(
    Intl,
    "DateTimeFormat",
    function (...args: ConstructorParameters<typeof Intl.DateTimeFormat>) {
      dates++;
      return new DateTimeFormatter(...args);
    },
  );

  const options = { minimumFractionDigits: 2 };
  assert.equal(
    formatNumber(12.5, "en_ZA", options),
    new NumberFormatter("en-ZA", options).format(12.5),
  );
  assert.equal(
    formatNumber(13.5, "en-ZA", { minimumFractionDigits: 2 }),
    new NumberFormatter("en-ZA", options).format(13.5),
  );
  assert.equal(numbers, 1);
  options.minimumFractionDigits = 3;
  formatNumber(12.5, "en-ZA", options);
  formatNumber(12.5, "fi", options);
  formatNumber(12.5, "en-ZA", { ...options, language: "fi" });
  formatCurrency(12.5, "fi", { currency: "EUR" });
  formatCurrency(13.5, "fi", { currency: "eur" });
  formatCurrency(12.5, "fi", { currency: "USD" });
  assert.equal(numbers, 5);

  const date = "2026-09-30";
  const expected = new Date(Date.UTC(2026, 8, 30));
  assert.equal(
    formatDate(date, "en-ZA"),
    new DateTimeFormatter("en-ZA", {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      timeZone: "UTC",
    }).format(expected),
  );
  formatDate(date, "en_ZA", {});
  assert.equal(dates, 1);
  formatDate(date, "ja-JP");
  formatTime("09:05", "en-ZA");
  formatTime("10:05", "en-ZA");
  formatTime("09:05:00", "en-ZA");
  formatWeekday(0, "en-ZA", { width: "short" });
  formatWeekday(1, "en-ZA", { width: "short" });
  assert.equal(dates, 5);
  const instant = new Date(Date.UTC(2026, 8, 30));
  formatDate(instant, "en-ZA");
  formatDate(instant, "en-ZA");
  assert.equal(dates, 7);
});

test("bypasses unsafe options and keeps the formatter cache bounded", t => {
  const NumberFormatter = Intl.NumberFormat;
  let constructions = 0;
  t.mock.method(
    Intl,
    "NumberFormat",
    function (...args: ConstructorParameters<typeof Intl.NumberFormat>) {
      constructions++;
      return new NumberFormatter(...args);
    },
  );

  let coercions = 0;
  const dynamic = { valueOf: () => ++coercions };
  const options = { minimumFractionDigits: dynamic as unknown as number };
  formatNumber(1.5, "en", options);
  formatNumber(1.5, "en", options);
  assert.equal(coercions, 2);
  assert.equal(constructions, 2);
  assert.throws(() => formatNumber(1, "en", { minimumFractionDigits: 101 }), RangeError);
  assert.throws(() => formatNumber(1, "en", { minimumFractionDigits: 101 }), RangeError);
  const longOptions = { ignoredOption: "x".repeat(2048) } as Intl.NumberFormatOptions;
  formatNumber(1, "en", longOptions);
  formatNumber(1, "en", longOptions);
  assert.equal(constructions, 6);

  const before = constructions;
  for (let index = 0; index <= 70; index++) {
    formatNumber(1, `en-x-cache-${index}`);
  }
  assert.equal(constructions - before, 71);
  formatNumber(2, "en-x-cache-70");
  assert.equal(constructions - before, 71);
  formatNumber(2, "en-x-cache-0");
  assert.equal(constructions - before, 72);
});

test("opt-in Intl DOM extension updates formatted text with language changes", () => {
  const window = new Window();
  const translator = new Translator({ language: "en" });
  window.document.body.innerHTML = `
    <span id="currency" data-i18n-currency="12" data-i18n-currency-code="EUR" data-i18n-minimum-fraction-digits="0"></span>
    <span id="date" data-i18n-date="2026-09-30"></span>
    <span id="time" data-i18n-time="09:05"></span>
    <span id="weekday" data-i18n-weekday="0" data-i18n-weekday-width="short"></span>
  `;
  bindTranslator(translator, asParentNode(window.document.body), {
    extensions: [intlDomExtension()],
  });

  assert.equal(
    window.document.querySelector("#currency")!.textContent,
    translator.formatCurrency(12, { currency: "EUR", minimumFractionDigits: 0 }),
  );
  assert.equal(window.document.querySelector("#weekday")!.textContent, "Mon");

  translator.setLanguage("fi");
  assert.equal(
    window.document.querySelector("#currency")!.textContent,
    translator.formatCurrency(12, { currency: "EUR", minimumFractionDigits: 0 }),
  );
  assert.equal(
    window.document.querySelector("#weekday")!.textContent,
    translator.formatWeekday(0, { width: "short" }),
  );
});

test("Intl fraction markers accept only decimal integer digits from 0 through 20", () => {
  const window = new Window();
  const translator = new Translator({ language: "en" });
  const extension = intlDomExtension();
  for (const kind of ["number", "currency"]) {
    for (const name of ["minimum", "maximum"]) {
      const element = window.document.createElement("span");
      element.setAttribute(`data-i18n-${kind}`, "1.25");
      if (kind === "currency") element.setAttribute("data-i18n-currency-code", "EUR");
      const attribute = `data-i18n-${name}-fraction-digits`;
      const context = { translator, log() {} };
      for (const raw of [
        "",
        " ",
        "\t",
        "2\n",
        "2\r",
        " 2 ",
        "0x2",
        "2e0",
        "2.0",
        "+2",
        "-1",
        "21",
        "100",
        "Infinity",
      ]) {
        element.setAttribute(attribute, raw);
        element.textContent = "unchanged";
        assert.throws(() => extension.update(asElement(element), context), {
          name: "RangeError",
          message: `${attribute} must be an integer from 0 through 20`,
        });
        assert.equal(element.textContent, "unchanged");
      }
      for (const raw of ["0", "2", "02", "20"]) {
        element.setAttribute(attribute, raw);
        extension.update(asElement(element), context);
        const options = { [`${name}FractionDigits`]: Number(raw) };
        assert.equal(
          element.textContent,
          kind === "number"
            ? translator.formatNumber(1.25, options)
            : translator.formatCurrency(1.25, { ...options, currency: "EUR" }),
        );
      }
    }
  }
});
