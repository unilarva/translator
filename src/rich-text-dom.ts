// SPDX-FileCopyrightText: 2020-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Package-private semantic rich-text DOM implementation. The extension factory,
 * renderer callback, context, and options are publicly re-exported from
 * `@unilarva/translator/dom`; recursive rendering remains an internal helper.
 *
 * SPDX-FileCopyrightText: 2020-2026 Lari Natri <lari.natri@iki.fi>
 * SPDX-License-Identifier: Apache-2.0
 *
 * @packageDocumentation
 * @module rich-text-dom
 * @author Lari Natri
 */

import type { TranslatorDomExtension } from "./dom.js";
import { parseRichTextWithAllowedTags, type RichTextNode } from "./rich-text.js";
import type { Translator } from "./translator.js";
import { observeCallbackResult } from "./logging.js";

/** Context supplied to a consumer-owned semantic tag renderer. */
export interface RichTextTagRendererContext {
  /** Target element's owner document, used to create consumer-owned nodes. */
  document: Document;
  /** Element whose children are being replaced by the complete translation. */
  element: Element;
  /** Trimmed translation key read from the rich-text marker. */
  key: string;
  /** Binding's translator, supplying the active language and translation catalog. */
  translator: Translator;
}

/**
 * Synchronously maps a semantic tag to a consumer-owned node; the consumer controls
 * all elements, attributes, classes, and URLs. Promises and thenables are unsupported.
 *
 * @param children - Already-rendered children in source order; may be consumed by the renderer.
 * @param context - Target document, element, key, and translator shared by this render.
 * @returns An appendable DOM node, including a fragment or a node from another document.
 * @remarks Thrown errors and invalid results trigger logged, inert-text fallback
 * for the entire target element; rejected asynchronous results are also logged.
 */
export type RichTextTagRenderer = (
  children: DocumentFragment,
  context: RichTextTagRendererContext,
) => Node;

/** Options for the semantic rich-text DOM extension. */
export interface RichTextDomExtensionOptions {
  /** Required record of case-sensitive `[A-Za-z][A-Za-z0-9-]*` names and synchronous renderers. */
  renderers: Readonly<Record<string, RichTextTagRenderer>>;
  /** Prefix starting with a letter, then letters, digits, or hyphens; defaults to `i18n`. */
  attributePrefix?: string;
}

/**
 * Recursively builds detached output; propagates renderer errors and rejects non-node results.
 * Invalid asynchronous results are observed through `onRejected`, never awaited.
 */
function renderNodes(
  nodes: readonly RichTextNode[],
  context: RichTextTagRendererContext,
  renderers: Readonly<Record<string, RichTextTagRenderer>>,
  onRejected: (error: unknown) => void,
): DocumentFragment {
  const fragment = context.document.createDocumentFragment();
  for (const node of nodes) {
    if (node.type === "text") {
      fragment.appendChild(context.document.createTextNode(node.value));
      continue;
    }
    const renderer = renderers[node.name];
    if (!renderer) throw new Error(`No renderer exists for rich-text tag: ${node.name}`);
    const children = renderNodes(node.children, context, renderers, onRejected);
    const rendered = renderer(children, context);
    try {
      if (!rendered || typeof rendered.nodeType !== "number") {
        throw new TypeError(`Rich-text renderer '${node.name}' must return a DOM Node`);
      }
      // Native insertion validates actual nodes, including nodes from another document/realm.
      fragment.appendChild(rendered);
    } catch (error) {
      // Observe invalid promise/thenable results only; rendering and fallback remain synchronous.
      observeCallbackResult(rendered, onRejected);
      throw new TypeError(`Rich-text renderer '${node.name}' must return an appendable DOM Node`, {
        cause: error,
      });
    }
  }
  return fragment;
}

/**
 * Creates an explicit `data-*-rich` extension for semantic, attribute-free translation tags.
 * Consumers own every resulting element, attribute, class, and URL through tag renderers.
 * Renderer entries are copied at creation; subsequent record mutations have no effect.
 *
 * @param options - Required renderers and optional marker prefix, defaulting to `i18n`.
 * @returns A synchronous extension matching `data-{prefix}-rich` translation keys.
 * Blank keys log a warning without changing the element. Parsing or rendering failures
 * log an error and replace children with the interpolated translation as inert text.
 * @throws {TypeError} If the renderer record, tag names, or callbacks are invalid.
 * @throws {Error} If the attribute prefix does not start with a letter followed by
 * letters, digits, or hyphens.
 */
export function richTextDomExtension(options: RichTextDomExtensionOptions): TranslatorDomExtension {
  if (
    !options ||
    !options.renderers ||
    typeof options.renderers !== "object" ||
    Array.isArray(options.renderers)
  ) {
    throw new TypeError("richTextDomExtension requires a renderer record");
  }
  const prefix = options.attributePrefix ?? "i18n";
  if (!/^[a-z][a-z0-9-]*$/i.test(prefix)) {
    throw new Error("attributePrefix must contain only letters, digits, and hyphens");
  }
  const marker = `data-${prefix}-rich`;
  const renderers = { ...options.renderers };
  for (const [tag, renderer] of Object.entries(renderers)) {
    if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(tag) || tag.trim() !== tag) {
      throw new TypeError(`Invalid rich-text renderer tag: ${tag}`);
    }
    if (typeof renderer !== "function") {
      throw new TypeError(`Rich-text renderer '${tag}' must be a function`);
    }
  }
  // Renderer names are immutable for this extension, so validate and index them only once.
  const allowedTags = new Set(Object.keys(renderers));

  return {
    /** Matches elements explicitly opting into semantic rich rendering. */
    selector: `[${marker}]`,
    /**
     * Replaces one target's children synchronously, falling back to inert text on failure.
     *
     * @param element - Target carrying the configured rich-text marker.
     * @param context - Binding translator, element-scoped values, and diagnostic logger.
     * @returns Nothing; writes the translation or leaves a blank-key target unchanged.
     */
    update(element, { translator, values, log }): void {
      const key = element.getAttribute(marker)?.trim();
      if (!key) {
        log("warn", "invalid-rich-text-marker", `${marker} must contain a translation key.`);
        return;
      }
      /** Logs both immediate failures and later rejections from invalid async renderers. */
      const reportFailure = (error: unknown): void => {
        log(
          "error",
          "rich-text-render-failed",
          "A semantic rich translation could not be rendered.",
          { key },
          error,
        );
      };
      try {
        const text = translator.translateKey(key, { interpolate: false });
        const nodes = parseRichTextWithAllowedTags(text, allowedTags, values);
        const context: RichTextTagRendererContext = {
          document: element.ownerDocument,
          element,
          key,
          translator,
        };
        // Commit completed output only; failures take the inert-text fallback path.
        element.replaceChildren(renderNodes(nodes, context, renderers, reportFailure));
      } catch (error) {
        // Keep the complete source visible as inert text rather than interpreting failed markup.
        element.textContent = translator.translateKey(key, { values });
        reportFailure(error);
      }
    },
  };
}
