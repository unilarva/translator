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
  formatCurrencyRange,
  formatCurrencyRangeToParts,
  formatCurrencyToParts,
  formatDateRange,
  formatDateRangeToParts,
  formatDateToParts,
  formatNumberRange,
  formatNumberRangeToParts,
  formatNumberToParts,
  formatRelativeTime,
  formatRelativeTimeToParts,
  formatTimeRange,
  formatTimeRangeToParts,
  formatTimeToParts,
  formatWeekdayToParts,
  type DateFormatOptions,
  type NumberFormatOptions,
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

test("date ranges preserve native UTC calendar pairs, instant zones, DST and equal endpoints", () => {
  const first = new Date("2026-03-08T06:30:00Z");
  const last = new Date("2026-03-08T08:30:00Z");
  for (const language of ["en-x-drnative", "fi-x-drnative", "ar-x-drnative", "ja-x-drnative"]) {
    for (const options of [
      {},
      { month: "long", day: "2-digit" },
      { dateStyle: "full" },
      { dateStyle: "medium", timeStyle: "short" },
      { year: undefined, month: "short" },
    ] as DateFormatOptions[]) {
      for (const end of ["2026-03-08", { year: 2026, month: 3, day: 10 }]) {
        const date =
          typeof end === "string" ? new Date(`${end}T00:00:00Z`) : new Date("2026-03-10T00:00:00Z");
        const effective = {
          ...(options.dateStyle === undefined && options.timeStyle === undefined
            ? ({ year: "numeric", month: "numeric", day: "numeric" } as const)
            : {}),
          ...options,
          timeZone: "UTC",
        };
        const native = new Intl.DateTimeFormat(language, effective);
        const start = new Date("2026-03-08T00:00:00Z");
        assert.equal(
          formatDateRange("2026-03-08", end, language, { ...options, timeZone: "Invalid/Zone" }),
          native.formatRange(start, date),
        );
        assert.deepEqual(
          formatDateRangeToParts("2026-03-08", end, language, {
            ...options,
            timeZone: "America/Los_Angeles",
          }),
          native.formatRangeToParts(start, date),
        );
        assert.equal(formatDateRange(end, end, language, options), native.formatRange(date, date));
      }
    }
    for (const timeZone of ["UTC", "America/New_York", "America/Los_Angeles"]) {
      const options = { dateStyle: "long", timeStyle: "long", timeZone } as const;
      const native = new Intl.DateTimeFormat(language, options);
      assert.equal(
        formatDateRange(first, last, language, options),
        native.formatRange(first, last),
      );
      assert.deepEqual(
        formatDateRangeToParts(first, last, language, options),
        native.formatRangeToParts(first, last),
      );
    }
  }
});

test("clock ranges match native pair-seconds defaults without synthetic date or zone leakage", () => {
  const choices: TimeFormatOptions[] = [
    {},
    { timeStyle: "short" },
    { timeStyle: "medium" },
    { hour: "2-digit", minute: "numeric", hourCycle: "h24" },
    { hour12: true, dayPeriod: "long" },
    { hour12: false, second: "numeric" },
    { fractionalSecondDigits: 3 },
    { hour: undefined, minute: undefined, second: undefined },
    { calendar: "islamic", numberingSystem: "arab", hourCycle: "h11" },
  ];
  const pairs: [string | ClockTime, string | ClockTime, number, number, boolean][] = [
    ["00:00", "00:00", 0, 0, false],
    ["00:00", "23:59", 0, 86340, false],
    ["09:05", "10:06:00", 32700, 36360, true],
    ["09:05:00", { hour: 10, minute: 6 }, 32700, 36360, true],
    [{ hour: 9, minute: 5, second: undefined }, "10:06", 32700, 36360, false],
    [{ hour: 0, minute: 0 }, { hour: 23, minute: 59, second: 59 }, 0, 86399, true],
    ["11:59:59", "12:00:00", 43199, 43200, true],
    ["12:00", "23:59:59", 43200, 86399, true],
  ];
  for (const language of [
    "en-US",
    "en-GB",
    "fi",
    "pt-BR",
    "ar-EG",
    "ja-JP",
    "zh-CN",
    "th-TH",
    "fa-IR",
    "he-IL",
    "hi-IN",
  ]) {
    for (const options of choices) {
      for (const [start, end, first, last, seconds] of pairs) {
        const native = new Intl.DateTimeFormat(language, {
          ...(options.timeStyle === undefined
            ? ({
                hour: "numeric",
                minute: "2-digit",
                ...(seconds ? { second: "2-digit" } : {}),
              } as const)
            : {}),
          ...Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined)),
          timeZone: "UTC",
        });
        const startDate = new Date(first * 1000);
        const endDate = new Date(last * 1000);
        const text = formatTimeRange(start, end, language, options);
        const parts = formatTimeRangeToParts(start, end, language, options);
        const context = JSON.stringify({ language, options, start, end, text, parts });
        assert.equal(text, native.formatRange(startDate, endDate), context);
        assert.deepEqual(parts, native.formatRangeToParts(startDate, endDate), context);
        assert.ok(
          parts.every(part =>
            ["hour", "minute", "second", "fractionalSecond", "dayPeriod", "literal"].includes(
              part.type,
            ),
          ),
          context,
        );
        // Equal ranges can retain single-value whitespace differences; ignore only whitespace here.
        assert.equal(
          text.replace(/\s/g, ""),
          parts
            .map(part => part.value)
            .join("")
            .replace(/\s/g, ""),
          context,
        );
      }
    }
  }
});

test("date and clock ranges reject invalid pairs, reversed endpoints and all clock restrictions", () => {
  for (const format of [formatDateRange, formatDateRangeToParts]) {
    for (const invalid of [
      "2026-02-30",
      "2026-3-01",
      "2026-03-01T00:00:00Z",
      new Date(NaN),
      runInNewContext("new Date(NaN)"),
      { year: 2026, month: 2, day: 29 },
      { [Symbol.toStringTag]: "Date", getTime: () => 0 },
    ]) {
      assert.throws(() => format(invalid as Date, "2026-03-10", "en"), RangeError);
      assert.throws(() => format("2026-03-01", invalid as Date, "en"), RangeError);
    }
    const date = new Date("2026-03-01T00:00:00Z");
    assert.throws(
      () => format(date, "2026-03-10", "en"),
      /both be calendar dates or both be Date instants/,
    );
    assert.throws(() => format({ year: 2026, month: 3, day: 1 }, date, "en"), RangeError);
    assert.throws(() => format("2026-03-10", "2026-03-01", "en"), RangeError);
    assert.throws(() => format(new Date("2026-03-10"), date, "en"), RangeError);
    assert.throws(() => format(date, date, "en", { timeZone: "Invalid/Zone" }), RangeError);
    assert.throws(() => format(date, date, "en", { dateStyle: "long", month: "long" }), TypeError);
    assert.throws(() => format(date, date, "not_a_locale!"), RangeError);
  }
  for (const format of [formatTimeRange, formatTimeRangeToParts]) {
    for (const invalid of [
      "24:00",
      "9:00",
      "09:00:60",
      { hour: 9, minute: 60 },
      { hour: 1.5, minute: 0 },
      { hour: 9, minute: 0, second: NaN },
    ]) {
      assert.throws(() => format(invalid, "10:00", "en"), RangeError);
      assert.throws(() => format("09:00", invalid, "en"), RangeError);
    }
    for (const [start, end] of [
      ["23:00", "01:00"],
      ["09:05:01", "09:05"],
      ["09:06", "09:05:59"],
    ])
      assert.throws(() => format(start, end, "en"), /overnight ranges are not inferred/);
    for (const field of [
      "dateStyle",
      "era",
      "year",
      "month",
      "day",
      "weekday",
      "timeZone",
      "timeZoneName",
    ]) {
      for (const options of [
        { [field]: undefined },
        { [field]: "long" },
        Object.create({ [field]: undefined }),
      ])
        assert.throws(
          () => format("09:00", "10:00", "en", options),
          new RegExp(`does not support ${field}`),
        );
    }
    for (const timeStyle of ["long", "full"])
      assert.throws(
        () => format("09:00", "10:00", "en", { timeStyle } as TimeFormatOptions),
        RangeError,
      );
    assert.throws(
      () => format("09:00", "10:00", "en", { timeStyle: "short", hour: "numeric" }),
      TypeError,
    );
    assert.throws(() => format("09:00", "10:00", "bad!"), RangeError);
  }
});

test("date ranges detach both native Date slots before option getters and coercions", () => {
  for (const format of [formatDateRange, formatDateRangeToParts]) {
    for (const getter of [false, true]) {
      const startTime = Date.UTC(2026, 8, 30, 0, 30);
      const endTime = Date.UTC(2026, 9, 2, 1, 30);
      const start = runInNewContext(`new Date(${startTime})`) as Date;
      const end = new Date(endTime);
      for (const date of [start, end]) {
        date.getTime = () => {
          throw new Error("Overridden getTime must not be called");
        };
        date.valueOf = () => 0;
        Object.defineProperty(date, Symbol.toPrimitive, { value: () => 0 });
      }
      const mutate = () => {
        start.setTime(NaN);
        end.setTime(0);
        return "UTC";
      };
      const options: DateFormatOptions = getter
        ? {
            get timeZone() {
              return mutate();
            },
            dateStyle: "long",
          }
        : { timeZone: { toString: mutate } as unknown as string, dateStyle: "long" };
      const native = new Intl.DateTimeFormat("en", { timeZone: "UTC", dateStyle: "long" });
      assert.deepEqual(
        format(start, end, "en", options),
        format === formatDateRange
          ? native.formatRange(startTime, endTime)
          : native.formatRangeToParts(startTime, endTime),
      );
      assert.ok(Number.isNaN(Date.prototype.getTime.call(start)));
      assert.equal(Date.prototype.getTime.call(end), 0);
    }
  }
});

test("date and clock range methods preserve locale policy, state, input ownership and fresh sources", () => {
  const translator = new Translator({ language: "fi", fallbackLanguage: "ja" });
  const events: unknown[] = [];
  translator.subscribe(event => events.push(event));
  translator.subscribeCatalog(event => events.push(event));
  translator.subscribeLanguages(event => events.push(event));
  const start = Object.freeze({ year: 2026, month: 3, day: 1 });
  const end = Object.freeze({ year: 2026, month: 3, day: 10 });
  const first = Object.freeze({ hour: 9, minute: 5 });
  const last = Object.freeze({ hour: 10, minute: 6, second: 0 });
  for (const language of [undefined, "en-US"]) {
    const options = Object.freeze({ language });
    const tag = language ?? "fi";
    assert.equal(translator.formatDateRange(start, end, options), formatDateRange(start, end, tag));
    assert.deepEqual(
      translator.formatDateRangeToParts(start, end, options),
      formatDateRangeToParts(start, end, tag),
    );
    assert.equal(
      translator.formatTimeRange(first, last, options),
      formatTimeRange(first, last, tag),
    );
    assert.deepEqual(
      translator.formatTimeRangeToParts(first, last, options),
      formatTimeRangeToParts(first, last, tag),
    );
  }
  assert.equal(translator.getLanguage(), "fi");
  assert.deepEqual(events, []);
  for (const call of [
    () => formatDateRangeToParts(start, end, "en"),
    () => translator.formatDateRangeToParts(start, end),
    () => formatTimeRangeToParts(first, last, "en"),
    () => translator.formatTimeRangeToParts(first, last),
  ]) {
    const parts = call();
    const expected = structuredClone(parts);
    assert.ok(parts.some(part => part.source === "startRange"));
    assert.ok(parts.some(part => part.source === "endRange"));
    assert.ok(parts.some(part => part.source === "shared"));
    parts[0].value = "changed";
    parts[0].source = "shared";
    parts.pop();
    assert.deepEqual(call(), expected);
    assert.notEqual(call()[0], call()[0]);
  }
});

test("date and clock ranges share formatter caches, snapshot options and bypass unsafe/host-zone caching", t => {
  const Native = Intl.DateTimeFormat;
  let constructions = 0;
  t.mock.method(Intl, "DateTimeFormat", function (...args: ConstructorParameters<typeof Native>) {
    constructions++;
    return new Native(...args);
  });
  formatDate("2026-03-01", "en-x-drcache");
  formatDateToParts("2026-03-01", "en-x-drcache");
  formatDateRange("2026-03-01", "2026-03-10", "EN_x_drcache");
  formatDateRangeToParts("2026-03-01", "2026-03-10", "en-x-drcache", { timeZone: "Ignored/Zone" });
  formatTime("09:05:00", "en-x-drcache");
  formatTimeToParts("09:05:00", "en-x-drcache");
  formatTimeRange("09:05", "10:06:00", "en-x-drcache");
  formatTimeRangeToParts("09:05:00", "10:06", "en-x-drcache");
  assert.equal(constructions, 2);
  let reads = 0;
  const options = {
    get hour(): "2-digit" {
      reads++;
      return "2-digit";
    },
  };
  formatDateRange("2026-03-01", "2026-03-10", "en-x-drreads", options);
  formatDateRangeToParts("2026-03-01", "2026-03-10", "en-x-drreads", options);
  formatTimeRange("09:05", "10:06", "en-x-drreads", options);
  formatTimeRangeToParts("09:05", "10:06", "en-x-drreads", options);
  assert.equal(reads, 4);
  let coercions = 0;
  const hour = {
    toString: () => {
      coercions++;
      return "numeric";
    },
  } as unknown as "numeric";
  const before = constructions;
  for (let index = 0; index < 2; index++) {
    formatDateRange("2026-03-01", "2026-03-10", "en-x-drcoerce", { hour });
    formatDateRangeToParts("2026-03-01", "2026-03-10", "en-x-drcoerce", { hour });
    formatTimeRange("09:05", "10:06", "en-x-drcoerce", { hour });
    formatTimeRangeToParts("09:05", "10:06", "en-x-drcoerce", { hour });
  }
  assert.equal(constructions - before, 8);
  assert.equal(coercions, 8);
  const original = process.env.TZ;
  t.after(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });
  const start = new Date("2026-03-01T00:30:00Z");
  const end = new Date("2026-03-02T00:30:00Z");
  const results: string[] = [];
  for (const timeZone of ["UTC", "America/Los_Angeles"]) {
    process.env.TZ = timeZone;
    const native = new Native("en", {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      timeZone,
    });
    const text = formatDateRange(start, end, "en-x-drhost");
    assert.equal(text, native.formatRange(start, end));
    assert.deepEqual(
      formatDateRangeToParts(start, end, "en-x-drhost"),
      native.formatRangeToParts(start, end),
    );
    results.push(text);
  }
  assert.notEqual(results[0], results[1]);
});

test("date and clock range diagnostics preserve original option/native errors even with failing loggers", t => {
  const entries: TranslatorLogEntry[] = [];
  const translator = new Translator({
    language: "fi",
    logger(entry) {
      entries.push(entry);
      throw new Error("Logger failed");
    },
  });
  const error = new Error("Range coercion failed");
  const hour = {
    toString() {
      throw error;
    },
  } as unknown as "numeric";
  const methods = [
    () => translator.formatDateRange("2026-03-01", "2026-03-10", { hour }),
    () => translator.formatDateRangeToParts("2026-03-01", "2026-03-10", { hour }),
    () => translator.formatTimeRange("09:05", "10:06", { hour }),
    () => translator.formatTimeRangeToParts("09:05", "10:06", { hour }),
  ];
  for (const call of [
    ...methods,
    () => formatDateRange("2026-03-01", "2026-03-10", "en", { hour }),
    () => formatDateRangeToParts("2026-03-01", "2026-03-10", "en", { hour }),
    () => formatTimeRange("09:05", "10:06", "en", { hour }),
    () => formatTimeRangeToParts("09:05", "10:06", "en", { hour }),
  ])
    assert.throws(call, thrown => thrown === error);
  const events = [
    "date-range-format-failed",
    "date-range-format-to-parts-failed",
    "time-range-format-failed",
    "time-range-format-to-parts-failed",
  ];
  assert.deepEqual(
    entries.map(entry => [entry.component, entry.event, entry.error, entry.details]),
    events.map(event => ["intl", event, error, { language: "fi" }]),
  );
  const nativeError = new Error("Native range failed");
  for (const method of ["formatRange", "formatRangeToParts"] as const)
    t.mock.method(Intl.DateTimeFormat.prototype, method, () => {
      throw nativeError;
    });
  const calls = [
    () => translator.formatDateRange("2026-03-01", "2026-03-10"),
    () => translator.formatDateRangeToParts("2026-03-01", "2026-03-10"),
    () => translator.formatTimeRange("09:05", "10:06"),
    () => translator.formatTimeRangeToParts("09:05", "10:06"),
  ];
  for (const call of calls) assert.throws(call, thrown => thrown === nativeError);
  assert.deepEqual(
    entries.slice(4).map(entry => [entry.event, entry.error]),
    events.map(event => [event, nativeError]),
  );
});

test("missing date-time range methods are isolated call-time capabilities on warmed formatters", async t => {
  const prototype = Intl.DateTimeFormat.prototype;
  const methods = ["formatRange", "formatRangeToParts"] as const;
  const descriptors = methods.map(method => Object.getOwnPropertyDescriptor(prototype, method)!);
  t.after(() =>
    methods.forEach((method, index) =>
      Object.defineProperty(prototype, method, descriptors[index]),
    ),
  );
  formatDateRange("2026-03-01", "2026-03-10", "en-x-drmiss");
  formatTimeRangeToParts("09:05", "10:06", "en-x-drmiss");
  const entries: TranslatorLogEntry[] = [];
  const translator = new Translator({
    language: "en-x-drmiss",
    logger: entry => entries.push(entry),
  });
  for (const [index, method] of methods.entries()) {
    Object.defineProperty(prototype, method, { ...descriptors[index], value: undefined });
    const modulePath = `../src/index.ts?missing-date-${method}`;
    const imported = await import(modulePath);
    const calls =
      method === "formatRange"
        ? [
            () => imported.formatDateRange("2026-03-01", "2026-03-10", "en-x-drmiss"),
            () => imported.formatTimeRange("09:05", "10:06", "en-x-drmiss"),
            () => translator.formatDateRange("2026-03-01", "2026-03-10"),
            () => translator.formatTimeRange("09:05", "10:06"),
          ]
        : [
            () => imported.formatDateRangeToParts("2026-03-01", "2026-03-10", "en-x-drmiss"),
            () => imported.formatTimeRangeToParts("09:05", "10:06", "en-x-drmiss"),
            () => translator.formatDateRangeToParts("2026-03-01", "2026-03-10"),
            () => translator.formatTimeRangeToParts("09:05", "10:06"),
          ];
    for (const call of calls)
      assert.throws(call, {
        name: "TypeError",
        message: new RegExp(
          `Intl\\.DateTimeFormat\\.prototype\\.${method} is unavailable.*supporting runtime.*polyfill`,
        ),
      });
    assert.equal(typeof imported.formatDate("2026-03-01", "en"), "string");
    assert.ok(imported.formatTimeToParts("09:05", "en").length > 0);
    assert.ok(imported.formatWeekdayToParts(0, "en").length > 0);
    assert.equal(typeof imported.formatNumberRange(1, 5, "en"), "string");
    assert.ok(imported.formatNumberRangeToParts(1, 5, "en").length > 0);
    assert.ok(imported.formatRelativeTimeToParts(1, "day", "en").length > 0);
    if (method === "formatRange") {
      assert.ok(translator.formatDateRangeToParts("2026-03-01", "2026-03-10").length > 0);
      assert.ok(translator.formatTimeRangeToParts("09:05", "10:06").length > 0);
    } else {
      assert.equal(typeof translator.formatDateRange("2026-03-01", "2026-03-10"), "string");
      assert.equal(typeof translator.formatTimeRange("09:05", "10:06"), "string");
    }
    Object.defineProperty(prototype, method, descriptors[index]);
  }
  assert.deepEqual(
    entries.map(entry => entry.event),
    [
      "date-range-format-failed",
      "time-range-format-failed",
      "date-range-format-to-parts-failed",
      "time-range-format-to-parts-failed",
    ],
  );
  assert.ok(entries.every(entry => entry.error instanceof TypeError));
});

test("numeric ranges preserve native descending, equal, rounded, signed-zero and affix semantics", () => {
  const choices: NumberFormatOptions[] = [
    {},
    { notation: "compact" },
    { style: "percent", signDisplay: "always" },
    { style: "unit", unit: "kilometer", unitDisplay: "long" },
    { maximumFractionDigits: 0, roundingMode: "halfEven", useGrouping: "min2" },
    { minimumFractionDigits: 2, maximumFractionDigits: 2, roundingIncrement: 5 },
    { minimumFractionDigits: 2, trailingZeroDisplay: "stripIfInteger" },
    { maximumFractionDigits: 1, maximumSignificantDigits: 2, roundingPriority: "morePrecision" },
  ];
  for (const language of ["en-x-rnative", "fi-x-rnative", "ar-x-rnative"]) {
    for (const options of choices) {
      const native = new Intl.NumberFormat(language, options);
      const currency = new Intl.NumberFormat(language, {
        ...options,
        style: "currency",
        currency: "EUR",
      });
      for (const [start, end] of [
        [-1234.5, 5678.9],
        [5, 1],
        [-1, -5],
        [1, 1],
        [1.21, 1.24],
        [-0, 0],
        [0, -0],
        [-0, -0],
        [0, 0],
      ]) {
        assert.equal(
          formatNumberRange(start, end, language, options),
          native.formatRange(start, end),
        );
        assert.deepEqual(
          formatNumberRangeToParts(start, end, language, options),
          native.formatRangeToParts(start, end),
        );
        assert.equal(
          formatCurrencyRange(start, end, language, { ...options, currency: "eur" }),
          currency.formatRange(start, end),
        );
        assert.deepEqual(
          formatCurrencyRangeToParts(start, end, language, { ...options, currency: "eur" }),
          currency.formatRangeToParts(start, end),
        );
      }
    }
    for (const currency of ["jpy", "kwd", "zzz"]) {
      const native = new Intl.NumberFormat(language, {
        style: "currency",
        currency: currency.toUpperCase(),
      });
      assert.equal(
        formatCurrencyRange(1.234, 5.678, language, { currency }),
        native.formatRange(1.234, 5.678),
      );
      assert.deepEqual(
        formatCurrencyRangeToParts(1.234, 5.678, language, { currency }),
        native.formatRangeToParts(1.234, 5.678),
      );
    }
  }
  assert.deepEqual(
    new Set(formatNumberRangeToParts(1, 5, "en-x-rmeta").map(part => part.source)),
    new Set(["startRange", "endRange", "shared"]),
  );
  for (const parts of [
    formatNumberRangeToParts(1, 1, "en-x-rmeta"),
    formatNumberRangeToParts(1.21, 1.24, "en-x-rmeta", { maximumFractionDigits: 0 }),
    formatCurrencyRangeToParts(1, 1, "en-x-rmeta", { currency: "EUR" }),
  ]) {
    assert.ok(parts.some(part => part.type === "approximatelySign"));
    assert.ok(parts.every(part => part.source === "shared"));
  }
});

test("numeric range methods resolve locales without catalog fallback, events or option mutation", () => {
  const entries: TranslatorLogEntry[] = [];
  const translator = new Translator({
    language: "en-x-rmethod",
    fallbackLanguage: "ar",
    logger: entry => entries.push(entry),
  });
  translator.setTranslation("item", { ar: "Fallback only" });
  let notifications = 0;
  translator.subscribe(() => notifications++);
  translator.subscribeCatalog(() => notifications++);
  translator.subscribeLanguages(() => notifications++);
  entries.length = 0;
  for (const language of ["en-x-rmethod", "fi-x-rmethod"]) {
    translator.setLanguage(language);
    assert.equal(translator.formatNumberRange(5, 1), formatNumberRange(5, 1, language));
    assert.deepEqual(
      translator.formatNumberRangeToParts(-0, 0),
      formatNumberRangeToParts(-0, 0, language),
    );
    assert.equal(
      translator.formatCurrencyRange(1, 5, { currency: "eur" }),
      formatCurrencyRange(1, 5, language, { currency: "EUR" }),
    );
    assert.deepEqual(
      translator.formatCurrencyRangeToParts(1, 5, { currency: "eur" }),
      formatCurrencyRangeToParts(1, 5, language, { currency: "EUR" }),
    );
  }
  const number = Object.freeze({ language: " en_GB ", maximumFractionDigits: 1 });
  const currency = Object.freeze({ ...number, currency: "eur", style: "percent" as const });
  assert.equal(
    translator.formatNumberRange(1, 5, number),
    formatNumberRange(1, 5, "!invalid!", number),
  );
  assert.deepEqual(
    translator.formatNumberRangeToParts(1, 5, number),
    formatNumberRangeToParts(1, 5, "!invalid!", number),
  );
  assert.equal(
    translator.formatCurrencyRange(1, 5, currency),
    formatCurrencyRange(1, 5, "!invalid!", currency),
  );
  assert.deepEqual(
    translator.formatCurrencyRangeToParts(1, 5, currency),
    formatCurrencyRangeToParts(1, 5, "!invalid!", currency),
  );
  assert.equal(translator.getLanguage(), "fi-x-rmethod");
  assert.equal(translator.translateKey("item"), "Fallback only");
  assert.equal(notifications, 1);
  assert.equal(currency.currency, "eur");
  assert.equal(currency.style, "percent");
  assert.ok(entries.every(entry => entry.component !== "intl"));
});

test("numeric range parts and source metadata are fresh mutable native results", () => {
  const translator = new Translator({ language: "en-x-rowner" });
  for (const parts of [
    () => formatNumberRangeToParts(1, 5, "en-x-rowner"),
    () => formatCurrencyRangeToParts(1, 5, "en-x-rowner", { currency: "EUR" }),
    () => translator.formatNumberRangeToParts(1, 5),
    () => translator.formatCurrencyRangeToParts(1, 5, { currency: "EUR" }),
  ]) {
    const first = parts();
    const second = parts();
    assert.deepEqual(first, second);
    assert.notEqual(first, second);
    assert.equal(Object.isFrozen(first), false);
    for (let index = 0; index < first.length; index++) {
      assert.notEqual(first[index], second[index]);
      assert.equal(Object.isFrozen(first[index]), false);
      first[index].source = "shared";
      first[index].value = "changed";
    }
    first.splice(0);
    assert.deepEqual(parts(), second);
  }
});

test("numeric ranges reject either invalid endpoint without coercion and validate currency/locale/options", () => {
  const translator = new Translator();
  const object = {
    valueOf() {
      throw new Error("Must not coerce endpoints");
    },
  };
  const calls = [
    (start: number, end: number) => formatNumberRange(start, end, "en-x-rinvalid"),
    (start: number, end: number) => formatNumberRangeToParts(start, end, "en-x-rinvalid"),
    (start: number, end: number) =>
      formatCurrencyRange(start, end, "en-x-rinvalid", { currency: "EUR" }),
    (start: number, end: number) =>
      formatCurrencyRangeToParts(start, end, "en-x-rinvalid", { currency: "EUR" }),
    (start: number, end: number) => translator.formatNumberRange(start, end),
    (start: number, end: number) => translator.formatNumberRangeToParts(start, end),
    (start: number, end: number) => translator.formatCurrencyRange(start, end, { currency: "EUR" }),
    (start: number, end: number) =>
      translator.formatCurrencyRangeToParts(start, end, { currency: "EUR" }),
  ];
  for (const value of [NaN, Infinity, -Infinity, "1", null, undefined, 1n, new Number(1), object]) {
    for (const call of calls) {
      assert.throws(() => call(value as number, 1), /Range start must be a finite number/);
      assert.throws(() => call(1, value as number), /Range end must be a finite number/);
    }
  }
  for (const currency of ["EU", "EURO", "€€€", " E "]) {
    assert.throws(() => formatCurrencyRange(1, 5, "en", { currency }), RangeError);
    assert.throws(() => formatCurrencyRangeToParts(1, 5, "en", { currency }), RangeError);
  }
  // @ts-expect-error Currency options remain required.
  assert.throws(() => formatCurrencyRange(1, 5, "en"), RangeError);
  // @ts-expect-error Currency range parts also require options.
  assert.throws(() => formatCurrencyRangeToParts(1, 5, "en"), RangeError);
  for (const language of ["", " ", "invalid_!"]) {
    assert.throws(() => formatNumberRange(1, 5, language), RangeError);
    assert.throws(() => formatNumberRangeToParts(1, 5, language), RangeError);
    assert.throws(() => formatCurrencyRange(1, 5, language, { currency: "EUR" }), RangeError);
    assert.throws(
      () => formatCurrencyRangeToParts(1, 5, language, { currency: "EUR" }),
      RangeError,
    );
  }
  assert.throws(() => formatNumberRange(1, 5, "en", { minimumFractionDigits: -1 }), RangeError);
  assert.throws(
    () => formatNumberRangeToParts(1, 5, "en", { minimumFractionDigits: -1 }),
    RangeError,
  );
  assert.throws(
    () => formatCurrencyRange(1, 5, "en", { currency: "EUR", maximumFractionDigits: -1 }),
    RangeError,
  );
  assert.throws(
    () => formatCurrencyRangeToParts(1, 5, "en", { currency: "EUR", maximumFractionDigits: -1 }),
    RangeError,
  );
});

test("numeric range diagnostics retain original errors and operation-specific events", t => {
  const entries: TranslatorLogEntry[] = [];
  const translator = new Translator({
    language: "fi",
    logger(entry) {
      entries.push(entry);
      throw new Error("Logger failed");
    },
  });
  const error = new Error("Range option coercion failed");
  const dynamic = {
    toString() {
      throw error;
    },
  };
  const number = { style: dynamic as unknown as "decimal" };
  const currency = { currency: "EUR", currencyDisplay: dynamic as unknown as "symbol" };
  for (const call of [
    () => translator.formatNumberRange(1, 5, number),
    () => translator.formatNumberRangeToParts(1, 5, number),
    () => translator.formatCurrencyRange(1, 5, currency),
    () => translator.formatCurrencyRangeToParts(1, 5, currency),
    () => formatNumberRange(1, 5, "en", number),
    () => formatNumberRangeToParts(1, 5, "en", number),
    () => formatCurrencyRange(1, 5, "en", currency),
    () => formatCurrencyRangeToParts(1, 5, "en", currency),
  ])
    assert.throws(call, thrown => thrown === error);
  const events = [
    "number-range-format-failed",
    "number-range-format-to-parts-failed",
    "currency-range-format-failed",
    "currency-range-format-to-parts-failed",
  ];
  assert.deepEqual(
    entries.map(entry => [entry.component, entry.event, entry.error, entry.details]),
    events.map(event => ["intl", event, error, { language: "fi" }]),
  );
  const nativeError = new Error("Native range failure");
  for (const method of ["formatRange", "formatRangeToParts"] as const) {
    t.mock.method(Intl.NumberFormat.prototype, method, () => {
      throw nativeError;
    });
  }
  for (const call of [
    () => translator.formatNumberRange(1, 5),
    () => translator.formatNumberRangeToParts(1, 5),
    () => translator.formatCurrencyRange(1, 5, { currency: "EUR" }),
    () => translator.formatCurrencyRangeToParts(1, 5, { currency: "EUR" }),
  ])
    assert.throws(call, thrown => thrown === nativeError);
  assert.deepEqual(
    entries.slice(4).map(entry => [entry.event, entry.error]),
    events.map(event => [event, nativeError]),
  );
});

test("numeric ranges share string/parts caches and retain snapshots and unsafe-coercion bypasses", t => {
  const Native = Intl.NumberFormat;
  let constructions = 0;
  t.mock.method(Intl, "NumberFormat", function (...args: ConstructorParameters<typeof Native>) {
    constructions++;
    return new Native(...args);
  });
  formatNumber(1, "en-x-rcache", { minimumFractionDigits: 2 });
  formatNumberToParts(2, "en-x-rcache", { minimumFractionDigits: 2 });
  formatNumberRange(1, 5, "EN_x_rcache", { minimumFractionDigits: 2 });
  formatNumberRangeToParts(2, 6, "en-x-rcache", { minimumFractionDigits: 2 });
  formatCurrency(1, "en-x-rcache", { currency: "eur" });
  formatCurrencyToParts(2, "en-x-rcache", { currency: "EUR" });
  formatCurrencyRange(1, 5, "en-x-rcache", { currency: "EUR" });
  formatCurrencyRangeToParts(2, 6, "en-x-rcache", { currency: "eur" });
  formatNumberRange(1, 5, "en-x-rcache", { style: "currency", currency: "EUR" });
  assert.equal(constructions, 2);
  let reads = 0;
  const options = {
    get minimumFractionDigits() {
      reads++;
      return 1;
    },
  };
  formatNumberRange(1, 5, "en-x-rreads", options);
  formatNumberRangeToParts(1, 5, "en-x-rreads", options);
  let currencyReads = 0;
  const currencyOptions = {
    get currency() {
      currencyReads++;
      return "eur";
    },
    get minimumFractionDigits() {
      reads++;
      return 1;
    },
  };
  formatCurrencyRange(1, 5, "en-x-rreads", currencyOptions);
  formatCurrencyRangeToParts(1, 5, "en-x-rreads", currencyOptions);
  assert.equal(reads, 4);
  // Retain the existing validation read followed by the currency option snapshot read.
  assert.equal(currencyReads, 4);
  let coercions = 0;
  const digits = { valueOf: () => ++coercions };
  const dynamic = { minimumFractionDigits: digits as unknown as number };
  const before = constructions;
  assert.equal(
    formatNumberRange(1, 5, "en-x-rcoerce", dynamic),
    new Native("en", { minimumFractionDigits: 1 }).formatRange(1, 5),
  );
  assert.deepEqual(
    formatNumberRangeToParts(1, 5, "en-x-rcoerce", dynamic),
    new Native("en", { minimumFractionDigits: 2 }).formatRangeToParts(1, 5),
  );
  formatCurrencyRange(1, 5, "en-x-rcoerce", { ...dynamic, currency: "EUR" });
  formatCurrencyRangeToParts(1, 5, "en-x-rcoerce", { ...dynamic, currency: "EUR" });
  assert.equal(coercions, 4);
  assert.equal(constructions - before, 4);
});

test("missing numeric range methods are isolated call-time capabilities, including cached formatters", async t => {
  const prototype = Intl.NumberFormat.prototype;
  const methods = ["formatRange", "formatRangeToParts"] as const;
  const descriptors = methods.map(method => Object.getOwnPropertyDescriptor(prototype, method)!);
  t.after(() =>
    methods.forEach((method, index) =>
      Object.defineProperty(prototype, method, descriptors[index]),
    ),
  );
  // Warm the shared cache before removing host methods; capabilities must not be cached or bound.
  formatNumberRange(1, 5, "en-x-rmissing");
  formatNumberRangeToParts(1, 5, "en-x-rmissing");
  const entries: TranslatorLogEntry[] = [];
  const translator = new Translator({
    language: "en-x-rmissing",
    logger: entry => entries.push(entry),
  });
  for (const [index, method] of methods.entries()) {
    Object.defineProperty(prototype, method, { ...descriptors[index], value: undefined });
    const modulePath = `../src/index.ts?missing-${method}`;
    const imported = await import(modulePath);
    const calls =
      method === "formatRange"
        ? [
            () => imported.formatNumberRange(1, 5, "en-x-rmissing"),
            () => imported.formatCurrencyRange(1, 5, "en", { currency: "EUR" }),
            () => translator.formatNumberRange(1, 5),
            () => translator.formatCurrencyRange(1, 5, { currency: "EUR" }),
          ]
        : [
            () => imported.formatNumberRangeToParts(1, 5, "en-x-rmissing"),
            () => imported.formatCurrencyRangeToParts(1, 5, "en", { currency: "EUR" }),
            () => translator.formatNumberRangeToParts(1, 5),
            () => translator.formatCurrencyRangeToParts(1, 5, { currency: "EUR" }),
          ];
    const before = entries.length;
    for (const call of calls)
      assert.throws(call, {
        name: "TypeError",
        message: new RegExp(
          `Intl\\.NumberFormat\\.prototype\\.${method} is unavailable.*supporting runtime.*polyfill`,
        ),
      });
    assert.equal(entries.length - before, 2);
    assert.ok(entries.slice(before).every(entry => entry.error instanceof TypeError));
    assert.equal(typeof imported.formatNumber(1, "en"), "string");
    assert.equal(typeof translator.formatCurrency(1, { currency: "EUR" }), "string");
    assert.deepEqual(
      imported.formatNumberToParts(1, "en"),
      new Intl.NumberFormat("en").formatToParts(1),
    );
    assert.deepEqual(
      translator.formatCurrencyToParts(1, { currency: "EUR" }),
      formatCurrencyToParts(1, "en", { currency: "EUR" }),
    );
    assert.equal(typeof imported.formatDate("2026-10-27", "en"), "string");
    assert.ok(imported.formatTimeToParts("09:05", "en").length > 0);
    assert.ok(imported.formatRelativeTimeToParts(1, "day", "en").length > 0);
    if (method === "formatRange") {
      assert.deepEqual(
        translator.formatNumberRangeToParts(1, 5),
        formatNumberRangeToParts(1, 5, "en"),
      );
      assert.ok(imported.formatCurrencyRangeToParts(1, 5, "en", { currency: "EUR" }).length > 0);
    } else {
      assert.equal(translator.formatNumberRange(1, 5), formatNumberRange(1, 5, "en"));
      assert.equal(typeof imported.formatCurrencyRange(1, 5, "en", { currency: "EUR" }), "string");
    }
    Object.defineProperty(prototype, method, descriptors[index]);
  }
  assert.deepEqual(
    entries.map(entry => entry.event),
    [
      "number-range-format-failed",
      "currency-range-format-failed",
      "number-range-format-to-parts-failed",
      "currency-range-format-to-parts-failed",
    ],
  );
});

test("number and currency parts preserve native output and newly typed rounding options", () => {
  const choices: NumberFormatOptions[] = [
    {},
    { notation: "compact" },
    { style: "percent", signDisplay: "always" },
    { style: "unit", unit: "kilometer", unitDisplay: "long" },
    { maximumFractionDigits: 0, roundingMode: "halfEven", useGrouping: "min2" },
    { minimumFractionDigits: 2, maximumFractionDigits: 2, roundingIncrement: 5 },
    { minimumFractionDigits: 2, trailingZeroDisplay: "stripIfInteger" },
    { maximumFractionDigits: 1, maximumSignificantDigits: 2, roundingPriority: "morePrecision" },
  ];
  for (const language of ["en-x-parts-native", "fi-x-parts-native", "ar-x-parts-native"]) {
    for (const options of choices) {
      const currencyOptions = { ...options, currency: "eur" };
      const nativeNumber = new Intl.NumberFormat(language, options);
      const nativeCurrency = new Intl.NumberFormat(language, {
        ...options,
        style: "currency",
        currency: "EUR",
      });
      for (const value of [-1234.5, -0, 0, 2.5, 1234.567]) {
        assert.deepEqual(
          formatNumberToParts(value, language, options),
          nativeNumber.formatToParts(value),
        );
        assert.deepEqual(
          formatCurrencyToParts(value, language, currencyOptions),
          nativeCurrency.formatToParts(value),
        );
        assert.equal(formatNumber(value, language, options), nativeNumber.format(value));
        assert.equal(
          formatCurrency(value, language, currencyOptions),
          nativeCurrency.format(value),
        );
      }
    }
  }
  assert.deepEqual(
    formatCurrencyToParts(1, "en", { currency: "zzz" }),
    new Intl.NumberFormat("en", { currency: "ZZZ", style: "currency" }).formatToParts(1),
  );
});

test("relative-time parts preserve native literal/unit structure, units and signed amounts", () => {
  const units: Intl.RelativeTimeFormatUnit[] = [
    "year",
    "quarters",
    "month",
    "weeks",
    "day",
    "hours",
    "minute",
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
          assert.deepEqual(
            formatRelativeTimeToParts(value, unit, language, options),
            native.formatToParts(value, unit),
          );
        }
      }
    }
  }
  const literal = formatRelativeTimeToParts(-1, "day", "en", { numeric: "auto" });
  assert.deepEqual(literal, [{ type: "literal", value: "yesterday" }]);
  assert.equal("unit" in literal[0], false);
});

test("parts methods resolve active and explicit locales without changing state or caller options", () => {
  const translator = new Translator({ language: "en-x-methods", fallbackLanguage: "ar" });
  translator.setTranslation("item", { ar: "Fallback only" });
  let notifications = 0;
  translator.subscribe(() => notifications++);
  translator.subscribeCatalog(() => notifications++);
  translator.subscribeLanguages(() => notifications++);
  for (const language of ["en-x-methods", "fi-x-methods"]) {
    translator.setLanguage(language);
    assert.deepEqual(
      translator.formatNumberToParts(1234.5),
      new Intl.NumberFormat(language).formatToParts(1234.5),
    );
    assert.deepEqual(
      translator.formatCurrencyToParts(12, { currency: "eur" }),
      new Intl.NumberFormat(language, { style: "currency", currency: "EUR" }).formatToParts(12),
    );
    assert.deepEqual(
      translator.formatRelativeTimeToParts(-2, "days"),
      new Intl.RelativeTimeFormat(language).formatToParts(-2, "days"),
    );
    assert.deepEqual(
      translator.formatDateToParts("2026-10-27"),
      formatDateToParts("2026-10-27", language),
    );
    assert.deepEqual(translator.formatTimeToParts("09:05"), formatTimeToParts("09:05", language));
    assert.deepEqual(translator.formatWeekdayToParts(0), formatWeekdayToParts(0, language));
  }
  const numberOptions = Object.freeze({ language: " en_GB ", maximumFractionDigits: 1 });
  const currencyOptions = Object.freeze({
    language: " en_GB ",
    currency: "eur",
    style: "percent" as const,
  });
  const relativeOptions = Object.freeze({ language: " en_GB ", numeric: "auto" as const });
  const dateOptions = Object.freeze({
    language: " en_GB ",
    dateStyle: "long" as const,
    timeZone: "Not/AZone",
  });
  const timeOptions = Object.freeze({ language: " en_GB ", hour12: false });
  const weekdayOptions = Object.freeze({ language: " en_GB ", width: "short" as const });
  assert.deepEqual(
    translator.formatNumberToParts(1.25, numberOptions),
    formatNumberToParts(1.25, "!invalid!", numberOptions),
  );
  assert.deepEqual(
    translator.formatCurrencyToParts(12, currencyOptions),
    formatCurrencyToParts(12, "!invalid!", currencyOptions),
  );
  assert.deepEqual(
    translator.formatRelativeTimeToParts(-1, "day", relativeOptions),
    formatRelativeTimeToParts(-1, "day", "!invalid!", relativeOptions),
  );
  assert.deepEqual(
    translator.formatDateToParts("2026-10-27", dateOptions),
    formatDateToParts("2026-10-27", "!invalid!", dateOptions),
  );
  assert.deepEqual(
    translator.formatTimeToParts("09:05", timeOptions),
    formatTimeToParts("09:05", "!invalid!", timeOptions),
  );
  assert.deepEqual(
    translator.formatWeekdayToParts(0, weekdayOptions),
    formatWeekdayToParts(0, "!invalid!", weekdayOptions),
  );
  assert.equal(translator.getLanguage(), "fi-x-methods");
  assert.equal(translator.translateKey("item"), "Fallback only");
  assert.equal(notifications, 1);
  assert.equal(currencyOptions.currency, "eur");
  assert.equal(currencyOptions.style, "percent");
});

test("parts arrays and records are fresh, mutable caller-owned results", () => {
  const translator = new Translator({ language: "en" });
  for (const parts of [
    () => formatNumberToParts(1234.5, "en"),
    () => formatCurrencyToParts(1234.5, "en", { currency: "EUR" }),
    () => formatRelativeTimeToParts(-2, "days", "en"),
    () => translator.formatNumberToParts(1234.5),
    () => translator.formatCurrencyToParts(1234.5, { currency: "EUR" }),
    () => translator.formatRelativeTimeToParts(-2, "days"),
    () => formatDateToParts("2026-10-27", "en"),
    () => formatTimeToParts("09:05", "en"),
    () => formatWeekdayToParts(0, "en"),
    () => translator.formatDateToParts("2026-10-27"),
    () => translator.formatTimeToParts("09:05"),
    () => translator.formatWeekdayToParts(0),
  ]) {
    const first = parts();
    const second = parts();
    assert.deepEqual(first, second);
    assert.notEqual(first, second);
    assert.notEqual(first[0], second[0]);
    first[0].value = "changed";
    first.splice(0);
    assert.deepEqual(parts(), second);
  }
});

test("parts reject invalid numeric values, currencies, locales, units and options", () => {
  const object = {
    valueOf() {
      throw new Error("Must not coerce input");
    },
  };
  for (const value of [NaN, Infinity, -Infinity, "1", null, undefined, 1n, object]) {
    assert.throws(() => formatNumberToParts(value as number, "en"), RangeError);
    assert.throws(
      () => formatCurrencyToParts(value as number, "en", { currency: "EUR" }),
      RangeError,
    );
    assert.throws(() => formatRelativeTimeToParts(value as number, "day", "en"), RangeError);
  }
  for (const language of ["", " ", "invalid_!"]) {
    assert.throws(() => formatNumberToParts(1, language), RangeError);
    assert.throws(() => formatCurrencyToParts(1, language, { currency: "EUR" }), RangeError);
    assert.throws(() => formatRelativeTimeToParts(1, "day", language), RangeError);
  }
  for (const currency of ["EU", "EURO", "€€€", " E "]) {
    assert.throws(() => formatCurrencyToParts(1, "en", { currency }), RangeError);
  }
  // @ts-expect-error Currency options are required.
  assert.throws(() => formatCurrencyToParts(1, "en"), RangeError);
  assert.throws(() => formatNumberToParts(1, "en", { minimumFractionDigits: -1 }), RangeError);
  assert.throws(
    () => formatCurrencyToParts(1, "en", { currency: "EUR", maximumFractionDigits: -1 }),
    RangeError,
  );
  // @ts-expect-error Native unit names only.
  assert.throws(() => formatRelativeTimeToParts(1, "fortnight", "en"), RangeError);
  assert.throws(
    // @ts-expect-error Native numeric modes only.
    () => formatRelativeTimeToParts(1, "day", "en", { numeric: "sometimes" }),
    RangeError,
  );
});

test("parts diagnostics preserve error identity and stable events despite logger failures", () => {
  const entries: TranslatorLogEntry[] = [];
  const translator = new Translator({
    language: "fi",
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
  const number = { style: dynamic as unknown as "decimal" };
  const currency = { currency: "EUR", currencyDisplay: dynamic as unknown as "symbol" };
  const relative = { numeric: dynamic as unknown as "auto" };
  for (const call of [
    () => translator.formatNumberToParts(1, number),
    () => translator.formatCurrencyToParts(1, currency),
    () => translator.formatRelativeTimeToParts(1, "day", relative),
    () => formatNumberToParts(1, "en", number),
    () => formatCurrencyToParts(1, "en", currency),
    () => formatRelativeTimeToParts(1, "day", "en", relative),
  ])
    assert.throws(call, thrown => thrown === error);
  assert.deepEqual(
    entries.map(entry => [entry.component, entry.event, entry.error, entry.details]),
    [
      ["intl", "number-format-to-parts-failed", error, { language: "fi" }],
      ["intl", "currency-format-to-parts-failed", error, { language: "fi" }],
      ["intl", "relative-time-format-to-parts-failed", error, { language: "fi" }],
    ],
  );
});

test("parts share string caches while preserving option-read and coercion contracts", t => {
  const NumberFormatter = Intl.NumberFormat;
  const Relative = Intl.RelativeTimeFormat;
  let numbers = 0;
  let relatives = 0;
  t.mock.method(
    Intl,
    "NumberFormat",
    function (...args: ConstructorParameters<typeof NumberFormatter>) {
      numbers++;
      return new NumberFormatter(...args);
    },
  );
  t.mock.method(
    Intl,
    "RelativeTimeFormat",
    function (...args: ConstructorParameters<typeof Relative>) {
      relatives++;
      return new Relative(...args);
    },
  );
  formatNumber(1, "en-x-parts", { minimumFractionDigits: 2 });
  formatNumberToParts(2, "EN_x_parts", { minimumFractionDigits: 2 });
  formatCurrency(1, "en-x-parts", { currency: "eur" });
  formatCurrencyToParts(2, "en-x-parts", { currency: "EUR" });
  formatNumberToParts(3, "en-x-parts", { currency: "EUR", style: "currency" });
  formatRelativeTime(1, "day", "en-x-parts", { numeric: "auto" });
  formatRelativeTimeToParts(2, "hours", "EN_x_parts", { numeric: "auto" });
  assert.equal(numbers, 2);
  assert.equal(relatives, 1);

  let reads = 0;
  const numberOptions = {
    get minimumFractionDigits() {
      reads++;
      return 1;
    },
  };
  formatNumber(1, "en-x-reads", numberOptions);
  formatNumberToParts(2, "en-x-reads", numberOptions);
  assert.equal(reads, 2);
  let numeric: "auto" | "always" = "auto";
  const relativeOptions = Object.create({
    get numeric() {
      return numeric;
    },
  });
  Object.defineProperty(relativeOptions, "ignoredOption", {
    enumerable: true,
    get() {
      throw new Error("Unknown getters must not run");
    },
  });
  assert.deepEqual(
    formatRelativeTimeToParts(0, "day", "en", relativeOptions),
    new Relative("en", { numeric: "auto" }).formatToParts(0, "day"),
  );
  numeric = "always";
  assert.deepEqual(
    formatRelativeTimeToParts(0, "day", "en", relativeOptions),
    new Relative("en", { numeric: "always" }).formatToParts(0, "day"),
  );
  const nonEnumerable = Object.defineProperty({}, "numeric", { value: "auto" });
  assert.deepEqual(
    formatRelativeTimeToParts(0, "day", "en", nonEnumerable),
    new Relative("en", { numeric: "auto" }).formatToParts(0, "day"),
  );
  let coercions = 0;
  const digits = { valueOf: () => ++coercions };
  const dynamicNumber = { minimumFractionDigits: digits as unknown as number };
  formatNumber(1, "en-x-coerce", dynamicNumber);
  formatNumberToParts(1, "en-x-coerce", dynamicNumber);
  assert.equal(coercions, 2);
  coercions = 0;
  const dynamicRelative = {
    numeric: { toString: () => (++coercions === 1 ? "auto" : "always") } as unknown as "auto",
  };
  assert.notDeepEqual(
    formatRelativeTime(0, "day", "en", dynamicRelative),
    formatRelativeTimeToParts(0, "day", "en", dynamicRelative)
      .map(part => part.value)
      .join(""),
  );
  assert.equal(coercions, 2);
});

test("missing parts methods fail only on request with actionable diagnostics", async t => {
  const NumberFormatter = Intl.NumberFormat;
  const Relative = Intl.RelativeTimeFormat;
  const entries: TranslatorLogEntry[] = [];
  const translator = new Translator({ logger: entry => entries.push(entry) });
  const numberDescriptor = Object.getOwnPropertyDescriptor(
    NumberFormatter.prototype,
    "formatToParts",
  )!;
  const relativeDescriptor = Object.getOwnPropertyDescriptor(Relative.prototype, "formatToParts")!;
  t.after(() => {
    Object.defineProperty(NumberFormatter.prototype, "formatToParts", numberDescriptor);
    Object.defineProperty(Relative.prototype, "formatToParts", relativeDescriptor);
  });
  Object.defineProperty(NumberFormatter.prototype, "formatToParts", {
    ...numberDescriptor,
    value: undefined,
  });
  const modulePath = "../src/intl.ts?missing-number-parts";
  const imported = await import(modulePath);
  assert.equal(imported.formatNumber(1, "en"), "1");
  for (const call of [
    () => formatNumberToParts(1, "en"),
    () => formatCurrencyToParts(1, "en", { currency: "EUR" }),
    () => translator.formatNumberToParts(1),
    () => translator.formatCurrencyToParts(1, { currency: "EUR" }),
  ])
    assert.throws(call, {
      name: "TypeError",
      message: /Intl\.NumberFormat\.prototype\.formatToParts.*supporting runtime.*polyfill/,
    });
  assert.equal(formatNumber(1, "en"), "1");
  assert.equal(typeof formatCurrency(1, "en", { currency: "EUR" }), "string");
  assert.deepEqual(
    formatRelativeTimeToParts(1, "day", "en"),
    new Relative("en").formatToParts(1, "day"),
  );
  Object.defineProperty(NumberFormatter.prototype, "formatToParts", numberDescriptor);
  Object.defineProperty(Relative.prototype, "formatToParts", {
    ...relativeDescriptor,
    value: undefined,
  });
  for (const call of [
    () => formatRelativeTimeToParts(1, "day", "en"),
    () => translator.formatRelativeTimeToParts(1, "day"),
  ])
    assert.throws(call, {
      name: "TypeError",
      message: /Intl\.RelativeTimeFormat\.prototype\.formatToParts.*supporting runtime.*polyfill/,
    });
  assert.deepEqual(formatNumberToParts(1, "en"), new NumberFormatter("en").formatToParts(1));
  assert.equal(typeof formatRelativeTime(1, "day", "en"), "string");
  assert.equal(typeof formatDate("2026-10-27", "en"), "string");
  assert.deepEqual(
    entries.map(entry => entry.event),
    [
      "number-format-to-parts-failed",
      "currency-format-to-parts-failed",
      "relative-time-format-to-parts-failed",
    ],
  );
  assert.ok(entries.every(entry => entry.error instanceof TypeError));
});

test("date parts match native defaults, styles, UTC calendars and zoned instants", () => {
  const timestamp = Date.UTC(2026, 8, 30, 0, 30);
  const instant = new Date(timestamp);
  const choices: DateFormatOptions[] = [
    {},
    { year: "2-digit", month: "long", weekday: "short" },
    { year: undefined, day: undefined },
    { dateStyle: "full" },
    { timeStyle: "short" },
    { dateStyle: "long", timeStyle: "medium" },
    { hour: "numeric", timeZoneName: "short" },
  ];
  for (const language of [
    "en-x-calparts",
    "fi-x-calparts",
    "ar-x-calparts",
    "ja-JP-u-ca-japanese",
  ]) {
    for (const options of choices) {
      const defaults: DateFormatOptions =
        options.dateStyle === undefined && options.timeStyle === undefined
          ? { year: "numeric", month: "numeric", day: "numeric" }
          : {};
      for (const timeZone of [undefined, "UTC", "America/Los_Angeles"]) {
        const provided = { ...options, timeZone };
        assert.deepEqual(
          formatDateToParts(instant, language, provided),
          new Intl.DateTimeFormat(language, { ...defaults, ...provided }).formatToParts(timestamp),
        );
        for (const calendar of ["2026-09-30", { year: 2026, month: 9, day: 30 }]) {
          assert.deepEqual(
            formatDateToParts(calendar, language, provided),
            new Intl.DateTimeFormat(language, {
              ...defaults,
              ...provided,
              timeZone: "UTC",
            }).formatToParts(Date.UTC(2026, 8, 30)),
          );
        }
      }
    }
  }
  const ancient = new Date(0);
  ancient.setUTCFullYear(99, 0, 1);
  assert.deepEqual(
    formatDateToParts("0099-01-01", "en", { dateStyle: "long" }),
    new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "UTC" }).formatToParts(ancient),
  );
  assert.deepEqual(
    formatDateToParts("2026-09-30", "en", { timeZone: "Not/AZone" }),
    formatDateToParts("2026-09-30", "en"),
  );
});

test("clock and weekday parts match native output without synthetic date or zone fields", () => {
  const choices: TimeFormatOptions[] = [
    {},
    { timeStyle: "short" },
    { timeStyle: "medium" },
    { hour: undefined, minute: undefined, second: undefined },
    { hour: "2-digit", minute: "numeric", hourCycle: "h24" },
    { hour12: true, dayPeriod: "long", second: "numeric", fractionalSecondDigits: 3 },
  ];
  for (const language of [
    "en-US-x-clock",
    "en-GB-x-clock",
    "fi-x-clock",
    "ar-x-clock",
    "ja-JP-u-ca-japanese",
  ]) {
    for (const value of [
      "09:05",
      "09:05:00",
      "23:59:07",
      { hour: 0, minute: 0 },
      { hour: 9, minute: 5, second: 0 },
      { hour: 9, minute: 5, second: undefined },
    ]) {
      const fields =
        typeof value === "string"
          ? value.split(":").map(Number)
          : [value.hour, value.minute, value.second];
      const explicitSeconds = fields[2] !== undefined;
      const date = new Date(Date.UTC(1970, 0, 1, fields[0]!, fields[1]!, fields[2] ?? 0));
      for (const options of choices) {
        const defaults: Intl.DateTimeFormatOptions =
          options.timeStyle === undefined
            ? {
                hour: "numeric",
                minute: "2-digit",
                ...(explicitSeconds ? { second: "2-digit" } : {}),
              }
            : {};
        const parts = formatTimeToParts(value, language, options);
        assert.deepEqual(
          parts,
          new Intl.DateTimeFormat(language, {
            ...defaults,
            ...Object.fromEntries(
              Object.entries(options).filter(([, value]) => value !== undefined),
            ),
            timeZone: "UTC",
          }).formatToParts(date),
        );
        assert.ok(
          parts.every(part =>
            ["hour", "minute", "second", "fractionalSecond", "dayPeriod", "literal"].includes(
              part.type,
            ),
          ),
        );
        if (Object.keys(options).length === 0)
          assert.equal(
            parts.some(part => part.type === "second"),
            explicitSeconds,
          );
      }
    }
    for (let weekday = 0; weekday <= 6; weekday++) {
      for (const width of [undefined, "long", "short", "narrow"] as const) {
        const parts = formatWeekdayToParts(weekday, language, { width });
        assert.deepEqual(
          parts,
          new Intl.DateTimeFormat(language, {
            weekday: width ?? "long",
            timeZone: "UTC",
          }).formatToParts(Date.UTC(1970, 0, 5 + weekday)),
        );
        assert.ok(parts.every(part => ["weekday", "literal"].includes(part.type)));
      }
    }
  }
});

test("calendar parts reject invalid inputs and all forbidden clock options", () => {
  for (const value of [
    "2026-02-30",
    "2026-2-01",
    "2026-09-30T00:00:00Z",
    new Date(NaN),
    { year: 2026, month: 13, day: 1 },
    { year: 2026.5, month: 1, day: 1 },
  ]) {
    assert.throws(() => formatDateToParts(value, "en"), RangeError);
  }
  for (const value of [
    "9:05",
    "24:00",
    "12:00:60",
    { hour: 9.5, minute: 0 },
    { hour: 9, minute: 60 },
    { hour: 9, minute: 0, second: null },
  ]) {
    assert.throws(() => formatTimeToParts(value as ClockTime, "en"), RangeError);
  }
  for (const weekday of [-1, 7, 0.5, NaN, Infinity, "0", null]) {
    assert.throws(() => formatWeekdayToParts(weekday as number, "en"), RangeError);
  }
  for (const option of [
    "dateStyle",
    "era",
    "year",
    "month",
    "day",
    "weekday",
    "timeZone",
    "timeZoneName",
  ]) {
    for (const options of [{ [option]: undefined }, Object.create({ [option]: undefined })]) {
      assert.throws(
        () => formatTimeToParts("09:05", "en", options),
        new RegExp(`does not support ${option}`),
      );
    }
  }
  for (const timeStyle of ["long", "full"] as const) {
    // @ts-expect-error Long/full clock styles expose a zone.
    assert.throws(() => formatTimeToParts("09:05", "en", { timeStyle }), RangeError);
  }
  assert.throws(() => formatDateToParts(new Date(), "en", { timeZone: "Not/AZone" }), RangeError);
  assert.throws(
    () => formatDateToParts("2026-09-30", "en", { dateStyle: "long", year: "numeric" }),
    TypeError,
  );
  assert.throws(
    () => formatTimeToParts("09:05", "en", { timeStyle: "short", hour: "numeric" }),
    TypeError,
  );
  // @ts-expect-error Widths retain the native weekday choices.
  assert.throws(() => formatWeekdayToParts(0, "en", { width: "wide" }), RangeError);
  for (const language of ["", " ", "invalid_!"]) {
    assert.throws(() => formatDateToParts("2026-09-30", language), RangeError);
    assert.throws(() => formatTimeToParts("09:05", language), RangeError);
    assert.throws(() => formatWeekdayToParts(0, language), RangeError);
  }
});

test("date parts detach foreign-realm native timestamps before option coercion", () => {
  const timestamp = Date.UTC(2026, 8, 30, 0, 30);
  for (const date of [new Date(timestamp), runInNewContext(`new Date(${timestamp})`) as Date]) {
    date.getTime = () => {
      throw new Error("Do not call overridden methods");
    };
    date.valueOf = () => 0;
    Object.defineProperty(date, Symbol.toPrimitive, { value: () => 0 });
    const options = { timeZone: "America/Los_Angeles", dateStyle: "long" } as const;
    assert.deepEqual(
      formatDateToParts(date, "en", options),
      new Intl.DateTimeFormat("en", options).formatToParts(timestamp),
    );
    const timeZone = {
      toString() {
        date.setTime(0);
        return "UTC";
      },
    };
    assert.deepEqual(
      formatDateToParts(date, "en", { dateStyle: "long", timeZone: timeZone as unknown as string }),
      new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "UTC" }).formatToParts(
        timestamp,
      ),
    );
    assert.equal(Date.prototype.getTime.call(date), 0);
  }
  assert.throws(
    () => formatDateToParts(runInNewContext("new Date(NaN)"), "en"),
    /Date must be valid/,
  );
  assert.throws(
    () =>
      formatDateToParts(
        { [Symbol.toStringTag]: "Date", getTime: () => timestamp } as unknown as Date,
        "en",
      ),
    RangeError,
  );
});

test("calendar parts share string caches and preserve snapshots and unsafe coercions", t => {
  const Native = Intl.DateTimeFormat;
  let constructions = 0;
  t.mock.method(Intl, "DateTimeFormat", function (...args: ConstructorParameters<typeof Native>) {
    constructions++;
    return new Native(...args);
  });
  formatDate("2026-09-30", "en-x-dtcache");
  formatDateToParts("2026-10-01", "EN_x_dtcache", { timeZone: "Not/AZone" });
  formatTime("09:05", "en-x-dtcache");
  formatTimeToParts("10:06", "en-x-dtcache");
  formatWeekday(0, "en-x-dtcache");
  formatWeekdayToParts(6, "en-x-dtcache");
  assert.equal(constructions, 3);
  const instant = new Date(Date.UTC(2026, 8, 30));
  formatDateToParts(instant, "en-x-dtcache", { timeZone: "UTC" });
  assert.equal(constructions, 3);
  formatDate(instant, "en-x-dtcache");
  formatDateToParts(instant, "en-x-dtcache");
  assert.equal(constructions, 5);
  let reads = 0;
  const options = {
    get month(): "long" {
      reads++;
      return "long";
    },
  };
  formatDate("2026-09-30", "en-x-dtcache", options);
  formatDateToParts("2026-09-30", "en-x-dtcache", options);
  assert.equal(reads, 2);
  let coercions = 0;
  const dynamic = { toString: () => (++coercions === 1 ? "numeric" : "2-digit") };
  for (const call of [
    () =>
      formatDateToParts("2026-09-30", "en-x-dtcache", { month: dynamic as unknown as "numeric" }),
    () => formatTimeToParts("09:05", "en-x-dtcache", { hour: dynamic as unknown as "numeric" }),
    () =>
      formatWeekdayToParts(0, "en-x-dtcache", {
        width: {
          toString: () => {
            coercions++;
            return "long";
          },
        } as unknown as "long",
      }),
  ]) {
    const before: number = constructions;
    call();
    call();
    assert.equal(constructions - before, 2);
  }
  assert.equal(coercions, 6);
});

test("date parts without a zone follow host zone changes instead of a stale formatter", t => {
  const original = process.env.TZ;
  t.after(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });
  const date = new Date(Date.UTC(2026, 8, 30, 0, 30));
  const results: Intl.DateTimeFormatPart[][] = [];
  for (const timeZone of ["UTC", "America/Los_Angeles"]) {
    process.env.TZ = timeZone;
    const parts = formatDateToParts(date, "en-x-hostpart");
    assert.deepEqual(
      parts,
      new Intl.DateTimeFormat("en", {
        year: "numeric",
        month: "numeric",
        day: "numeric",
        timeZone,
      }).formatToParts(date),
    );
    results.push(parts);
  }
  assert.notDeepEqual(results[0], results[1]);
});

test("calendar parts preserve original errors and operation-specific diagnostics", () => {
  const entries: TranslatorLogEntry[] = [];
  const translator = new Translator({
    language: "fi",
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
  const date = { month: dynamic as unknown as "long" };
  const time = { hour: dynamic as unknown as "numeric" };
  const weekday = { width: dynamic as unknown as "long" };
  for (const call of [
    () => translator.formatDateToParts("2026-09-30", date),
    () => translator.formatTimeToParts("09:05", time),
    () => translator.formatWeekdayToParts(0, weekday),
    () => formatDateToParts("2026-09-30", "en", date),
    () => formatTimeToParts("09:05", "en", time),
    () => formatWeekdayToParts(0, "en", weekday),
  ])
    assert.throws(call, thrown => thrown === error);
  assert.deepEqual(
    entries.map(entry => [entry.component, entry.event, entry.error, entry.details]),
    [
      ["intl", "date-format-to-parts-failed", error, { language: "fi" }],
      ["intl", "time-format-to-parts-failed", error, { language: "fi" }],
      ["intl", "weekday-format-to-parts-failed", error, { language: "fi" }],
    ],
  );
});

test("missing date-time parts support leaves imports, strings and other parts working", async t => {
  const descriptor = Object.getOwnPropertyDescriptor(
    Intl.DateTimeFormat.prototype,
    "formatToParts",
  )!;
  t.after(() => Object.defineProperty(Intl.DateTimeFormat.prototype, "formatToParts", descriptor));
  Object.defineProperty(Intl.DateTimeFormat.prototype, "formatToParts", {
    ...descriptor,
    value: undefined,
  });
  const modulePath = "../src/index.ts?missing-calendar-parts";
  const imported = await import(modulePath);
  const entries: TranslatorLogEntry[] = [];
  const translator = new imported.Translator({
    logger: (entry: TranslatorLogEntry) => entries.push(entry),
  });
  for (const call of [
    () => imported.formatDateToParts("2026-09-30", "en"),
    () => imported.formatTimeToParts("09:05", "en"),
    () => imported.formatWeekdayToParts(0, "en"),
    () => translator.formatDateToParts("2026-09-30"),
    () => translator.formatTimeToParts("09:05"),
    () => translator.formatWeekdayToParts(0),
  ])
    assert.throws(call, {
      name: "TypeError",
      message: /Intl\.DateTimeFormat\.prototype\.formatToParts.*supporting runtime.*polyfill/,
    });
  assert.equal(typeof imported.formatDate("2026-09-30", "en"), "string");
  assert.equal(typeof translator.formatTime("09:05"), "string");
  assert.equal(typeof translator.formatWeekday(0), "string");
  assert.deepEqual(
    imported.formatNumberToParts(1, "en"),
    new Intl.NumberFormat("en").formatToParts(1),
  );
  assert.deepEqual(
    imported.formatRelativeTimeToParts(1, "day", "en"),
    new Intl.RelativeTimeFormat("en").formatToParts(1, "day"),
  );
  assert.deepEqual(
    entries.map(entry => entry.event),
    [
      "date-format-to-parts-failed",
      "time-format-to-parts-failed",
      "weekday-format-to-parts-failed",
    ],
  );
  assert.ok(entries.every(entry => entry.error instanceof TypeError));
});

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
