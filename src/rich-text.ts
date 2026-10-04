// SPDX-FileCopyrightText: 2020-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * DOM-free semantic rich-text parsing implementation. Node types, parsing options,
 * `parseRichText`, and `translateRichText` are publicly re-exported from
 * `@unilarva/translator`; the prevalidated parser is package-private implementation.
 *
 * SPDX-FileCopyrightText: 2020-2026 Lari Natri <lari.natri@iki.fi>
 * SPDX-License-Identifier: Apache-2.0
 *
 * @packageDocumentation
 * @module rich-text
 * @author Lari Natri
 */

import type { Translator } from "./translator.js";
import type { TranslationInterpolationValue } from "./types.js";
import { interpolate } from "./interpolation.js";

/** Literal text in a parsed semantic rich translation. */
export interface RichTextTextNode {
  /** Discriminant identifying literal text rather than a semantic tag. */
  readonly type: "text";
  /** Text after interpolation and doubled-brace decoding; never parsed as markup. */
  readonly value: string;
}

/** Named semantic token in a parsed rich translation. */
export interface RichTextTagNode {
  /** Discriminant identifying a consumer-approved semantic tag. */
  readonly type: "tag";
  /** Exact, case-sensitive tag name, without brackets or attributes. */
  readonly name: string;
  /** Nested text and semantic tags in source order. */
  readonly children: readonly RichTextNode[];
}

/** One node in a parsed semantic rich translation. */
export type RichTextNode = RichTextTextNode | RichTextTagNode;

/** Options for translating and parsing semantic rich text. */
export interface TranslateRichTextOptions {
  /** Required case-sensitive names matching `[A-Za-z][A-Za-z0-9-]*`; may be empty. */
  allowedTags: readonly string[];
  /** Requested lookup language; omitted uses the translator's current language. */
  language?: string;
  /** Own named values inserted as text; omitted leaves unresolved placeholders intact. */
  values?: Readonly<Record<string, TranslationInterpolationValue>>;
}

/** Writable tag used while assembling the publicly readonly node tree. */
interface MutableTagNode {
  type: "tag";
  name: string;
  children: MutableRichTextNode[];
}

/** Internal node union permitting child insertion during parsing. */
type MutableRichTextNode = RichTextTextNode | MutableTagNode;

// Bound recursive consumer rendering as well as the built-in DOM renderer.
const MAX_RICH_TEXT_NESTING = 256;

/**
 * Parses balanced, attribute-free semantic tags without interpreting HTML.
 * Attribute-like and self-closing tokens remain literal text. Interpolation occurs
 * only in text segments, so inserted values cannot introduce semantic tags.
 *
 * @param text - Source text containing optional `<name>` and `</name>` tokens.
 * @param allowedTags - Required array of case-sensitive names matching `[A-Za-z][A-Za-z0-9-]*`.
 * @param values - Optional own placeholder values; nullish values become empty text,
 * missing values remain placeholders, and doubled braces decode once.
 * @returns Nodes in source order; an empty source produces an empty array.
 * @throws {TypeError} If the allowlist is not an array of valid primitive tag names.
 * @throws {Error} If a recognized tag is unapproved, mismatched, or unclosed.
 * @throws {RangeError} If nesting exceeds 256 tags.
 */
export function parseRichText(
  text: string,
  allowedTags: readonly string[],
  values?: Readonly<Record<string, TranslationInterpolationValue>>,
): readonly RichTextNode[] {
  if (!Array.isArray(allowedTags)) {
    throw new TypeError("Rich-text allowedTags must be an array of tag names");
  }
  const allowed = new Set<string>();
  for (const tag of allowedTags) {
    if (typeof tag !== "string") {
      throw new TypeError("Rich-text tag names must be strings");
    }
    if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(tag) || tag.trim() !== tag) {
      throw new TypeError(`Invalid rich-text tag name: ${tag}`);
    }
    allowed.add(tag);
  }

  return parseRichTextWithAllowedTags(text, allowed, values);
}

/**
 * Package-private parser shared with repeated DOM rendering; skips allowlist validation.
 *
 * @param text - Uninterpolated semantic source text.
 * @param allowed - Previously validated, case-sensitive tag names.
 * @param values - Optional values interpolated into text segments only.
 * @returns Parsed nodes in source order, with doubled braces decoded in text.
 * @throws {Error} If a recognized tag is unapproved, mismatched, or unclosed.
 * @throws {RangeError} If nesting exceeds 256 tags.
 * @internal
 */
export function parseRichTextWithAllowedTags(
  text: string,
  allowed: ReadonlySet<string>,
  values?: Readonly<Record<string, TranslationInterpolationValue>>,
): readonly RichTextNode[] {
  const root: MutableTagNode = { type: "tag", name: "", children: [] };
  const stack: MutableTagNode[] = [root];
  // Recognize only attribute-free tokens; all other markup-like syntax stays inert text.
  const pattern = /<\/?([A-Za-z][A-Za-z0-9-]*)>/g;
  let previousEnd = 0;
  for (const match of text.matchAll(pattern)) {
    const before = text.slice(previousEnd, match.index);
    if (before) {
      stack.at(-1)!.children.push({ type: "text", value: interpolate(before, values) });
    }
    const name = match[1];
    if (!allowed.has(name)) throw new Error(`Rich-text tag is not allowed: ${name}`);
    if (match[0].startsWith("</")) {
      if (stack.length === 1 || stack.at(-1)!.name !== name) {
        throw new Error(`Rich-text closing tag does not match: ${name}`);
      }
      stack.pop();
    } else {
      if (stack.length > MAX_RICH_TEXT_NESTING) {
        throw new RangeError(`Rich-text nesting must not exceed ${MAX_RICH_TEXT_NESTING} tags`);
      }
      const node: MutableTagNode = { type: "tag", name, children: [] };
      stack.at(-1)!.children.push(node);
      stack.push(node);
    }
    previousEnd = match.index + match[0].length;
  }
  const remaining = text.slice(previousEnd);
  if (remaining) {
    stack.at(-1)!.children.push({ type: "text", value: interpolate(remaining, values) });
  }
  if (stack.length !== 1) throw new Error(`Rich-text tag is not closed: ${stack.at(-1)!.name}`);
  return root.children;
}

/**
 * Translates a key using the translator's lookup and missing-key policies, then
 * parses consumer-approved semantic tags before interpolating text.
 *
 * @param translator - Translator supplying the source and language fallback policy.
 * @param key - Translation key; an empty key produces an empty node array.
 * @param options - Required allowlist and optional language and interpolation values.
 * @returns Parsed nodes for the resolved translation or missing-key result.
 * @throws {TypeError} If the allowlist is not an array of valid primitive tag names.
 * @throws {Error} If a recognized tag is unapproved, mismatched, or unclosed.
 * @throws {RangeError} If nesting exceeds 256 tags.
 */
export function translateRichText(
  translator: Translator,
  key: string,
  options: TranslateRichTextOptions,
): readonly RichTextNode[] {
  // Preserve source braces until parsing so escapes decode once and values stay literal.
  const text = translator.translateKey(key, { language: options.language, interpolate: false });
  return parseRichText(text, options.allowedTags, options.values);
}
