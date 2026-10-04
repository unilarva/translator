// SPDX-FileCopyrightText: 2020-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Package-private tests for semantic-token parsing and consumer-owned DOM rendering.
 * @packageDocumentation
 * @module rich-text.test
 * @author Lari Natri
 */

import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { Window } from "happy-dom";

import { parseRichText, Translator, translateRichText } from "../src/index.ts";
import {
  bindTranslator,
  richTextDomExtension,
  type RichTextDomExtensionOptions,
  type RichTextTagRenderer,
  type TranslatorDomExtensionContext,
} from "../src/dom.ts";
import { asElement, asParentNode } from "./dom-test-utils.ts";

test("parses balanced consumer-approved semantic tags", () => {
  assert.deepEqual(parseRichText("Read <strong>this</strong>.", ["strong"]), [
    { type: "text", value: "Read " },
    { type: "tag", name: "strong", children: [{ type: "text", value: "this" }] },
    { type: "text", value: "." },
  ]);
  assert.throws(() => parseRichText("<script>bad</script>", ["strong"]));
  assert.throws(() => parseRichText("<strong>bad</em>", ["strong", "em"]));
  assert.throws(() => parseRichText("<strong>bad", ["strong"]));
});

test("rich allowlists require arrays of primitive valid tag names", () => {
  for (const allowed of ["strong", null, undefined, new Set(["strong"]), { strong: true }]) {
    assert.throws(() => parseRichText("<s>unexpected</s>", allowed as unknown as string[]), {
      name: "TypeError",
      message: "Rich-text allowedTags must be an array of tag names",
    });
  }
  for (const tag of [
    null,
    undefined,
    1,
    true,
    new String("strong"),
    { toString: () => "strong" },
  ]) {
    assert.throws(() => parseRichText("plain", [tag] as unknown as string[]), {
      name: "TypeError",
      message: "Rich-text tag names must be strings",
    });
  }
  assert.throws(() => parseRichText("plain", Array(1)), TypeError);
  for (const tag of ["", " strong", "strong\n", "1strong", "strong_", "strong class=x"]) {
    assert.throws(() => parseRichText("plain", [tag]), TypeError);
  }
  assert.deepEqual(parseRichText("<Strong-2>x</Strong-2>", Object.freeze(["Strong-2"])), [
    { type: "tag", name: "Strong-2", children: [{ type: "text", value: "x" }] },
  ]);
  assert.throws(() => parseRichText("<strong>x</strong>", ["Strong"]), /not allowed/);
});

test("attribute-like and self-closing rich tokens remain literal text", () => {
  const text = '<strong class="x">literal</strong class="x"> <br/> <img src=x onerror=alert(1)>';
  assert.deepEqual(parseRichText(text, ["strong", "br"]), [{ type: "text", value: text }]);
});

test("rich parsing permits 256 nested tags and rejects deeper trees with RangeError", () => {
  const text = "<b>".repeat(256) + "x" + "</b>".repeat(256);
  let nodes = parseRichText(text, ["b"]);
  for (let depth = 0; depth < 256; depth++) {
    assert.equal(nodes.length, 1);
    const node = nodes[0];
    assert.equal(node.type, "tag");
    if (node.type !== "tag") assert.fail("Expected a nested semantic tag");
    nodes = node.children;
  }
  assert.deepEqual(nodes, [{ type: "text", value: "x" }]);
  for (const depth of [257, 10000]) {
    assert.throws(() => parseRichText("<b>".repeat(depth) + "x" + "</b>".repeat(depth), ["b"]), {
      name: "RangeError",
      message: "Rich-text nesting must not exceed 256 tags",
    });
  }
  assert.equal(parseRichText("<b>x</b>".repeat(300), ["b"]).length, 300);
});

test("interpolates rich values as text rather than parsing injected tags", () => {
  const translator = new Translator();
  translator.importTranslations({
    "translator-i18n": {
      "multilingual-data": {
        message: { en: "Hello <strong>{name}</strong>; literal {{name}}" },
      },
    },
  });
  assert.deepEqual(
    translateRichText(translator, "message", {
      allowedTags: ["strong"],
      values: { name: "<script>bad</script>" },
    }),
    [
      { type: "text", value: "Hello " },
      {
        type: "tag",
        name: "strong",
        children: [{ type: "text", value: "<script>bad</script>" }],
      },
      { type: "text", value: "; literal {name}" },
    ],
  );
});

test("rich source lookups decode escaped braces exactly once with and without values", () => {
  const window = new Window();
  const translator = new Translator();
  translator.importTranslations({
    "translator-i18n": {
      "multilingual-data": {
        message: { en: "<b>{name}</b>; literal {{name}}; doubled {{{{name}}}}" },
      },
    },
  });
  for (const values of [undefined, { name: "<script>hostile</script>" }]) {
    const expected = `${values?.name ?? "{name}"}; literal {name}; doubled {{name}}`;
    const nodes = translateRichText(translator, "message", { allowedTags: ["b"], values });
    assert.deepEqual(nodes, [
      { type: "tag", name: "b", children: [{ type: "text", value: values?.name ?? "{name}" }] },
      { type: "text", value: "; literal {name}; doubled {{name}}" },
    ]);
    const element = window.document.createElement("p");
    element.setAttribute("data-i18n-rich", "message");
    const diagnostics: string[] = [];
    richTextDomExtension({ renderers: { b: children => children } }).update(asElement(element), {
      translator,
      values,
      log: (_level, event) => diagnostics.push(event),
    });
    assert.equal(element.textContent, expected);
    assert.equal(element.children.length, 0);
    assert.deepEqual(diagnostics, []);
  }
});

test("rich DOM extension gives semantic tags to consumer-owned renderers", () => {
  const window = new Window();
  const translator = new Translator({ language: "en" });
  translator.importTranslations({
    "translator-i18n": {
      "multilingual-data": {
        message: {
          en: "Visit the <website>{place} website</website>.",
          fi: "Vieraile <website>kohteen {place} verkkosivuilla</website>.",
        },
      },
    },
  });
  window.document.body.innerHTML = '<p id="message" data-i18n-rich="message"></p>';
  const binding = bindTranslator(translator, asParentNode(window.document.body), {
    extensions: [
      richTextDomExtension({
        renderers: {
          website(children, { document }) {
            const link = document.createElement("a");
            link.href = "https://example.test/museum";
            link.appendChild(children);
            return link;
          },
        },
      }),
    ],
  });

  const message = window.document.querySelector("#message")!;
  assert.equal(message.textContent, "Visit the {place} website.");
  binding.setValues(asElement(message), { place: "museum" });
  assert.equal(message.textContent, "Visit the museum website.");
  assert.equal(message.querySelector("a")?.getAttribute("href"), "https://example.test/museum");
  translator.setLanguage("fi");
  assert.equal(message.textContent, "Vieraile kohteen museum verkkosivuilla.");
  translator.setTranslation("message", { fi: "<website>Updated {place}</website>" });
  assert.equal(message.textContent, "Updated museum");
  binding.dispose();
});

test("invalid async rich renderers fall back synchronously and observe every rejected result", async () => {
  const window = new Window();
  const translator = new Translator();
  translator.setTranslation("message", { en: "<b>Hello {name}</b>" });
  const rejection = new Error("Renderer rejected");
  const renderers: (() => unknown)[] = [
    async () => {
      throw rejection;
    },
    () => Promise.reject(rejection),
    () => runInNewContext("Promise.reject(error)", { error: rejection }),
    () => ({
      then(_resolve: unknown, reject: (error: unknown) => void) {
        reject(rejection);
      },
    }),
    () =>
      Object.defineProperty({}, "then", {
        get() {
          throw rejection;
        },
      }),
    () => ({
      nodeType: 1,
      then(_resolve: unknown, reject: (error: unknown) => void) {
        reject(rejection);
      },
    }),
  ];
  for (const renderer of renderers) {
    const element = window.document.createElement("p");
    element.setAttribute("data-i18n-rich", "message");
    const diagnostics: Parameters<TranslatorDomExtensionContext["log"]>[] = [];
    richTextDomExtension({ renderers: { b: renderer as RichTextTagRenderer } }).update(
      asElement(element),
      {
        translator,
        values: { name: "Ada" },
        log: (...args) => diagnostics.push(args),
      },
    );
    assert.equal(element.textContent, "<b>Hello Ada</b>");
    assert.equal(element.children.length, 0);
    assert.equal(diagnostics.length, 1);
    assert.ok(diagnostics[0][4] instanceof TypeError);
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(diagnostics.length, 2);
    assert.equal(diagnostics[1][1], "rich-text-render-failed");
    assert.equal(diagnostics[1][4], rejection);
  }
});

test("accidental async rich renderer resolution cannot update fallback after disposal", async () => {
  const window = new Window();
  const translator = new Translator();
  translator.setTranslation("message", { en: "<b>Fallback</b>" });
  window.document.body.innerHTML = '<p data-i18n-rich="message"></p>';
  let resolveNode!: (node: Node) => void;
  const pending = new Promise<Node>(resolve => {
    resolveNode = resolve;
  });
  const binding = bindTranslator(translator, asParentNode(window.document.body), {
    extensions: [richTextDomExtension({ renderers: { b: () => pending as unknown as Node } })],
  });
  assert.equal(window.document.body.textContent, "<b>Fallback</b>");
  binding.dispose();
  resolveNode(asElement(window.document.createElement("b")));
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(window.document.body.textContent, "<b>Fallback</b>");
  assert.equal(window.document.querySelector("p")!.children.length, 0);
});

test("rich renderer configuration rejects malformed records, names, and callbacks", () => {
  for (const options of [
    undefined,
    null,
    {},
    { renderers: null },
    { renderers: [] },
    { renderers: "b" },
  ]) {
    assert.throws(() => richTextDomExtension(options as unknown as RichTextDomExtensionOptions), {
      name: "TypeError",
      message: "richTextDomExtension requires a renderer record",
    });
  }
  for (const tag of ["", "1b", "b\n", "b class=x", "b_"]) {
    assert.throws(
      () => richTextDomExtension({ renderers: { [tag]: children => children } }),
      TypeError,
    );
  }
  for (const renderer of [null, undefined, 1, "b", {}, { nodeType: 1 }]) {
    assert.throws(
      () => richTextDomExtension({ renderers: { b: renderer as unknown as RichTextTagRenderer } }),
      { name: "TypeError", message: "Rich-text renderer 'b' must be a function" },
    );
  }
});

test("rich parser and renderer failures produce interpolated inert text and original diagnostics", () => {
  const window = new Window();
  const translator = new Translator({ language: "en" });
  const values = { name: "<img src=x onerror=alert(1)>" };
  const failure = new Error("Consumer renderer failed");
  const cases: {
    text: string;
    renderer: RichTextTagRenderer;
    error: typeof Error;
    originalError?: Error;
  }[] = [
    { text: "<unknown>{name}</unknown>", renderer: children => children, error: Error },
    { text: "<b>{name}</wrong>", renderer: children => children, error: Error },
    { text: "<b>{name}", renderer: children => children, error: Error },
    {
      text: "<b>".repeat(257) + "{name}" + "</b>".repeat(257),
      renderer: children => children,
      error: RangeError,
    },
    {
      text: "<b>{name}</b>",
      renderer() {
        throw failure;
      },
      error: Error,
      originalError: failure,
    },
  ];
  for (const result of [
    null,
    undefined,
    1,
    "not a node",
    {},
    { nodeType: 1 },
    Promise.resolve(null),
  ]) {
    cases.push({
      text: "<b>{name}</b>",
      renderer: () => result as unknown as Node,
      error: TypeError,
    });
  }
  for (const { text, renderer, error, originalError } of cases) {
    translator.importTranslations({
      "translator-i18n": { "multilingual-data": { message: { en: text } } },
    });
    const element = window.document.createElement("p");
    element.setAttribute("data-i18n-rich", "message");
    element.appendChild(window.document.createElement("a"));
    const diagnostics: Parameters<TranslatorDomExtensionContext["log"]>[] = [];
    richTextDomExtension({ renderers: { b: renderer } }).update(asElement(element), {
      translator,
      values,
      log: (...args) => diagnostics.push(args),
    });
    assert.equal(element.textContent, translator.translateKey("message", { values }));
    assert.equal(element.children.length, 0);
    assert.equal(diagnostics.length, 1);
    const [level, event, , details, caught] = diagnostics[0];
    assert.equal(level, "error");
    assert.equal(event, "rich-text-render-failed");
    assert.deepEqual(details, { key: "message" });
    assert.ok(caught instanceof error);
    if (error === TypeError)
      assert.match((caught as Error).message, /Rich-text renderer 'b' must return/);
    if (originalError) assert.equal(caught, originalError);
    if (error === RangeError) assert.match((caught as Error).message, /must not exceed 256/);
  }
});

test("rich DOM rendering accepts the nesting boundary, foreign nodes, and literal hostile text", () => {
  const window = new Window();
  const foreignWindow = new Window();
  const translator = new Translator();
  const literal = "<br/> <b class=x>literal</b class=x> <img src=x onerror=alert(1)>";
  translator.importTranslations({
    "translator-i18n": {
      "multilingual-data": {
        deep: { en: "<b>".repeat(256) + "{name}" + "</b>".repeat(256) },
        foreign: { en: "<foreign>x</foreign>" },
        literal: { en: literal },
      },
    },
  });
  const extension = richTextDomExtension({
    renderers: {
      b(children, { document }) {
        const element = document.createElement("b");
        element.appendChild(children);
        return element;
      },
      foreign: () => foreignWindow.document.createTextNode("foreign text") as unknown as Node,
    },
  });
  const diagnostics: string[] = [];
  for (const key of ["deep", "foreign", "literal"]) {
    const element = window.document.createElement("p");
    element.setAttribute("data-i18n-rich", key);
    extension.update(asElement(element), {
      translator,
      values: { name: "<script>hostile</script>" },
      log: (_level, event) => diagnostics.push(event),
    });
    if (key === "deep") {
      assert.equal(element.querySelectorAll("b").length, 256);
      assert.equal(element.textContent, "<script>hostile</script>");
      assert.equal(element.querySelector("script"), null);
    } else {
      assert.equal(element.textContent, key === "foreign" ? "foreign text" : literal);
      assert.equal(element.children.length, 0);
    }
  }
  assert.deepEqual(diagnostics, []);
});
