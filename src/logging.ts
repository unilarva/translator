// SPDX-FileCopyrightText: 2020-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Package-private implementation of isolated diagnostics and callback rejection observation.
 * This module is not a public package entry.
 *
 * SPDX-FileCopyrightText: 2020-2026 Lari Natri <lari.natri@iki.fi>
 * SPDX-License-Identifier: Apache-2.0
 *
 * @packageDocumentation
 * @module logging
 * @author Lari Natri
 */

import type {
  TranslatorLogComponent,
  TranslatorLogEntry,
  TranslatorLogger,
  TranslatorLogLevel,
} from "./types.js";

/** Copies and freezes arrays/plain records, preserving cycles and consumer-owned opaque objects. */
function snapshotDetails(value: unknown, seen = new WeakMap<object, unknown>()): unknown {
  if (value === null || typeof value !== "object") return value;
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return value;
  if (seen.has(value)) return seen.get(value);
  const copy: unknown[] | Record<string, unknown> = Array.isArray(value)
    ? new Array(value.length)
    : Object.create(prototype);
  seen.set(value, copy);
  for (const [key, item] of Object.entries(value)) {
    Object.defineProperty(copy, key, {
      value: snapshotDetails(item, seen),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return Object.freeze(copy);
}

/**
 * Observes accidental asynchronous callback results without awaiting consumer work.
 *
 * @param result - Callback return value; only objects/functions undergo Promise assimilation.
 * @param onRejected - Handler for asynchronous rejection, including throwing then accessors.
 */
export function observeCallbackResult(result: unknown, onRejected: (error: unknown) => void): void {
  if (result !== null && (typeof result === "object" || typeof result === "function")) {
    void Promise.resolve(result).catch(onRejected);
  }
}

/**
 * Emits an opt-in diagnostic without allowing snapshot or consumer logger failures to escape.
 * Plain-data details are detached and frozen; opaque objects and errors retain their identity.
 *
 * @param logger - Diagnostic sink; null/undefined disables emission and snapshotting.
 * @param level - Diagnostic severity.
 * @param component - Emitting package component.
 * @param event - Machine-readable event identifier.
 * @param message - Human-readable summary.
 * @param details - Optional context to snapshot before synchronous delivery.
 * @param error - Original failure; omitted from the entry when undefined.
 */
export function emitTranslatorLog(
  logger: TranslatorLogger | null | undefined,
  level: TranslatorLogLevel,
  component: TranslatorLogComponent,
  event: string,
  message: string,
  details?: Readonly<Record<string, unknown>>,
  error?: unknown,
): void {
  if (!logger) return;
  try {
    const entry: TranslatorLogEntry = { level, component, event, message };
    if (details !== undefined) {
      entry.details = snapshotDetails(details) as Readonly<Record<string, unknown>>;
    }
    if (error !== undefined) entry.error = error;
    observeCallbackResult(logger(Object.freeze(entry)), () => {
      // Rejected logger promises are ignored just like synchronous logging failures.
    });
  } catch {
    // Consumer logging failures never affect translation behavior.
  }
}
