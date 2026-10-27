// SPDX-FileCopyrightText: 2020-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Package-private tests for strict Intl formatting and its DOM extension.
 * @packageDocumentation
 * @module intl.test
 * @author Lari Natri
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
  formatDateTime,
  formatDateTimeToParts,
  formatDateTimeRange,
  formatDateTimeRangeToParts,
  formatNumberRange,
  formatNumberRangeToParts,
  formatNumberToParts,
  formatRelativeTime,
  formatRelativeTimeToParts,
  formatTimeRange,
  formatTimeRangeToParts,
  formatTimeToParts,
  formatWeekdayToParts,
  formatWeekdayRange,
  formatWeekdayRangeToParts,
  type DateFormatOptions,
  type DateTimeFormatOptions,
  type CalendarDate,
  type WeekdayFormatOptions,
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

test("weekday ranges match native strings and parts for every pair, width and representative locale without leakage", () => {
  for (const language of [
    "en-US",
    "en-GB",
    "fi-FI",
    "pt-BR",
    "ja-JP",
    "ar-EG",
    "zh-CN",
    "th-TH",
    "fa-IR",
    "he-IL",
    "hi-IN",
  ]) {
    const translator = new Translator({ language });
    for (const width of ["long", "short", "narrow"] as const) {
      const options = Object.freeze({ width });
      const native = new Intl.DateTimeFormat(language, { weekday: width, timeZone: "UTC" });
      for (let start = 0; start < 7; start++) {
        for (let end = 0; end < 7; end++) {
          const first = Date.UTC(1970, 0, 5 + start);
          const last = Date.UTC(1970, 0, 5 + end + (end < start ? 7 : 0));
          const context = `${language}/${width}/${start}/${end}`;
          const expected = native.formatRangeToParts(first, last);
          assert.ok(
            expected.every(part => ["weekday", "literal"].includes(part.type)),
            context,
          );
          assert.equal(
            formatWeekdayRange(start, end, language, options),
            native.formatRange(first, last),
            context,
          );
          assert.deepEqual(
            formatWeekdayRangeToParts(start, end, language, options),
            expected,
            context,
          );
          assert.equal(
            translator.formatWeekdayRange(start, end, options),
            native.formatRange(first, last),
            context,
          );
          assert.deepEqual(
            translator.formatWeekdayRangeToParts(start, end, options),
            expected,
            context,
          );
        }
      }
    }
  }
});

test("weekday ranges validate both endpoints without coercion before reading options", () => {
  const translator = new Translator();
  let coercions = 0;
  const object = {
    valueOf() {
      coercions++;
      return 0;
    },
    toString() {
      coercions++;
      return "0";
    },
  };
  const options = new Proxy(
    {},
    {
      has() {
        throw new Error("Options read before endpoint validation");
      },
      get() {
        throw new Error("Options read before endpoint validation");
      },
    },
  );
  const calls = [
    (start: number, end: number) => formatWeekdayRange(start, end, "en", options),
    (start: number, end: number) => formatWeekdayRangeToParts(start, end, "en", options),
    (start: number, end: number) => translator.formatWeekdayRange(start, end, options),
    (start: number, end: number) => translator.formatWeekdayRangeToParts(start, end, options),
  ];
  for (const invalid of [
    -1,
    7,
    0.5,
    NaN,
    Infinity,
    -Infinity,
    "0",
    "Monday",
    null,
    undefined,
    true,
    0n,
    Symbol("weekday"),
    new Number(0),
    object,
    new Date(0),
  ]) {
    for (const call of calls) {
      assert.throws(() => call(invalid as number, 0), RangeError);
      assert.throws(() => call(0, invalid as number), RangeError);
    }
  }
  assert.equal(coercions, 0);
  assert.equal(formatWeekdayRange(-0, 0, "en"), formatWeekdayRange(0, 0, "en"));
});

test("weekday range defaults, forbidden zones and inherited options preserve single-weekday reads", () => {
  for (const format of [formatWeekdayRange, formatWeekdayRangeToParts]) {
    for (const key of ["timeZone", "timeZoneName"]) {
      for (const value of [undefined, "UTC"]) {
        for (const options of [{ [key]: value }, Object.create({ [key]: value })]) {
          assert.throws(() => format(0, 6, "en", options), new RegExp(key));
        }
      }
      const options = Object.defineProperty({}, key, {
        get() {
          throw new Error("Forbidden getter read");
        },
      });
      assert.throws(() => format(0, 6, "en", options), new RegExp(key));
      const translator = new Translator();
      assert.throws(
        () => translator.formatWeekdayRange(0, 6, Object.create({ [key]: undefined })),
        new RegExp(key),
      );
      assert.throws(
        () => translator.formatWeekdayRangeToParts(0, 6, { [key]: undefined }),
        new RegExp(key),
      );
    }
    const reads: string[] = [];
    const options = Object.create({
      get language() {
        reads.push("language");
        return " fi_FI ";
      },
      get width() {
        reads.push("width");
        return undefined;
      },
    });
    const native = new Intl.DateTimeFormat("fi-FI", { weekday: "long", timeZone: "UTC" });
    const first = Date.UTC(1970, 0, 9);
    const last = Date.UTC(1970, 0, 12);
    assert.deepEqual(
      format(4, 0, "!invalid!", options),
      format === formatWeekdayRange
        ? native.formatRange(first, last)
        : native.formatRangeToParts(first, last),
    );
    assert.deepEqual(reads, ["language", "width"]);
    assert.deepEqual(format(4, 0, "fi-FI"), format(4, 0, "fi-FI", { width: undefined }));
    for (const width of ["wide", "", false, 1])
      assert.throws(() => format(0, 1, "en", { width: width as never }), RangeError);
    assert.throws(() => format(0, 1, "!invalid!"), RangeError);
    assert.throws(() => format(0, 1, "en", { language: "!invalid!" }), RangeError);
    const stopped: string[] = [];
    assert.throws(
      () =>
        format(0, 1, "en", {
          get language() {
            stopped.push("language");
            return "!invalid!";
          },
          get width() {
            stopped.push("width");
            return "long" as const;
          },
        }),
      RangeError,
    );
    assert.deepEqual(stopped, ["language"]);
  }
});

test("weekday range parts are fresh mutable native records and equal endpoints still use range operations", t => {
  const native = new Intl.DateTimeFormat("en", { weekday: "long", timeZone: "UTC" });
  const expected = native.formatRangeToParts(Date.UTC(1970, 0, 9), Date.UTC(1970, 0, 12));
  const first = formatWeekdayRangeToParts(4, 0, "en");
  const second = formatWeekdayRangeToParts(4, 0, "en");
  assert.deepEqual(first, expected);
  assert.notEqual(first, second);
  first.forEach((part, index) => {
    assert.notEqual(part, second[index]);
    assert.equal(Object.isFrozen(part), false);
    part.value = "consumer-owned";
    part.source = "shared";
  });
  first.push({ type: "literal", value: "extra", source: "shared" });
  assert.deepEqual(second, expected);
  assert.deepEqual(formatWeekdayRangeToParts(4, 0, "en"), expected);
  const records: Intl.DateTimeRangeFormatPart[] = [
    { type: "weekday", value: "native", source: "shared" },
  ];
  const seen: unknown[][] = [];
  t.mock.method(
    Intl.DateTimeFormat.prototype,
    "formatRangeToParts",
    (start: Date | number, end: Date | number) => {
      seen.push([Number(start), Number(end)]);
      return records;
    },
  );
  t.mock.method(
    Intl.DateTimeFormat.prototype,
    "formatRange",
    (start: Date | number, end: Date | number) => {
      seen.push([Number(start), Number(end)]);
      return "native equal range";
    },
  );
  assert.equal(formatWeekdayRangeToParts(2, 2, "en"), records);
  assert.equal(formatWeekdayRange(2, 2, "en"), "native equal range");
  assert.deepEqual(seen, [
    [Date.UTC(1970, 0, 7), Date.UTC(1970, 0, 7)],
    [Date.UTC(1970, 0, 7), Date.UTC(1970, 0, 7)],
  ]);
  assert.equal(new Translator().formatWeekdayRangeToParts(2, 2), records);
});

test("weekday ranges follow locale overrides without translation fallbacks, state changes or host-zone dependence", t => {
  const translator = new Translator({
    language: "ja-JP",
    fallbackLanguage: "fi",
    additionalFallbackLanguages: ["ar"],
  });
  translator.setTranslation("retained", { fi: "Retained" });
  const catalog = translator.getTranslationData();
  const languages = translator.getLanguages();
  const events: unknown[] = [];
  translator.subscribe(event => events.push(event));
  translator.subscribeCatalog(event => events.push(event));
  translator.subscribeLanguages(event => events.push(event));
  const original = process.env.TZ;
  t.after(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });
  const results: unknown[] = [];
  for (const zone of ["UTC", "America/Los_Angeles", "Asia/Tokyo"]) {
    process.env.TZ = zone;
    for (const language of [undefined, " pt_BR ", "ar-EG"]) {
      const options = Object.freeze({ language, width: "short" as const });
      const native = new Intl.DateTimeFormat(
        language === undefined ? "ja-JP" : language.trim().replace("_", "-"),
        { weekday: "short", timeZone: "UTC" },
      );
      const first = Date.UTC(1970, 0, 11);
      const last = Date.UTC(1970, 0, 12);
      assert.equal(translator.formatWeekdayRange(6, 0, options), native.formatRange(first, last));
      assert.deepEqual(
        translator.formatWeekdayRangeToParts(6, 0, options),
        native.formatRangeToParts(first, last),
      );
    }
    results.push([translator.formatWeekdayRange(6, 0), translator.formatWeekdayRangeToParts(6, 0)]);
    assert.throws(() => translator.formatWeekdayRange(0, 1, { language: "!invalid!" }), RangeError);
    assert.throws(
      () => translator.formatWeekdayRangeToParts(0, 1, { language: "!invalid!" }),
      RangeError,
    );
  }
  assert.deepEqual(results[0], results[1]);
  assert.deepEqual(results[0], results[2]);
  assert.equal(translator.getLanguage(), "ja-JP");
  assert.equal(translator.getFallbackLanguage(), "fi");
  assert.deepEqual(translator.getAdditionalFallbackLanguages(), ["ar"]);
  assert.deepEqual(translator.getTranslationData(), catalog);
  assert.deepEqual(translator.getLanguages(), languages);
  assert.deepEqual(events, []);
});

test("weekday ranges share bounded weekday caches, snapshot getters and bypass unsafe width coercion", t => {
  const Native = Intl.DateTimeFormat;
  let constructions = 0;
  t.mock.method(Intl, "DateTimeFormat", function (...args: ConstructorParameters<typeof Native>) {
    constructions++;
    return new Native(...args);
  });
  const language = "en-x-wkcache";
  formatWeekday(0, language);
  formatWeekdayToParts(6, language);
  formatWeekdayRange(4, 0, "EN_x_wkcache");
  formatWeekdayRangeToParts(0, 0, language, { width: "long" });
  assert.equal(constructions, 1);
  let reads = 0;
  const options = {
    get width() {
      reads++;
      return "short" as const;
    },
  };
  formatWeekdayRange(0, 1, language, options);
  formatWeekdayRangeToParts(0, 1, language, options);
  assert.equal(reads, 2);
  assert.equal(constructions, 2);
  const mutable: WeekdayFormatOptions = { width: "long" };
  const original = formatWeekdayRange(4, 0, language, mutable);
  mutable.width = "short";
  assert.equal(
    formatWeekdayRange(4, 0, language, mutable),
    new Native(language, { weekday: "short", timeZone: "UTC" }).formatRange(
      Date.UTC(1970, 0, 9),
      Date.UTC(1970, 0, 12),
    ),
  );
  mutable.width = "long";
  assert.equal(formatWeekdayRange(4, 0, language, mutable), original);
  assert.equal(constructions, 2);
  let coercions = 0;
  const dynamic = {
    toString() {
      return ++coercions % 2 ? "long" : "short";
    },
  };
  const before = constructions;
  for (const format of [formatWeekdayRange, formatWeekdayRangeToParts]) {
    for (const width of ["long", "short"]) {
      const actual = format(4, 0, language, { width: dynamic as unknown as "long" });
      const native = new Native(language, { weekday: width as "long" | "short", timeZone: "UTC" });
      assert.deepEqual(
        actual,
        format === formatWeekdayRange
          ? native.formatRange(Date.UTC(1970, 0, 9), Date.UTC(1970, 0, 12))
          : native.formatRangeToParts(Date.UTC(1970, 0, 9), Date.UTC(1970, 0, 12)),
      );
    }
  }
  assert.equal(coercions, 4);
  assert.equal(constructions - before, 4);
  for (let index = 0; index < 70; index++) formatWeekdayRange(4, 0, `en-x-week-${index}`);
  const full = constructions;
  formatWeekdayRangeToParts(0, 0, "en-x-week-69");
  assert.equal(constructions, full);
  formatWeekdayRangeToParts(0, 0, "en-x-week-0");
  assert.equal(constructions, full + 1);
});

test("weekday range diagnostics preserve original option and native errors despite logger failures", t => {
  const entries: TranslatorLogEntry[] = [];
  const translator = new Translator({
    language: "fi",
    logger(entry) {
      entries.push(entry);
      throw new Error("Logger failed");
    },
  });
  const error = new Error("Weekday range failed");
  for (const options of [
    {
      get language(): string {
        throw error;
      },
    },
    {
      get width(): "long" {
        throw error;
      },
    },
    {
      width: {
        toString() {
          throw error;
        },
      } as unknown as "long",
    },
  ]) {
    const before = entries.length;
    for (const call of [
      () => translator.formatWeekdayRange(4, 0, options),
      () => translator.formatWeekdayRangeToParts(4, 0, options),
      () => formatWeekdayRange(4, 0, "en", options),
      () => formatWeekdayRangeToParts(4, 0, "en", options),
    ])
      assert.throws(call, thrown => thrown === error);
    assert.deepEqual(
      entries
        .slice(before)
        .map(entry => [entry.component, entry.event, entry.error, entry.details]),
      [
        ["intl", "weekday-range-format-failed", error, { language: "fi" }],
        ["intl", "weekday-range-format-to-parts-failed", error, { language: "fi" }],
      ],
    );
  }
  for (const method of ["formatRange", "formatRangeToParts"] as const)
    t.mock.method(Intl.DateTimeFormat.prototype, method, () => {
      throw error;
    });
  const before = entries.length;
  for (const call of [
    () => translator.formatWeekdayRange(0, 0),
    () => translator.formatWeekdayRangeToParts(0, 0),
    () => formatWeekdayRange(0, 0, "en"),
    () => formatWeekdayRangeToParts(0, 0, "en"),
  ])
    assert.throws(call, thrown => thrown === error);
  assert.deepEqual(
    entries.slice(before).map(entry => [entry.event, entry.error]),
    [
      ["weekday-range-format-failed", error],
      ["weekday-range-format-to-parts-failed", error],
    ],
  );
});

test("weekday range capabilities are independent at call time before import and on warm caches, including equality", () => {
  const entry = new URL("../src/index.ts", import.meta.url).href;
  for (const method of ["formatRange", "formatRangeToParts", "format", "formatToParts"]) {
    for (const warm of [false, true]) {
      execFileSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "--input-type=module",
          "-e",
          `
        import assert from "node:assert/strict";
        const prototype = Intl.DateTimeFormat.prototype;
        let api;
        if (${warm}) {
          api = await import(${JSON.stringify(entry)});
          api.formatWeekdayRange(4, 0, "en");
          api.formatWeekdayRangeToParts(4, 0, "en");
        }
        Object.defineProperty(prototype, ${JSON.stringify(method)}, { configurable: true, value: undefined });
        api ??= await import(${JSON.stringify(entry)});
        const entries = [];
        const translator = new api.Translator({ logger: entry => entries.push(entry) });
        for (const [helper, facade, native] of [
          [api.formatWeekdayRange, translator.formatWeekdayRange.bind(translator), "formatRange"],
          [api.formatWeekdayRangeToParts, translator.formatWeekdayRangeToParts.bind(translator), "formatRangeToParts"],
        ]) {
          for (const [start, end] of [[4, 0], [2, 2]]) {
            for (const call of [() => helper(start, end, "en"), () => facade(start, end)]) {
              if (native === ${JSON.stringify(method)}) assert.throws(call, { name: "TypeError", message: new RegExp("Intl\\\\.DateTimeFormat\\\\.prototype\\\\." + native + " is unavailable.*supporting runtime.*polyfill") });
              else assert.ok(call().length > 0);
            }
          }
        }
        if (${JSON.stringify(method)} !== "format") assert.equal(typeof api.formatWeekday(0, "en"), "string");
        if (${JSON.stringify(method)} !== "formatToParts") assert.ok(api.formatWeekdayToParts(0, "en").length > 0);
        assert.equal(typeof api.formatNumber(1, "en"), "string");
        assert.equal(entries.length, ${method === "formatRange" || method === "formatRangeToParts" ? 2 : 0});
        assert.ok(entries.every(entry => entry.event === ${JSON.stringify(method === "formatRange" ? "weekday-range-format-failed" : "weekday-range-format-to-parts-failed")} && entry.error instanceof TypeError));
      `,
        ],
        { stdio: "pipe" },
      );
    }
  }
});

test("calendar and datetime ranges preserve native calendars, explicit zones, DST and equality", () => {
  const first = new Date("2026-03-08T06:30:00Z");
  const last = new Date("2026-03-08T08:30:00Z");
  for (const language of ["en-x-drnative", "fi-x-drnative", "ar-x-drnative", "ja-x-drnative"]) {
    for (const options of [
      {},
      { month: "long", day: "2-digit" },
      { dateStyle: "full" },
      { year: undefined, month: "short" },
    ] as DateFormatOptions[]) {
      for (const end of ["2026-03-08", { year: 2026, month: 3, day: 10 }]) {
        const date =
          typeof end === "string" ? new Date(`${end}T00:00:00Z`) : new Date("2026-03-10T00:00:00Z");
        const effective = {
          ...(options.dateStyle === undefined
            ? ({ year: "numeric", month: "numeric", day: "numeric" } as const)
            : {}),
          ...options,
          timeZone: "UTC",
        };
        const native = new Intl.DateTimeFormat(language, effective);
        const start = new Date("2026-03-08T00:00:00Z");
        assert.equal(
          formatDateRange("2026-03-08", end, language, options),
          native.formatRange(start, date),
        );
        assert.deepEqual(
          formatDateRangeToParts("2026-03-08", end, language, options),
          native.formatRangeToParts(start, date),
        );
        assert.equal(formatDateRange(end, end, language, options), native.formatRange(date, date));
      }
    }
    for (const timeZone of ["UTC", "America/New_York", "America/Los_Angeles"]) {
      const options = { dateStyle: "long", timeStyle: "long", timeZone } as const;
      const native = new Intl.DateTimeFormat(language, options);
      assert.equal(
        formatDateTimeRange(first, last, language, options),
        native.formatRange(first, last),
      );
      assert.deepEqual(
        formatDateTimeRangeToParts(first, last, language, options),
        native.formatRangeToParts(first, last),
      );
    }
  }
});

test("all calendar APIs reject Dates and forbidden option presence, including inherited undefined", () => {
  const translator = new Translator();
  const calls = [
    (value: string | CalendarDate, options?: DateFormatOptions) => formatDate(value, "en", options),
    (value: string | CalendarDate, options?: DateFormatOptions) =>
      formatDateToParts(value, "en", options),
    (value: string | CalendarDate, options?: DateFormatOptions) =>
      formatDateRange(value, "2026-10-02", "en", options),
    (value: string | CalendarDate, options?: DateFormatOptions) =>
      formatDateRangeToParts("2026-09-30", value, "en", options),
    (value: string | CalendarDate, options?: DateFormatOptions) =>
      translator.formatDate(value, options),
    (value: string | CalendarDate, options?: DateFormatOptions) =>
      translator.formatDateToParts(value, options),
    (value: string | CalendarDate, options?: DateFormatOptions) =>
      translator.formatDateRange(value, "2026-10-02", options),
    (value: string | CalendarDate, options?: DateFormatOptions) =>
      translator.formatDateRangeToParts("2026-09-30", value, options),
  ];
  for (const call of calls) {
    for (const date of [
      new Date(),
      new Date(NaN),
      runInNewContext("new Date()"),
      runInNewContext("new Date(NaN)"),
    ])
      assert.throws(() => call(date as unknown as CalendarDate), RangeError);
    for (const field of [
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
    ]) {
      for (const options of [
        { [field]: undefined },
        { [field]: "long" },
        Object.create({ [field]: undefined }),
        Object.defineProperty({}, field, { value: undefined }),
      ])
        assert.throws(
          () => call("2026-09-30", options as DateFormatOptions),
          new RegExp(`does not support ${field}`),
        );
    }
  }
  for (const format of [formatWeekday, formatWeekdayToParts]) {
    for (const field of ["timeZone", "timeZoneName"]) {
      for (const options of [
        { [field]: undefined },
        { [field]: "UTC" },
        Object.create({ [field]: undefined }),
        Object.defineProperty({}, field, { value: undefined }),
      ])
        assert.throws(
          () => format(0, "en", options as WeekdayFormatOptions),
          new RegExp(`does not support ${field}`),
        );
    }
  }
  for (const call of [
    (options: WeekdayFormatOptions) => translator.formatWeekday(0, options),
    (options: WeekdayFormatOptions) => translator.formatWeekdayToParts(0, options),
  ]) {
    for (const field of ["timeZone", "timeZoneName"])
      assert.throws(
        () => call(Object.create({ [field]: undefined })),
        new RegExp(`does not support ${field}`),
      );
  }
});

test("datetime APIs require native Date slots and an explicit primitive nonblank zone", () => {
  const date = new Date("2026-09-30T23:30:00Z");
  const translator = new Translator();
  const calls = [
    (value: Date, options: DateTimeFormatOptions) => formatDateTime(value, "en", options),
    (value: Date, options: DateTimeFormatOptions) => formatDateTimeToParts(value, "en", options),
    (value: Date, options: DateTimeFormatOptions) =>
      formatDateTimeRange(value, date, "en", options),
    (value: Date, options: DateTimeFormatOptions) =>
      formatDateTimeRangeToParts(date, value, "en", options),
    (value: Date, options: DateTimeFormatOptions) => translator.formatDateTime(value, options),
    (value: Date, options: DateTimeFormatOptions) =>
      translator.formatDateTimeToParts(value, options),
    (value: Date, options: DateTimeFormatOptions) =>
      translator.formatDateTimeRange(value, date, options),
    (value: Date, options: DateTimeFormatOptions) =>
      translator.formatDateTimeRangeToParts(date, value, options),
  ];
  for (const call of calls) {
    for (const value of [
      "2026-09-30",
      "2026-09-30T23:30:00Z",
      0,
      null,
      undefined,
      { year: 2026, month: 9, day: 30 },
      { [Symbol.toStringTag]: "Date", getTime: () => 0 },
      new Proxy(date, {}),
    ])
      assert.throws(() => call(value as Date, { timeZone: "UTC" }), TypeError);
    for (const invalid of [new Date(NaN), runInNewContext("new Date(NaN)")])
      assert.throws(() => call(invalid as Date, { timeZone: "UTC" }), RangeError);
    for (const options of [
      undefined,
      {},
      { timeZone: undefined },
      { timeZone: null },
      { timeZone: "" },
      { timeZone: " \t" },
      { timeZone: 0 },
      { timeZone: new String("UTC") },
      {
        timeZone: {
          toString() {
            throw new Error("Must not coerce zone");
          },
        },
      },
      { timeZone: "Not/AZone" },
    ])
      assert.throws(() => call(date, options as DateTimeFormatOptions), RangeError);
  }
  for (const format of [formatDateTimeRange, formatDateTimeRangeToParts]) {
    assert.throws(() => format(date, new Date(0), "en", { timeZone: "UTC" }), RangeError);
    assert.throws(
      () => format(date, "2026-10-01" as unknown as Date, "en", { timeZone: "UTC" }),
      TypeError,
    );
    assert.throws(
      () => format("2026-09-30" as unknown as Date, date, "en", { timeZone: "UTC" }),
      TypeError,
    );
  }
});

test("datetime defaults, projections, boundaries and equal ranges match each native operation", () => {
  const choices: Omit<DateTimeFormatOptions, "timeZone">[] = [
    {},
    { dateStyle: undefined, timeStyle: undefined, hour: undefined },
    { calendar: "gregory", numberingSystem: "latn", hourCycle: "h23" },
    { hour12: true, localeMatcher: "lookup", formatMatcher: "basic" },
    { dateStyle: "long" },
    { timeStyle: "short" },
    { dateStyle: "full", timeStyle: "long" },
    { era: "short" },
    { year: "numeric" },
    { month: "long" },
    { day: "2-digit" },
    { weekday: "long" },
    { hour: "numeric" },
    { minute: "numeric" },
    { second: "numeric" },
    { fractionalSecondDigits: 3 },
    { dayPeriod: "long" },
    { timeZoneName: "short" },
  ];
  const display = [
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
  ];
  for (const language of ["en-GB", "fi", "ar", "ja-JP-u-ca-japanese"]) {
    for (const timeZone of ["UTC", "Europe/Helsinki", "America/New_York"]) {
      for (const [first, last] of [
        ["2026-03-08T06:30:00Z", "2026-03-08T08:30:00Z"],
        ["2026-11-01T05:30:00Z", "2026-11-01T07:30:00Z"],
        ["2026-12-31T23:30:00Z", "2027-01-01T01:30:00Z"],
        ["2026-09-30T23:30:00Z", "2026-09-30T23:30:00Z"],
      ]) {
        const start = new Date(first);
        const end = new Date(last);
        for (const options of choices) {
          const defined = Object.fromEntries(
            Object.entries(options).filter(([, value]) => value !== undefined),
          );
          const native = new Intl.DateTimeFormat(language, {
            ...(display.some(key => defined[key] !== undefined)
              ? {}
              : { dateStyle: "medium", timeStyle: "short" }),
            ...defined,
            timeZone,
          });
          const provided = Object.freeze({ ...options, timeZone });
          assert.equal(formatDateTime(start, language, provided), native.format(start));
          assert.deepEqual(
            formatDateTimeToParts(start, language, provided),
            native.formatToParts(start),
          );
          assert.equal(
            formatDateTimeRange(start, end, language, provided),
            native.formatRange(start, end),
          );
          assert.deepEqual(
            formatDateTimeRangeToParts(start, end, language, provided),
            native.formatRangeToParts(start, end),
          );
        }
      }
    }
  }
  for (const format of [formatDateTime, formatDateTimeToParts]) {
    assert.throws(
      () => format(new Date(), "en", { timeZone: "UTC", dateStyle: "long", hour: "numeric" }),
      TypeError,
    );
    assert.throws(() => format(new Date(), "bad!", { timeZone: "UTC" }), RangeError);
  }
  for (const format of [formatDateTimeRange, formatDateTimeRangeToParts])
    assert.throws(
      () =>
        format(new Date(0), new Date(1), "en", {
          timeZone: "UTC",
          timeStyle: "short",
          year: "numeric",
        }),
      TypeError,
    );
});

test("datetime snapshots detach inputs before zone, language and own enumerable option reads", () => {
  for (const format of [
    formatDateTime,
    formatDateTimeToParts,
    formatDateTimeRange,
    formatDateTimeRangeToParts,
  ]) {
    for (const zoneKind of ["own", "inherited", "nonenumerable"]) {
      const startTime = Date.UTC(2026, 8, 30, 23, 30);
      const endTime = Date.UTC(2026, 9, 2, 1, 30);
      const start = runInNewContext(`new Date(${startTime})`) as Date;
      const end = new Date(endTime);
      const reads: string[] = [];
      const mutate = () => {
        start.setTime(NaN);
        end.setTime(0);
      };
      const zone = {
        enumerable: zoneKind !== "nonenumerable",
        get() {
          reads.push("zone");
          mutate();
          return reads.filter(read => read === "zone").length === 1
            ? "Europe/Helsinki"
            : "Invalid/Zone";
        },
      };
      const options = Object.create(
        zoneKind === "inherited" ? Object.defineProperty({}, "timeZone", zone) : null,
      );
      Object.defineProperties(options, {
        ...(zoneKind === "inherited" ? {} : { timeZone: zone }),
        language: {
          enumerable: true,
          get() {
            reads.push("language");
            return " en_GB ";
          },
        },
        dateStyle: {
          enumerable: true,
          get() {
            reads.push("dateStyle");
            return {
              toString() {
                reads.push("coerce");
                return "long";
              },
            };
          },
        },
        ignored: {
          enumerable: true,
          get() {
            reads.push("ignored");
            return true;
          },
        },
        timeStyle: {
          get() {
            throw new Error("Nonenumerable native options are not snapshotted");
          },
        },
      });
      const native = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Helsinki",
        dateStyle: "long",
      });
      const actual =
        format === formatDateTime
          ? formatDateTime(start, "bad!", options)
          : format === formatDateTimeToParts
            ? formatDateTimeToParts(start, "bad!", options)
            : format === formatDateTimeRange
              ? formatDateTimeRange(start, end, "bad!", options)
              : formatDateTimeRangeToParts(start, end, "bad!", options);
      const expected =
        format === formatDateTime
          ? native.format(startTime)
          : format === formatDateTimeToParts
            ? native.formatToParts(startTime)
            : format === formatDateTimeRange
              ? native.formatRange(startTime, endTime)
              : native.formatRangeToParts(startTime, endTime);
      assert.deepEqual(actual, expected);
      assert.deepEqual(reads, ["zone", "language", "dateStyle", "ignored", "coerce"]);
      assert.ok(Number.isNaN(Date.prototype.getTime.call(start)));
      assert.equal(Date.prototype.getTime.call(end), 0);
    }
  }
  const error = new Error("Must not access options before invalid input rejection");
  const options = {
    get timeZone(): string {
      throw error;
    },
  };
  for (const format of [formatDateTime, formatDateTimeToParts])
    assert.throws(() => format(new Date(NaN), "en", options), RangeError);
  for (const format of [formatDateTimeRange, formatDateTimeRangeToParts])
    assert.throws(() => format(new Date(), new Date(NaN), "en", options), RangeError);
  const invalidZone = {
    timeZone: " ",
    get language(): string {
      throw error;
    },
    get dateStyle(): "long" {
      throw error;
    },
  };
  for (const format of [formatDateTime, formatDateTimeToParts])
    assert.throws(() => format(new Date(), "en", invalidZone), RangeError);
  for (const format of [formatDateTimeRange, formatDateTimeRangeToParts])
    assert.throws(() => format(new Date(0), new Date(1), "en", invalidZone), RangeError);
});

test("datetime facade preserves locale policy, input ownership and fresh mutable native metadata", () => {
  const translator = new Translator({ language: "fi", fallbackLanguage: "ja" });
  translator.setTranslation("fallback", { ja: "Fallback only" });
  const events: unknown[] = [];
  translator.subscribe(event => events.push(event));
  translator.subscribeCatalog(event => events.push(event));
  translator.subscribeLanguages(event => events.push(event));
  const start = Object.freeze(new Date("2026-09-30T23:30:00Z"));
  const end = Object.freeze(new Date("2026-10-02T01:30:00Z"));
  for (const language of [undefined, " en_GB "]) {
    const options = Object.freeze({ language, timeZone: "Europe/Helsinki" });
    const tag = language === undefined ? "fi" : "en-GB";
    assert.equal(translator.formatDateTime(start, options), formatDateTime(start, tag, options));
    assert.deepEqual(
      translator.formatDateTimeToParts(start, options),
      formatDateTimeToParts(start, tag, options),
    );
    assert.equal(
      translator.formatDateTimeRange(start, end, options),
      formatDateTimeRange(start, end, tag, options),
    );
    assert.deepEqual(
      translator.formatDateTimeRangeToParts(start, end, options),
      formatDateTimeRangeToParts(start, end, tag, options),
    );
  }
  for (const call of [
    () => formatDateTimeToParts(start, "en", { timeZone: "UTC" }),
    () => translator.formatDateTimeToParts(start, { timeZone: "UTC" }),
  ]) {
    const parts = call();
    const expected = structuredClone(parts);
    assert.notEqual(parts, call());
    for (let index = 0; index < parts.length; index++) {
      assert.notEqual(parts[index], call()[index]);
      parts[index].value = "changed";
    }
    parts.splice(0);
    assert.deepEqual(call(), expected);
  }
  for (const call of [
    () => formatDateTimeRangeToParts(start, end, "en", { timeZone: "UTC" }),
    () => translator.formatDateTimeRangeToParts(start, end, { timeZone: "UTC" }),
  ]) {
    const parts = call();
    const expected = structuredClone(parts);
    assert.deepEqual(
      new Set(parts.map(part => part.source)),
      new Set(["startRange", "endRange", "shared"]),
    );
    assert.notEqual(parts, call());
    for (let index = 0; index < parts.length; index++) {
      assert.notEqual(parts[index], call()[index]);
      parts[index].source = "shared";
      parts[index].value = "changed";
    }
    parts.splice(0);
    assert.deepEqual(call(), expected);
  }
  assert.equal(start.toISOString(), "2026-09-30T23:30:00.000Z");
  assert.equal(end.toISOString(), "2026-10-02T01:30:00.000Z");
  assert.equal(translator.getLanguage(), "fi");
  assert.equal(translator.translateKey("fallback"), "Fallback only");
  assert.deepEqual(events, []);
});

test("datetime diagnostics preserve original getter, coercion and native errors despite failing loggers", t => {
  const entries: TranslatorLogEntry[] = [];
  const translator = new Translator({
    language: "fi",
    logger(entry) {
      entries.push(entry);
      throw new Error("Logger failed");
    },
  });
  const events: unknown[] = [];
  translator.subscribe(event => events.push(event));
  translator.subscribeCatalog(event => events.push(event));
  translator.subscribeLanguages(event => events.push(event));
  const start = new Date("2026-09-30T23:30:00Z");
  const end = new Date("2026-10-02T01:30:00Z");
  const methods = [
    (options: DateTimeFormatOptions) => translator.formatDateTime(start, options),
    (options: DateTimeFormatOptions) => translator.formatDateTimeToParts(start, options),
    (options: DateTimeFormatOptions) => translator.formatDateTimeRange(start, end, options),
    (options: DateTimeFormatOptions) => translator.formatDateTimeRangeToParts(start, end, options),
  ];
  const standalone = [
    (options: DateTimeFormatOptions) => formatDateTime(start, "fi", options),
    (options: DateTimeFormatOptions) => formatDateTimeToParts(start, "fi", options),
    (options: DateTimeFormatOptions) => formatDateTimeRange(start, end, "fi", options),
    (options: DateTimeFormatOptions) => formatDateTimeRangeToParts(start, end, "fi", options),
  ];
  const diagnostics = [
    "datetime-format-failed",
    "datetime-format-to-parts-failed",
    "datetime-range-format-failed",
    "datetime-range-format-to-parts-failed",
  ];
  const error = new Error("Original datetime failure");
  for (const options of [
    {
      get timeZone(): string {
        throw error;
      },
    },
    {
      timeZone: "UTC",
      get language(): string {
        throw error;
      },
    },
    {
      timeZone: "UTC",
      get dateStyle(): "long" {
        throw error;
      },
    },
    {
      timeZone: "UTC",
      dateStyle: {
        toString() {
          throw error;
        },
      } as unknown as "long",
    },
  ]) {
    const before = entries.length;
    for (const call of [...methods, ...standalone])
      assert.throws(
        () => call(options),
        thrown => thrown === error,
      );
    assert.deepEqual(
      entries
        .slice(before)
        .map(entry => [entry.component, entry.event, entry.error, entry.details]),
      diagnostics.map(event => ["intl", event, error, { language: "fi" }]),
    );
  }
  const descriptor = Object.getOwnPropertyDescriptor(Intl.DateTimeFormat.prototype, "format")!;
  t.after(() => Object.defineProperty(Intl.DateTimeFormat.prototype, "format", descriptor));
  Object.defineProperty(Intl.DateTimeFormat.prototype, "format", {
    configurable: true,
    get() {
      throw error;
    },
  });
  for (const method of ["formatToParts", "formatRange", "formatRangeToParts"] as const)
    t.mock.method(Intl.DateTimeFormat.prototype, method, () => {
      throw error;
    });
  const before = entries.length;
  for (const call of [...methods, ...standalone])
    assert.throws(
      () => call({ timeZone: "UTC" }),
      thrown => thrown === error,
    );
  assert.deepEqual(
    entries.slice(before).map(entry => [entry.event, entry.error]),
    diagnostics.map(event => [event, error]),
  );
  assert.deepEqual(events, []);
});

test("datetime cache shares primitive snapshots across operations and bypasses unsafe options and oversized keys", t => {
  const Native = Intl.DateTimeFormat;
  let constructions = 0;
  t.mock.method(Intl, "DateTimeFormat", function (...args: ConstructorParameters<typeof Native>) {
    constructions++;
    return new Native(...args);
  });
  const start = new Date("2026-09-30T23:30:00Z");
  const end = new Date("2026-10-02T01:30:00Z");
  const calls = [
    (options: DateTimeFormatOptions, language = "en-x-dtcache2") =>
      formatDateTime(start, language, options),
    (options: DateTimeFormatOptions, language = "en-x-dtcache2") =>
      formatDateTimeToParts(start, language, options),
    (options: DateTimeFormatOptions, language = "en-x-dtcache2") =>
      formatDateTimeRange(start, end, language, options),
    (options: DateTimeFormatOptions, language = "en-x-dtcache2") =>
      formatDateTimeRangeToParts(start, end, language, options),
  ];
  let zoneReads = 0;
  const options = {
    get timeZone() {
      zoneReads++;
      return "UTC";
    },
  };
  for (const call of calls) call(options);
  assert.equal(zoneReads, 4);
  assert.equal(constructions, 1);
  calls[0]({ timeZone: "UTC" }, "EN_x_dtcache2");
  assert.equal(constructions, 1);
  calls[0]({ timeZone: "Europe/Helsinki" });
  assert.equal(constructions, 2);
  let coercions = 0;
  const dynamic = {
    timeZone: "UTC",
    month: {
      toString() {
        coercions++;
        return "long";
      },
    } as unknown as "long",
  };
  const before = constructions;
  for (const call of calls) {
    call(dynamic);
    call(dynamic);
  }
  assert.equal(coercions, 8);
  assert.equal(constructions - before, 8);
  for (const ignored of [{}, () => "ignored", Symbol("ignored"), 1n]) {
    const beforeUnsafe: number = constructions;
    calls[0]({ timeZone: "UTC", ignored } as DateTimeFormatOptions);
    calls[0]({ timeZone: "UTC", ignored } as DateTimeFormatOptions);
    assert.equal(constructions - beforeUnsafe, 2);
  }
  const oversized = { timeZone: "UTC", ignored: "x".repeat(5000) };
  const beforeOversized = constructions;
  calls[0](oversized);
  calls[0](oversized);
  assert.equal(constructions - beforeOversized, 2);
  calls[0]({ timeZone: "UTC" }, "en-x-dtevict");
  for (let index = 0; index < 110; index++) calls[0]({ timeZone: "UTC" }, `en-x-dtevict-${index}`);
  const beforeEvicted = constructions;
  calls[0]({ timeZone: "UTC" }, "en-x-dtevict");
  assert.equal(constructions - beforeEvicted, 1);
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
      assert.throws(() => format(invalid as CalendarDate, "2026-03-10", "en"), RangeError);
      assert.throws(() => format("2026-03-01", invalid as CalendarDate, "en"), RangeError);
    }
    const date = new Date("2026-03-01T00:00:00Z");
    assert.throws(() => format(date as unknown as CalendarDate, "2026-03-10", "en"), RangeError);
    assert.throws(
      () => format({ year: 2026, month: 3, day: 1 }, date as unknown as CalendarDate, "en"),
      RangeError,
    );
    assert.throws(() => format("2026-03-10", "2026-03-01", "en"), RangeError);
    assert.throws(
      () => format(date as unknown as CalendarDate, date as unknown as CalendarDate, "en"),
      RangeError,
    );
    assert.throws(
      () => format("2026-03-01", "2026-03-10", "en", { dateStyle: "long", month: "long" }),
      TypeError,
    );
    assert.throws(() => format("2026-03-01", "2026-03-10", "not_a_locale!"), RangeError);
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

test("datetime ranges detach both native Date slots before option getters and coercions", () => {
  for (const format of [formatDateTimeRange, formatDateTimeRangeToParts]) {
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
        return "long" as const;
      };
      const options: DateTimeFormatOptions = getter
        ? {
            timeZone: "UTC",
            get dateStyle() {
              return mutate();
            },
          }
        : { timeZone: "UTC", dateStyle: { toString: mutate } as unknown as "long" };
      const native = new Intl.DateTimeFormat("en", { timeZone: "UTC", dateStyle: "long" });
      assert.deepEqual(
        format(start, end, "en", options),
        format === formatDateTimeRange
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

test("date and clock ranges share formatter caches, snapshot options and bypass unsafe coercions", t => {
  const Native = Intl.DateTimeFormat;
  let constructions = 0;
  t.mock.method(Intl, "DateTimeFormat", function (...args: ConstructorParameters<typeof Native>) {
    constructions++;
    return new Native(...args);
  });
  formatDate("2026-03-01", "en-x-drcache");
  formatDateToParts("2026-03-01", "en-x-drcache");
  formatDateRange("2026-03-01", "2026-03-10", "EN_x_drcache");
  formatDateRangeToParts("2026-03-01", "2026-03-10", "en-x-drcache");
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
  const dateOptions = {
    get month(): "long" {
      reads++;
      return "long";
    },
  };
  formatDateRange("2026-03-01", "2026-03-10", "en-x-drreads", dateOptions);
  formatDateRangeToParts("2026-03-01", "2026-03-10", "en-x-drreads", dateOptions);
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
    formatDateRange("2026-03-01", "2026-03-10", "en-x-drcoerce", { month: hour });
    formatDateRangeToParts("2026-03-01", "2026-03-10", "en-x-drcoerce", { month: hour });
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
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Europe/Helsinki",
    });
    const text = formatDateTimeRange(start, end, "en-x-drhost", { timeZone: "Europe/Helsinki" });
    assert.equal(text, native.formatRange(start, end));
    assert.deepEqual(
      formatDateTimeRangeToParts(start, end, "en-x-drhost", { timeZone: "Europe/Helsinki" }),
      native.formatRangeToParts(start, end),
    );
    results.push(text);
  }
  assert.equal(results[0], results[1]);
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
    () => translator.formatDateRange("2026-03-01", "2026-03-10", { month: hour }),
    () => translator.formatDateRangeToParts("2026-03-01", "2026-03-10", { month: hour }),
    () => translator.formatTimeRange("09:05", "10:06", { hour }),
    () => translator.formatTimeRangeToParts("09:05", "10:06", { hour }),
  ];
  for (const call of [
    ...methods,
    () => formatDateRange("2026-03-01", "2026-03-10", "en", { month: hour }),
    () => formatDateRangeToParts("2026-03-01", "2026-03-10", "en", { month: hour }),
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

test("missing datetime string formatting is a named call-time capability on warm caches", async t => {
  const instant = new Date("2026-09-30T23:30Z");
  const options = { timeZone: "Europe/Helsinki" };
  const native = new Intl.DateTimeFormat("en", {
    ...options,
    dateStyle: "medium",
    timeStyle: "short",
  });
  const expected = native.formatToParts(instant);
  formatDateTime(instant, "en", options);
  const entries: TranslatorLogEntry[] = [];
  const translator = new Translator({ language: "en", logger: entry => entries.push(entry) });
  const descriptor = Object.getOwnPropertyDescriptor(Intl.DateTimeFormat.prototype, "format")!;
  t.after(() => Object.defineProperty(Intl.DateTimeFormat.prototype, "format", descriptor));
  Object.defineProperty(Intl.DateTimeFormat.prototype, "format", {
    configurable: true,
    value: undefined,
  });
  for (const call of [
    () => formatDateTime(instant, "en", options),
    () => translator.formatDateTime(instant, options),
  ]) {
    assert.throws(call, {
      name: "TypeError",
      message:
        /Intl\.DateTimeFormat\.prototype\.format is unavailable.*supporting runtime.*polyfill/,
    });
  }
  assert.deepEqual(formatDateTimeToParts(instant, "en", options), expected);
  assert.equal(typeof formatDateTimeRange(instant, instant, "en", options), "string");
  assert.ok(formatDateTimeRangeToParts(instant, instant, "en", options).length > 0);
  assert.equal(typeof formatNumber(1, "en"), "string");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].event, "datetime-format-failed");
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
  const start = new Date("2026-03-01T00:30:00Z");
  const end = new Date("2026-03-10T01:30:00Z");
  const options = { timeZone: "UTC" };
  formatDateTimeRange(start, end, "en-x-drmiss", options);
  formatDateTimeRangeToParts(start, end, "en-x-drmiss", options);
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
            () => imported.formatDateTimeRange(start, end, "en-x-drmiss", options),
            () => translator.formatDateTimeRange(start, end, options),
          ]
        : [
            () => imported.formatDateRangeToParts("2026-03-01", "2026-03-10", "en-x-drmiss"),
            () => imported.formatTimeRangeToParts("09:05", "10:06", "en-x-drmiss"),
            () => translator.formatDateRangeToParts("2026-03-01", "2026-03-10"),
            () => translator.formatTimeRangeToParts("09:05", "10:06"),
            () => imported.formatDateTimeRangeToParts(start, end, "en-x-drmiss", options),
            () => translator.formatDateTimeRangeToParts(start, end, options),
          ];
    for (const call of calls)
      assert.throws(call, {
        name: "TypeError",
        message: new RegExp(
          `Intl\\.DateTimeFormat\\.prototype\\.${method} is unavailable.*supporting runtime.*polyfill`,
        ),
      });
    assert.equal(typeof imported.formatDate("2026-03-01", "en"), "string");
    assert.equal(typeof imported.formatDateTime(start, "en", options), "string");
    assert.ok(imported.formatDateTimeToParts(start, "en", options).length > 0);
    assert.ok(imported.formatTimeToParts("09:05", "en").length > 0);
    assert.ok(imported.formatWeekdayToParts(0, "en").length > 0);
    assert.equal(typeof imported.formatNumberRange(1, 5, "en"), "string");
    assert.ok(imported.formatNumberRangeToParts(1, 5, "en").length > 0);
    assert.ok(imported.formatRelativeTimeToParts(1, "day", "en").length > 0);
    if (method === "formatRange") {
      assert.ok(translator.formatDateRangeToParts("2026-03-01", "2026-03-10").length > 0);
      assert.ok(translator.formatTimeRangeToParts("09:05", "10:06").length > 0);
      assert.ok(translator.formatDateTimeRangeToParts(start, end, options).length > 0);
    } else {
      assert.equal(typeof translator.formatDateRange("2026-03-01", "2026-03-10"), "string");
      assert.equal(typeof translator.formatTimeRange("09:05", "10:06"), "string");
      assert.equal(typeof translator.formatDateTimeRange(start, end, options), "string");
    }
    Object.defineProperty(prototype, method, descriptors[index]);
  }
  assert.deepEqual(
    entries.map(entry => entry.event),
    [
      "date-range-format-failed",
      "time-range-format-failed",
      "datetime-range-format-failed",
      "date-range-format-to-parts-failed",
      "time-range-format-to-parts-failed",
      "datetime-range-format-to-parts-failed",
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

test("calendar parts match native numeric defaults, styles and UTC calendars", () => {
  const choices: DateFormatOptions[] = [
    {},
    { year: "2-digit", month: "long", weekday: "short" },
    { year: undefined, day: undefined },
    { dateStyle: "full" },
  ];
  for (const language of [
    "en-x-calparts",
    "fi-x-calparts",
    "ar-x-calparts",
    "ja-JP-u-ca-japanese",
  ]) {
    for (const options of choices) {
      const defaults: DateFormatOptions =
        options.dateStyle === undefined
          ? { year: "numeric", month: "numeric", day: "numeric" }
          : {};
      for (const calendar of ["2026-09-30", { year: 2026, month: 9, day: 30 }]) {
        assert.deepEqual(
          formatDateToParts(calendar, language, options),
          new Intl.DateTimeFormat(language, {
            ...defaults,
            ...options,
            timeZone: "UTC",
          }).formatToParts(Date.UTC(2026, 8, 30)),
        );
      }
    }
  }
  const ancient = new Date(0);
  ancient.setUTCFullYear(99, 0, 1);
  assert.deepEqual(
    formatDateToParts("0099-01-01", "en", { dateStyle: "long" }),
    new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "UTC" }).formatToParts(ancient),
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
    assert.throws(() => formatDateToParts(value as CalendarDate, "en"), RangeError);
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
  assert.throws(
    () => formatDateTimeToParts(new Date(), "en", { timeZone: "Not/AZone" }),
    RangeError,
  );
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

test("datetime parts detach foreign-realm native timestamps before option coercion", () => {
  const timestamp = Date.UTC(2026, 8, 30, 0, 30);
  for (const date of [new Date(timestamp), runInNewContext(`new Date(${timestamp})`) as Date]) {
    date.getTime = () => {
      throw new Error("Do not call overridden methods");
    };
    date.valueOf = () => 0;
    Object.defineProperty(date, Symbol.toPrimitive, { value: () => 0 });
    const options = { timeZone: "America/Los_Angeles", dateStyle: "long" } as const;
    assert.deepEqual(
      formatDateTimeToParts(date, "en", options),
      new Intl.DateTimeFormat("en", options).formatToParts(timestamp),
    );
    const dateStyle = {
      toString() {
        date.setTime(0);
        return "long";
      },
    };
    assert.deepEqual(
      formatDateTimeToParts(date, "en", {
        dateStyle: dateStyle as unknown as "long",
        timeZone: "UTC",
      }),
      new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "UTC" }).formatToParts(
        timestamp,
      ),
    );
    assert.equal(Date.prototype.getTime.call(date), 0);
  }
  assert.throws(
    () => formatDateTimeToParts(runInNewContext("new Date(NaN)"), "en", { timeZone: "UTC" }),
    /Date instant must be valid/,
  );
  assert.throws(
    () =>
      formatDateTimeToParts(
        { [Symbol.toStringTag]: "Date", getTime: () => timestamp } as unknown as Date,
        "en",
        { timeZone: "UTC" },
      ),
    TypeError,
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
  formatDateToParts("2026-10-01", "EN_x_dtcache");
  formatTime("09:05", "en-x-dtcache");
  formatTimeToParts("10:06", "en-x-dtcache");
  formatWeekday(0, "en-x-dtcache");
  formatWeekdayToParts(6, "en-x-dtcache");
  assert.equal(constructions, 3);
  const instant = new Date(Date.UTC(2026, 8, 30));
  formatDateTimeToParts(instant, "en-x-dtcache", {
    timeZone: "UTC",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
  assert.equal(constructions, 3);
  formatDateTime(instant, "en-x-dtcache", { timeZone: "UTC" });
  formatDateTimeToParts(instant, "en-x-dtcache", { timeZone: "UTC" });
  assert.equal(constructions, 4);
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

test("all explicitly zoned datetime operations are independent of host zone changes", t => {
  const original = process.env.TZ;
  t.after(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });
  const date = new Date(Date.UTC(2026, 8, 30, 0, 30));
  const end = new Date(Date.UTC(2026, 9, 2, 1, 30));
  const options = Object.freeze({ timeZone: "Europe/Helsinki" });
  const translator = new Translator({ language: "en-x-hostpart" });
  const results: unknown[] = [];
  for (const timeZone of ["UTC", "America/Los_Angeles", "Asia/Tokyo"]) {
    process.env.TZ = timeZone;
    const native = new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeStyle: "short",
      ...options,
    });
    const expected = [
      native.format(date),
      native.formatToParts(date),
      native.formatRange(date, end),
      native.formatRangeToParts(date, end),
    ];
    const actual = [
      formatDateTime(date, "en-x-hostpart", options),
      formatDateTimeToParts(date, "en-x-hostpart", options),
      formatDateTimeRange(date, end, "en-x-hostpart", options),
      formatDateTimeRangeToParts(date, end, "en-x-hostpart", options),
    ];
    const facade = [
      translator.formatDateTime(date, options),
      translator.formatDateTimeToParts(date, options),
      translator.formatDateTimeRange(date, end, options),
      translator.formatDateTimeRangeToParts(date, end, options),
    ];
    assert.deepEqual(actual, expected);
    assert.deepEqual(facade, expected);
    results.push(actual);
  }
  assert.deepEqual(results[0], results[1]);
  assert.deepEqual(results[0], results[2]);
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
  const start = new Date("2026-03-01T00:30:00Z");
  const end = new Date("2026-03-10T01:30:00Z");
  const options = { timeZone: "UTC" };
  formatDateTimeToParts(start, "en", options);
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
    () => imported.formatDateTimeToParts(start, "en", options),
    () => translator.formatDateTimeToParts(start, options),
  ])
    assert.throws(call, {
      name: "TypeError",
      message: /Intl\.DateTimeFormat\.prototype\.formatToParts.*supporting runtime.*polyfill/,
    });
  assert.equal(typeof imported.formatDate("2026-09-30", "en"), "string");
  assert.equal(typeof imported.formatDateTime(start, "en", options), "string");
  assert.equal(typeof translator.formatDateTime(start, options), "string");
  assert.equal(typeof imported.formatDateTimeRange(start, end, "en", options), "string");
  assert.ok(translator.formatDateTimeRangeToParts(start, end, options).length > 0);
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
      "datetime-format-to-parts-failed",
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
    translator.formatDateTime(instant, {
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

test("datetime instants use native cross-realm timestamps and ignore overridden date methods", () => {
  const timestamp = Date.UTC(2026, 8, 30, 0, 30);
  const foreignDate: Date = runInNewContext(`new Date(${timestamp})`);
  assert.equal(foreignDate instanceof Date, false);
  const options = { timeZone: "America/Los_Angeles", dateStyle: "long" } as const;
  const expected = new Intl.DateTimeFormat("en-GB", options).format(timestamp);
  assert.equal(formatDateTime(foreignDate, "en-GB", options), expected);
  foreignDate.getTime = () => {
    throw new Error("Overridden getTime must not be called");
  };
  foreignDate.valueOf = () => 0;
  Object.defineProperty(foreignDate, Symbol.toPrimitive, { value: () => 0 });
  assert.equal(formatDateTime(foreignDate, "en-GB", options), expected);
  for (const invalid of [new Date(NaN), runInNewContext("new Date(NaN)")]) {
    assert.throws(
      () => formatDateTime(invalid, "en", { timeZone: "UTC" }),
      /Date instant must be valid/,
    );
  }
  assert.throws(
    () =>
      formatDateTime(
        { [Symbol.toStringTag]: "Date", getTime: () => timestamp } as unknown as Date,
        "en",
        { timeZone: "UTC" },
      ),
    TypeError,
  );
});

test("datetime instants are detached before Intl option coercion can mutate the original", () => {
  const timestamp = Date.UTC(2026, 8, 30, 0, 30);
  const date = new Date(timestamp);
  const dateStyle = {
    toString() {
      date.setTime(0);
      return "long";
    },
  };
  assert.equal(
    formatDateTime(date, "en-GB", { timeZone: "UTC", dateStyle: dateStyle as unknown as "long" }),
    new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", dateStyle: "long" }).format(timestamp),
  );
  assert.equal(date.getTime(), 0);
});

test("calendar dates reject zones while datetime instants honor the supplied zone", () => {
  const instant = new Date(Date.UTC(2026, 8, 30, 0, 30));
  const zone = "America/Los_Angeles";
  assert.notEqual(
    formatDateTime(instant, "en-GB", { timeZone: zone }),
    formatDateTime(instant, "en-GB", {
      timeZone: "UTC",
    }),
  );
  for (const calendar of ["2026-09-30", { year: 2026, month: 9, day: 30 }]) {
    assert.throws(
      () => formatDate(calendar, "en-GB", { timeZone: zone } as unknown as DateFormatOptions),
      RangeError,
    );
    assert.throws(
      () => formatDate(calendar, "en-GB", { timeStyle: "short" } as unknown as DateFormatOptions),
      RangeError,
    );
  }
  assert.throws(() => formatDateTime(instant, "en-GB", { timeZone: "Not/AZone" }), RangeError);
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
  formatDateTime(instant, "en-ZA", { timeZone: "UTC" });
  formatDateTime(instant, "en-ZA", { timeZone: "UTC" });
  assert.equal(dates, 6);
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
