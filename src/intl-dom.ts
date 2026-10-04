// SPDX-FileCopyrightText: 2020-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Package-private implementation of the opt-in Intl DOM extension. Its public
 * factory and options are re-exported by `@unilarva/translator/dom`; this file is
 * not a separate public package entry point.
 *
 * SPDX-FileCopyrightText: 2020-2026 Lari Natri <lari.natri@iki.fi>
 * SPDX-License-Identifier: Apache-2.0
 *
 * @packageDocumentation
 * @module intl-dom
 * @author Lari Natri
 */

import type { TranslatorDomExtension } from "./dom.js";

/** Options for the opt-in Intl formatting DOM extension. */
export interface IntlDomExtensionOptions {
  /**
   * Marker prefix, defaulting to `i18n` (`data-i18n-number`, etc.). Must start
   * with a letter and contain only letters, digits, and hyphens. Invalid prefixes
   * throw during factory creation. Configure independently of the binding's prefix.
   */
  attributePrefix?: string;
}

/** Parses a non-blank Number-compatible string, rejecting non-finite values with RangeError. */
function parseNumber(value: string, label: string): number {
  if (!value.trim()) throw new RangeError(`${label} must not be empty`);
  const number = Number(value);
  if (!Number.isFinite(number)) throw new RangeError(`${label} must be a finite number`);
  return number;
}

/** Reads an optional strict decimal fraction limit (0-20), throwing RangeError when malformed. */
function fractionDigits(element: Element, attribute: string): number | undefined {
  const raw = element.getAttribute(attribute);
  if (raw === null) return undefined;
  // Fraction markers use unsigned decimal integer digits only, with no whitespace or coercions.
  const value = Number(raw);
  if (
    !/^[0-9]+$/.test(raw) ||
    raw.trim() !== raw ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 20
  ) {
    throw new RangeError(`${attribute} must be an integer from 0 through 20`);
  }
  return value;
}

/**
 * Creates a text-only DOM extension for number, currency, date, time, and weekday values.
 * Register the returned extension in `bindTranslator` options to opt in to its
 * synchronous update/disposal lifecycle. All rendered output replaces textContent,
 * never interpreting it as HTML; the binding excludes template and script/style targets.
 *
 * @remarks
 * Each matching element must have exactly one value marker: `data-i18n-number`,
 * `-currency`, `-date`, `-time`, or `-weekday`. Number and currency values accept
 * non-blank finite Number-compatible strings. Currency requires `-currency-code`
 * with a three-letter ISO 4217 code. Dates require valid strict `YYYY-MM-DD`
 * calendar strings and are rendered without time-zone shifts, with numeric year,
 * month, and day by default; `-year` accepts `numeric` or `2-digit`.
 * Times require `HH:MM` or `HH:MM:SS` in the 24-hour input range and render a
 * locale-dependent clock without zone conversion; explicit seconds are displayed.
 * Weekdays are integers from Monday 0 through Sunday 6; `-weekday-width` accepts
 * `long` (default), `short`, or `narrow`.
 *
 * `data-i18n-format-language` overrides the active translator language.
 * `-minimum-fraction-digits` and `-maximum-fraction-digits` accept unsigned decimal
 * integer strings from 0 through 20 with no whitespace; omitted limits use Intl
 * defaults. Both limits are validated on every value kind but applied only to number
 * and currency formatting. Other kind-specific options are read only for that kind.
 * All marker names use the configured prefix. Values come from attributes, not
 * translation keys or the binding's interpolation snapshot.
 *
 * @param options - Marker configuration; defaults to the `i18n` prefix.
 * @returns Stateless synchronous extension with a selector for all five value markers.
 * Its update callback throws on conflicting markers, missing currency code, invalid
 * options/values, or Intl formatting failure. A translator DOM binding catches and
 * logs those errors; validation/formatting completes before replacing existing text.
 * @throws Error if the configured prefix is invalid. Element validation is deferred
 * until the returned extension is updated, not performed by this factory.
 */
export function intlDomExtension(options: IntlDomExtensionOptions = {}): TranslatorDomExtension {
  const prefix = options.attributePrefix ?? "i18n";
  if (!/^[a-z][a-z0-9-]*$/i.test(prefix)) {
    throw new Error("attributePrefix must contain only letters, digits, and hyphens");
  }
  const base = `data-${prefix}`;
  const markers = {
    number: `${base}-number`,
    currency: `${base}-currency`,
    currencyCode: `${base}-currency-code`,
    date: `${base}-date`,
    time: `${base}-time`,
    weekday: `${base}-weekday`,
    weekdayWidth: `${base}-weekday-width`,
    language: `${base}-format-language`,
    minimumFractionDigits: `${base}-minimum-fraction-digits`,
    maximumFractionDigits: `${base}-maximum-fraction-digits`,
    year: `${base}-year`,
  } as const;
  const valueMarkers = [
    markers.number,
    markers.currency,
    markers.date,
    markers.time,
    markers.weekday,
  ];

  return {
    selector: valueMarkers.map(attribute => `[${attribute}]`).join(","),
    /** Validates one value marker and delegates locale-sensitive formatting to the translator. */
    update(element, { translator }): void {
      const present = valueMarkers.filter(attribute => element.hasAttribute(attribute));
      if (present.length !== 1) {
        throw new Error("Intl formatting elements must contain exactly one value marker");
      }
      const language = element.getAttribute(markers.language) ?? undefined;
      const minimumFractionDigits = fractionDigits(element, markers.minimumFractionDigits);
      const maximumFractionDigits = fractionDigits(element, markers.maximumFractionDigits);

      if (present[0] === markers.number) {
        element.textContent = translator.formatNumber(
          parseNumber(element.getAttribute(markers.number)!, markers.number),
          { language, minimumFractionDigits, maximumFractionDigits },
        );
        return;
      }
      if (present[0] === markers.currency) {
        const currency = element.getAttribute(markers.currencyCode);
        if (!currency) throw new Error(`${markers.currencyCode} is required for currency values`);
        element.textContent = translator.formatCurrency(
          parseNumber(element.getAttribute(markers.currency)!, markers.currency),
          { currency, language, minimumFractionDigits, maximumFractionDigits },
        );
        return;
      }
      if (present[0] === markers.date) {
        const year = element.getAttribute(markers.year);
        if (year !== null && year !== "numeric" && year !== "2-digit") {
          throw new Error(`${markers.year} must be 'numeric' or '2-digit'`);
        }
        element.textContent = translator.formatDate(element.getAttribute(markers.date)!, {
          language,
          ...(year ? { year } : {}),
        });
        return;
      }
      if (present[0] === markers.time) {
        element.textContent = translator.formatTime(element.getAttribute(markers.time)!, {
          language,
        });
        return;
      }

      const width = element.getAttribute(markers.weekdayWidth);
      if (width !== null && width !== "long" && width !== "short" && width !== "narrow") {
        throw new Error(`${markers.weekdayWidth} must be 'long', 'short', or 'narrow'`);
      }
      element.textContent = translator.formatWeekday(
        parseNumber(element.getAttribute(markers.weekday)!, markers.weekday),
        { language, ...(width ? { width } : {}) },
      );
    },
  };
}
