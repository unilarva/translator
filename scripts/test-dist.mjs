// SPDX-FileCopyrightText: 2020-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Package-private smoke checks for built exports and isolated tarball consumers.
 * @packageDocumentation
 * @module test-dist
 * @author Lari Natri
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertPublishedFiles } from "./packed-files.mjs";

const core = await import("../dist/index.js");
const dom = await import("../dist/dom.js");

// Consumers need the same documentation in emitted declarations as in source.
const distribution = new URL("../dist/", import.meta.url);
for (const filename of readdirSync(distribution)) {
  if (!filename.endsWith(".d.ts")) continue;
  const declaration = readFileSync(new URL(filename, distribution), "utf8");
  assert.match(declaration, /@packageDocumentation/, filename);
  assert.ok(declaration.includes(`@module ${filename.replace(/\.d\.ts$/, "")}`), filename);
  assert.match(declaration, /@author Lari Natri/, filename);
  assert.match(declaration, /SPDX-License-Identifier: Apache-2\.0/, filename);
}

const translator = new core.Translator({ language: "en" });
translator.importTranslations({
  "translator-i18n": { "multilingual-data": { smoke: { en: "Built package" } } },
});

assert.equal(translator.translateKey("smoke"), "Built package");
assert.equal(core.formatRelativeTime(-1, "day", "en", { numeric: "auto" }), "yesterday");
assert.equal(core.selectPlural(2, "en", { type: "ordinal" }), "two");
assert.equal(translator.formatRelativeTime(0, "day", { numeric: "auto" }), "today");
assert.equal(translator.selectPlural(1), "one");
assert.equal(typeof dom.bindTranslator, "function");
assert.equal(typeof dom.bindLanguageSelect, "function");
assert.equal(typeof dom.bindLanguageDetails, "function");

/** Checks public parts exports, locale overrides, and caller-owned native results. */
function assertParts(api, translator) {
  const rounding = {
    maximumFractionDigits: 1,
    roundingMode: "halfEven",
    trailingZeroDisplay: "stripIfInteger",
  };
  const number = new Intl.NumberFormat("en", rounding).formatToParts(1234.25);
  const currency = new Intl.NumberFormat("en", {
    style: "currency",
    currency: "EUR",
    ...rounding,
  }).formatToParts(1234.25);
  const relative = new Intl.RelativeTimeFormat("en").formatToParts(-2, "day");
  const calendar = { year: 2026, month: 10, day: 3 };
  const instant = new Date("2026-10-03T13:45:00Z");
  const calendarDate = new Date(Date.UTC(2026, 9, 3));
  const dateOptions = { year: "numeric", month: "numeric", day: "numeric", timeZone: "UTC" };
  const date = new Intl.DateTimeFormat("en", dateOptions).formatToParts(calendarDate);
  const instantOptions = { dateStyle: "long", timeZone: "America/New_York" };
  const instantParts = new Intl.DateTimeFormat("en", instantOptions).formatToParts(instant);
  const clock = { hour: 13, minute: 45, second: 0 };
  const clockDate = new Date(Date.UTC(1970, 0, 1, 13, 45));
  const timeOptions = { hour: "numeric", minute: "2-digit", timeZone: "UTC" };
  const time = new Intl.DateTimeFormat("en", timeOptions).formatToParts(clockDate);
  const seconds = new Intl.DateTimeFormat("en", {
    ...timeOptions,
    second: "2-digit",
  }).formatToParts(clockDate);
  const monday = new Date(Date.UTC(1970, 0, 5));
  const weekday = new Intl.DateTimeFormat("en", { weekday: "long", timeZone: "UTC" }).formatToParts(
    monday,
  );
  for (const [format, expected] of [
    [() => api.formatNumberToParts(1234.25, "en", rounding), number],
    [() => translator.formatNumberToParts(1234.25, rounding), number],
    [() => api.formatCurrencyToParts(1234.25, "en", { currency: "eur", ...rounding }), currency],
    [() => translator.formatCurrencyToParts(1234.25, { currency: "eur", ...rounding }), currency],
    [() => api.formatRelativeTimeToParts(-2, "day", "en"), relative],
    [() => translator.formatRelativeTimeToParts(-2, "day"), relative],
    [() => api.formatDateToParts(calendar, "en"), date],
    [() => translator.formatDateToParts(calendar), date],
    [() => api.formatDateToParts("2026-10-03", "en"), date],
    [() => translator.formatDateToParts("2026-10-03"), date],
    [() => api.formatDateTimeToParts(instant, "en", instantOptions), instantParts],
    [() => translator.formatDateTimeToParts(instant, instantOptions), instantParts],
    [() => api.formatTimeToParts("13:45", "en"), time],
    [() => translator.formatTimeToParts("13:45"), time],
    [() => api.formatTimeToParts(clock, "en"), seconds],
    [() => translator.formatTimeToParts(clock), seconds],
    [() => api.formatWeekdayToParts(0, "en"), weekday],
    [() => translator.formatWeekdayToParts(0), weekday],
  ]) {
    const first = format();
    const second = format();
    assert.deepEqual(first, expected);
    assert.deepEqual(second, expected);
    assert.notStrictEqual(first, second);
    assert.equal(Object.isFrozen(first), false);
    for (let index = 0; index < first.length; index++) {
      assert.notStrictEqual(first[index], second[index]);
      assert.equal(Object.isFrozen(first[index]), false);
      first[index].value = "consumer mutation";
    }
    first.length = 0;
    assert.deepEqual(format(), expected);
    assert.deepEqual(second, expected);
  }
  assert.deepEqual(
    translator.formatNumberToParts(1.25, { language: "fi", ...rounding }),
    new Intl.NumberFormat("fi", rounding).formatToParts(1.25),
  );
  assert.deepEqual(
    translator.formatCurrencyToParts(1.25, { language: "fi", currency: "EUR" }),
    new Intl.NumberFormat("fi", { style: "currency", currency: "EUR" }).formatToParts(1.25),
  );
  assert.deepEqual(
    translator.formatRelativeTimeToParts(0, "day", { language: "fi", numeric: "auto" }),
    new Intl.RelativeTimeFormat("fi", { numeric: "auto" }).formatToParts(0, "day"),
  );
  for (const format of [
    () => api.formatDateToParts(calendar, "en", { language: "fi" }),
    () => translator.formatDateToParts(calendar, { language: "fi" }),
  ]) {
    assert.deepEqual(
      format(),
      new Intl.DateTimeFormat("fi", dateOptions).formatToParts(calendarDate),
    );
  }
  for (const format of [
    () => api.formatTimeToParts(clock, "en", { language: "fi", timeStyle: "medium" }),
    () => translator.formatTimeToParts(clock, { language: "fi", timeStyle: "medium" }),
  ]) {
    assert.deepEqual(
      format(),
      new Intl.DateTimeFormat("fi", { timeStyle: "medium", timeZone: "UTC" }).formatToParts(
        clockDate,
      ),
    );
  }
  for (const format of [
    () => api.formatWeekdayToParts(6, "en", { language: "fi", width: "short" }),
    () => translator.formatWeekdayToParts(6, { language: "fi", width: "short" }),
  ]) {
    assert.deepEqual(
      format(),
      new Intl.DateTimeFormat("fi", { weekday: "short", timeZone: "UTC" }).formatToParts(
        new Date(Date.UTC(1970, 0, 11)),
      ),
    );
  }
}

assertParts(core, translator);

/** Checks numeric ranges against the host, including metadata and mutable ownership. */
function assertNumberRanges(api, translator) {
  const rounding = { maximumFractionDigits: 1, roundingMode: "halfEven" };
  for (const language of ["en", "fi"]) {
    for (const options of [{}, rounding]) {
      const number = new Intl.NumberFormat(language, options);
      const currency = new Intl.NumberFormat(language, {
        ...options,
        style: "currency",
        currency: "EUR",
      });
      for (const [start, end] of [
        [1, 9],
        [9, 1],
        [2, 2],
        [-0, 0],
        [0, -0],
        [1.21, 1.24],
      ]) {
        const numberOptions = { ...options, language };
        const currencyOptions = { ...options, language, currency: "eur", style: "decimal" };
        for (const format of [
          () => api.formatNumberRange(start, end, "en", numberOptions),
          () => translator.formatNumberRange(start, end, numberOptions),
        ])
          assert.equal(format(), number.formatRange(start, end));
        for (const format of [
          () => api.formatCurrencyRange(start, end, "en", currencyOptions),
          () => translator.formatCurrencyRange(start, end, currencyOptions),
        ])
          assert.equal(format(), currency.formatRange(start, end));
        for (const [format, expected] of [
          [
            () => api.formatNumberRangeToParts(start, end, "en", numberOptions),
            number.formatRangeToParts(start, end),
          ],
          [
            () => translator.formatNumberRangeToParts(start, end, numberOptions),
            number.formatRangeToParts(start, end),
          ],
          [
            () => api.formatCurrencyRangeToParts(start, end, "en", currencyOptions),
            currency.formatRangeToParts(start, end),
          ],
          [
            () => translator.formatCurrencyRangeToParts(start, end, currencyOptions),
            currency.formatRangeToParts(start, end),
          ],
        ]) {
          const first = format();
          const second = format();
          assert.deepEqual(first, expected);
          assert.deepEqual(second, expected);
          assert.notStrictEqual(first, second);
          assert.equal(Object.isFrozen(first), false);
          for (let index = 0; index < first.length; index++) {
            assert.ok(["startRange", "endRange", "shared"].includes(first[index].source));
            assert.notStrictEqual(first[index], second[index]);
            assert.equal(Object.isFrozen(first[index]), false);
            first[index].value = "consumer mutation";
            first[index].source = first[index].source === "shared" ? "startRange" : "shared";
          }
          first.push({ type: "approximatelySign", value: "~", source: "shared" });
          first.length = 0;
          assert.deepEqual(second, expected);
          assert.deepEqual(format(), expected);
        }
      }
    }
  }
  const number = new Intl.NumberFormat("en");
  assert.equal(api.formatNumberRange(1, 9, "en"), number.formatRange(1, 9));
  assert.equal(translator.formatNumberRange(1, 9), number.formatRange(1, 9));
  assert.deepEqual(api.formatNumberRangeToParts(1, 9, "en"), number.formatRangeToParts(1, 9));
  assert.deepEqual(translator.formatNumberRangeToParts(1, 9), number.formatRangeToParts(1, 9));
  const equal = api.formatNumberRangeToParts(2, 2, "en");
  assert.ok(equal.some(part => part.type === "approximatelySign" && part.source === "shared"));
  const distinct = api.formatNumberRangeToParts(1, 9, "en");
  assert.ok(distinct.some(part => part.source === "startRange"));
  assert.ok(distinct.some(part => part.source === "endRange"));
  assert.ok(distinct.some(part => part.source === "shared"));
  for (const format of [
    (start, end) => api.formatNumberRange(start, end, "en"),
    (start, end) => api.formatNumberRangeToParts(start, end, "en"),
    (start, end) => api.formatCurrencyRange(start, end, "en", { currency: "EUR" }),
    (start, end) => api.formatCurrencyRangeToParts(start, end, "en", { currency: "EUR" }),
    (start, end) => translator.formatNumberRange(start, end),
    (start, end) => translator.formatNumberRangeToParts(start, end),
    (start, end) => translator.formatCurrencyRange(start, end, { currency: "EUR" }),
    (start, end) => translator.formatCurrencyRangeToParts(start, end, { currency: "EUR" }),
  ]) {
    for (const invalid of ["1", 1n, NaN, Infinity, -Infinity]) {
      assert.throws(() => format(invalid, 2));
      assert.throws(() => format(1, invalid));
    }
  }
}

assertNumberRanges(core, translator);

/** Checks calendar/instant pairs and clock ranges through built and installed exports. */
function assertDateTimeRanges(api, translator) {
  const calendar = { year: 2026, month: 10, day: 3 };
  const clock = { hour: 13, minute: 45, second: 0 };
  for (const language of ["en", "fi"]) {
    for (const [family, start, end, nativeStart, nativeEnd, options, nativeOptions] of [
      [
        "Date",
        calendar,
        "2026-10-05",
        new Date("2026-10-03T00:00Z"),
        new Date("2026-10-05T00:00Z"),
        {},
        { year: "numeric", month: "numeric", day: "numeric", timeZone: "UTC" },
      ],
      [
        "DateTime",
        new Date("2026-10-03T13:45Z"),
        new Date("2026-10-05T14:30Z"),
        new Date("2026-10-03T13:45Z"),
        new Date("2026-10-05T14:30Z"),
        { dateStyle: "long", timeZone: "America/New_York" },
        { dateStyle: "long", timeZone: "America/New_York" },
      ],
      [
        "Time",
        "13:00",
        clock,
        new Date("1970-01-01T13:00Z"),
        new Date("1970-01-01T13:45Z"),
        {},
        { hour: "numeric", minute: "2-digit", second: "2-digit", timeZone: "UTC" },
      ],
      [
        "Time",
        clock,
        "14:30",
        new Date("1970-01-01T13:45Z"),
        new Date("1970-01-01T14:30Z"),
        { timeStyle: "short" },
        { timeStyle: "short", timeZone: "UTC" },
      ],
    ]) {
      const formatter = new Intl.DateTimeFormat(language, nativeOptions);
      const rangeOptions = { ...options, language };
      for (const format of [
        () => api["format" + family + "Range"](start, end, "en", rangeOptions),
        () => translator["format" + family + "Range"](start, end, rangeOptions),
      ])
        assert.equal(format(), formatter.formatRange(nativeStart, nativeEnd));
      const expected = formatter.formatRangeToParts(nativeStart, nativeEnd);
      assert.ok(expected.some(part => part.source === "startRange"));
      assert.ok(expected.some(part => part.source === "endRange"));
      assert.ok(expected.some(part => part.source === "shared"));
      for (const format of [
        () => api["format" + family + "RangeToParts"](start, end, "en", rangeOptions),
        () => translator["format" + family + "RangeToParts"](start, end, rangeOptions),
      ]) {
        const first = format();
        const second = format();
        assert.deepEqual(first, expected);
        assert.deepEqual(second, expected);
        assert.notStrictEqual(first, second);
        assert.equal(Object.isFrozen(first), false);
        for (let index = 0; index < first.length; index++) {
          assert.ok(["startRange", "endRange", "shared"].includes(first[index].source));
          if (family === "Time")
            assert.ok(
              ![
                "era",
                "year",
                "relatedYear",
                "yearName",
                "month",
                "day",
                "weekday",
                "timeZoneName",
              ].includes(first[index].type),
            );
          assert.notStrictEqual(first[index], second[index]);
          assert.equal(Object.isFrozen(first[index]), false);
          first[index].value = "consumer mutation";
          first[index].source = first[index].source === "shared" ? "startRange" : "shared";
        }
        first.push({ type: "literal", value: "consumer-owned", source: "shared" });
        first.length = 0;
        assert.deepEqual(second, expected);
        assert.deepEqual(format(), expected);
      }
    }
  }
  for (const suffix of ["Range", "RangeToParts"]) {
    for (const format of [
      (start, end) => api["formatDate" + suffix](start, end, "en"),
      (start, end) => translator["formatDate" + suffix](start, end),
    ]) {
      assert.throws(() => format(calendar, new Date()), RangeError);
      assert.throws(() => format(new Date(), calendar), RangeError);
      assert.throws(() => format("2026-10-05", calendar), RangeError);
    }
    for (const format of [
      (start, end) => api["formatTime" + suffix](start, end, "en"),
      (start, end) => translator["formatTime" + suffix](start, end),
    ])
      assert.throws(() => format("23:00", "01:00"), RangeError);
  }
}

assertDateTimeRanges(core, translator);

/** Checks recurring weekday ranges, native metadata, ownership and isolated failures. */
function assertWeekdayRanges(api, translator) {
  for (const language of ["en-US", "fi-FI", "pt-BR", "ja-JP", "ar-EG", "th-TH"])
    for (const width of ["long", "short", "narrow"])
      for (let start = 0; start < 7; start++)
        for (let end = 0; end < 7; end++) {
          const nativeStart = new Date(Date.UTC(1970, 0, 5 + start));
          const nativeEnd = new Date(Date.UTC(1970, 0, 5 + end + (end < start ? 7 : 0)));
          const native = new Intl.DateTimeFormat(language, { weekday: width, timeZone: "UTC" });
          const options = { width, language };
          const text = native.formatRange(nativeStart, nativeEnd);
          const parts = native.formatRangeToParts(nativeStart, nativeEnd);
          assert.ok(
            parts.every(part => ["weekday", "literal"].includes(part.type)),
            JSON.stringify({ language, width, start, end, text, parts }),
          );
          for (const format of [
            () => api.formatWeekdayRange(start, end, "en", options),
            () => translator.formatWeekdayRange(start, end, options),
          ])
            assert.equal(format(), text);
          for (const format of [
            () => api.formatWeekdayRangeToParts(start, end, "en", options),
            () => translator.formatWeekdayRangeToParts(start, end, options),
          ]) {
            const first = format();
            const second = format();
            assert.deepEqual(first, parts);
            assert.deepEqual(second, parts);
            assert.notStrictEqual(first, second);
            assert.equal(Object.isFrozen(first), false);
            first.forEach((part, index) => {
              assert.ok(["startRange", "endRange", "shared"].includes(part.source));
              assert.notStrictEqual(part, second[index]);
              assert.equal(Object.isFrozen(part), false);
              part.value = "consumer mutation";
              part.source = part.source === "shared" ? "startRange" : "shared";
            });
            first.push({ type: "literal", value: "consumer-owned", source: "shared" });
            first.length = 0;
            assert.deepEqual(second, parts);
            assert.deepEqual(format(), parts);
          }
        }
  const native = new Intl.DateTimeFormat("en", { weekday: "long", timeZone: "UTC" });
  const monday = new Date(Date.UTC(1970, 0, 5));
  const friday = new Date(Date.UTC(1970, 0, 9));
  assert.equal(api.formatWeekdayRange(0, 4, "en"), native.formatRange(monday, friday));
  assert.equal(translator.formatWeekdayRange(0, 4), native.formatRange(monday, friday));
  assert.deepEqual(
    api.formatWeekdayRangeToParts(0, 4, "en"),
    native.formatRangeToParts(monday, friday),
  );
  assert.deepEqual(
    translator.formatWeekdayRangeToParts(0, 4),
    native.formatRangeToParts(monday, friday),
  );
  for (const suffix of ["Range", "RangeToParts"]) {
    const method = "formatWeekday" + suffix;
    for (const format of [
      (start, end, options) => api[method](start, end, "en", options),
      (start, end, options) => translator[method](start, end, options),
    ]) {
      for (const invalid of [
        -1,
        7,
        0.5,
        NaN,
        Infinity,
        -Infinity,
        "0",
        0n,
        null,
        undefined,
        {},
        new Number(0),
      ]) {
        assert.throws(() => format(invalid, 4), RangeError);
        assert.throws(() => format(0, invalid), RangeError);
      }
      assert.throws(() => format(0, 4, { width: "wide" }), RangeError);
      assert.throws(() => format(0, 4, { language: "!" }), RangeError);
      for (const key of ["timeZone", "timeZoneName"])
        for (const value of [undefined, key === "timeZone" ? "UTC" : "short"])
          for (const options of [{ [key]: value }, Object.create({ [key]: value })])
            assert.throws(() => format(0, 4, options), RangeError);
    }
    const failure = new Error("weekday option failure");
    const options = {
      get width() {
        throw failure;
      },
    };
    const logs = [];
    const events = [];
    const isolated = new api.Translator({
      language: "fi",
      fallbackLanguage: "en",
      logger: entry => {
        logs.push(entry);
        throw new Error("logger failure");
      },
    });
    isolated.subscribe(event => events.push(event));
    isolated.subscribeCatalog(event => events.push(event));
    const locale = new Intl.DateTimeFormat("fi", { weekday: "long", timeZone: "UTC" });
    const expected = locale["format" + suffix](monday, friday);
    assert.deepEqual(isolated[method](0, 4), expected);
    assert.deepEqual(api[method](0, 4, "fi"), expected);
    let width = "long";
    const coercible = { width: { toString: () => width } };
    for (width of ["long", "short", "narrow", "long"]) {
      const expected = new Intl.DateTimeFormat("en", { weekday: width, timeZone: "UTC" })[
        "format" + suffix
      ](monday, friday);
      assert.deepEqual(api[method](0, 4, "en", coercible), expected);
      assert.deepEqual(translator[method](0, 4, coercible), expected);
    }
    assert.throws(
      () => api[method](0, 4, "en", options),
      error => error === failure,
    );
    assert.equal(logs.length, 0);
    assert.throws(
      () => isolated[method](0, 4, options),
      error => error === failure,
    );
    assert.equal(logs.length, 1);
    assert.equal(
      logs[0].event,
      suffix === "Range" ? "weekday-range-format-failed" : "weekday-range-format-to-parts-failed",
    );
    assert.equal(isolated.getLanguage(), "fi");
    assert.deepEqual(events, []);
  }
}

assertWeekdayRanges(core, translator);

/** Probes one unavailable weekday range operation before import or with a warm cache. */
async function assertWeekdayCapabilities(entry, missing, warm) {
  const prototype = Intl.DateTimeFormat.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, missing);
  const native = new Intl.DateTimeFormat("en", { weekday: "long", timeZone: "UTC" });
  const friday = new Date(Date.UTC(1970, 0, 9));
  const monday = new Date(Date.UTC(1970, 0, 12));
  const suffixes = ["", "ToParts", "Range", "RangeToParts"];
  const expected = Object.fromEntries(
    suffixes.map(suffix => [
      suffix,
      native["format" + suffix](...(suffix.startsWith("Range") ? [friday, monday] : [friday])),
    ]),
  );
  let api;
  let translator;
  const logs = [];
  const load = async () => {
    api = await import(entry);
    translator = new api.Translator({ language: "en", logger: entry => logs.push(entry) });
  };
  if (warm) {
    await load();
    for (const suffix of suffixes) {
      const values = suffix.startsWith("Range") ? [4, 0] : [4];
      api["formatWeekday" + suffix](...values, "en");
      translator["formatWeekday" + suffix](...values);
    }
  }
  Object.defineProperty(prototype, missing, { configurable: true, value: undefined });
  try {
    if (!api) await load();
    for (const suffix of suffixes) {
      const values = suffix.startsWith("Range") ? [4, 0] : [4];
      for (const call of [
        () => api["formatWeekday" + suffix](...values, "en"),
        () => translator["formatWeekday" + suffix](...values),
      ]) {
        if ("format" + suffix === missing)
          assert.throws(
            call,
            error =>
              error instanceof TypeError &&
              error.message.includes("Intl.DateTimeFormat.prototype." + missing) &&
              /runtime|polyfill/i.test(error.message),
          );
        else assert.deepEqual(call(), expected[suffix]);
      }
    }
    assert.equal(typeof api.formatNumberRange(1, 2, "en"), "string");
    assert.ok(translator.formatNumberRangeToParts(1, 2).length > 0);
    assert.equal(typeof api.formatDate("2026-10-03", "en"), "string");
    assert.ok(translator.formatDateToParts("2026-10-03").length > 0);
    assert.equal(typeof translator.formatTime("13:45"), "string");
    assert.ok(api.formatTimeToParts("13:45", "en").length > 0);
    assert.equal(logs.length, 1);
    assert.equal(
      logs[0].event,
      missing === "formatRange"
        ? "weekday-range-format-failed"
        : "weekday-range-format-to-parts-failed",
    );
  } finally {
    Object.defineProperty(prototype, missing, descriptor);
  }
}

/** Verifies the breaking temporal split, explicit zones, defaults and native result ownership. */
function assertDateTimeContract(api, translator) {
  const start = new Date("2026-09-30T23:30:00Z");
  const end = new Date("2026-10-02T01:45:00Z");
  for (const suffix of ["", "ToParts", "Range", "RangeToParts"]) {
    const range = suffix.startsWith("Range");
    const values = range ? [start, end] : [start];
    const method = "formatDateTime" + suffix;
    const native = "format" + suffix;
    for (const options of [
      { timeZone: "Europe/Helsinki" },
      { timeZone: "UTC", hour12: false },
      { timeZone: "America/New_York", dateStyle: "long" },
      { timeZone: "Europe/Helsinki", timeStyle: "short" },
      { timeZone: "UTC", year: "numeric", hour: "2-digit" },
    ]) {
      const { timeZone, ...display } = options;
      const defaults = Object.keys(display).every(key => key === "hour12")
        ? { dateStyle: "medium", timeStyle: "short" }
        : {};
      const formatter = new Intl.DateTimeFormat("fi", { ...defaults, ...display, timeZone });
      const expected = formatter[native](...values);
      for (const format of [
        () => api[method](...values, "en", { ...options, language: "fi" }),
        () => translator[method](...values, { ...options, language: "fi" }),
      ]) {
        const first = format();
        assert.deepEqual(first, expected);
        if (Array.isArray(first)) {
          const second = format();
          assert.notStrictEqual(first, second);
          assert.equal(Object.isFrozen(first), false);
          first.forEach((part, index) => {
            assert.notStrictEqual(part, second[index]);
            assert.equal(Object.isFrozen(part), false);
            if (range) assert.ok(["startRange", "endRange", "shared"].includes(part.source));
            part.value = "consumer mutation";
          });
          first.length = 0;
          assert.deepEqual(second, expected);
          assert.deepEqual(format(), expected);
        }
      }
    }
    for (const invoke of [
      (values, options) => api[method](...values, "en", options),
      (values, options) => translator[method](...values, options),
    ]) {
      for (const options of [
        undefined,
        null,
        {},
        { timeZone: undefined },
        { timeZone: null },
        { timeZone: "" },
        { timeZone: "  " },
        { timeZone: 1 },
        { timeZone: new String("UTC") },
        { timeZone: "Not/A_Zone" },
      ])
        assert.throws(() => invoke(values, options), RangeError);
      for (const invalid of [
        "2026-10-03",
        0,
        { year: 2026, month: 10, day: 3 },
        {},
        new Date(NaN),
      ]) {
        assert.throws(() => invoke(range ? [invalid, end] : [invalid], { timeZone: "UTC" }));
        if (range) assert.throws(() => invoke([start, invalid], { timeZone: "UTC" }));
      }
      if (range) assert.throws(() => invoke([end, start], { timeZone: "UTC" }), RangeError);
      const inherited = Object.create({ timeZone: "Europe/Helsinki" });
      const hidden = Object.defineProperty({}, "timeZone", { value: "Europe/Helsinki" });
      const expected = invoke(values, { timeZone: "Europe/Helsinki" });
      assert.deepEqual(invoke(values, inherited), expected);
      assert.deepEqual(invoke(values, hidden), expected);
    }
    const calendarValues = range ? ["2026-10-03", "2026-10-04"] : ["2026-10-03"];
    for (const invoke of [
      (values, options) => api["formatDate" + suffix](...values, "en", options),
      (values, options) => translator["formatDate" + suffix](...values, options),
    ]) {
      assert.throws(() => invoke(values, {}), RangeError);
      for (const key of [
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
        for (const options of [{ [key]: undefined }, Object.create({ [key]: undefined })])
          assert.throws(() => invoke(calendarValues, options), RangeError);
      }
    }
  }
  for (const suffix of ["", "ToParts"])
    for (const key of ["timeZone", "timeZoneName"])
      for (const options of [{ [key]: undefined }, Object.create({ [key]: undefined })]) {
        assert.throws(() => api["formatWeekday" + suffix](0, "en", options), RangeError);
        assert.throws(() => translator["formatWeekday" + suffix](0, options), RangeError);
      }
}

assertDateTimeContract(core, translator);

const typescriptManifest = fileURLToPath(import.meta.resolve("typescript/package.json"));
const typescript = resolve(dirname(typescriptManifest), "bin/tsc");
const packageDirectory = fileURLToPath(new URL("..", import.meta.url));
const usage = readFileSync(new URL("../USAGE.md", import.meta.url), "utf8");
const fragmentSnippet = [...usage.matchAll(/```ts\n([\s\S]*?)\n```/g)].find(([, source]) =>
  source.includes("template.content.cloneNode(true)"),
)?.[1];
assert.ok(fragmentSnippet, "The cloned-template usage snippet is required");
const typedSnippet = [...usage.matchAll(/```ts\n([\s\S]*?)\n```/g)].find(([, source]) =>
  source.includes("const translate = createTypedTranslate(translator, catalog)"),
)?.[1];
assert.ok(typedSnippet, "The inferred typed-key usage snippet is required");
const temporary = mkdtempSync(join(tmpdir(), "translator-dist-"));
const npmCommand = process.env.npm_execpath ? process.execPath : "npm";
const npmPrefix = process.env.npm_execpath ? [process.env.npm_execpath] : [];
/** Runs npm outside workspace resolution, using a disposable package cache. */
const npm = (args, cwd) =>
  execFileSync(
    npmCommand,
    [...npmPrefix, ...args, "--workspaces=false", "--cache", join(temporary, "cache")],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );

/** Generates the same strict temporal contract checks for built and installed roots. */
function temporalConsumerSource(entry) {
  return `import * as temporal from ${JSON.stringify(entry)};
    const options: temporal.DateTimeFormatOptions = { timeZone: "Europe/Helsinki", language: "fi" };
    const translator = new temporal.Translator();
    ${["", "ToParts", "Range", "RangeToParts"]
      .map(suffix => {
        const range = suffix.startsWith("Range");
        const dates = range ? "new Date(), new Date()" : "new Date()";
        const calendars = range ? '"2026-10-03", "2026-10-04"' : '"2026-10-03"';
        const result = suffix.endsWith("ToParts")
          ? range
            ? "Intl.DateTimeRangeFormatPart[]"
            : "Intl.DateTimeFormatPart[]"
          : "string";
        return `
      const result${suffix || "Text"}: ${result} = temporal.formatDateTime${suffix}(${dates}, "en", options);
      const method${suffix || "Text"}: ${result} = translator.formatDateTime${suffix}(${dates}, options);
      // @ts-expect-error Calendar helpers reject instants.
      temporal.formatDate${suffix}(${dates}, "en");
      // @ts-expect-error Calendar methods reject instants.
      translator.formatDate${suffix}(${dates});
      // @ts-expect-error Datetime helpers require options.
      temporal.formatDateTime${suffix}(${dates}, "en");
      // @ts-expect-error Datetime methods require options.
      translator.formatDateTime${suffix}(${dates});
      // @ts-expect-error Datetime options require a zone.
      temporal.formatDateTime${suffix}(${dates}, "en", {});
      // @ts-expect-error Undefined is not an explicit zone.
      translator.formatDateTime${suffix}(${dates}, { timeZone: undefined });
      // @ts-expect-error Calendar strings are not Date instants.
      temporal.formatDateTime${suffix}(${calendars}, "en", options);
      // @ts-expect-error Calendar records are not Date instants.
      translator.formatDateTime${suffix}(${range ? "{ year: 2026, month: 10, day: 3 }, new Date()" : "{ year: 2026, month: 10, day: 3 }"}, options);
      // @ts-expect-error Numeric timestamps are not Date objects.
      temporal.formatDateTime${suffix}(${range ? "new Date(), 0" : "0"}, "en", options);
      ${[
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
      ]
        .map(
          key => `
      // @ts-expect-error Calendar options forbid ${key}.
      temporal.formatDate${suffix}(${calendars}, "en", { ${key}: ${key === "hour12" ? "false" : key === "fractionalSecondDigits" ? "3" : ["hour", "minute", "second"].includes(key) ? '"numeric"' : key === "hourCycle" ? '"h23"' : key === "timeZone" ? '"UTC"' : '"short"'} });
      // @ts-expect-error Calendar method options forbid ${key}.
      translator.formatDate${suffix}(${calendars}, { ${key}: ${key === "hour12" ? "false" : key === "fractionalSecondDigits" ? "3" : ["hour", "minute", "second"].includes(key) ? '"numeric"' : key === "hourCycle" ? '"h23"' : key === "timeZone" ? '"UTC"' : '"short"'} });`,
        )
        .join("\n")}
      `;
      })
      .join("\n")}
    ${["Range", "RangeToParts"]
      .map(suffix => {
        const result = suffix.endsWith("ToParts") ? "Intl.DateTimeRangeFormatPart[]" : "string";
        const wrong = suffix.endsWith("ToParts") ? "string" : "Intl.DateTimeRangeFormatPart[]";
        return `
    const weekdayOptions${suffix}: temporal.WeekdayFormatOptions = { width: "short", language: "fi" };
    const weekday${suffix}: ${result} = temporal.formatWeekday${suffix}(4, 0, "en", weekdayOptions${suffix});
    const methodWeekday${suffix}: ${result} = translator.formatWeekday${suffix}(0, 0, weekdayOptions${suffix});
    temporal.formatWeekday${suffix}(0, 6, "en");
    translator.formatWeekday${suffix}(0, 6);
    // @ts-expect-error Weekday range helpers return the exact declared result family.
    const wrongWeekday${suffix}: ${wrong} = temporal.formatWeekday${suffix}(0, 4, "en");
    // @ts-expect-error Weekday range methods return the exact declared result family.
    const wrongMethodWeekday${suffix}: ${wrong} = translator.formatWeekday${suffix}(0, 4);
    ${["temporal", "translator"]
      .map(receiver => {
        const language = receiver === "temporal" ? ', "en"' : "";
        return `
    // @ts-expect-error Start endpoints do not coerce strings.
    ${receiver}.formatWeekday${suffix}("0", 4${language});
    // @ts-expect-error End endpoints do not coerce strings.
    ${receiver}.formatWeekday${suffix}(0, "4"${language});
    // @ts-expect-error Start endpoints do not accept Date objects.
    ${receiver}.formatWeekday${suffix}(new Date(), 4${language});
    // @ts-expect-error End endpoints do not accept bigint.
    ${receiver}.formatWeekday${suffix}(0, 4n${language});
    // @ts-expect-error Both weekday endpoints are required.
    ${receiver}.formatWeekday${suffix}(0${language});
    // @ts-expect-error Weekday width is a closed union.
    ${receiver}.formatWeekday${suffix}(0, 4${language}, { width: "wide" });
    // @ts-expect-error Weekday options do not expose native calendar fields.
    ${receiver}.formatWeekday${suffix}(0, 4${language}, { year: "numeric" });
    // @ts-expect-error Weekday options do not expose clock styles.
    ${receiver}.formatWeekday${suffix}(0, 4${language}, { timeStyle: "short" });`;
      })
      .join("\n")}
    ${
      suffix.endsWith("ToParts")
        ? `
    weekday${suffix}.push({ type: "literal", value: "consumer-owned", source: "shared" });
    weekday${suffix}[0]!.value = "consumer-owned";
    weekday${suffix}[0]!.source = "endRange";
    const weekdaySource: "startRange" | "endRange" | "shared" = methodWeekday${suffix}[0]!.source;
    // @ts-expect-error Native range source metadata is a closed union.
    methodWeekday${suffix}[0]!.source = "start";`
        : ""
    }
    `;
      })
      .join("\n")}
    ${["", "ToParts", "Range", "RangeToParts"]
      .map(suffix =>
        ["timeZone", "timeZoneName"]
          .map(
            key => `
    // @ts-expect-error Weekdays forbid zones.
    temporal.formatWeekday${suffix}(${suffix.startsWith("Range") ? "0, 4" : "0"}, "en", { ${key}: "UTC" });
    // @ts-expect-error Weekday methods forbid zones.
    translator.formatWeekday${suffix}(${suffix.startsWith("Range") ? "0, 4" : "0"}, { ${key}: "UTC" });`,
          )
          .join("\n"),
      )
      .join("\n")}
  `;
}

try {
  // Skip prepack here: this check itself runs inside the prepack validation gate.
  const packed = JSON.parse(
    npm(["pack", "--ignore-scripts", "--json", "--pack-destination", temporary], packageDirectory),
  );
  const [tarball] = Array.isArray(packed) ? packed : Object.values(packed);
  assert.ok(tarball, "npm pack must produce one tarball");
  const paths = tarball.files.map(file => file.path);
  assertPublishedFiles(paths);

  const consumer = join(temporary, "consumer");
  mkdirSync(consumer);
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
  npm(
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--package-lock=false",
      join(temporary, tarball.filename),
    ],
    consumer,
  );
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `
      import assert from "node:assert/strict";
      import * as core from "@unilarva/translator";
      import { createTypedTranslate, Translator, formatRelativeTime, selectPlural } from "@unilarva/translator";
      import { bindTranslator, bindLanguageSelect, bindLanguageDetails } from "@unilarva/translator/dom";
      const translator = new Translator({ language: "en" });
      assert.equal(formatRelativeTime(-1, "day", "en", { numeric: "auto" }), "yesterday");
      assert.equal(selectPlural(2, "en", { type: "ordinal" }), "two");
      assert.equal(translator.formatRelativeTime(0, "day", { numeric: "auto" }), "today");
      assert.equal(translator.selectPlural(1), "one");
       (${assertParts.toString()})(core, translator);
        (${assertNumberRanges.toString()})(core, translator);
          (${assertDateTimeRanges.toString()})(core, translator);
          (${assertDateTimeContract.toString()})(core, translator);
          (${assertWeekdayRanges.toString()})(core, translator);
      const catalogEvents = [];
      const unsubscribeCatalog = translator.subscribeCatalog(event => catalogEvents.push(event));
      translator.setTranslation("smoke", { en: "Installed package" });
      assert.equal(translator.translateKey("smoke"), "Installed package");
      const typed = createTypedTranslate(translator, { smoke: { en: "Type witness only" } });
      assert.equal(typed("smoke"), "Installed package");
      assert.deepEqual(catalogEvents, [{ revision: 1 }]);
      assert.ok(Object.isFrozen(catalogEvents[0]));
      unsubscribeCatalog();
      const preview = new Translator({ language: "fi" });
      preview.copyFrom(translator);
      assert.equal(preview.translateKey("smoke"), "Installed package");
      const chained = new Translator({ language: "ja", additionalFallbackLanguages: ["pt_br"], fallbackToAnyLanguage: false });
      chained.setTranslation("extra", { pt: "Additional fallback" });
      assert.equal(chained.translateKey("extra"), "Additional fallback");
      assert.deepEqual(chained.getFallbackLanguages(), ["en", "pt-BR"]);
      assert.ok(Object.isFrozen(chained.getAdditionalFallbackLanguages()));
      const copy = new Translator();
      copy.copyFrom(chained, { additionalFallbackLanguages: true });
      assert.equal(copy.translateKey("extra"), "Additional fallback");
      chained.setAdditionalFallbackLanguages([]);
      assert.equal(chained.translateKey("extra"), "");
      assert.deepEqual(copy.getAdditionalFallbackLanguages(), ["pt-BR"]);
      assert.equal(preview.getLanguage(), "fi");
      translator.setTranslation("smoke", { en: "Source changed" });
      assert.equal(typed("smoke"), "Source changed");
      assert.equal(preview.translateKey("smoke"), "Installed package");
      for (const binding of [bindTranslator, bindLanguageSelect, bindLanguageDetails]) {
        assert.equal(typeof binding, "function");
      }
      await assert.rejects(import("@unilarva/translator/dist/translator.js"), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" });
    `,
    ],
    { cwd: consumer, stdio: "inherit" },
  );

  for (const missing of ["formatRange", "formatRangeToParts"]) {
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `
      import assert from "node:assert/strict";
      const missing = ${JSON.stringify(missing)};
      const prototype = Intl.NumberFormat.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, missing);
      Object.defineProperty(prototype, missing, { configurable: true, value: undefined });
      try {
        const core = await import("@unilarva/translator");
        const translator = new core.Translator({ language: "en" });
        assert.equal(core.formatNumber(1, "en"), new Intl.NumberFormat("en").format(1));
        assert.deepEqual(translator.formatNumberToParts(1), new Intl.NumberFormat("en").formatToParts(1));
        assert.equal(typeof core.formatDate("2026-10-03", "en"), "string");
        assert.ok(translator.formatTimeToParts("13:45").length > 0);
        const suffix = missing === "formatRange" ? "Range" : "RangeToParts";
        const supported = missing === "formatRange" ? "RangeToParts" : "Range";
        for (const family of ["Number", "Currency"]) {
          const options = family === "Currency" ? { currency: "EUR" } : {};
          const helper = "format" + family + suffix;
          for (const call of [
            () => core[helper](1, 2, "en", options),
            () => translator[helper](1, 2, options),
          ]) assert.throws(call, error => error instanceof TypeError &&
            error.message.includes("Intl.NumberFormat") && error.message.includes(missing) &&
            /runtime|polyfill/i.test(error.message));
          const formatter = new Intl.NumberFormat("en", family === "Currency" ? { style: "currency", currency: "EUR" } : {});
          const native = missing === "formatRange" ? "formatRangeToParts" : "formatRange";
          assert.deepEqual(core["format" + family + supported](1, 2, "en", options), formatter[native](1, 2));
          assert.deepEqual(translator["format" + family + supported](1, 2, options), formatter[native](1, 2));
        }
      } finally {
        Object.defineProperty(prototype, missing, descriptor);
      }
    `,
      ],
      { cwd: consumer, stdio: "inherit" },
    );
  }

  for (const missing of ["formatRange", "formatRangeToParts"]) {
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        `
      import assert from "node:assert/strict";
      const missing = ${JSON.stringify(missing)};
      const prototype = Intl.DateTimeFormat.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, missing);
      Object.defineProperty(prototype, missing, { configurable: true, value: undefined });
      try {
        const core = await import("@unilarva/translator");
        const translator = new core.Translator({ language: "en" });
        assert.equal(typeof core.formatDate("2026-10-03", "en"), "string");
        assert.equal(typeof translator.formatTime("13:45"), "string");
        assert.ok(core.formatDateToParts("2026-10-03", "en").length > 0);
        assert.ok(translator.formatTimeToParts("13:45").length > 0);
        assert.ok(translator.formatWeekdayToParts(0).length > 0);
        assert.equal(core.formatNumberRange(1, 2, "en"), new Intl.NumberFormat("en").formatRange(1, 2));
        assert.deepEqual(translator.formatNumberRangeToParts(1, 2), new Intl.NumberFormat("en").formatRangeToParts(1, 2));
        const suffix = missing === "formatRange" ? "Range" : "RangeToParts";
        const supported = missing === "formatRange" ? "RangeToParts" : "Range";
        const native = missing === "formatRange" ? "formatRangeToParts" : "formatRange";
        for (const [family, start, end, nativeStart, nativeEnd, options] of [
          ["Date", "2026-10-03", "2026-10-05", new Date("2026-10-03T00:00Z"), new Date("2026-10-05T00:00Z"),
            { year: "numeric", month: "numeric", day: "numeric", timeZone: "UTC" }],
          ["Time", "13:00", "14:00", new Date("1970-01-01T13:00Z"), new Date("1970-01-01T14:00Z"),
            { hour: "numeric", minute: "2-digit", timeZone: "UTC" }],
        ]) {
          const helper = "format" + family + suffix;
          for (const call of [
            () => core[helper](start, end, "en"),
            () => translator[helper](start, end),
          ]) assert.throws(call, error => error instanceof TypeError &&
            error.message.includes("Intl.DateTimeFormat") && error.message.includes(missing) &&
            /runtime|polyfill/i.test(error.message));
          const formatter = new Intl.DateTimeFormat("en", options);
          assert.deepEqual(core["format" + family + supported](start, end, "en"), formatter[native](nativeStart, nativeEnd));
          assert.deepEqual(translator["format" + family + supported](start, end), formatter[native](nativeStart, nativeEnd));
        }
      } finally {
        Object.defineProperty(prototype, missing, descriptor);
      }
      `,
      ],
      { cwd: consumer, stdio: "inherit" },
    );
  }

  for (const entry of [new URL("../dist/index.js", import.meta.url).href, "@unilarva/translator"])
    for (const missing of ["formatRange", "formatRangeToParts"])
      for (const warm of [false, true])
        execFileSync(
          process.execPath,
          [
            "--input-type=module",
            "--eval",
            `
          import assert from "node:assert/strict";
          await (${assertWeekdayCapabilities.toString()})(${JSON.stringify(entry)}, ${JSON.stringify(missing)}, ${JSON.stringify(warm)});
        `,
          ],
          { cwd: consumer, stdio: "inherit" },
        );

  // Probe fresh processes before import and after warming every datetime operation/cache.
  for (const entry of [new URL("../dist/index.js", import.meta.url).href, "@unilarva/translator"])
    for (const missing of ["format", "formatToParts", "formatRange", "formatRangeToParts"])
      for (const warm of [false, true]) {
        execFileSync(
          process.execPath,
          [
            "--input-type=module",
            "--eval",
            `
          import assert from "node:assert/strict";
          const entry = ${JSON.stringify(entry)};
          const missing = ${JSON.stringify(missing)};
          const warm = ${JSON.stringify(warm)};
          const start = new Date("2026-09-30T23:30Z");
          const end = new Date("2026-10-02T01:45Z");
          const options = { timeZone: "Europe/Helsinki" };
          const prototype = Intl.DateTimeFormat.prototype;
          const descriptor = Object.getOwnPropertyDescriptor(prototype, missing);
          const native = new Intl.DateTimeFormat("en", { ...options, dateStyle: "medium", timeStyle: "short" });
          const suffixes = ["", "ToParts", "Range", "RangeToParts"];
          const expected = Object.fromEntries(suffixes.map(suffix => [suffix,
            native["format" + suffix](...(suffix.startsWith("Range") ? [start, end] : [start]))]));
          let core;
          if (warm) {
            core = await import(entry);
            const translator = new core.Translator({ language: "en" });
            for (const suffix of suffixes) {
              const values = suffix.startsWith("Range") ? [start, end] : [start];
              core["formatDateTime" + suffix](...values, "en", options);
              translator["formatDateTime" + suffix](...values, options);
            }
          }
          Object.defineProperty(prototype, missing, { configurable: true, value: undefined });
          try {
            core ??= await import(entry);
            const logs = [];
            const translator = new core.Translator({ language: "en", logger: entry => logs.push(entry) });
            for (const suffix of suffixes) {
              const values = suffix.startsWith("Range") ? [start, end] : [start];
              for (const call of [
                () => core["formatDateTime" + suffix](...values, "en", options),
                () => translator["formatDateTime" + suffix](...values, options),
              ]) {
                if ("format" + suffix === missing) assert.throws(call, error =>
                  error instanceof TypeError && error.message.includes("Intl.DateTimeFormat") &&
                  error.message.includes(missing) && /runtime|polyfill/i.test(error.message));
                else assert.deepEqual(call(), expected[suffix]);
              }
            }
            assert.equal(typeof core.formatNumber(1, "en"), "string");
            if (missing === "format") {
              assert.ok(translator.formatDateToParts("2026-10-03").length > 0);
              assert.ok(translator.formatTimeToParts("13:45").length > 0);
            } else {
              assert.equal(typeof translator.formatDate("2026-10-03"), "string");
              assert.equal(typeof translator.formatTime("13:45"), "string");
            }
            assert.equal(logs.length, 1);
            const events = { format: "datetime-format-failed", formatToParts: "datetime-format-to-parts-failed",
              formatRange: "datetime-range-format-failed",
              formatRangeToParts: "datetime-range-format-to-parts-failed" };
            assert.equal(logs[0].event, events[missing]);
          } finally { Object.defineProperty(prototype, missing, descriptor); }
        `,
          ],
          { cwd: consumer, stdio: "inherit" },
        );
      }

  const compilerOptions = {
    strict: true,
    noEmit: true,
    target: "ES2022",
    module: "NodeNext",
    moduleResolution: "NodeNext",
    types: [],
    skipLibCheck: false,
  };
  for (const [name, lib, source] of [
    ["temporal-installed", ["ES2023"], temporalConsumerSource("@unilarva/translator")],
    [
      "temporal-built",
      ["ES2023"],
      temporalConsumerSource(fileURLToPath(new URL("../dist/index.js", import.meta.url))),
    ],
    [
      "core",
      ["ES2023"],
      `
      import { Translator, formatDate, formatRelativeTime, formatNumberToParts, formatCurrencyToParts, formatRelativeTimeToParts, formatDateToParts, formatTimeToParts, formatWeekdayToParts, selectPlural, parseRichText, type CalendarDate, type ClockTime, type DateFormatOptions, type TimeFormatOptions, type WeekdayFormatOptions, type RelativeTimeFormatOptions, type PluralSelectOptions, type TranslationBundle, type TranslationCatalogChangeEvent, type TranslatorCopyOptions } from "@unilarva/translator";
      const bundle: TranslationBundle = { "translator-i18n": { "language-data": { en: { greeting: "Hello" } } } };
      const translator = new Translator({ language: "en" });
      const unsubscribeCatalog = translator.subscribeCatalog((event: TranslationCatalogChangeEvent) => {
        const revision: number = event.revision;
        // @ts-expect-error Catalog event revisions are readonly.
        event.revision = revision;
      });
      translator.importTranslations(bundle);
      const copyOptions: TranslatorCopyOptions = {
        translations: true, languageMetadata: true, activeLanguage: false,
        fallbackLanguage: true, mode: "replace",
      };
      new Translator({ language: "fi" }).copyFrom(translator, copyOptions);
      // @ts-expect-error Copy modes are deliberately limited to merge and replace.
      translator.copyFrom(translator, { mode: "replace-all" });
      const text: string = translator.translateKey("greeting");
      const fallback = new Translator({ additionalFallbackLanguages: ["pt-BR", "fi"] as const });
      const fallbackTags: readonly string[] = fallback.getFallbackLanguages();
      const extraTags: readonly string[] = fallback.getAdditionalFallbackLanguages();
      fallback.setAdditionalFallbackLanguages(extraTags);
      fallback.copyFrom(translator, { additionalFallbackLanguages: true, fallbackLanguage: false });
      // @ts-expect-error Configuration snapshots are immutable.
      fallbackTags.push("ar");
      // @ts-expect-error Additional fallback configuration accepts arrays, not a single string.
      new Translator({ additionalFallbackLanguages: "fi" });
      // @ts-expect-error Additional fallback entries are language strings.
      fallback.setAdditionalFallbackLanguages([1]);
      // @ts-expect-error The new independent copy flag remains boolean.
      fallback.copyFrom(translator, { additionalFallbackLanguages: ["fi"] });
      formatDate("2026-10-03", "en");
      const relativeOptions: RelativeTimeFormatOptions = { numeric: "auto", language: "fi" };
      const pluralOptions: PluralSelectOptions = { type: "ordinal", maximumFractionDigits: 0 };
      const relative: string = formatRelativeTime(-1, "day", "en", relativeOptions);
      const category: Intl.LDMLPluralRule = selectPlural(2, "en", pluralOptions);
      const methodCategory: Intl.LDMLPluralRule = translator.selectPlural(2, pluralOptions);
      translator.formatRelativeTime(1, "weeks", relativeOptions);
      const rounding: Intl.NumberFormatOptions = {
        roundingMode: "halfEven", roundingPriority: "morePrecision",
        roundingIncrement: 1, trailingZeroDisplay: "stripIfInteger",
      };
      const numberParts: Intl.NumberFormatPart[] = formatNumberToParts(1.25, "en", rounding);
      const currencyParts: Intl.NumberFormatPart[] = formatCurrencyToParts(1.25, "en", { ...rounding, currency: "EUR" });
      const relativeParts: Intl.RelativeTimeFormatPart[] = formatRelativeTimeToParts(-1, "day", "en", relativeOptions);
      const methodNumberParts: Intl.NumberFormatPart[] = translator.formatNumberToParts(1.25, { ...rounding, language: "fi" });
      const methodCurrencyParts: Intl.NumberFormatPart[] = translator.formatCurrencyToParts(1.25, { currency: "EUR" });
      const methodRelativeParts: Intl.RelativeTimeFormatPart[] = translator.formatRelativeTimeToParts(1, "weeks", relativeOptions);
      const calendar: CalendarDate = { year: 2026, month: 10, day: 3 };
      const clock: ClockTime = { hour: 13, minute: 45, second: 0 };
      const dateOptions: DateFormatOptions = { language: "fi", dateStyle: "long" };
      const timeOptions: TimeFormatOptions = { language: "fi", timeStyle: "medium", hour12: false };
      const weekdayOptions: WeekdayFormatOptions = { language: "fi", width: "short" };
      const dateParts: Intl.DateTimeFormatPart[] = formatDateToParts(calendar, "en", dateOptions);
      const timeParts: Intl.DateTimeFormatPart[] = formatTimeToParts(clock, "en", timeOptions);
      const weekdayParts: Intl.DateTimeFormatPart[] = formatWeekdayToParts(0, "en", weekdayOptions);
      const methodDateParts: Intl.DateTimeFormatPart[] = translator.formatDateToParts(calendar, dateOptions);
      const methodTimeParts: Intl.DateTimeFormatPart[] = translator.formatTimeToParts("13:45", timeOptions);
      const methodWeekdayParts: Intl.DateTimeFormatPart[] = translator.formatWeekdayToParts(6, weekdayOptions);
      // @ts-expect-error Calendar helpers reject Date instants.
      formatDateToParts(new Date(), "en");
      formatDateToParts("2026-10-03", "en");
      translator.formatDateToParts(calendar);
      translator.formatDateToParts("2026-10-03");
      formatTimeToParts("13:45:00", "en");
      translator.formatTimeToParts(clock);
      formatWeekdayToParts(6, "en");
      translator.formatWeekdayToParts(0);
      dateParts.push({ type: "literal", value: "consumer-owned" });
      timeParts[0]!.value = "consumer-owned";
      // @ts-expect-error Dates do not accept numeric timestamps.
      formatDateToParts(0, "en");
      // @ts-expect-error Calendar records require a day.
      translator.formatDateToParts({ year: 2026, month: 10 });
      // @ts-expect-error Clock inputs are not Date instants.
      formatTimeToParts(new Date(), "en");
      // @ts-expect-error Clock records require minutes.
      translator.formatTimeToParts({ hour: 13 });
      // @ts-expect-error Weekdays use numeric indices, not names.
      formatWeekdayToParts("Monday", "en");
      // @ts-expect-error Weekday methods do not coerce strings.
      translator.formatWeekdayToParts("0");
      // @ts-expect-error Clock parts forbid date styles.
      formatTimeToParts(clock, "en", { dateStyle: "short" });
      // @ts-expect-error Clock parts forbid eras.
      translator.formatTimeToParts(clock, { era: "short" });
      // @ts-expect-error Clock parts forbid years.
      formatTimeToParts(clock, "en", { year: "numeric" });
      // @ts-expect-error Clock parts forbid months.
      translator.formatTimeToParts(clock, { month: "long" });
      // @ts-expect-error Clock parts forbid days.
      formatTimeToParts(clock, "en", { day: "numeric" });
      // @ts-expect-error Clock parts forbid weekdays.
      translator.formatTimeToParts(clock, { weekday: "long" });
      // @ts-expect-error Clock parts forbid time zones.
      formatTimeToParts(clock, "en", { timeZone: "UTC" });
      // @ts-expect-error Clock parts forbid zone names.
      translator.formatTimeToParts(clock, { timeZoneName: "short" });
      // @ts-expect-error Long clock styles include a zone.
      formatTimeToParts(clock, "en", { timeStyle: "long" });
      // @ts-expect-error Full clock styles include a zone.
      translator.formatTimeToParts(clock, { timeStyle: "full" });
      // @ts-expect-error Weekday width is a closed union.
      formatWeekdayToParts(0, "en", { width: "wide" });
      // @ts-expect-error Weekday options do not expose native date fields.
      translator.formatWeekdayToParts(0, { year: "numeric" });
      // @ts-expect-error Date helpers return parts arrays, not strings.
      const wrongDateParts: string = formatDateToParts(calendar, "en");
      // @ts-expect-error Date methods return parts arrays, not strings.
      const wrongMethodDateParts: string = translator.formatDateToParts(calendar);
      // @ts-expect-error Clock helpers return parts arrays, not strings.
      const wrongTimeParts: string = formatTimeToParts(clock, "en");
      // @ts-expect-error Clock methods return parts arrays, not strings.
      const wrongMethodTimeParts: string = translator.formatTimeToParts(clock);
      // @ts-expect-error Weekday helpers return parts arrays, not strings.
      const wrongWeekdayParts: string = formatWeekdayToParts(0, "en");
      // @ts-expect-error Weekday methods return parts arrays, not strings.
      const wrongMethodWeekdayParts: string = translator.formatWeekdayToParts(0);
      for (const part of relativeParts) {
        if (part.type !== "literal") {
          const unit: Intl.RelativeTimeFormatUnitSingular = part.unit;
        } else {
          // @ts-expect-error Native literal parts do not carry units.
          part.unit;
        }
      }
      // @ts-expect-error Numeric strings are not coerced.
      formatNumberToParts("1", "en");
      // @ts-expect-error Bigints remain unsupported.
      translator.formatNumberToParts(1n);
      // @ts-expect-error Currency options are required.
      formatCurrencyToParts(1, "en");
      // @ts-expect-error Currency methods require a code.
      translator.formatCurrencyToParts(1, {});
      // @ts-expect-error Currency parts do not accept bigint.
      formatCurrencyToParts(1n, "en", { currency: "EUR" });
      // @ts-expect-error Relative values do not accept numeric strings.
      formatRelativeTimeToParts("1", "day", "en");
      // @ts-expect-error Relative units remain a native union.
      translator.formatRelativeTimeToParts(1, "fortnight");
      // @ts-expect-error Parts are not formatted strings.
      const wrongNumberParts: string = translator.formatNumberToParts(1);
      // @ts-expect-error Currency parts are not formatted strings.
      const wrongCurrencyParts: string = formatCurrencyToParts(1, "en", { currency: "EUR" });
      // @ts-expect-error Relative parts are not formatted strings.
      const wrongRelativeParts: string = formatRelativeTimeToParts(1, "day", "en");
      // @ts-expect-error Relative time requires a native unit name.
      formatRelativeTime(1, "fortnight", "en");
      // @ts-expect-error Plural categories are a union, not arbitrary strings.
      const invalidCategory: typeof methodCategory = "unknown";
      // @ts-expect-error Rule type is cardinal or ordinal.
      translator.selectPlural(2, { type: "select" });
      parseRichText(text, []);
      translator.setTranslation("greeting", {});
      unsubscribeCatalog();
    `,
    ],
    [
      "numeric-ranges",
      ["ES2023"],
      `
      import { Translator, formatNumberRange, formatNumberRangeToParts, formatCurrencyRange, formatCurrencyRangeToParts, type CurrencyFormatOptions } from "@unilarva/translator";
      const translator = new Translator({ language: "en" });
      const options: CurrencyFormatOptions = { currency: "eur", language: "fi", roundingMode: "halfEven", maximumFractionDigits: 1 };
      const number: string = formatNumberRange(1, 2, "en");
      const currency: string = formatCurrencyRange(1, 2, "en", options);
      const numberParts: Intl.NumberRangeFormatPart[] = formatNumberRangeToParts(1, 2, "en", options);
      const currencyParts: Intl.NumberRangeFormatPart[] = formatCurrencyRangeToParts(1, 2, "en", options);
      const methodNumber: string = translator.formatNumberRange(1, 2, options);
      const methodCurrency: string = translator.formatCurrencyRange(1, 2, options);
      const methodNumberParts: Intl.NumberRangeFormatPart[] = translator.formatNumberRangeToParts(1, 2);
      const methodCurrencyParts: Intl.NumberRangeFormatPart[] = translator.formatCurrencyRangeToParts(1, 2, options);
      numberParts.push({ type: "approximatelySign", value: "~", source: "shared" });
      currencyParts[0]!.value = "consumer-owned";
      currencyParts[0]!.source = "endRange";
      for (const part of methodNumberParts) {
        const source: "startRange" | "endRange" | "shared" = part.source;
        // @ts-expect-error Native range sources are a closed union.
        part.source = "start";
      }
      for (const format of [formatNumberRange, formatNumberRangeToParts]) {
        format(1, 2, "en");
        // @ts-expect-error Start endpoints do not coerce strings.
        format("1", 2, "en");
        // @ts-expect-error End endpoints do not coerce strings.
        format(1, "2", "en");
        // @ts-expect-error Start endpoints do not accept bigint.
        format(1n, 2, "en");
        // @ts-expect-error End endpoints do not accept bigint.
        format(1, 2n, "en");
      }
      for (const format of [translator.formatNumberRange, translator.formatNumberRangeToParts]) {
        // @ts-expect-error Start endpoints do not coerce strings.
        format("1", 2);
        // @ts-expect-error End endpoints do not coerce strings.
        format(1, "2");
        // @ts-expect-error Start endpoints do not accept bigint.
        format(1n, 2);
        // @ts-expect-error End endpoints do not accept bigint.
        format(1, 2n);
      }
      for (const format of [formatCurrencyRange, formatCurrencyRangeToParts]) {
        // @ts-expect-error Currency options are required.
        format(1, 2, "en");
        // @ts-expect-error Currency codes are required.
        format(1, 2, "en", {});
        // @ts-expect-error Start endpoints do not coerce strings.
        format("1", 2, "en", options);
        // @ts-expect-error End endpoints do not coerce strings.
        format(1, "2", "en", options);
        // @ts-expect-error Start endpoints do not accept bigint.
        format(1n, 2, "en", options);
        // @ts-expect-error End endpoints do not accept bigint.
        format(1, 2n, "en", options);
      }
      for (const format of [translator.formatCurrencyRange, translator.formatCurrencyRangeToParts]) {
        // @ts-expect-error Currency method options are required.
        format(1, 2);
        // @ts-expect-error Currency method codes are required.
        format(1, 2, {});
        // @ts-expect-error Start endpoints do not coerce strings.
        format("1", 2, options);
        // @ts-expect-error End endpoints do not coerce strings.
        format(1, "2", options);
        // @ts-expect-error Start endpoints do not accept bigint.
        format(1n, 2, options);
        // @ts-expect-error End endpoints do not accept bigint.
        format(1, 2n, options);
      }
      // @ts-expect-error Number range strings are not parts arrays.
      const wrongNumber: Intl.NumberRangeFormatPart[] = formatNumberRange(1, 2, "en");
      // @ts-expect-error Currency range strings are not parts arrays.
      const wrongCurrency: Intl.NumberRangeFormatPart[] = formatCurrencyRange(1, 2, "en", options);
      // @ts-expect-error Number range parts are not strings.
      const wrongNumberParts: string = formatNumberRangeToParts(1, 2, "en");
      // @ts-expect-error Currency range parts are not strings.
      const wrongCurrencyParts: string = formatCurrencyRangeToParts(1, 2, "en", options);
      // @ts-expect-error Number range method strings are not parts arrays.
      const wrongMethodNumber: Intl.NumberRangeFormatPart[] = translator.formatNumberRange(1, 2);
      // @ts-expect-error Currency range method strings are not parts arrays.
      const wrongMethodCurrency: Intl.NumberRangeFormatPart[] = translator.formatCurrencyRange(1, 2, options);
      // @ts-expect-error Number range method parts are not strings.
      const wrongMethodNumberParts: string = translator.formatNumberRangeToParts(1, 2);
      // @ts-expect-error Currency range method parts are not strings.
      const wrongMethodCurrencyParts: string = translator.formatCurrencyRangeToParts(1, 2, options);
      `,
    ],
    [
      "date-time-ranges",
      ["ES2023"],
      `
      import { Translator, formatDateRange, formatDateRangeToParts, formatTimeRange, formatTimeRangeToParts, type CalendarDate, type ClockTime, type DateFormatOptions, type TimeFormatOptions } from "@unilarva/translator";
      const translator = new Translator({ language: "en" });
      const calendar: CalendarDate = { year: 2026, month: 10, day: 3 };
      const clock: ClockTime = { hour: 13, minute: 45, second: 0 };
      const dateOptions: DateFormatOptions = { language: "fi", dateStyle: "long" };
      const timeOptions: TimeFormatOptions = { language: "fi", timeStyle: "medium", hour12: false };
      const dateRange: string = formatDateRange(calendar, "2026-10-04", "en", dateOptions);
      const timeRange: string = formatTimeRange("13:00", clock, "en", timeOptions);
      const dateRangeParts: Intl.DateTimeRangeFormatPart[] = formatDateRangeToParts(calendar, calendar, "en", dateOptions);
      const timeRangeParts: Intl.DateTimeRangeFormatPart[] = formatTimeRangeToParts(clock, "14:00", "en", timeOptions);
      const methodDateRange: string = translator.formatDateRange(calendar, calendar, dateOptions);
      const methodTimeRange: string = translator.formatTimeRange(clock, "14:00", timeOptions);
      const methodDateRangeParts: Intl.DateTimeRangeFormatPart[] = translator.formatDateRangeToParts("2026-10-03", calendar, dateOptions);
      const methodTimeRangeParts: Intl.DateTimeRangeFormatPart[] = translator.formatTimeRangeToParts("13:00", clock, timeOptions);
      for (const parts of [dateRangeParts, timeRangeParts, methodDateRangeParts, methodTimeRangeParts]) {
        parts.push({ type: "literal", value: "consumer-owned", source: "shared" });
        parts[0]!.value = "consumer-owned";
        const source: "startRange" | "endRange" | "shared" = parts[0]!.source;
        parts[0]!.source = "endRange";
        // @ts-expect-error Native source metadata is a closed union.
        parts[0]!.source = "start";
      }
      for (const format of [formatDateRange, formatDateRangeToParts]) {
        format(calendar, "2026-10-04", "en");
        // @ts-expect-error Calendar ranges reject two instants.
        format(new Date(), new Date(), "en");
        // @ts-expect-error Calendar ranges reject an instant start.
        format(new Date(), calendar, "en");
        // @ts-expect-error Calendar ranges reject an instant end.
        format("2026-10-03", new Date(), "en");
        // @ts-expect-error Date start endpoints do not accept timestamps.
        format(0, calendar, "en");
        // @ts-expect-error Date end records require a day.
        format(calendar, { year: 2026, month: 10 }, "en");
      }
      for (const format of [translator.formatDateRange, translator.formatDateRangeToParts]) {
        format(calendar, "2026-10-04");
        // @ts-expect-error Calendar ranges reject two instants.
        format(new Date(), new Date());
        // @ts-expect-error Calendar ranges reject an instant end.
        format(calendar, new Date());
        // @ts-expect-error Calendar ranges reject an instant start.
        format(new Date(), "2026-10-04");
        // @ts-expect-error Date start records require a day.
        format({ year: 2026, month: 10 }, calendar);
        // @ts-expect-error Date end endpoints do not accept timestamps.
        format(calendar, 0);
      }
      for (const format of [formatTimeRange, formatTimeRangeToParts]) {
        format("13:00", clock, "en");
        format(clock, "14:00", "en");
        // @ts-expect-error Clock start endpoints are not Date instants.
        format(new Date(), clock, "en");
        // @ts-expect-error Clock end records require minutes.
        format(clock, { hour: 14 }, "en");
        // @ts-expect-error Clock options forbid zones.
        format(clock, clock, "en", { timeZone: "UTC" });
        // @ts-expect-error Long clock styles expose a zone.
        format(clock, clock, "en", { timeStyle: "long" });
      }
      for (const format of [translator.formatTimeRange, translator.formatTimeRangeToParts]) {
        format(clock, "14:00");
        format("13:00", clock);
        // @ts-expect-error Clock start records require minutes.
        format({ hour: 13 }, clock);
        // @ts-expect-error Clock end endpoints are not Date instants.
        format(clock, new Date());
        // @ts-expect-error Clock options forbid calendar fields.
        format(clock, clock, { year: "numeric" });
        // @ts-expect-error Full clock styles expose a zone.
        format(clock, clock, { timeStyle: "full" });
      }
      // @ts-expect-error Date range strings are not parts arrays.
      const wrongDateRange: Intl.DateTimeRangeFormatPart[] = formatDateRange(calendar, calendar, "en");
      // @ts-expect-error Clock range strings are not parts arrays.
      const wrongTimeRange: Intl.DateTimeRangeFormatPart[] = formatTimeRange(clock, clock, "en");
      // @ts-expect-error Date range parts are not strings.
      const wrongDateRangeParts: string = formatDateRangeToParts(calendar, calendar, "en");
      // @ts-expect-error Clock range parts are not strings.
      const wrongTimeRangeParts: string = formatTimeRangeToParts(clock, clock, "en");
      // @ts-expect-error Date method strings are not parts arrays.
      const wrongMethodDateRange: Intl.DateTimeRangeFormatPart[] = translator.formatDateRange(calendar, calendar);
      // @ts-expect-error Clock method strings are not parts arrays.
      const wrongMethodTimeRange: Intl.DateTimeRangeFormatPart[] = translator.formatTimeRange(clock, clock);
      // @ts-expect-error Date method parts are not strings.
      const wrongMethodDateRangeParts: string = translator.formatDateRangeToParts(calendar, calendar);
      // @ts-expect-error Clock method parts are not strings.
      const wrongMethodTimeRangeParts: string = translator.formatTimeRangeToParts(clock, clock);
      `,
    ],
    [
      "typed-lookup",
      ["ES2023"],
      `
      import { createTypedTranslate, Translator, type MultilingualData, type TranslateOptions } from "@unilarva/translator";
      const translator = new Translator();
      const catalog = {
        greeting: { en: "Hello {name}", fi: "Hei {name}" },
        goodbye: { en: ["Good", "bye"] },
      } as const satisfies MultilingualData;
      translator.importTranslations({ "translator-i18n": { "multilingual-data": catalog } });
      const t = createTypedTranslate(translator, catalog);
      const options: TranslateOptions = { language: "fi", interpolate: true, values: { name: "Ada" } };
      const text: string = t("greeting", options);
      const same: (key: "greeting" | "goodbye", options?: TranslateOptions) => string = t;
      t("goodbye");
      // @ts-expect-error Inference restricts keys, including when options are supplied.
      t("greting", options);
      const dynamic: string = "greeting";
      // @ts-expect-error Arbitrary string variables need narrowing at the consumer boundary.
      t(dynamic);
      // @ts-expect-error Numeric input is not a translation key.
      t(1);
      // @ts-expect-error The wrapper preserves the ordinary lookup-option types.
      t("greeting", { interpolate: "yes" });
      const explicit = createTypedTranslate<"downloaded" | "missing">(translator);
      explicit("downloaded");
      // @ts-expect-error Explicit unions restrict keys even without a local catalog.
      explicit("greeting");
      // @ts-expect-error Explicit key unions must contain strings only.
      createTypedTranslate<1>(translator);
      const language = { greeting: "Hello", goodbye: "Bye" };
      createTypedTranslate<keyof typeof language>(translator)("greeting");
      const mutable = { mutable: { en: "Live value" } };
      const mutableLookup = createTypedTranslate(translator, mutable);
      mutableLookup("mutable");
      // @ts-expect-error Mutable inferred records still retain their literal key vocabulary.
      mutableLookup("greeting");
      const widened: MultilingualData = catalog;
      createTypedTranslate(translator, widened)(dynamic);
      createTypedTranslate(translator)(dynamic);
      translator.translateKey(dynamic);
      const empty = createTypedTranslate(translator, {});
      // @ts-expect-error Empty inferred catalogs have no permitted keys.
      empty("greeting");
      const symbol = Symbol();
      const unusual = createTypedTranslate(translator, { "1": { en: "String key" }, [symbol]: { en: "Not a string key" } });
      unusual("1");
      // @ts-expect-error Symbols do not become usable string lookup keys.
      unusual(symbol);
      // @ts-expect-error Numeric arguments are not implicitly converted to string keys.
      unusual(1);
      // @ts-expect-error Witness values follow the key-first MultilingualData contract.
      createTypedTranslate(translator, { bad: { en: 1 } });
      // @ts-expect-error Supply the key-first data, not the bundle envelope.
      createTypedTranslate(translator, { "translator-i18n": { "multilingual-data": catalog } });
      `,
    ],
    [
      "usage-typed-keys",
      ["ES2023"],
      `
      declare const console: { warn(...values: unknown[]): void };
      ${typedSnippet}
      `,
    ],
    [
      "dom",
      ["ES2023", "DOM", "DOM.Iterable"],
      `
      import { Translator } from "@unilarva/translator";
      import { bindTranslator, bindLanguageSelect, bindLanguageDetails } from "@unilarva/translator/dom";
      const translator = new Translator({ fetch });
      translator.loadTranslationFiles([], { fetch, signal: new AbortController().signal });
      const binding = bindTranslator(translator, document.documentElement, { updateOnCatalogChange: false });
      binding.update();
      binding.dispose();
      bindLanguageSelect(translator, document.createElement("select")).dispose();
      bindLanguageDetails(translator, document.querySelector<HTMLDetailsElement>("details")!).dispose();
    `,
    ],
    [
      "usage-fragment",
      ["ES2023", "DOM", "DOM.Iterable"],
      `
      import { Translator } from "@unilarva/translator";
      import { bindTranslator } from "@unilarva/translator/dom";
      const translator = new Translator({ language: "en" });
      ${fragmentSnippet}
    `,
    ],
  ]) {
    writeFileSync(join(consumer, `${name}.ts`), source);
    for (const libraries of [
      "core",
      "numeric-ranges",
      "date-time-ranges",
      "temporal-installed",
      "temporal-built",
    ].includes(name)
      ? [lib, ["ES2022", "ES2023.Intl"]]
      : [lib]) {
      const config = join(consumer, `${name}.json`);
      writeFileSync(
        config,
        JSON.stringify({
          compilerOptions: { ...compilerOptions, lib: libraries },
          files: [`${name}.ts`],
        }),
      );
      execFileSync(process.execPath, [typescript, "--project", config], {
        cwd: consumer,
        stdio: "inherit",
      });
    }
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
