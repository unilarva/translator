// SPDX-FileCopyrightText: 2020-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Public `@unilarva/translator/dom` entry point for scoped translation bindings,
 * native language controls, and opt-in Intl and rich-text DOM extensions.
 * Ordinary translations write text and allowlisted textual attributes, never HTML or URLs.
 *
 * SPDX-FileCopyrightText: 2020-2026 Lari Natri <lari.natri@iki.fi>
 * SPDX-License-Identifier: Apache-2.0
 *
 * @packageDocumentation
 * @module dom
 * @author Lari Natri
 */

import type {
  LanguageInfo,
  TranslationInterpolationValue,
  TranslatorLogger,
  TranslatorLogLevel,
} from "./types.js";
import { normalizeLanguageTag, type Translator } from "./translator.js";
import { emitTranslatorLog } from "./logging.js";

const DEFAULT_TRANSLATED_ATTRIBUTES = ["title", "aria-label", "placeholder", "alt"] as const;
const OPTIONAL_TRANSLATED_ATTRIBUTES = new Set([
  "aria-description",
  "aria-placeholder",
  "aria-roledescription",
  "aria-valuetext",
]);
const SAFE_TRANSLATED_ATTRIBUTES = new Set([
  ...DEFAULT_TRANSLATED_ATTRIBUTES,
  ...OPTIONAL_TRANSLATED_ATTRIBUTES,
]);

/** Configuration for one scoped translator DOM binding. */
export interface TranslatorDomOptions {
  /**
   * Marker prefix, defaulting to `i18n` (`data-i18n`). Must start with a letter
   * and contain only letters, digits, and hyphens; invalid prefixes throw during binding.
   */
  attributePrefix?: string;
  /** Also update the configured root's owning document's `<html lang>`. Defaults to false. */
  updateDocumentLanguage?: boolean;
  /**
   * Also update `<html dir>` on refresh and registry changes. Defaults to false.
   * Uses the exact active language's metadata, or `ltr` when no direction is registered.
   */
  updateDocumentDirection?: boolean;
  /** Automatically refresh after catalog changes. Defaults to true; disable for manual batching. */
  updateOnCatalogChange?: boolean;
  /**
   * Extra textual attributes accepted by `data-*-attrs`; defaults to none.
   * Only `aria-description`, `aria-placeholder`, `aria-roledescription`, and
   * `aria-valuetext` may extend the default `title`, `aria-label`, `placeholder`,
   * and `alt` set. Names are trimmed and lowercased; unsafe names are logged and ignored.
   */
  additionalTranslatedAttributes?: readonly string[];
  /** Optional synchronous diagnostic sink; absent by default. Logger failures are ignored. */
  logger?: TranslatorLogger;
  /**
   * Optional synchronous renderers, invoked in array order after built-in translations.
   * Defaults to none; the array is copied at binding creation, but extension objects are not.
   * Extensions own their rendering safety and do not run on script/style or template targets.
   */
  extensions?: readonly TranslatorDomExtension[];
}

/** Context supplied to an opt-in DOM extension. */
export interface TranslatorDomExtensionContext {
  /** Translator used by the binding, including its current language and catalog. */
  translator: Translator;
  /** Frozen element-scoped interpolation snapshot, or undefined when none was configured. */
  values?: Readonly<Record<string, TranslationInterpolationValue>>;
  /**
   * Emits a diagnostic with component `dom` through the binding's optional logger.
   * Logger exceptions and rejected promises are ignored.
   *
   * @param level - Diagnostic severity.
   * @param event - Machine-readable event identifier.
   * @param message - Human-readable diagnostic summary.
   * @param details - Optional context, copied and frozen when it is plain data.
   * @param error - Optional original error, retained by identity.
   * @returns Nothing.
   */
  log(
    level: TranslatorLogLevel,
    event: string,
    message: string,
    details?: Readonly<Record<string, unknown>>,
    error?: unknown,
  ): void;
}

/** Adds consumer or package-provided element rendering to a DOM binding. */
export interface TranslatorDomExtension {
  /**
   * Non-empty valid CSS element-matching selector. Root-relative `:scope` selectors,
   * including escaped spellings, are rejected when the binding is created.
   */
  selector: string;
  /**
   * Updates a matching element synchronously after built-in rendering.
   * Exceptions are logged and isolated from other extensions. Returned thenables
   * are warned about and observed for rejection, not awaited or canceled on disposal.
   *
   * @param element - Matching non-template, non-script/style element.
   * @param context - Translator, optional interpolation values, and diagnostic sink.
   * @returns Nothing; asynchronous callbacks are unsupported.
   */
  update(element: Element, context: TranslatorDomExtensionContext): void;
}

/** A live, disposable binding between one Translator and one DOM scope. */
export interface TranslatorDomBinding {
  /**
   * Refreshes marked elements and enabled document metadata; no-op after disposal.
   * An element root is included if it matches. There is no DOM mutation observer.
   *
   * @param root - Scope to scan, defaulting to the configured root. Need not lie within it;
   * document metadata still belongs to the configured root's document.
   * @returns Nothing.
   * @throws Errors from built-in translation or DOM operations; extension errors are isolated.
   */
  update(root?: ParentNode): void;
  /**
   * Refreshes only one element's markers and matching extensions, not descendants or
   * document metadata. Template targets and disposed bindings are ignored.
   *
   * @param element - Element to update; membership in the configured root is not required.
   * @returns Nothing.
   * @throws Errors from built-in translation or DOM operations; extension errors are isolated.
   */
  updateElement(element: Element): void;
  /**
   * Stores a shallow, frozen copy of enumerable own interpolation values, then updates
   * the element. Values persist across refreshes until cleared; no-op after disposal.
   *
   * @param element - Element receiving the values and immediate refresh.
   * @param values - Non-null, non-array record of interpolation values.
   * @returns Nothing.
   * @throws TypeError if values is not a record while the binding is live.
   * @throws Errors from the immediate built-in refresh; the stored snapshot remains set.
   */
  setValues(
    element: Element,
    values: Readonly<Record<string, TranslationInterpolationValue>>,
  ): void;
  /**
   * Removes stored interpolation values and immediately refreshes the element.
   * No-op after disposal; clearing an element without values still refreshes it.
   *
   * @param element - Element whose values are removed.
   * @returns Nothing.
   * @throws Errors from the immediate built-in refresh.
   */
  clearValues(element: Element): void;
  /**
   * Unsubscribes and makes future binding operations no-ops. Idempotent; does not
   * restore DOM content, remove markers, or cancel consumer extension work.
   *
   * @returns Nothing.
   */
  dispose(): void;
}

/** Configuration for a native select bound to translator language state. */
export interface TranslatorLanguageSelectOptions {
  /** Optional diagnostic sink for ignored invalid option tags; absent by default. Failures are ignored. */
  logger?: TranslatorLogger;
  /**
   * Replace all select children with registry options initially and on registry/manual
   * refreshes, with a temporary option for an unregistered active language. Defaults
   * to true; false preserves consumer-owned options and their labels.
   */
  populate?: boolean;
  /** Generated option label form or formatter. Defaults to native name, then code. */
  label?: TranslatorLanguageLabel;
}

/**
 * Label strategy: `native` uses a non-empty native name or the code; `code` uses the
 * canonical code. A synchronous formatter receives read-only registry metadata, or
 * only `{ code }` for an unregistered active language, and returns plain text,
 * never HTML. Formatter errors propagate from explicit updates
 * and binding creation; translator notifications isolate subscriber failures.
 *
 * @param language - Detached, read-only metadata for the language being labeled.
 * @returns Plain-text label when a formatter is supplied.
 */
export type TranslatorLanguageLabel =
  "native" | "code" | ((language: Readonly<LanguageInfo>) => string);

/** A disposable binding between a Translator and one native language select. */
export interface TranslatorLanguageSelectBinding {
  /**
   * Rebuilds options when population is enabled and selects the first normalized tag
   * matching the active language, adding a temporary active option if unregistered.
   * With population disabled, sets selectedIndex to -1 if none matches.
   * No-op after disposal; consumer DOM edits require an explicit refresh.
   *
   * @returns Nothing.
   * @throws Errors from a custom label formatter or DOM operations.
   */
  update(): void;
  /**
   * Removes subscriptions and the change listener; subsequent updates are no-ops.
   * Idempotent and leaves the current options and selection intact.
   *
   * @returns Nothing.
   */
  dispose(): void;
}

/** Configuration for a details/summary language dropdown binding. */
export interface TranslatorLanguageDetailsOptions {
  /** Optional diagnostic sink for invalid tags or non-button choices; absent by default. Failures are ignored. */
  logger?: TranslatorLogger;
  /**
   * Marker prefix, defaulting to `i18n` (`data-i18n-language-*`). Must start with
   * a letter and contain only letters, digits, and hyphens; invalid prefixes throw.
   */
  attributePrefix?: string;
  /**
   * Replace choice-container children with registry buttons initially and on
   * registry/manual refreshes. Defaults to true; false preserves consumer markup.
   */
  populate?: boolean;
  /** Space-separated className for generated buttons; defaults to no classes. */
  choiceClass?: string;
  /** Generated choice label form or formatter. Defaults to native name, then code. */
  choiceLabel?: TranslatorLanguageLabel;
  /** Summary label form or formatter, including unregistered languages. Defaults to native name, then code. */
  currentLabel?: TranslatorLanguageLabel;
  /**
   * Hide the active choice via `hidden`. Defaults to false, which unhides valid choices.
   * Moves focus to the summary before hiding a focused active choice.
   */
  hideCurrent?: boolean;
}

/** A disposable binding between a Translator and one details language dropdown. */
export interface TranslatorLanguageDetailsBinding {
  /**
   * Rebuilds choices when enabled, then updates summary text, lang, hidden, and
   * aria-current state. Preserves focus by language when rebuilding, falling back
   * to the summary if the focused language disappears. No-op after disposal.
   *
   * @returns Nothing.
   * @throws Errors from custom label formatters or DOM operations.
   */
  update(): void;
  /**
   * Removes subscriptions and the click listener; subsequent updates are no-ops.
   * Idempotent; leaves choices, disclosure state, and rendered attributes intact.
   *
   * @returns Nothing.
   */
  dispose(): void;
}

/** Built-in marker names derived from one validated prefix. */
interface AttributeNames {
  key: string;
  attrs: string;
  title: string;
  ariaLabel: string;
  placeholder: string;
  alt: string;
}

/** Creates marker names, throwing when the prefix is not a letter-led identifier. */
function createAttributeNames(prefix: string): AttributeNames {
  if (!/^[a-z][a-z0-9-]*$/i.test(prefix)) {
    throw new Error("attributePrefix must contain only letters, digits, and hyphens");
  }
  const base = `data-${prefix}`;
  return {
    key: base,
    attrs: `${base}-attrs`,
    title: `${base}-title`,
    ariaLabel: `${base}-aria-label`,
    placeholder: `${base}-placeholder`,
    alt: `${base}-alt`,
  };
}

/** Tests the fixed textual-attribute allowlist, not arbitrary consumer-supplied names. */
function isSafeAttributeName(name: string): boolean {
  return SAFE_TRANSLATED_ATTRIBUTES.has(name);
}

/** Resolves a document scope itself or a node's owner, without requiring a global document. */
function ownerDocument(root: ParentNode): Document | null {
  if (root.nodeType === 9) return root as Document;
  return (root as Node).ownerDocument ?? null;
}

/** Detects the scope pseudo-class without confusing quoted values or escaped punctuation. */
function hasScopeSelector(selector: string): boolean {
  const tokens =
    /\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\\(?:[\da-f]{1,6}\s?|[\s\S])|:((?:[\w-]|\\(?:[\da-f]{1,6}\s?|[\s\S]))+)/gi;
  for (const match of selector.matchAll(tokens)) {
    if (!match[1]) continue;
    const name = match[1].replace(/\\([\da-f]{1,6})\s?|\\([\s\S])/gi, (_, hex, character) =>
      hex ? String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff)) : character,
    );
    if (name.toLowerCase() === "scope") return true;
  }
  return false;
}

/** Checks native HTML elements without depending on the caller's window realm. */
function isNativeElement(element: Element, name: string): boolean {
  return element.namespaceURI === "http://www.w3.org/1999/xhtml" && element.localName === name;
}

/** Script/style text is executable content even when assigned through textContent. */
function isUnsafeContentTarget(element: Element): boolean {
  return /^(script|style)$/i.test(element.localName);
}

/** Finds the native disclosure that owns an element, ignoring foreign-namespace lookalikes. */
function owningDetails(element: Element): Element | null {
  for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
    if (isNativeElement(ancestor, "details")) return ancestor;
  }
  return null;
}

/** Normalizes consumer-owned choices without changing their markup. */
function normalizeChoiceLanguage(language: string, logger: TranslatorLogger | null): string | null {
  try {
    return normalizeLanguageTag(language);
  } catch (error) {
    emitTranslatorLog(
      logger,
      "warn",
      "dom",
      "invalid-language-choice",
      "Ignoring a language choice with an invalid language tag.",
      { language },
      error,
    );
    return null;
  }
}

/**
 * Binds text-only translation markers and optional extensions under a DOM root.
 * Performs an immediate refresh, then refreshes on language and, by default, catalog
 * changes. Newly inserted or edited DOM markers require an explicit update.
 *
 * @remarks
 * `data-i18n` supplies the text key; explicit `-title`, `-aria-label`, `-placeholder`,
 * and `-alt` markers supply independent attribute keys. `data-i18n-attrs` is a
 * comma/whitespace-separated allowlisted attribute list using the text key;
 * explicit attribute keys take precedence. Keys are trimmed; empty keys are ignored.
 * Text rendering replaces child markup. Template elements/descendants are skipped;
 * script/style targets accept textual attributes but not content or extensions.
 * Prefixes are configurable. Missing keys and interpolation follow translator policy.
 * Refreshes are not transactional: earlier DOM writes remain if a later lookup fails.
 * Initial refresh failure removes subscriptions before rethrowing.
 *
 * @param translator - Translator supplying lookup, language, and catalog events.
 * @param root - Document, element, or other queryable DOM scope; an element root is included.
 * @param options - Marker, document metadata, diagnostics, and extension configuration;
 * defaults to standard `i18n` markers, catalog refreshes, and no document metadata writes.
 * @returns Live binding with explicit refresh, element values, and idempotent disposal.
 * @throws TypeError for a non-function logger or malformed extension selector/update member.
 * @throws Error for an invalid prefix, invalid CSS selector, or `:scope` extension selector.
 * @throws Errors from initial built-in translation or DOM operations, including the
 * translator's throwing missing-key policy; extension update errors are logged instead.
 */
export function bindTranslator(
  translator: Translator,
  root: ParentNode,
  options: TranslatorDomOptions = {},
): TranslatorDomBinding {
  const names = createAttributeNames(options.attributePrefix ?? "i18n");
  const logger = options.logger ?? null;
  if (logger !== null && typeof logger !== "function") {
    throw new TypeError("bindTranslator: logger must be a function when provided");
  }
  const extensions = [...(options.extensions ?? [])];
  for (const extension of extensions) {
    if (!extension || typeof extension.selector !== "string" || !extension.selector.trim()) {
      throw new TypeError("bindTranslator: extension selector must be a non-empty string");
    }
    if (typeof extension.update !== "function") {
      throw new TypeError("bindTranslator: extension update must be a function");
    }
    if (hasScopeSelector(extension.selector)) {
      throw new Error(
        "bindTranslator: extension selectors must not use :scope; use element-matching classes or data attributes instead",
      );
    }
    try {
      root.querySelectorAll(extension.selector);
      ownerDocument(root)?.createElement("span").matches(extension.selector);
    } catch {
      throw new Error(`bindTranslator: invalid extension selector: ${extension.selector}`);
    }
  }
  /** Routes extension and binding diagnostics through the isolated DOM logger. */
  const log = (
    level: TranslatorLogLevel,
    event: string,
    message: string,
    details?: Readonly<Record<string, unknown>>,
    error?: unknown,
  ): void => emitTranslatorLog(logger, level, "dom", event, message, details, error);
  const elementValues = new WeakMap<
    Element,
    Readonly<Record<string, TranslationInterpolationValue>>
  >();
  // Marker strings usually stay fixed across language changes, but cache by raw value to allow edits.
  const sharedAttributeCache = new WeakMap<Element, { raw: string; requested: string[] }>();
  const allowedAttributes = new Set<string>(DEFAULT_TRANSLATED_ATTRIBUTES);
  for (const rawName of options.additionalTranslatedAttributes ?? []) {
    const name = rawName.trim().toLowerCase();
    if (!isSafeAttributeName(name)) {
      log(
        "warn",
        "invalid-dom-attribute",
        `Unsafe translated attribute is not allowed: ${name || "(empty)"}`,
        { attribute: name },
      );
      continue;
    }
    allowedAttributes.add(name);
  }

  const builtInSelector = [names.key, names.title, names.ariaLabel, names.placeholder, names.alt]
    .map(name => `[${name}]`)
    .join(",");
  const selector = [builtInSelector, ...extensions.map(extension => extension.selector)].join(",");
  let disposed = false;

  /** Excludes template markup from live translation rendering. */
  const isTemplateElement = (element: Element): boolean => element.closest("template") !== null;

  /** Translates an attribute key and avoids redundant attribute writes. */
  const setTranslatedAttribute = (
    element: Element,
    attribute: string,
    key: string,
    values: Readonly<Record<string, TranslationInterpolationValue>> | undefined,
  ): void => {
    const translated = translator.translateKey(key, { values });
    if (element.getAttribute(attribute) !== translated) element.setAttribute(attribute, translated);
  };

  /** Applies safe built-in markers, then isolates each matching extension's failures. */
  const updateElement = (element: Element): void => {
    if (disposed || isTemplateElement(element)) return;
    const values = elementValues.get(element);
    const unsafeTarget = isUnsafeContentTarget(element);
    if (unsafeTarget) {
      log(
        "warn",
        "unsafe-dom-target",
        "Skipping content translation and extensions on script/style elements.",
        { element: element.localName, namespace: element.namespaceURI },
      );
    }

    if (element.matches(builtInSelector)) {
      const key = element.getAttribute(names.key)?.trim() ?? "";
      const explicitAttributes = new Set<string>();
      const explicitMarkers: ReadonlyArray<readonly [string, string]> = [
        [names.title, "title"],
        [names.ariaLabel, "aria-label"],
        [names.placeholder, "placeholder"],
        [names.alt, "alt"],
      ];
      for (const [marker, attribute] of explicitMarkers) {
        const attributeKey = element.getAttribute(marker)?.trim();
        if (!attributeKey) continue;
        explicitAttributes.add(attribute);
        setTranslatedAttribute(element, attribute, attributeKey, values);
      }

      const sharedAttributes = element.getAttribute(names.attrs);
      if (sharedAttributes !== null) {
        if (!key) {
          log(
            "warn",
            "invalid-dom-marker",
            `${names.attrs} requires a non-empty ${names.key} translation key.`,
          );
        } else {
          let cached = sharedAttributeCache.get(element);
          if (!cached || cached.raw !== sharedAttributes) {
            cached = {
              raw: sharedAttributes,
              requested: sharedAttributes
                .split(/[\s,]+/)
                .map(name => name.trim().toLowerCase())
                .filter((name, index, all) => name.length > 0 && all.indexOf(name) === index),
            };
            sharedAttributeCache.set(element, cached);
          }
          const requested = cached.requested;
          for (const attribute of requested) {
            if (explicitAttributes.has(attribute)) continue;
            if (!allowedAttributes.has(attribute) || !isSafeAttributeName(attribute)) {
              log(
                "warn",
                "invalid-dom-attribute",
                `Translated attribute is not allowed: ${attribute}`,
                { attribute },
              );
              continue;
            }
            setTranslatedAttribute(element, attribute, key, values);
          }
        }
      }

      if (key && !unsafeTarget) {
        const translated = translator.translateKey(key, { values });
        const child = element.firstChild;
        // Matching aggregate text is insufficient: replace child markup to keep this sink inert.
        if (!(
          (child === null && translated === "") ||
          (child?.nodeType === 3 && child.nextSibling === null && child.nodeValue === translated)
        )) {
          element.textContent = translated;
        }
      }
    }

    if (unsafeTarget) return;
    for (const extension of extensions) {
      if (disposed) return;
      if (!element.matches(extension.selector)) continue;
      try {
        const result: unknown = extension.update(element, { translator, values, log });
        if (
          result !== null &&
          (typeof result === "object" || typeof result === "function") &&
          typeof (result as PromiseLike<unknown>).then === "function"
        ) {
          log(
            "warn",
            "async-dom-extension",
            "DOM extensions must update synchronously; a returned thenable cannot be managed by the binding lifecycle.",
            { selector: extension.selector },
          );
          // Observe rejections without pretending asynchronous work belongs to this lifecycle.
          void Promise.resolve(result).catch(error => {
            log(
              "error",
              "dom-extension-failed",
              "An asynchronous translator DOM extension failed.",
              { selector: extension.selector },
              error,
            );
          });
        }
      } catch (error) {
        log(
          "error",
          "dom-extension-failed",
          "A translator DOM extension failed to update an element.",
          { selector: extension.selector },
          error,
        );
      }
    }
  };

  /** Synchronizes opted-in metadata on the configured root's document only. */
  const updateDocument = (): void => {
    if (!disposed && (options.updateDocumentLanguage || options.updateDocumentDirection)) {
      const document = ownerDocument(root);
      if (document?.documentElement) {
        const language = translator.getLanguage();
        if (options.updateDocumentLanguage) document.documentElement.lang = language;
        if (options.updateDocumentDirection) {
          document.documentElement.dir =
            translator.getLanguages().find(info => info.code === language)?.direction ?? "ltr";
        }
      }
    }
  };

  /** Includes a matching element root before scanning descendants and updating metadata. */
  const update = (updateRoot: ParentNode = root): void => {
    if (disposed) return;
    if (updateRoot.nodeType === 1) {
      const rootElement = updateRoot as Element;
      if (rootElement.matches(selector)) updateElement(rootElement);
    }
    updateRoot.querySelectorAll(selector).forEach(updateElement);
    updateDocument();
  };

  const unsubscribeLanguage = translator.subscribe(() => update());
  const unsubscribeCatalog =
    options.updateOnCatalogChange !== false
      ? translator.subscribeCatalog(() => update())
      : undefined;
  const unsubscribeRegistry = options.updateDocumentDirection
    ? translator.subscribeLanguages(updateDocument)
    : undefined;
  // A failed initial render must not leave a live binding that the caller cannot dispose.
  try {
    update();
  } catch (error) {
    disposed = true;
    unsubscribeLanguage();
    unsubscribeCatalog?.();
    unsubscribeRegistry?.();
    throw error;
  }

  /** Detaches and freezes caller values before refreshing their element. */
  const setValues = (
    element: Element,
    values: Readonly<Record<string, TranslationInterpolationValue>>,
  ): void => {
    if (disposed) return;
    if (values === null || typeof values !== "object" || Array.isArray(values)) {
      throw new TypeError("Translator DOM values must be a record");
    }
    const snapshot: Record<string, TranslationInterpolationValue> = Object.create(null);
    for (const [name, value] of Object.entries(values)) snapshot[name] = value;
    elementValues.set(element, Object.freeze(snapshot));
    updateElement(element);
  };

  /** Drops an element's snapshot and rerenders with translator-default interpolation. */
  const clearValues = (element: Element): void => {
    if (disposed) return;
    elementValues.delete(element);
    updateElement(element);
  };

  return {
    update,
    updateElement,
    setValues,
    clearValues,
    /** Ends this binding's subscriptions without reverting rendered DOM. */
    dispose(): void {
      if (disposed) return;
      disposed = true;
      unsubscribeLanguage();
      unsubscribeCatalog?.();
      unsubscribeRegistry?.();
    },
  };
}

/**
 * Binds a native single-select control to active-language and registry changes.
 * Populates registry options by default and synchronizes selection immediately.
 * With population enabled, an unregistered active language gets a temporary option
 * formatted with only `{ code }` metadata; it does not create a registry entry.
 * Change events normalize non-empty option values and activate valid tags, even
 * when not registered. Invalid tags are logged and ignored; the control is not disabled.
 *
 * @param translator - Translator supplying active language and selectable registry.
 * @param select - Native HTML select, including one from another window; multiple is unsupported.
 * @param options - Population, label, and diagnostic settings; defaults to generated native-name labels.
 * @returns Live select binding; disposal does not restore original options.
 * @throws TypeError if the control is not a native single select or the logger is not a function.
 * @throws Errors from initial label formatting or DOM operations; setup is cleaned up before rethrowing.
 */
export function bindLanguageSelect(
  translator: Translator,
  select: HTMLSelectElement,
  options: TranslatorLanguageSelectOptions = {},
): TranslatorLanguageSelectBinding {
  if (!select || !isNativeElement(select, "select")) {
    throw new TypeError("bindLanguageSelect: select must be a native select element");
  }
  if (select.multiple) {
    throw new TypeError(
      "bindLanguageSelect: multiple selects are not supported; use a single-select control",
    );
  }
  const logger = options.logger ?? null;
  if (logger !== null && typeof logger !== "function") {
    throw new TypeError("bindLanguageSelect: logger must be a function when provided");
  }
  const populate = options.populate ?? true;
  let disposed = false;
  let temporaryOption: HTMLOptionElement | null = null;

  /** Reconciles the temporary active option and selects the first canonical match. */
  const updateSelection = (): void => {
    if (disposed) return;
    const active = translator.getLanguage();
    if (temporaryOption && temporaryOption.value !== active) {
      temporaryOption.remove();
      temporaryOption = null;
    }
    let selectedIndex = [...select.options].findIndex(
      option =>
        option.value.trim() !== "" && normalizeChoiceLanguage(option.value, logger) === active,
    );
    if (selectedIndex === -1 && populate) {
      const option = select.ownerDocument.createElement("option");
      option.value = active;
      option.textContent = languageLabel({ code: active }, options.label);
      option.lang = active;
      select.append(option);
      temporaryOption = option;
      selectedIndex = option.index;
    }
    select.selectedIndex = selectedIndex;
  };

  /** Replaces owned options with plain-text registry entries in registration order. */
  const populateOptions = (): void => {
    if (!populate) return;
    const fragment = select.ownerDocument.createDocumentFragment();
    for (const language of translator.getLanguages()) {
      const option = select.ownerDocument.createElement("option");
      option.value = language.code;
      option.textContent = languageLabel(language, options.label);
      option.lang = language.code;
      fragment.append(option);
    }
    select.replaceChildren(fragment);
    temporaryOption = null;
  };

  /** Rebuilds owned options and reconciles active selection while live. */
  const update = (): void => {
    if (disposed) return;
    populateOptions();
    updateSelection();
  };

  /** Activates a valid non-empty selected tag without requiring registry membership. */
  const handleChange = (): void => {
    if (disposed) return;
    const rawLanguage = select.value.trim();
    const language = rawLanguage ? normalizeChoiceLanguage(rawLanguage, logger) : null;
    if (language) translator.setLanguage(language);
  };

  const unsubscribeLanguage = translator.subscribe(updateSelection);
  const unsubscribeLanguages = translator.subscribeLanguages(update);
  select.addEventListener("change", handleChange);
  // Roll back setup if initial population fails, including a consumer formatter failure.
  try {
    update();
  } catch (error) {
    disposed = true;
    select.removeEventListener("change", handleChange);
    unsubscribeLanguage();
    unsubscribeLanguages();
    throw error;
  }

  return {
    update,
    /** Releases subscriptions and the control listener without restoring options. */
    dispose(): void {
      if (disposed) return;
      disposed = true;
      select.removeEventListener("change", handleChange);
      unsubscribeLanguage();
      unsubscribeLanguages();
    },
  };
}

/** Derives language-control marker names and selectors from a validated prefix. */
function createLanguageAttributeNames(prefix: string): {
  current: string;
  options: string;
  choice: string;
  currentSelector: string;
  optionsSelector: string;
  choiceSelector: string;
} {
  const base = createAttributeNames(prefix).key;
  const current = `${base}-language-current`;
  const options = `${base}-language-options`;
  const choice = `${base}-language`;
  return {
    current,
    options,
    choice,
    currentSelector: `[${current}]`,
    optionsSelector: `[${options}]`,
    choiceSelector: `[${choice}]`,
  };
}

/** Resolves a plain-text language label, allowing synchronous consumer formatting. */
function languageLabel(
  language: Readonly<LanguageInfo>,
  format: TranslatorLanguageLabel = "native",
): string {
  if (typeof format === "function") return format(language);
  return format === "code" ? language.code : language.nativeName || language.code;
}

/**
 * Binds a native details/summary language dropdown and refreshes it immediately.
 * Requires exactly one direct-child native summary, one owned `data-i18n-language-current`
 * marker inside it, and one separate owned `data-i18n-language-options` container.
 * Markers in nested details and foreign namespaces do not belong to this control;
 * script/style current or container targets are rejected. The prefix is configurable.
 *
 * @remarks
 * Generated choices are native `type="button"` elements in registry order. With
 * population disabled, consumer choices must be owned native buttons inside the
 * container with a valid `data-i18n-language` tag. Disabled choices cannot be activated.
 * Valid clicks prevent the button's default action, set the language, close the disclosure,
 * and focus the summary, including for unregistered tags. Consumer buttons should still use
 * `type="button"` to avoid form submission before binding or after disposal.
 * Active language changes update labels and choice state without rebuilding; registry/manual
 * updates may rebuild. DOM mutations are not observed.
 * An unregistered active summary uses the same label strategy with only `{ code }`
 * metadata, falling back to its code unless a custom formatter is supplied.
 *
 * @param translator - Translator supplying language state and registry metadata.
 * @param details - Native HTML details element, including one from another window.
 * @param options - Marker, population, label, visibility, and diagnostic settings;
 * defaults to `i18n` markers, generated native-name labels, and visible active choices.
 * @returns Live dropdown binding; disposal does not restore consumer markup.
 * @throws TypeError if details is not native HTML details or logger is not a function.
 * @throws Error for an invalid prefix or invalid/ambiguous required control structure.
 * @throws Errors from initial label formatting or DOM operations; installed listeners
 * and subscriptions are removed before an initial refresh failure is rethrown.
 */
export function bindLanguageDetails(
  translator: Translator,
  details: HTMLDetailsElement,
  options: TranslatorLanguageDetailsOptions = {},
): TranslatorLanguageDetailsBinding {
  if (!details || !isNativeElement(details, "details")) {
    throw new TypeError("bindLanguageDetails: details must be a native details element");
  }
  const logger = options.logger ?? null;
  if (logger !== null && typeof logger !== "function") {
    throw new TypeError("bindLanguageDetails: logger must be a function when provided");
  }
  const names = createLanguageAttributeNames(options.attributePrefix ?? "i18n");
  const summaries = [...details.children].filter(element => isNativeElement(element, "summary"));
  /** Rejects nested disclosures and foreign-namespace marker lookalikes. */
  const owned = (element: Element): boolean =>
    owningDetails(element) === details && element.namespaceURI === "http://www.w3.org/1999/xhtml";
  const currents = [...details.querySelectorAll<HTMLElement>(names.currentSelector)].filter(owned);
  const containers = [...details.querySelectorAll<HTMLElement>(names.optionsSelector)].filter(
    owned,
  );
  const summary = summaries[0] as HTMLElement | undefined;
  const current = currents[0];
  const choices = containers[0];
  if (
    summaries.length !== 1 ||
    currents.length !== 1 ||
    containers.length !== 1 ||
    !summary ||
    !current ||
    !choices ||
    !summary.contains(current) ||
    summary.contains(choices) ||
    choices.contains(summary) ||
    isUnsafeContentTarget(current) ||
    isUnsafeContentTarget(choices)
  ) {
    throw new Error(
      `bindLanguageDetails: details must contain <summary>, ${names.currentSelector}, and ${names.optionsSelector}; require one direct-child summary with its current marker and one separate choice container owned by this control; script/style markers are not allowed`,
    );
  }
  const populate = options.populate ?? true;
  const hideCurrent = options.hideCurrent ?? false;
  let disposed = false;

  /** Reads focus from the control's document or shadow root rather than a global document. */
  const activeElement = (): Element | null => {
    const root = details.getRootNode();
    return "activeElement" in root ? (root as Document | ShadowRoot).activeElement : null;
  };

  /** Validates choice ownership and native button semantics before normalizing its tag. */
  const choiceLanguage = (choice: Element): string | null => {
    if (!choices.contains(choice) || owningDetails(choice) !== details) return null;
    if (!isNativeElement(choice, "button")) {
      emitTranslatorLog(
        logger,
        "warn",
        "dom",
        "invalid-language-choice",
        "Ignoring a language choice that is not a native button.",
        { element: choice.localName },
      );
      return null;
    }
    return normalizeChoiceLanguage(choice.getAttribute(names.choice) ?? "", logger);
  };

  /** Replaces owned buttons while retaining focus by language where possible. */
  const populateChoices = (): void => {
    if (!populate) return;
    const focused = activeElement();
    const focusedLanguage =
      focused && focused.hasAttribute(names.choice) ? choiceLanguage(focused) : null;
    const fragment = details.ownerDocument.createDocumentFragment();
    for (const language of translator.getLanguages()) {
      const button = details.ownerDocument.createElement("button");
      button.type = "button";
      button.setAttribute(names.choice, language.code);
      button.lang = language.code;
      button.textContent = languageLabel(language, options.choiceLabel);
      if (options.choiceClass) button.className = options.choiceClass;
      fragment.append(button);
    }
    choices.replaceChildren(fragment);
    // Rebuilt nodes lose focus; recover the semantic choice, not the removed node identity.
    if (focusedLanguage) {
      const replacement = [...choices.querySelectorAll<HTMLElement>(names.choiceSelector)].find(
        choice => choice.getAttribute(names.choice) === focusedLanguage,
      );
      (replacement ?? summary).focus();
    }
  };

  /** Refreshes the summary and valid choices, moving focus before hiding an active choice. */
  const updateSelection = (): void => {
    if (disposed) return;
    const active = translator.getLanguage();
    const info = translator.getLanguages().find(language => language.code === active) ?? {
      code: active,
    };
    current.textContent = languageLabel(info, options.currentLabel);
    current.lang = active;
    choices.querySelectorAll<HTMLElement>(names.choiceSelector).forEach(choice => {
      const language = choiceLanguage(choice);
      if (!language) return;
      const selected = language === active;
      if (hideCurrent && selected && activeElement() === choice) summary.focus();
      choice.hidden = hideCurrent && selected;
      if (selected) choice.setAttribute("aria-current", "true");
      else choice.removeAttribute("aria-current");
    });
  };

  /** Rebuilds owned choices and synchronizes current-language presentation while live. */
  const update = (): void => {
    if (disposed) return;
    populateChoices();
    updateSelection();
  };

  /** Delegates choice clicks, activates valid enabled buttons, and closes the disclosure. */
  const handleClick = (event: Event): void => {
    if (disposed) return;
    const rawTarget = event.target as unknown as {
      closest?: Element["closest"];
      parentElement?: Element | null;
    } | null;
    // Text-node targets lack closest(); duck typing also works across window realms.
    const target =
      typeof rawTarget?.closest === "function"
        ? (rawTarget as Element)
        : (rawTarget?.parentElement ?? null);
    if (!target) return;
    const choice = target.closest<HTMLElement>(names.choiceSelector);
    if (!choice || (choice as HTMLButtonElement).disabled) return;
    const language = choiceLanguage(choice);
    if (!language) return;
    event.preventDefault();
    translator.setLanguage(language);
    details.open = false;
    summary.focus();
  };

  const unsubscribeLanguage = translator.subscribe(updateSelection);
  const unsubscribeLanguages = translator.subscribeLanguages(update);
  details.addEventListener("click", handleClick);
  // Failed initial rendering must release resources before the binding escapes to its caller.
  try {
    update();
  } catch (error) {
    disposed = true;
    details.removeEventListener("click", handleClick);
    unsubscribeLanguage();
    unsubscribeLanguages();
    throw error;
  }

  return {
    update,
    /** Releases control synchronization without changing disclosure or rendered state. */
    dispose(): void {
      if (disposed) return;
      disposed = true;
      details.removeEventListener("click", handleClick);
      unsubscribeLanguage();
      unsubscribeLanguages();
    },
  };
}

export { intlDomExtension } from "./intl-dom.js";
export type { IntlDomExtensionOptions } from "./intl-dom.js";
export { richTextDomExtension } from "./rich-text-dom.js";
export type {
  RichTextDomExtensionOptions,
  RichTextTagRenderer,
  RichTextTagRendererContext,
} from "./rich-text-dom.js";
