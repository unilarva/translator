// SPDX-FileCopyrightText: 2020-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Package-private implementation of plain-text placeholder interpolation; not a public entry.
 *
 * SPDX-FileCopyrightText: 2020-2026 Lari Natri <lari.natri@iki.fi>
 * SPDX-License-Identifier: Apache-2.0
 *
 * @packageDocumentation
 * @module interpolation
 * @author Lari Natri
 */

import type { TranslationInterpolationValue } from "./types.js";

const PLACEHOLDER_CHARACTER = /^[A-Za-z0-9_.-]$/;

/**
 * Interpolates named values and decodes doubled braces in one left-to-right pass.
 * Names contain only ASCII letters, digits, underscores, dots, and hyphens.
 * Replacement text is neither rescanned nor interpreted as markup.
 *
 * @param text - Source text; malformed or unknown placeholders remain literal.
 * @param values - Own-property replacements; null/undefined become empty text, others use String.
 * @returns Text with known placeholders replaced and doubled braces decoded, even without values.
 */
export function interpolate(
  text: string,
  values: Readonly<Record<string, TranslationInterpolationValue>> | undefined,
): string {
  let result = "";
  let index = 0;
  let end = -1;

  while (index < text.length) {
    if (text.startsWith("{{", index)) {
      result += "{";
      index += 2;
      continue;
    }
    if (text.startsWith("}}", index)) {
      result += "}";
      index += 2;
      continue;
    }
    if (text[index] !== "{") {
      result += text[index];
      index++;
      continue;
    }

    // Reuse the next closing brace and stop validation at the first invalid character.
    // Malformed nested openings must not rescan their shared suffix on every iteration.
    if (end <= index) end = text.indexOf("}", index + 1);
    if (end < 0) {
      result += text.slice(index);
      break;
    }
    let nameEnd = index + 1;
    while (nameEnd < end && PLACEHOLDER_CHARACTER.test(text[nameEnd])) nameEnd++;
    if (nameEnd !== end || nameEnd === index + 1) {
      result += "{";
      index++;
      continue;
    }
    const name = text.slice(index + 1, end);
    if (!values || !Object.prototype.hasOwnProperty.call(values, name)) {
      result += text.slice(index, end + 1);
    } else {
      const value = values[name];
      result += value == null ? "" : String(value);
    }
    index = end + 1;
  }

  return result;
}
