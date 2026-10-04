// SPDX-FileCopyrightText: 2016-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Package-private adapters between Happy DOM and TypeScript's DOM declarations.
 * @packageDocumentation
 * @module dom-test-utils
 * @author Lari Natri
 */

/**
 * Adapts Happy DOM nodes to the active TypeScript DOM library at the test boundary.
 * Happy DOM can lag newly added structural members such as ParentNode.moveBefore,
 * although the APIs exercised by TranslatorDomBinding are implemented at runtime.
 */
export function asParentNode(node: unknown): ParentNode {
  return node as ParentNode;
}

/** Adapts a Happy DOM element across the same declaration-library boundary. */
export function asElement(node: unknown): Element {
  return node as Element;
}
