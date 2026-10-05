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
      import { createTypedTranslate, Translator, formatRelativeTime, selectPlural } from "@unilarva/translator";
      import { bindTranslator, bindLanguageSelect, bindLanguageDetails } from "@unilarva/translator/dom";
      const translator = new Translator({ language: "en" });
      assert.equal(formatRelativeTime(-1, "day", "en", { numeric: "auto" }), "yesterday");
      assert.equal(selectPlural(2, "en", { type: "ordinal" }), "two");
      assert.equal(translator.formatRelativeTime(0, "day", { numeric: "auto" }), "today");
      assert.equal(translator.selectPlural(1), "one");
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
    [
      "core",
      ["ES2022"],
      `
      import { Translator, formatDate, formatRelativeTime, selectPlural, parseRichText, type RelativeTimeFormatOptions, type PluralSelectOptions, type TranslationBundle, type TranslationCatalogChangeEvent, type TranslatorCopyOptions } from "@unilarva/translator";
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
      formatDate("2026-10-03", "en");
      const relativeOptions: RelativeTimeFormatOptions = { numeric: "auto", language: "fi" };
      const pluralOptions: PluralSelectOptions = { type: "ordinal", maximumFractionDigits: 0 };
      const relative: string = formatRelativeTime(-1, "day", "en", relativeOptions);
      const category: Intl.LDMLPluralRule = selectPlural(2, "en", pluralOptions);
      const methodCategory: Intl.LDMLPluralRule = translator.selectPlural(2, pluralOptions);
      translator.formatRelativeTime(1, "weeks", relativeOptions);
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
      "typed-lookup",
      ["ES2022"],
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
      ["ES2022"],
      `
      declare const console: { warn(...values: unknown[]): void };
      ${typedSnippet}
      `,
    ],
    [
      "dom",
      ["ES2022", "DOM", "DOM.Iterable"],
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
      ["ES2022", "DOM", "DOM.Iterable"],
      `
      import { Translator } from "@unilarva/translator";
      import { bindTranslator } from "@unilarva/translator/dom";
      const translator = new Translator({ language: "en" });
      ${fragmentSnippet}
    `,
    ],
  ]) {
    writeFileSync(join(consumer, `${name}.ts`), source);
    const config = join(consumer, `${name}.json`);
    writeFileSync(
      config,
      JSON.stringify({ compilerOptions: { ...compilerOptions, lib }, files: [`${name}.ts`] }),
    );
    execFileSync(process.execPath, [typescript, "--project", config], {
      cwd: consumer,
      stdio: "inherit",
    });
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
