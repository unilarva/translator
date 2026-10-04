// SPDX-FileCopyrightText: 2020-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Package-private tests for public entry points and published-file boundaries.
 * @packageDocumentation
 * @module package.test
 * @author Lari Natri
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Window } from "happy-dom";
import { tsImport } from "tsx/esm/api";
import type { Translator } from "../src/index.ts";

const { assertPublishedFiles, publishedRootFiles, publishedAssetFiles } = (await import(
  new URL("../scripts/packed-files.mjs", import.meta.url).href
)) as {
  assertPublishedFiles(paths: readonly string[]): void;
  publishedRootFiles: readonly string[];
  publishedAssetFiles: readonly string[];
};

test("authored modules retain module documentation and SPDX headers", async () => {
  for (const directory of ["src", "scripts", "tests"]) {
    const base = new URL(`../${directory}/`, import.meta.url);
    for (const filename of await readdir(base)) {
      if (!/\.(?:ts|mjs)$/.test(filename)) continue;
      const text = await readFile(new URL(filename, base), "utf8");
      const label = `${directory}/${filename}`;
      assert.match(
        text,
        /^\/\/ SPDX-FileCopyrightText: .+ Lari Natri <lari\.natri@iki\.fi>$/m,
        label,
      );
      assert.match(text, /^\/\/ SPDX-License-Identifier: Apache-2\.0$/m, label);
      // Only inspect the first block so API comments cannot mask a missing module header.
      const header = text.match(/\/\*\*([\s\S]*?)\*\//)?.[1] ?? "";
      assert.ok(header.includes("@packageDocumentation"), label);
      assert.ok(header.includes(`@module ${filename.replace(/\.(?:ts|mjs)$/, "")}`), label);
      assert.ok(header.includes("@author Lari Natri"), label);
      assert.match(header, /public|package-private/i, label);
    }
  }
});

test("both SVG logos retain SPDX headers", async () => {
  for (const filename of [
    "unilarva-translator-logo.svg",
    "unilarva-translator-logo-adaptive.svg",
  ]) {
    const text = await readFile(new URL(`../assets/icons/${filename}`, import.meta.url), "utf8");
    assert.match(
      text,
      /<!-- SPDX-FileCopyrightText: .+ Lari Natri <lari\.natri@iki\.fi> -->/,
      filename,
    );
    assert.match(text, /<!-- SPDX-License-Identifier: Apache-2\.0 -->/, filename);
  }
});

test("package exposes only the core and DOM public entry points", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as {
    dependencies?: Record<string, string>;
    exports: Record<string, unknown>;
    files: string[];
    license: string;
    sideEffects: boolean;
  };

  assert.deepEqual(Object.keys(manifest.exports), [".", "./dom", "./package.json"]);
  assert.equal(manifest.dependencies, undefined);
  assert.equal(manifest.license, "Apache-2.0");
  assert.equal(manifest.sideEffects, false);
  assert.deepEqual(manifest.files, [
    "dist",
    ...publishedRootFiles.filter(file => file !== "package.json"),
    ...publishedAssetFiles,
  ]);
});

test("published file gate accepts only exact root and asset allowlists and controlled dist paths", () => {
  assert.deepEqual(publishedRootFiles, [
    "package.json",
    "README.md",
    "USAGE.md",
    "ARCHITECTURE.md",
    "CHANGELOG.md",
    "LICENSE",
  ]);
  assert.deepEqual(publishedAssetFiles, ["assets/icons/unilarva-translator-logo-adaptive.svg"]);
  const paths = [
    ...publishedRootFiles,
    ...publishedAssetFiles,
    "dist/index.js",
    "dist/index.d.ts",
    "dist/dom.js",
    "dist/dom.d.ts",
    "dist/translator.js",
    "dist/types.d.ts",
  ];
  assert.doesNotThrow(() => assertPublishedFiles(paths));
  for (const unexpected of [
    "MIGRATION.md",
    "RELEASE_translator.md",
    "PRIVATE.md",
    "tsconfig.json",
    "package-lock.json",
    "dist/index.js.map",
    "dist/private.js",
    "dist/nested/index.js",
    "src/index.ts",
    "assets/icons/README.md",
    "assets/icons/.npmignore",
    "assets/icons/unilarva-translator-logo.svg",
  ]) {
    assert.throws(() => assertPublishedFiles([...paths, unexpected]), {
      message: `Unexpected published file: ${unexpected}`,
    });
  }
  for (const required of paths.slice(0, 11)) {
    assert.throws(() => assertPublishedFiles(paths.filter(path => path !== required)), {
      message: `Missing published file: ${required}`,
    });
  }
});

test("README logo references the published adaptive icon", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  assert.ok(readme.includes(`src="./${publishedAssetFiles[0]}"`));
});

test("README core and browser quick starts work together", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const quickStart = readme.split("## Quick Start")[1]!.split("## Browser Binding")[0]!;
  const browser = readme.split("## Browser Binding")[1]!.split("## Is It A Fit?")[0]!;
  const coreCode = quickStart.match(/```ts\n([\s\S]*?)\n```/)?.[1];
  const browserCode = browser.match(/```ts\n([\s\S]*?)\n```/)?.[1];
  const markup = browser.match(/```html\n([\s\S]*?)\n```/)?.[1];
  assert.ok(coreCode && browserCode && markup, "Connected quick-start snippets are required");

  const directory = await mkdtemp(join(tmpdir(), "translator-readme-"));
  const window = new Window();
  try {
    // Execute the authored snippets through the existing TS test loader, without a duplicate fixture.
    const browserImports = browserCode.match(/^import .+;$/gm) ?? [];
    const source = `${browserImports.join("\n")}\n${coreCode}\nexport { translator };\nexport function run(document: Document) {\n${browserCode.replace(/^import .+;$/gm, "")}\n}`;
    const fixture = join(directory, "quick-start.mts");
    await writeFile(
      fixture,
      source
        .replaceAll(
          '"@unilarva/translator"',
          JSON.stringify(new URL("../src/index.ts", import.meta.url).href),
        )
        .replaceAll(
          '"@unilarva/translator/dom"',
          JSON.stringify(new URL("../src/dom.ts", import.meta.url).href),
        ),
    );
    const { translator, run } = (await tsImport(fixture, import.meta.url)) as {
      translator: Translator;
      run(document: unknown): void;
    };
    assert.equal(translator.translateKey("greeting", { values: { name: "Ada" } }), "Hei Ada");
    window.document.body.innerHTML = markup;
    run(window.document);
    assert.equal(window.document.querySelector("#greeting")!.textContent, "Hello Lin");
    assert.equal(window.document.documentElement.lang, "en");
    assert.equal(window.document.querySelector("select")!.value, "en");
    translator.setLanguage("fi");
    assert.equal(window.document.querySelector("#greeting")!.textContent, "Hello Lin");
    assert.equal(window.document.querySelector("select")!.value, "en");
  } finally {
    await window.happyDOM.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("USAGE localized resource allowlist rejects unknown identifiers and releases both subscriptions", async () => {
  const usage = await readFile(new URL("../USAGE.md", import.meta.url), "utf8");
  const source = [...usage.matchAll(/```ts\n([\s\S]*?)\n```/g)].find(([, code]) =>
    code.includes("const heroImages:"),
  )?.[1];
  assert.ok(source, "The localized-resource usage snippet is required");
  const directory = await mkdtemp(join(tmpdir(), "translator-usage-"));
  const window = new Window({ url: "https://example.test/" });
  try {
    const fixture = join(directory, "resource.mts");
    await writeFile(
      fixture,
      `export function run(translator: import(${JSON.stringify(new URL("../src/index.ts", import.meta.url).href)}).Translator, document: Document) {\n${source}\nreturn () => { unsubscribeImage(); unsubscribeImageCatalog(); };\n}`,
    );
    const { run } = (await tsImport(fixture, import.meta.url)) as {
      run(translator: Translator, document: unknown): () => void;
    };
    const { Translator } = await import("../src/index.ts");
    const translator = new Translator({ language: "en" });
    translator.setTranslation("hero.image", { en: "hero-en", fi: "hero-fi" });
    window.document.body.innerHTML = '<img id="hero" src="/images/initial.webp" />';
    const image = window.document.querySelector("img")!;
    const dispose = run(translator, window.document);
    assert.equal(image.getAttribute("src"), "/images/hero-en.webp");
    translator.setLanguage("fi");
    assert.equal(image.getAttribute("src"), "/images/hero-fi.webp");
    translator.setTranslation("hero.image", { fi: "hero-en" });
    assert.equal(image.getAttribute("src"), "/images/hero-en.webp");
    for (const identifier of ["__proto__", "constructor", "toString", "unknown"]) {
      translator.setTranslation("hero.image", { fi: identifier });
      assert.equal(image.getAttribute("src"), "/images/hero-en.webp", identifier);
    }
    dispose();
    translator.setTranslation("hero.image", { fi: "hero-fi" });
    translator.setLanguage("en");
    translator.setLanguage("fi");
    assert.equal(image.getAttribute("src"), "/images/hero-en.webp");
  } finally {
    await window.happyDOM.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("published documents contain no private project references and resolve local links", async () => {
  const guides = publishedRootFiles.filter(file => file.endsWith(".md"));
  const documents = new Map(
    await Promise.all(
      guides.map(
        async file =>
          [file, await readFile(new URL(`../${file}`, import.meta.url), "utf8")] as const,
      ),
    ),
  );
  for (const [file, text] of documents) {
    assert.doesNotMatch(
      text,
      /Hubifier|\bparent (?:application|workspace|repository|project|lockfile)\b|MIGRATION\.md|RELEASE_[\w-]+\.md|copied translator|private workspace/i,
      file,
    );
    const prose = text.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, "");
    for (const match of prose.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = match[1]!;
      if (/^(?:https?:|mailto:)/.test(target)) continue;
      const [relative, fragment] = target.split("#");
      const destination = relative ? relative.replace(/^\.\//, "") : file;
      assert.ok(publishedRootFiles.includes(destination), `${file}: unpublished link ${target}`);
      if (!fragment) continue;
      const linkedText = documents.get(destination);
      assert.ok(linkedText, `${file}: fragment link requires a published guide: ${target}`);
      const anchors = [...linkedText.matchAll(/^#+\s+(.+)$/gm)].map(heading =>
        heading[1]!
          .toLowerCase()
          .replace(/[^\w\s-]/g, "")
          .replace(/\s/g, "-"),
      );
      assert.ok(anchors.includes(fragment), `${file}: missing heading for ${target}`);
    }
  }
});
