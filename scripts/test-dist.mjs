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
      import { Translator } from "@unilarva/translator";
      import { bindTranslator, bindLanguageSelect, bindLanguageDetails } from "@unilarva/translator/dom";
      const translator = new Translator({ language: "en" });
      const catalogEvents = [];
      const unsubscribeCatalog = translator.subscribeCatalog(event => catalogEvents.push(event));
      translator.setTranslation("smoke", { en: "Installed package" });
      assert.equal(translator.translateKey("smoke"), "Installed package");
      assert.deepEqual(catalogEvents, [{ revision: 1 }]);
      assert.ok(Object.isFrozen(catalogEvents[0]));
      unsubscribeCatalog();
      const preview = new Translator({ language: "fi" });
      preview.copyFrom(translator);
      assert.equal(preview.translateKey("smoke"), "Installed package");
      assert.equal(preview.getLanguage(), "fi");
      translator.setTranslation("smoke", { en: "Source changed" });
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
      import { Translator, formatDate, parseRichText, type TranslationBundle, type TranslationCatalogChangeEvent, type TranslatorCopyOptions } from "@unilarva/translator";
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
      parseRichText(text, []);
      translator.setTranslation("greeting", {});
      unsubscribeCatalog();
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
