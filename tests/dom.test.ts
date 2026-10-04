// SPDX-FileCopyrightText: 2020-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Package-private tests for safe DOM rendering and language-control lifecycles.
 * @packageDocumentation
 * @module dom.test
 * @author Lari Natri
 */

import assert from "node:assert/strict";
import test from "node:test";
import { Window } from "happy-dom";

import { Translator } from "../src/index.ts";
import { bindLanguageDetails, bindLanguageSelect, bindTranslator } from "../src/dom.ts";
import { asElement, asParentNode } from "./dom-test-utils.ts";

/** Creates an isolated DOM and a catalog shared by binding tests. */
function createFixture(): { window: Window; translator: Translator } {
  const window = new Window();
  const translator = new Translator({ language: "en", fallbackLanguage: "en" });
  translator.importTranslations({
    "translator-i18n": {
      "multilingual-data": {
        unsafe: { en: '<img src=x onerror="globalThis.pwned=true"> & text', fi: "Turvallinen" },
        shared: { en: "Shared", fi: "Jaettu" },
        title: { en: "Explicit title", fi: "Otsikko" },
        interpolated: { en: "Hello {name}", fi: "Hei {name}" },
      },
    },
  });
  return { window, translator };
}

/** Counts live subscriptions across all translator event channels. */
function trackSubscriptions(translator: Translator): () => number {
  let count = 0;
  const subscribe = translator.subscribe.bind(translator);
  translator.subscribe = listener => {
    count++;
    const unsubscribe = subscribe(listener);
    return () => {
      count--;
      unsubscribe();
    };
  };
  const subscribeCatalog = translator.subscribeCatalog.bind(translator);
  translator.subscribeCatalog = listener => {
    count++;
    const unsubscribe = subscribeCatalog(listener);
    return () => {
      count--;
      unsubscribe();
    };
  };
  const subscribeLanguages = translator.subscribeLanguages.bind(translator);
  translator.subscribeLanguages = listener => {
    count++;
    const unsubscribe = subscribeLanguages(listener);
    return () => {
      count--;
      unsubscribe();
    };
  };
  return () => count;
}

test("renders HTML-like translations as inert text", () => {
  const { window, translator } = createFixture();
  window.document.body.innerHTML = '<div id="target" data-i18n="unsafe"><strong>old</strong></div>';
  bindTranslator(translator, asParentNode(window.document.body));

  const target = window.document.querySelector("#target")!;
  assert.equal(target.textContent, '<img src=x onerror="globalThis.pwned=true"> & text');
  assert.equal(target.children.length, 0);
});

test("blocks script/style content and extensions across namespaces but translates safe attributes", () => {
  const { window, translator } = createFixture();
  const root = window.document.createDocumentFragment();
  const targets = [];
  for (const namespace of [
    "http://www.w3.org/1999/xhtml",
    "http://www.w3.org/2000/svg",
    "http://www.w3.org/1998/Math/MathML",
  ]) {
    for (const name of ["script", "style"]) {
      const element = window.document.createElementNS(namespace, name);
      element.setAttribute("data-i18n", "shared");
      element.setAttribute("data-i18n-attrs", "title");
      element.setAttribute("data-i18n-aria-label", "title");
      element.setAttribute("data-custom", "");
      element.textContent = "/* original */";
      root.append(element);
      targets.push(element);
    }
  }
  const normal = window.document.createElement("span");
  normal.setAttribute("data-custom", "");
  root.append(normal);
  let extensionCalls = 0;
  const skipped: string[] = [];
  const binding = bindTranslator(translator, asParentNode(root), {
    logger: entry => {
      if (entry.event === "unsafe-dom-target") skipped.push(String(entry.details?.element));
    },
    extensions: [
      {
        selector: "[data-custom]",
        update(element) {
          extensionCalls++;
          element.textContent = "extension";
        },
      },
    ],
  });
  assert.equal(extensionCalls, 1);
  assert.equal(skipped.length, targets.length);
  translator.setLanguage("fi");
  for (const element of targets) {
    assert.equal(element.textContent, "/* original */");
    assert.equal(element.getAttribute("title"), "Jaettu");
    assert.equal(element.getAttribute("aria-label"), "Otsikko");
  }
  binding.setValues(asElement(targets[0]), { name: "Ada" });
  binding.updateElement(asElement(targets[1]));
  assert.equal(extensionCalls, 2);
  binding.dispose();

  translator.setMissingTranslationPolicy("throw");
  const script = window.document.createElement("script");
  script.setAttribute("data-i18n", "missing");
  const safeBinding = bindTranslator(translator, asParentNode(script));
  assert.equal(script.textContent, "");
  safeBinding.dispose();
});

test("rejects invalid and scope-dependent extension selectors before subscribing", () => {
  const { window, translator } = createFixture();
  const subscriptions = trackSubscriptions(translator);
  for (const selector of [":scope > span", ":is(:SCOPE)", ":\\73 cope > span", ":sc\\6f pe"]) {
    assert.throws(
      () =>
        bindTranslator(translator, asParentNode(window.document.body), {
          extensions: [{ selector, update() {} }],
        }),
      /must not use :scope.*classes or data attributes/,
    );
    assert.equal(subscriptions(), 0);
  }
  assert.throws(
    () =>
      bindTranslator(translator, asParentNode(window.document.body), {
        extensions: [{ selector: "[", update() {} }],
      }),
    /invalid extension selector/,
  );
  assert.equal(subscriptions(), 0);
  window.document.body.innerHTML = '<span data-label=":scope"></span>';
  let updates = 0;
  const binding = bindTranslator(translator, asParentNode(window.document.body), {
    extensions: [
      {
        selector: '[data-label=":scope"]',
        update() {
          updates++;
        },
      },
    ],
  });
  assert.equal(updates, 1);
  binding.dispose();
  assert.equal(subscriptions(), 0);
});

test("cleans up failed ordinary binding initialization and preserves fail-fast scans", () => {
  const { window, translator } = createFixture();
  const subscriptions = trackSubscriptions(translator);
  translator.setMissingTranslationPolicy("throw");
  window.document.body.innerHTML = '<span data-i18n="missing">old</span>';
  assert.throws(
    () => bindTranslator(translator, asParentNode(window.document.body)),
    /Missing translation/,
  );
  assert.equal(subscriptions(), 0);
  translator.setTranslation("missing", { en: "Recovered", fi: "Palautettu" });
  translator.setLanguage("fi");
  assert.equal(window.document.body.textContent, "old");

  translator.setLanguage("en");
  translator.setMissingTranslationPolicy("key");
  window.document.body.innerHTML =
    '<span data-i18n="absent"></span><span data-i18n="shared"></span>';
  const binding = bindTranslator(translator, asParentNode(window.document.body));
  translator.setMissingTranslationPolicy("throw");
  assert.throws(() => binding.update(), /Missing translation/);
  translator.setLanguage("fi");
  assert.equal(window.document.body.lastElementChild!.textContent, "Shared");
  binding.dispose();
  assert.equal(subscriptions(), 0);
});

test("isolates synchronous extension failures and consumes accidental async rejections", async () => {
  const { window, translator } = createFixture();
  window.document.body.innerHTML = "<span data-custom></span>";
  const error = new Error("extension failed");
  const diagnostics: { event: string; error?: unknown }[] = [];
  const binding = bindTranslator(translator, asParentNode(window.document.body), {
    logger: entry => diagnostics.push({ event: entry.event, error: entry.error }),
    extensions: [
      {
        selector: "[data-custom]",
        update() {
          throw error;
        },
      },
      {
        selector: "[data-custom]",
        async update() {
          throw error;
        },
      },
      {
        selector: "[data-custom]",
        update() {
          return {
            then(_resolve: unknown, reject: (reason: unknown) => void) {
              reject(error);
            },
          };
        },
      },
      {
        selector: "[data-custom]",
        update(element) {
          element.textContent = "updated";
        },
      },
    ],
  });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(window.document.body.textContent, "updated");
  assert.equal(diagnostics.filter(entry => entry.event === "async-dom-extension").length, 2);
  const failures = diagnostics.filter(entry => entry.event === "dom-extension-failed");
  assert.equal(failures.length, 3);
  assert.ok(failures.every(entry => entry.error === error));
  binding.dispose();
});

test("updates a marked root and allowlisted shared attributes", () => {
  const { window, translator } = createFixture();
  const target = window.document.createElement("button");
  target.setAttribute("data-i18n", "shared");
  target.setAttribute("data-i18n-attrs", "title, aria-label title");
  window.document.body.append(target);

  const binding = bindTranslator(translator, asParentNode(window.document.body));
  assert.equal(target.textContent, "Shared");
  assert.equal(target.title, "Shared");
  assert.equal(target.getAttribute("aria-label"), "Shared");

  translator.setLanguage("fi");
  assert.equal(target.textContent, "Jaettu");
  assert.equal(target.title, "Jaettu");
  binding.dispose();
});

test("avoids redundant writes but corrects changed attributes and removes child markup", () => {
  const { window, translator } = createFixture();
  window.document.body.innerHTML =
    '<button data-i18n="shared" data-i18n-attrs="aria-label" data-i18n-title="title"></button>';
  const target = window.document.querySelector("button")!;
  const binding = bindTranslator(translator, asParentNode(window.document.body));
  const originalTextNode = target.firstChild;
  assert.equal(originalTextNode?.nodeType, 3);

  const originalSetAttribute = target.setAttribute.bind(target);
  const writes: string[] = [];
  target.setAttribute = (name, value) => {
    writes.push(name);
    originalSetAttribute(name, value);
  };
  binding.updateElement(asElement(target));
  translator.setLanguage("en");
  assert.deepEqual(writes, []);
  assert.equal(target.firstChild, originalTextNode);

  originalSetAttribute("title", "stale");
  originalSetAttribute("aria-label", "stale");
  target.replaceChildren(window.document.createElement("span"));
  target.firstChild!.textContent = "Shared";
  assert.equal(target.textContent, "Shared");
  binding.updateElement(asElement(target));
  assert.deepEqual(writes, ["title", "aria-label"]);
  assert.equal(target.title, "Explicit title");
  assert.equal(target.getAttribute("aria-label"), "Shared");
  assert.equal(target.children.length, 0);
  assert.equal(target.textContent, "Shared");
});

test("reparses changed shared attribute markers and retains explicit precedence", () => {
  const { window, translator } = createFixture();
  window.document.body.innerHTML =
    '<button data-i18n="shared" data-i18n-attrs="title" data-i18n-title="title"></button>';
  const target = window.document.querySelector("button")!;
  const diagnostics: string[] = [];
  const binding = bindTranslator(translator, asParentNode(window.document.body), {
    logger: entry => {
      if (entry.event === "invalid-dom-attribute")
        diagnostics.push(String(entry.details?.attribute));
    },
  });
  assert.equal(target.title, "Explicit title");

  target.setAttribute("data-i18n-attrs", "aria-label, href");
  binding.updateElement(asElement(target));
  assert.equal(target.getAttribute("aria-label"), "Shared");
  assert.equal(target.hasAttribute("href"), false);
  assert.deepEqual(diagnostics, ["href"]);
  binding.updateElement(asElement(target));
  assert.deepEqual(diagnostics, ["href", "href"]);

  target.setAttribute("data-i18n-attrs", "title, placeholder");
  binding.updateElement(asElement(target));
  assert.equal(target.title, "Explicit title");
  assert.equal(target.getAttribute("placeholder"), "Shared");
  translator.setLanguage("fi");
  assert.equal(target.title, "Otsikko");
  assert.equal(target.getAttribute("placeholder"), "Jaettu");
});

test("stores element values and reapplies them during automatic DOM updates", () => {
  const { window, translator } = createFixture();
  window.document.body.innerHTML =
    '<button data-i18n="interpolated" data-i18n-title="interpolated"></button>';
  const binding = bindTranslator(translator, asParentNode(window.document.body));

  const target = window.document.querySelector("button")!;
  assert.equal(target.textContent, "Hello {name}");
  const values = { name: "Ada" };
  binding.setValues(asElement(target), values);
  assert.equal(target.textContent, "Hello Ada");
  assert.equal(target.title, "Hello Ada");
  values.name = "Changed outside the binding";
  translator.setLanguage("fi");
  assert.equal(target.textContent, "Hei Ada");
  assert.equal(target.title, "Hei Ada");
  binding.setValues(asElement(target), { name: "Meri" });
  assert.equal(target.textContent, "Hei Meri");
  binding.clearValues(asElement(target));
  assert.equal(target.textContent, "Hei {name}");
  assert.throws(() => binding.setValues(asElement(target), [] as never), TypeError);
});

test("automatically refreshes scoped text, attributes, and extensions after effective catalog changes", () => {
  const { window, translator } = createFixture();
  window.document.body.innerHTML = `
    <section><button data-i18n="interpolated" data-i18n-title="title"></button></section>
    <span data-i18n="interpolated">outside</span>
  `;
  const scope = window.document.querySelector("section")!;
  const target = scope.querySelector("button")!;
  let extensionCalls = 0;
  const binding = bindTranslator(translator, asParentNode(scope), {
    extensions: [
      {
        selector: "button",
        update: () => {
          extensionCalls++;
        },
      },
    ],
  });
  binding.setValues(asElement(target), { name: "Ada" });
  extensionCalls = 0;
  translator.importTranslations({
    "translator-i18n": {
      "multilingual-data": {
        interpolated: { en: "Welcome {name}" },
        title: { en: "Updated title" },
      },
    },
  });
  assert.equal(target.textContent, "Welcome Ada");
  assert.equal(target.getAttribute("title"), "Updated title");
  assert.equal(window.document.querySelector("body > span")!.textContent, "outside");
  assert.equal(extensionCalls, 1);

  translator.setTranslation("title", { en: "Updated title", fi: "Otsikko" });
  assert.equal(extensionCalls, 1);
  translator.importTranslations(
    {
      "translator-i18n": { "multilingual-data": { interpolated: { en: "Welcome {name}" } } },
    },
    { mode: "replace-all" },
  );
  assert.equal(target.getAttribute("title"), translator.translateKey("title"));
  translator.clearTranslations();
  assert.equal(target.textContent, translator.translateKey("interpolated"));
  assert.equal(extensionCalls, 3);
  binding.dispose();
  translator.setTranslation("interpolated", { en: "After disposal" });
  assert.equal(extensionCalls, 3);
});

test("can opt out of catalog refresh for manual batching while retaining language updates", () => {
  const { window, translator } = createFixture();
  const subscriptions = trackSubscriptions(translator);
  window.document.body.innerHTML = '<button data-i18n="shared" data-i18n-title="title"></button>';
  const target = window.document.querySelector("button")!;
  let extensionCalls = 0;
  const revisions: number[] = [];
  const unsubscribeCatalog = translator.subscribeCatalog(event => revisions.push(event.revision));
  const binding = bindTranslator(translator, asParentNode(window.document.body), {
    updateOnCatalogChange: false,
    extensions: [
      {
        selector: "button",
        update: () => {
          extensionCalls++;
        },
      },
    ],
  });
  assert.equal(subscriptions(), 2);
  translator.setTranslation("shared", { en: "Updated", fi: "Päivitetty" });
  translator.setTranslation("title", { en: "New title", fi: "Uusi otsikko" });
  assert.equal(revisions.length, 2);
  assert.equal(target.textContent, "Shared");
  assert.equal(target.getAttribute("title"), "Explicit title");
  assert.equal(extensionCalls, 1);

  binding.update();
  assert.equal(target.textContent, "Updated");
  assert.equal(target.getAttribute("title"), "New title");
  assert.equal(extensionCalls, 2);
  translator.setLanguage("fi");
  assert.equal(target.textContent, "Päivitetty");
  assert.equal(target.getAttribute("title"), "Uusi otsikko");
  assert.equal(extensionCalls, 3);
  binding.dispose();
  unsubscribeCatalog();
  assert.equal(subscriptions(), 0);
});

test("refreshes DOM once after a complete file transaction and never for an aborted load", async () => {
  const { window, translator } = createFixture();
  window.document.body.innerHTML =
    '<span data-i18n="shared"></span><span data-i18n="title"></span>';
  const snapshots: string[] = [];
  const binding = bindTranslator(translator, asParentNode(window.document.body), {
    extensions: [
      {
        selector: "[data-i18n=title]",
        update: () => {
          snapshots.push(window.document.body.textContent!);
        },
      },
    ],
  });
  snapshots.length = 0;
  const data = [
    { "translator-i18n": { "multilingual-data": { shared: { en: "Loaded" } } } },
    { "translator-i18n": { "multilingual-data": { title: { en: " together" } } } },
  ];
  await translator.loadTranslationFiles(["first", "second"], {
    mode: "replace-all",
    fetch: async url => ({ json: async () => data[url === "first" ? 0 : 1] }),
  });
  assert.deepEqual(snapshots, ["Loaded together"]);

  const controller = new AbortController();
  const reason = new Error("Cancelled before commit");
  await assert.rejects(
    translator.loadTranslationFiles(["first"], {
      mode: "replace-all",
      signal: controller.signal,
      fetch: async () => ({
        json: async () => {
          controller.abort(reason);
          return data[0];
        },
      }),
    }),
    error => error === reason,
  );
  assert.deepEqual(snapshots, ["Loaded together"]);
  binding.dispose();
});

test("does not refresh a binding disposed by an earlier in-flight catalog subscriber", () => {
  const { window, translator } = createFixture();
  window.document.body.innerHTML = '<span data-i18n="shared"></span>';
  let disposeBinding = (): void => {};
  const unsubscribe = translator.subscribeCatalog(() => disposeBinding());
  const binding = bindTranslator(translator, asParentNode(window.document.body));
  disposeBinding = binding.dispose;
  translator.setTranslation("shared", { en: "Updated" });
  assert.equal(window.document.body.textContent, "Shared");
  binding.update();
  assert.equal(window.document.body.textContent, "Shared");
  unsubscribe();
});

test("explicit attribute markers work without replacing children and win precedence", () => {
  const { window, translator } = createFixture();
  window.document.body.innerHTML = `
    <button id="icon" data-i18n-title="title"><i>icon</i></button>
    <span id="mixed" data-i18n="shared" data-i18n-attrs="title" data-i18n-title="title"></span>
  `;
  bindTranslator(translator, asParentNode(window.document.body));

  const icon = window.document.querySelector("#icon")!;
  const mixed = window.document.querySelector("#mixed")!;
  assert.equal(icon.textContent, "icon");
  assert.equal(icon.getAttribute("title"), "Explicit title");
  assert.equal(mixed.textContent, "Shared");
  assert.equal(mixed.getAttribute("title"), "Explicit title");
});

test("allows only known inert textual attributes as extensions", () => {
  const { window, translator } = createFixture();
  const diagnostics: string[] = [];
  window.document.body.innerHTML =
    '<a data-i18n="shared" data-i18n-attrs="href target form id onclick aria-description"></a>';
  bindTranslator(translator, asParentNode(window.document.body), {
    additionalTranslatedAttributes: ["href", "target", "form", "id", "onclick", "aria-description"],
    logger: entry => {
      const attribute = entry.details?.attribute;
      if (typeof attribute === "string") diagnostics.push(attribute);
    },
  });

  const target = window.document.querySelector("a")!;
  assert.equal(target.hasAttribute("href"), false);
  assert.equal(target.hasAttribute("target"), false);
  assert.equal(target.hasAttribute("form"), false);
  assert.equal(target.id, "");
  assert.equal(target.hasAttribute("onclick"), false);
  assert.equal(target.getAttribute("aria-description"), "Shared");
  assert.ok(diagnostics.includes("href"));
  assert.ok(diagnostics.includes("target"));
  assert.ok(diagnostics.includes("onclick"));
});

test("scopes updates, translates explicit fragments, and stops after disposal", () => {
  const { window, translator } = createFixture();
  window.document.body.innerHTML = `
    <section id="scope">
      <span id="live" data-i18n="shared"></span>
      <template><span id="template-value" data-i18n="shared">template</span></template>
    </section>
    <span id="outside" data-i18n="shared">outside</span>
  `;
  const scope = window.document.querySelector("#scope")!;
  const binding = bindTranslator(translator, asParentNode(scope));
  assert.equal(window.document.querySelector("#live")!.textContent, "Shared");
  assert.equal(window.document.querySelector("#outside")!.textContent, "outside");

  const template = window.document.querySelector("template")!;
  const templateValue = template.content.querySelector("#template-value")!;
  assert.equal(templateValue.textContent, "template");

  const clone = template.content.cloneNode(true);
  const cloneValue = clone.querySelector("#template-value")!;
  binding.update(asParentNode(clone));
  assert.equal(cloneValue.textContent, "Shared");
  scope.append(clone);

  translator.setLanguage("fi");
  assert.equal(cloneValue.textContent, "Jaettu");
  assert.equal(templateValue.textContent, "template");

  binding.update(asParentNode(template.content));
  assert.equal(templateValue.textContent, "Jaettu");

  binding.dispose();
  translator.setLanguage("en");
  assert.equal(window.document.querySelector("#live")!.textContent, "Jaettu");
});

test("keeps a copied nested preview detached until explicitly recopied", () => {
  const { window, translator: appTranslator } = createFixture();
  appTranslator.setTranslation("shared", { en: "Shared", fi: "Jaettu", pt: "Partilhado" });
  appTranslator.addLanguage({ code: "fi", nativeName: "Suomi", englishName: "Finnish" });
  appTranslator.addLanguage({ code: "pt", nativeName: "Portugues", englishName: "Portuguese" });
  appTranslator.setFallbackLanguage("fi");
  const previewTranslator = new Translator({ language: "pt" });
  const previewFallback = previewTranslator.getFallbackLanguage();
  previewTranslator.copyFrom(appTranslator);
  assert.deepEqual(previewTranslator.getTranslationData(), appTranslator.getTranslationData());
  assert.deepEqual(previewTranslator.getLanguages(), appTranslator.getLanguages());
  assert.equal(previewTranslator.getLanguage(), "pt");
  assert.equal(previewTranslator.getFallbackLanguage(), previewFallback);
  window.document.body.innerHTML = `
    <span id="app-title" data-i18n="shared"></span>
    <section id="preview">
      <span id="preview-title" data-preview="shared"></span>
      <select></select>
    </section>
  `;

  const appBinding = bindTranslator(appTranslator, asParentNode(window.document.body));
  const previewBinding = bindTranslator(
    previewTranslator,
    asParentNode(window.document.querySelector("#preview")!),
    {
      attributePrefix: "preview",
    },
  );
  const select = window.document.querySelector("select")!;
  const selectBinding = bindLanguageSelect(
    previewTranslator,
    select as unknown as HTMLSelectElement,
  );
  const optionLabels = () => [...select.options].map(option => [option.value, option.textContent]);
  assert.deepEqual(optionLabels(), [
    ["en", "English"],
    ["fi", "Suomi"],
    ["pt", "Portugues"],
  ]);
  assert.equal(select.value, "pt");

  const appTitle = window.document.querySelector("#app-title")!;
  const previewTitle = window.document.querySelector("#preview-title")!;
  assert.equal(appTitle.textContent, "Shared");
  assert.equal(previewTitle.textContent, "Partilhado");

  appTranslator.setLanguage("fi");
  assert.equal(appTitle.textContent, "Jaettu");
  assert.equal(previewTitle.textContent, "Partilhado");
  assert.equal(previewTranslator.getLanguage(), "pt");
  assert.equal(select.value, "pt");

  previewTranslator.setLanguage("en");
  assert.equal(appTitle.textContent, "Jaettu");
  assert.equal(previewTitle.textContent, "Shared");
  assert.equal(appTranslator.getLanguage(), "fi");
  assert.equal(select.value, "en");

  appTranslator.setTranslation("shared", {
    en: "Updated",
    fi: "Updated Finnish",
    pt: "Updated Portuguese",
  });
  appTranslator.setTranslation("later", { en: "Added later" });
  appTranslator.addLanguage({ code: "pt", nativeName: "Updated Portuguese" });
  appTranslator.addLanguage({ code: "sv", nativeName: "Svenska" });
  assert.equal(previewTitle.textContent, "Shared");
  assert.equal(previewTranslator.translateKey("shared", { language: "pt" }), "Partilhado");
  assert.deepEqual(optionLabels(), [
    ["en", "English"],
    ["fi", "Suomi"],
    ["pt", "Portugues"],
  ]);
  assert.notDeepEqual(previewTranslator.getTranslationData(), appTranslator.getTranslationData());

  let catalogUpdates = 0;
  const unsubscribe = previewTranslator.subscribeCatalog(() => catalogUpdates++);
  previewTranslator.copyFrom(appTranslator);
  assert.equal(catalogUpdates, 1);
  assert.equal(previewTitle.textContent, "Updated");
  assert.deepEqual(previewTranslator.getTranslationData(), appTranslator.getTranslationData());
  assert.deepEqual(optionLabels(), [
    ["en", "English"],
    ["fi", "Suomi"],
    ["pt", "Updated Portuguese"],
    ["sv", "Svenska"],
  ]);
  assert.equal(previewTranslator.getLanguage(), "en");
  assert.equal(previewTranslator.getFallbackLanguage(), previewFallback);
  assert.equal(appTranslator.getLanguage(), "fi");
  assert.equal(select.value, "en");
  unsubscribe();
  selectBinding.dispose();
  previewBinding.dispose();
  appBinding.dispose();
});

test("copies multiple keys into a bound target with one complete catalog refresh", () => {
  const { window, translator } = createFixture();
  const source = new Translator({ language: "fi" });
  source.setTranslation("shared", { en: "Copied text" });
  source.setTranslation("title", { en: "Copied title" });
  window.document.body.innerHTML = '<button data-i18n="shared" data-i18n-title="title"></button>';
  const target = window.document.querySelector("button")!;
  const snapshots: string[][] = [];
  const catalogs: string[][] = [];
  const unsubscribe = translator.subscribeCatalog(() => {
    catalogs.push([translator.translateKey("shared"), translator.translateKey("title")]);
  });
  const binding = bindTranslator(translator, asParentNode(window.document.body), {
    extensions: [
      {
        selector: "button",
        update() {
          snapshots.push([target.textContent!, target.getAttribute("title")!]);
        },
      },
    ],
  });
  snapshots.length = 0;
  translator.copyFrom(source);
  assert.deepEqual(catalogs, [["Copied text", "Copied title"]]);
  assert.deepEqual(snapshots, [["Copied text", "Copied title"]]);
  assert.equal(translator.getLanguage(), "en");
  translator.copyFrom(source);
  assert.equal(catalogs.length, 1);
  assert.equal(snapshots.length, 1);
  binding.dispose();
  unsubscribe();
});

test("updates document language only when requested", () => {
  const { window, translator } = createFixture();
  window.document.documentElement.dir = "rtl";
  const binding = bindTranslator(translator, asParentNode(window.document.body), {
    updateDocumentLanguage: true,
  });
  assert.equal(window.document.documentElement.lang, "en");
  translator.setLanguage("fi");
  assert.equal(window.document.documentElement.lang, "fi");
  assert.equal(window.document.documentElement.dir, "rtl");
  binding.dispose();
});

test("opts into document direction independently and observes registry changes", () => {
  const { window, translator } = createFixture();
  window.document.documentElement.lang = "de";
  window.document.documentElement.dir = "rtl";
  translator.addLanguage({ code: "ar", direction: "rtl" });
  let scans = 0;
  window.document.body.innerHTML = '<span class="scan"></span>';
  const binding = bindTranslator(translator, asParentNode(window.document.body), {
    updateDocumentDirection: true,
    updateOnCatalogChange: false,
    extensions: [
      {
        selector: ".scan",
        update() {
          scans++;
        },
      },
    ],
  });
  assert.equal(window.document.documentElement.dir, "ltr");
  assert.equal(window.document.documentElement.lang, "de");
  translator.setLanguage("ar");
  assert.equal(window.document.documentElement.dir, "rtl");
  translator.addLanguage({ code: "ar", direction: "ltr" });
  assert.equal(window.document.documentElement.dir, "ltr");
  translator.importTranslations({
    "translator-i18n": { languages: { ar: { direction: "rtl" } }, "multilingual-data": {} },
  });
  assert.equal(window.document.documentElement.dir, "rtl");
  assert.equal(scans, 2); // Initial scan and language change; registry updates do not rescan content.
  translator.removeLanguage("ar");
  assert.equal(window.document.documentElement.dir, "ltr");
  translator.addLanguage({ code: "ar", direction: "rtl" });
  translator.setLanguage("ar-EG");
  assert.equal(window.document.documentElement.dir, "ltr");
  translator.setLanguage("ar");
  translator.clearLanguages();
  assert.equal(window.document.documentElement.dir, "ltr");
  window.document.documentElement.dir = "rtl";
  binding.update();
  assert.equal(window.document.documentElement.dir, "ltr");
  binding.dispose();
  translator.addLanguage({ code: "ar", direction: "rtl" });
  translator.setLanguage("ar", { force: true });
  binding.update();
  assert.equal(window.document.documentElement.dir, "ltr");
  assert.equal(window.document.documentElement.lang, "de");
});

test("updates document language and direction together when both are requested", () => {
  const { window, translator } = createFixture();
  translator.addLanguage({ code: "ar", direction: "rtl" });
  const binding = bindTranslator(translator, asParentNode(window.document.body), {
    updateDocumentLanguage: true,
    updateDocumentDirection: true,
  });
  translator.setLanguage("ar");
  assert.equal(window.document.documentElement.lang, "ar");
  assert.equal(window.document.documentElement.dir, "rtl");
  translator.setLanguage("fi");
  assert.equal(window.document.documentElement.lang, "fi");
  assert.equal(window.document.documentElement.dir, "ltr");
  binding.dispose();
});

test("binds a native select to active language and live registry changes", () => {
  const { window, translator } = createFixture();
  translator.addLanguage({ code: "fi", nativeName: "Suomi", englishName: "Finnish" });
  const select = window.document.createElement("select");
  window.document.body.append(select);

  const binding = bindLanguageSelect(translator, select as unknown as HTMLSelectElement);
  assert.deepEqual(
    [...select.options].map(option => [option.value, option.textContent, option.lang]),
    [
      ["en", "English", "en"],
      ["fi", "Suomi", "fi"],
    ],
  );
  assert.equal(select.value, "en");

  select.value = "fi";
  select.dispatchEvent(new window.Event("change"));
  assert.equal(translator.getLanguage(), "fi");

  translator.addLanguage({ code: "pt_BR", englishName: "Portuguese" });
  assert.deepEqual(
    [...select.options].map(option => [option.value, option.textContent]),
    [
      ["en", "English"],
      ["fi", "Suomi"],
      ["pt-BR", "pt-BR"],
    ],
  );
  assert.equal(select.value, "fi");

  translator.removeLanguage("fi");
  assert.equal(translator.getLanguage(), "fi");
  assert.equal(select.value, "fi");
  assert.equal(select.selectedOptions[0]!.textContent, "fi");
  binding.dispose();
  translator.addLanguage({ code: "sv", nativeName: "Svenska" });
  assert.deepEqual(
    [...select.options].map(option => option.value),
    ["en", "pt-BR", "fi"],
  );
});

test("formats temporary select options across active-language and registry changes", () => {
  const { window, translator } = createFixture();
  translator.setLanguage("pt_BR");
  const select = window.document.createElement("select");
  const labels: { code: string; nativeName?: string }[] = [];
  const binding = bindLanguageSelect(translator, select as unknown as HTMLSelectElement, {
    label: language => {
      labels.push({ ...language });
      return language.code.toUpperCase();
    },
  });
  assert.deepEqual(labels.at(-1), { code: "pt-BR" });
  assert.equal(select.value, "pt-BR");
  assert.equal(select.selectedOptions[0]!.textContent, "PT-BR");
  assert.equal(select.selectedOptions[0]!.lang, "pt-BR");
  assert.equal(
    translator.getLanguages().some(language => language.code === "pt-BR"),
    false,
  );
  const registeredOption = select.options[0];

  translator.setLanguage("sv");
  assert.deepEqual(
    [...select.options].map(option => option.value),
    ["en", "sv"],
  );
  assert.equal(select.options[0], registeredOption);
  assert.equal(select.value, "sv");
  assert.equal(select.selectedOptions[0]!.textContent, "SV");
  assert.deepEqual(labels.at(-1), { code: "sv" });

  translator.setLanguage("en");
  assert.equal(select.options.length, 1);
  assert.equal(select.value, "en");
  assert.equal(select.selectedOptions[0]!.textContent, "EN");
  translator.setLanguage("pt-BR");
  translator.addLanguage({ code: "pt-BR", nativeName: "Portuguese" });
  assert.equal(labels.at(-1)!.nativeName, "Portuguese");
  assert.deepEqual(
    [...select.options].map(option => option.value),
    ["en", "pt-BR"],
  );
  assert.equal(select.value, "pt-BR");
  translator.removeLanguage("pt-BR");
  assert.deepEqual(labels.at(-1), { code: "pt-BR" });
  binding.update();
  assert.deepEqual(
    [...select.options].map(option => option.value),
    ["en", "pt-BR"],
  );
  assert.equal(select.selectedOptions[0]!.textContent, "PT-BR");
  binding.dispose();
  translator.setLanguage("en");
  assert.equal(select.value, "pt-BR");
});

test("built-in select labels fall back to canonical codes for temporary options", () => {
  for (const label of [undefined, "native", "code"] as const) {
    const { window, translator } = createFixture();
    translator.setLanguage("pt-BR");
    const select = window.document.createElement("select");
    const binding = bindLanguageSelect(translator, select as unknown as HTMLSelectElement, {
      label,
    });
    assert.equal(select.value, "pt-BR");
    assert.equal(select.selectedOptions[0]!.textContent, "pt-BR");
    translator.addLanguage({ code: "pt-BR", nativeName: "Portuguese" });
    assert.equal(select.selectedOptions[0]!.textContent, label === "code" ? "pt-BR" : "Portuguese");
    translator.removeLanguage("pt-BR");
    assert.equal(select.value, "pt-BR");
    assert.equal(select.selectedOptions[0]!.textContent, "pt-BR");
    binding.dispose();
  }
});

test("rolls back both language controls when an unregistered active label formatter fails", () => {
  for (const control of ["select", "details"] as const) {
    const { window, translator } = createFixture();
    translator.setLanguage("pt-BR");
    const subscriptions = trackSubscriptions(translator);
    const element = window.document.createElement(control);
    if (control === "details") {
      element.innerHTML =
        "<summary><span data-i18n-language-current></span></summary><div data-i18n-language-options></div>";
    }
    const label = (language: { code: string }): string => {
      if (language.code === "pt-BR") throw new Error("unregistered label failed");
      return language.code;
    };
    assert.throws(
      () =>
        control === "select"
          ? bindLanguageSelect(translator, element as unknown as HTMLSelectElement, { label })
          : bindLanguageDetails(translator, element as unknown as HTMLDetailsElement, {
              currentLabel: label,
            }),
      /unregistered label failed/,
    );
    assert.equal(subscriptions(), 0);
    const markup = element.innerHTML;
    translator.setLanguage("en");
    translator.addLanguage({ code: "sv" });
    assert.equal(element.innerHTML, markup);
  }
});

test("supports consumer-owned select options when population is disabled", () => {
  const { window, translator } = createFixture();
  const select = window.document.createElement("select");
  select.innerHTML = '<option value="">Choose</option><option value="fi">Finnish</option>';
  window.document.body.append(select);

  const binding = bindLanguageSelect(translator, select as unknown as HTMLSelectElement, {
    populate: false,
  });
  assert.equal(select.selectedIndex, -1);
  translator.setLanguage("fi");
  assert.equal(select.value, "fi");
  translator.addLanguage({ code: "pt", nativeName: "Português" });
  assert.equal(select.options.length, 2);

  binding.dispose();
  assert.throws(
    () => bindLanguageSelect(translator, window.document.createElement("div") as never),
    /native select/,
  );
});

test("canonicalizes consumer-owned select values without rewriting options and ignores invalid codes", () => {
  const { window, translator } = createFixture();
  const select = window.document.createElement("select");
  select.innerHTML =
    '<option value="">Choose</option><option value="invalid!">Invalid</option><option value=" EN_us ">English</option><option value="en-US">Duplicate</option>';
  const originalMarkup = select.innerHTML;
  const diagnostics: string[] = [];
  const binding = bindLanguageSelect(translator, select as unknown as HTMLSelectElement, {
    populate: false,
    logger: entry => diagnostics.push(entry.event),
  });
  translator.setLanguage("en-US");
  assert.equal(select.selectedIndex, 2);
  select.selectedIndex = 1;
  select.dispatchEvent(new window.Event("change"));
  assert.equal(translator.getLanguage(), "en-US");
  select.selectedIndex = 2;
  translator.setLanguage("fi");
  select.selectedIndex = 2;
  select.dispatchEvent(new window.Event("change"));
  assert.equal(translator.getLanguage(), "en-US");
  assert.equal(select.selectedIndex, 2);
  assert.equal(select.innerHTML, originalMarkup);
  assert.ok(diagnostics.includes("invalid-language-choice"));
  binding.dispose();
});

test("rejects multiple and foreign-namespace selects and cleans up failed select setup", () => {
  const { window, translator } = createFixture();
  const subscriptions = trackSubscriptions(translator);
  const select = window.document.createElement("select");
  select.multiple = true;
  assert.throws(
    () => bindLanguageSelect(translator, select as unknown as HTMLSelectElement),
    /multiple selects/,
  );
  const foreign = window.document.createElementNS("http://www.w3.org/2000/svg", "select");
  assert.throws(
    () => bindLanguageSelect(translator, foreign as unknown as HTMLSelectElement),
    /native select/,
  );
  assert.equal(subscriptions(), 0);
  select.multiple = false;
  assert.throws(
    () =>
      bindLanguageSelect(translator, select as unknown as HTMLSelectElement, {
        label() {
          throw new Error("label failed");
        },
      }),
    /label failed/,
  );
  assert.equal(subscriptions(), 0);
  select.innerHTML = '<option value="fi">Finnish</option>';
  select.value = "fi";
  select.dispatchEvent(new window.Event("change"));
  assert.equal(translator.getLanguage(), "en");
  translator.addLanguage({ code: "sv" });
  assert.equal(select.options.length, 1);
});

test("does not update a select disposed by an earlier in-flight subscriber", () => {
  const { window, translator } = createFixture();
  const select = window.document.createElement("select");
  select.innerHTML = '<option value="en">English</option><option value="fi">Finnish</option>';
  let disposeBinding = (): void => {};
  const unsubscribe = translator.subscribe(() => disposeBinding());
  const binding = bindLanguageSelect(translator, select as unknown as HTMLSelectElement, {
    populate: false,
  });
  disposeBinding = binding.dispose;
  translator.setLanguage("fi");
  assert.equal(select.value, "en");
  binding.update();
  assert.equal(select.value, "en");
  unsubscribe();
});

test("binds a populated details dropdown and synchronizes multiple language controls", () => {
  const { window, translator } = createFixture();
  translator.addLanguage({ code: "fi", nativeName: "Suomi", englishName: "Finnish" });
  window.document.body.innerHTML = `
    <select id="language-select"></select>
    <details id="language-details" open>
      <summary>Language: <span data-i18n-language-current></span></summary>
      <div data-i18n-language-options></div>
    </details>
  `;
  const select = window.document.querySelector("#language-select")! as unknown as HTMLSelectElement;
  const details = window.document.querySelector(
    "#language-details",
  )! as unknown as HTMLDetailsElement;
  const summary = details.querySelector("summary")!;
  const current = details.querySelector<HTMLElement>("[data-i18n-language-current]")!;
  bindLanguageSelect(translator, select as unknown as HTMLSelectElement);
  const detailsBinding = bindLanguageDetails(translator, details as unknown as HTMLDetailsElement, {
    choiceClass: "language-choice",
  });

  assert.equal(current.textContent, "English");
  assert.equal(current.lang, "en");
  assert.deepEqual(
    [...details.querySelectorAll<HTMLButtonElement>("[data-i18n-language]")].map(button => [
      button.getAttribute("data-i18n-language"),
      button.textContent,
      button.className,
      button.hidden,
      button.getAttribute("aria-current"),
    ]),
    [
      ["en", "English", "language-choice", false, "true"],
      ["fi", "Suomi", "language-choice", false, null],
    ],
  );

  details.querySelector<HTMLButtonElement>('[data-i18n-language="fi"]')!.click();
  assert.equal(translator.getLanguage(), "fi");
  assert.equal(select.value, "fi");
  assert.equal(current.textContent, "Suomi");
  assert.equal(details.open, false);
  assert.equal(window.document.activeElement, summary);

  details.querySelector<HTMLElement>('[data-i18n-language="en"]')!.focus();
  translator.addLanguage({ code: "pt_BR", nativeName: "Português" });
  assert.deepEqual(
    [...details.querySelectorAll<HTMLElement>("[data-i18n-language]")].map(choice =>
      choice.getAttribute("data-i18n-language"),
    ),
    ["en", "fi", "pt-BR"],
  );
  assert.deepEqual(
    [...select.options].map(option => option.value),
    ["en", "fi", "pt-BR"],
  );
  assert.equal(
    window.document.activeElement,
    details.querySelector<HTMLElement>('[data-i18n-language="en"]'),
  );

  translator.removeLanguage("en");
  assert.equal(window.document.activeElement, summary);
  translator.addLanguage({ code: "en", nativeName: "English" });

  translator.setLanguage("pt-BR");
  assert.equal(select.value, "pt-BR");
  assert.equal(current.textContent, "Português");
  assert.equal(details.querySelector<HTMLElement>('[data-i18n-language="pt-BR"]')!.hidden, false);
  assert.equal(
    details
      .querySelector<HTMLElement>('[data-i18n-language="pt-BR"]')!
      .getAttribute("aria-current"),
    "true",
  );

  detailsBinding.dispose();
  translator.setLanguage("en");
  assert.equal(current.textContent, "Português");
  assert.equal(select.value, "en");
});

test("formats registered and unregistered details summaries across language and registry changes", () => {
  const { window, translator } = createFixture();
  translator.setLanguage("pt_BR");
  const details = window.document.createElement("details");
  details.innerHTML =
    "<summary><span data-i18n-language-current></span></summary><div data-i18n-language-options></div>";
  const current = details.querySelector("span")!;
  const labels: { code: string; nativeName?: string }[] = [];
  const binding = bindLanguageDetails(translator, details as unknown as HTMLDetailsElement, {
    choiceLabel: language => language.code.toUpperCase(),
    currentLabel: language => {
      labels.push({ ...language });
      return language.code.toUpperCase();
    },
  });
  assert.deepEqual(labels.at(-1), { code: "pt-BR" });
  assert.equal(current.textContent, "PT-BR");
  assert.equal(current.lang, "pt-BR");
  assert.equal(translator.getLanguage(), "pt-BR");
  assert.equal(
    translator.getLanguages().some(language => language.code === "pt-BR"),
    false,
  );

  translator.setLanguage("en");
  assert.equal(current.textContent, "EN");
  assert.equal(labels.at(-1)!.nativeName, "English");
  assert.equal(details.querySelector('[data-i18n-language="en"]')!.textContent, "EN");
  translator.setLanguage("pt-BR");
  assert.equal(current.textContent, "PT-BR");
  assert.deepEqual(labels.at(-1), { code: "pt-BR" });

  translator.addLanguage({ code: "pt-BR", nativeName: "Portuguese" });
  assert.equal(labels.at(-1)!.nativeName, "Portuguese");
  assert.equal(current.textContent, "PT-BR");
  assert.equal(details.querySelector('[data-i18n-language="pt-BR"]')!.textContent, "PT-BR");
  translator.removeLanguage("pt-BR");
  assert.deepEqual(labels.at(-1), { code: "pt-BR" });
  assert.equal(current.textContent, "PT-BR");
  binding.update();
  assert.deepEqual(labels.at(-1), { code: "pt-BR" });
  binding.dispose();
});

test("built-in details summary labels retain code fallback for unregistered languages", () => {
  for (const currentLabel of [undefined, "native", "code"] as const) {
    const { window, translator } = createFixture();
    translator.setLanguage("pt-BR");
    const details = window.document.createElement("details");
    details.innerHTML =
      "<summary><span data-i18n-language-current></span></summary><div data-i18n-language-options></div>";
    const current = details.querySelector("span")!;
    const binding = bindLanguageDetails(translator, details as unknown as HTMLDetailsElement, {
      currentLabel,
    });
    assert.equal(current.textContent, "pt-BR");
    assert.equal(current.lang, "pt-BR");
    translator.addLanguage({ code: "pt-BR", nativeName: "Portuguese" });
    assert.equal(current.textContent, currentLabel === "code" ? "pt-BR" : "Portuguese");
    translator.removeLanguage("pt-BR");
    assert.equal(current.textContent, "pt-BR");
    binding.dispose();
  }
});

test("supports consumer-owned details choices and validates required structure", () => {
  const { window, translator } = createFixture();
  window.document.body.innerHTML = `
    <details id="language-details">
      <summary><span data-preview-language-current></span></summary>
      <div data-preview-language-options>
        <button type="button" data-preview-language="fi">Finnish</button>
      </div>
    </details>
  `;
  const details = window.document.querySelector(
    "#language-details",
  )! as unknown as HTMLDetailsElement;
  const binding = bindLanguageDetails(translator, details as unknown as HTMLDetailsElement, {
    attributePrefix: "preview",
    populate: false,
    hideCurrent: true,
  });
  translator.addLanguage({ code: "pt", nativeName: "Português" });
  assert.equal(details.querySelectorAll("[data-preview-language]").length, 1);
  const choice = details.querySelector<HTMLElement>("[data-preview-language]")!;
  choice.focus();
  translator.setLanguage("fi");
  assert.equal(
    details.querySelector<HTMLElement>("[data-preview-language]")!.getAttribute("aria-current"),
    "true",
  );
  assert.equal(choice.hidden, true);
  assert.equal(window.document.activeElement, details.querySelector("summary"));
  binding.dispose();

  assert.throws(
    () => bindLanguageDetails(translator, window.document.createElement("div") as never),
    /native details/,
  );
  assert.throws(
    () =>
      bindLanguageDetails(
        translator,
        window.document.createElement("details") as unknown as HTMLDetailsElement,
      ),
    /must contain <summary>, \[data-i18n-language-current\], and \[data-i18n-language-options\]/,
  );
});

test("accepted consumer-owned details choices cancel form actions without changing button types", () => {
  const { window, translator } = createFixture();
  window.document.body.innerHTML = `
    <form>
      <details open>
        <summary><span data-i18n-language-current></span></summary>
        <div data-i18n-language-options>
          <button data-i18n-language="fi"><span>Finnish</span></button>
          <button type="submit" data-i18n-language="en">English</button>
          <button type="reset" data-i18n-language="pt">Portuguese</button>
          <button id="unrelated">Submit</button>
          <button data-i18n-language="invalid!">Invalid</button>
          <button disabled data-i18n-language="fi">Disabled</button>
          <details><summary>Nested</summary><button id="nested" data-i18n-language="fi">Nested choice</button></details>
        </div>
        <button id="outside" data-i18n-language="fi">Outside container</button>
      </details>
    </form>`;
  const form = window.document.querySelector("form")!;
  const details = form.querySelector("details")! as unknown as HTMLDetailsElement;
  let submissions = 0;
  let resets = 0;
  form.addEventListener("submit", event => {
    event.preventDefault();
    submissions++;
  });
  form.addEventListener("reset", () => resets++);
  const binding = bindLanguageDetails(translator, details as unknown as HTMLDetailsElement, {
    populate: false,
  });
  for (const [language, type] of [
    ["fi", null],
    ["en", "submit"],
    ["pt", "reset"],
  ] as const) {
    details.open = true;
    const choice = details.querySelector<HTMLButtonElement>(
      `button[data-i18n-language="${language}"]`,
    )!;
    (choice.querySelector<HTMLElement>("span") ?? choice).click();
    assert.equal(translator.getLanguage(), language);
    assert.equal(details.open, false);
    assert.equal(window.document.activeElement, details.querySelector("summary"));
    assert.equal(choice.getAttribute("type"), type);
    assert.equal(submissions, 0);
    assert.equal(resets, 0);
  }
  for (const selector of [
    "#unrelated",
    '[data-i18n-language="invalid!"]',
    "[disabled]",
    "#nested",
    "#outside",
  ]) {
    const event = new window.MouseEvent("click", { bubbles: true, cancelable: true });
    details.querySelector(selector)!.dispatchEvent(event as unknown as Event);
    assert.equal(event.defaultPrevented, false, selector);
    assert.equal(translator.getLanguage(), "pt");
  }
  const beforeSubmit = submissions;
  details.querySelector<HTMLButtonElement>("#unrelated")!.click();
  assert.equal(submissions, beforeSubmit + 1);
  binding.dispose();
  details.querySelector<HTMLButtonElement>('button[data-i18n-language="fi"]')!.click();
  assert.equal(submissions, beforeSubmit + 2);
  assert.equal(translator.getLanguage(), "pt");
});

test("canonicalizes native details buttons and ignores malformed, invalid, and disabled choices", () => {
  const { window, translator } = createFixture();
  window.document.body.innerHTML = `
    <details open>
      <summary><span data-i18n-language-current></span></summary>
      <div data-i18n-language-options>
        <button type="button" data-i18n-language=" EN_us "><span>English</span></button>
        <button type="button" data-i18n-language="invalid!" aria-current="keep">Invalid</button>
        <a data-i18n-language="fi" aria-current="keep">Link</a>
        <button type="button" disabled data-i18n-language="fi">Disabled</button>
      </div>
    </details>`;
  const details = window.document.querySelector("details")!;
  const foreign = window.document.createElementNS("http://www.w3.org/2000/svg", "button");
  foreign.setAttribute("data-i18n-language", "fi");
  details.querySelector("div")!.append(foreign);
  const diagnostics: string[] = [];
  const binding = bindLanguageDetails(translator, details as unknown as HTMLDetailsElement, {
    populate: false,
    hideCurrent: true,
    logger: entry => diagnostics.push(entry.event),
  });
  const button = details.querySelector("button")!;
  button.querySelector("span")!.click();
  assert.equal(translator.getLanguage(), "en-US");
  assert.equal(button.getAttribute("data-i18n-language"), " EN_us ");
  assert.equal(button.getAttribute("aria-current"), "true");
  assert.equal(button.hidden, true);
  assert.equal(window.document.activeElement, details.querySelector("summary"));
  for (const choice of [
    details.querySelector('[data-i18n-language="invalid!"]')!,
    details.querySelector("a")!,
    details.querySelector("[disabled]")!,
    foreign,
  ]) {
    choice.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    assert.equal(translator.getLanguage(), "en-US");
  }
  assert.equal(details.querySelector("a")!.getAttribute("aria-current"), "keep");
  assert.equal(
    details.querySelector('[data-i18n-language="invalid!"]')!.getAttribute("aria-current"),
    "keep",
  );
  assert.ok(diagnostics.includes("invalid-language-choice"));
  translator.setLanguage("fi");
  assert.equal(button.hidden, false);
  assert.equal(button.hasAttribute("aria-current"), false);
  binding.dispose();
});

test("isolates nested details controls and ignores choices outside the owned container", () => {
  const { window, translator } = createFixture();
  const innerTranslator = new Translator({ language: "en" });
  window.document.body.innerHTML = `
    <details id="outer" open>
      <summary><span data-i18n-language-current></span></summary>
      <button id="outside" type="button" data-i18n-language="fi" aria-current="keep">Outside</button>
      <div data-i18n-language-options>
        <button id="outer-choice" type="button" data-i18n-language="fi">Finnish</button>
        <details id="inner" open>
          <summary><span data-i18n-language-current></span></summary>
          <div data-i18n-language-options><button type="button" data-i18n-language="fi">Finnish</button></div>
        </details>
      </div>
    </details>`;
  const outer = window.document.querySelector("#outer")! as unknown as HTMLDetailsElement;
  const inner = window.document.querySelector("#inner")! as unknown as HTMLDetailsElement;
  const outerBinding = bindLanguageDetails(translator, outer as unknown as HTMLDetailsElement, {
    populate: false,
    hideCurrent: true,
  });
  const innerBinding = bindLanguageDetails(
    innerTranslator,
    inner as unknown as HTMLDetailsElement,
    { populate: false },
  );
  inner.querySelector("button")!.click();
  assert.equal(innerTranslator.getLanguage(), "fi");
  assert.equal(translator.getLanguage(), "en");
  assert.equal(outer.open, true);
  translator.setLanguage("fi");
  assert.equal(inner.querySelector("button")!.hidden, false);
  assert.equal(outer.querySelector<HTMLButtonElement>("#outer-choice")!.hidden, true);
  translator.setLanguage("en");
  outer.querySelector<HTMLButtonElement>("#outside")!.click();
  assert.equal(translator.getLanguage(), "en");
  assert.equal(window.document.querySelector("#outside")!.getAttribute("aria-current"), "keep");
  outerBinding.dispose();
  innerBinding.dispose();
});

test("validates owned details structure and rolls back failing initial labels", () => {
  const { window, translator } = createFixture();
  const subscriptions = trackSubscriptions(translator);
  const valid =
    "<summary><span data-i18n-language-current></span></summary><div data-i18n-language-options></div>";
  const details = window.document.createElement("details");
  for (const markup of [
    `<details>${valid}</details>`,
    "<div><summary><span data-i18n-language-current></span></summary></div><div data-i18n-language-options></div>",
    "<summary></summary><span data-i18n-language-current></span><div data-i18n-language-options></div>",
    "<summary><span data-i18n-language-current></span><div data-i18n-language-options></div></summary>",
    `${valid}<div data-i18n-language-options></div>`,
    "<summary><script data-i18n-language-current></script></summary><div data-i18n-language-options></div>",
    "<summary><span data-i18n-language-current></span></summary><style data-i18n-language-options></style>",
  ]) {
    details.innerHTML = markup;
    assert.throws(
      () => bindLanguageDetails(translator, details as unknown as HTMLDetailsElement),
      /direct-child summary/,
    );
    assert.equal(subscriptions(), 0);
  }
  const foreign = window.document.createElementNS("http://www.w3.org/2000/svg", "details");
  assert.throws(
    () => bindLanguageDetails(translator, foreign as unknown as HTMLDetailsElement),
    /native details/,
  );
  for (const key of ["choiceLabel", "currentLabel"] as const) {
    details.innerHTML = valid;
    assert.throws(
      () =>
        bindLanguageDetails(translator, details as unknown as HTMLDetailsElement, {
          [key]() {
            throw new Error("label failed");
          },
        }),
      /label failed/,
    );
    assert.equal(subscriptions(), 0);
    details.querySelector("div")!.innerHTML =
      '<button type="button" data-i18n-language="fi">Finnish</button>';
    details.querySelector("button")!.click();
    assert.equal(translator.getLanguage(), "en");
    translator.addLanguage({ code: "sv" });
    assert.equal(details.querySelector("div")!.children.length, 1);
  }
});

test("preserves details focus within shadow roots on rebuild, removal, and hiding", () => {
  const { window, translator } = createFixture();
  translator.addLanguage({ code: "fi", nativeName: "Suomi" });
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML =
    '<span data-i18n="shared"></span><details open><summary><span data-i18n-language-current></span></summary><div data-i18n-language-options></div></details>';
  const markerBinding = bindTranslator(translator, asParentNode(shadow));
  const details = shadow.querySelector("details")! as unknown as HTMLDetailsElement;
  const binding = bindLanguageDetails(translator, details as unknown as HTMLDetailsElement, {
    hideCurrent: true,
  });
  details.querySelector<HTMLButtonElement>('[data-i18n-language="fi"]')!.focus();
  assert.equal(window.document.activeElement, host);
  translator.addLanguage({ code: "sv" });
  assert.equal(shadow.activeElement, details.querySelector('[data-i18n-language="fi"]'));
  translator.removeLanguage("fi");
  assert.equal(shadow.activeElement, details.querySelector("summary"));
  translator.addLanguage({ code: "fi", nativeName: "Suomi" });
  details.querySelector<HTMLButtonElement>('[data-i18n-language="fi"]')!.focus();
  translator.setLanguage("fi");
  assert.equal(shadow.activeElement, details.querySelector("summary"));
  assert.equal(shadow.querySelector("[data-i18n]")!.textContent, "Jaettu");
  binding.dispose();
  markerBinding.dispose();
});
