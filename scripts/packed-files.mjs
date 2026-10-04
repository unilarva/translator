// SPDX-FileCopyrightText: 2020-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Package-private allowlist shared by source tests and tarball qualification.
 * @packageDocumentation
 * @module packed-files
 * @author Lari Natri
 */

import assert from "node:assert/strict";

/** Required package-root files, including npm's generated manifest entry. */
export const publishedRootFiles = Object.freeze([
  "package.json",
  "README.md",
  "USAGE.md",
  "ARCHITECTURE.md",
  "CHANGELOG.md",
  "LICENSE",
]);

/** Consumer assets intentionally shipped with the package. */
export const publishedAssetFiles = Object.freeze([
  "assets/icons/unilarva-translator-logo-adaptive.svg",
]);

const modules = [
  "index",
  "dom",
  "types",
  "translator",
  "interpolation",
  "intl",
  "intl-dom",
  "logging",
  "rich-text",
  "rich-text-dom",
];
const allowedFiles = new Set([
  ...publishedRootFiles,
  ...publishedAssetFiles,
  ...modules.flatMap(name => [`dist/${name}.js`, `dist/${name}.d.ts`]),
]);

/** Check the actual npm file list without importing or building distribution output. */
export function assertPublishedFiles(paths) {
  for (const required of [
    ...publishedRootFiles,
    ...publishedAssetFiles,
    "dist/index.js",
    "dist/index.d.ts",
    "dist/dom.js",
    "dist/dom.d.ts",
  ]) {
    assert.ok(paths.includes(required), `Missing published file: ${required}`);
  }
  for (const path of paths) {
    assert.ok(allowedFiles.has(path), `Unexpected published file: ${path}`);
  }
}
