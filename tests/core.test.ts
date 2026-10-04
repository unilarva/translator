// SPDX-FileCopyrightText: 2020-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Package-private tests for catalog validation, lookup, snapshots, and notifications.
 * @packageDocumentation
 * @module core.test
 * @author Lari Natri
 */

import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Translator, translateRichText } from "../src/index.ts";
import type { TranslationCatalogChangeEvent, TranslatorCopyOptions } from "../src/index.ts";
import { interpolate } from "../src/interpolation.ts";
import type {
  LanguageChangeEvent,
  LanguageRegistryChangeEvent,
  TranslationLoadOptions,
  TranslatorLogEntry,
} from "../src/types.ts";

/** Wraps untrusted key-first data for runtime validation tests. */
const bundle = (data: Record<string, unknown>) => ({
  "translator-i18n": { "multilingual-data": data },
});

/** Wraps untrusted language-first data for runtime validation tests. */
const languageBundle = (data: Record<string, Record<string, unknown>>) => ({
  "translator-i18n": { "language-data": data },
});

test("copyFrom defaults to merging detached catalogs and metadata without changing language settings", () => {
  const source = new Translator({ language: "fi", fallbackLanguage: "sv" });
  source.setTranslation("greeting", { fi: "Hei", en: "Hello" });
  source.setTranslation("source-only", { en: "Source" });
  source.addLanguage({ code: "fi", nativeName: "Suomi", englishName: "Finnish" });
  const target = new Translator({ language: "pt", fallbackLanguage: "de" });
  target.setTranslation("greeting", { pt: "Ola", en: "Old" });
  target.setTranslation("target-only", { en: "Target" });
  target.addLanguage({ code: "pt", nativeName: "Portugues" });
  target.addLanguage({ code: "fi", nativeName: "Old name" });

  target.copyFrom(source);
  assert.equal(target.getLanguage(), "pt");
  assert.equal(target.getFallbackLanguage(), "de");
  assert.deepEqual(
    [...target.getTranslationData().get("greeting")!],
    [
      ["pt", "Ola"],
      ["en", "Hello"],
      ["fi", "Hei"],
    ],
  );
  assert.equal(target.translateKey("source-only"), "Source");
  assert.equal(target.translateKey("target-only"), "Target");
  assert.deepEqual(target.getLanguages(), [
    { code: "en", nativeName: "English", englishName: "English" },
    { code: "pt", nativeName: "Portugues" },
    { code: "fi", nativeName: "Suomi", englishName: "Finnish" },
  ]);

  source.setTranslation("greeting", { fi: "Changed source" });
  source.addLanguage({ code: "fi", nativeName: "Changed source" });
  source.setLanguage("sv");
  source.setFallbackLanguage("en");
  assert.equal(target.translateKey("greeting", { language: "fi" }), "Hei");
  assert.equal(target.getLanguages().find(info => info.code === "fi")?.nativeName, "Suomi");
  assert.equal(target.getLanguage(), "pt");
  assert.equal(target.getFallbackLanguage(), "de");
  target.setTranslation("source-only", { en: "Changed target" });
  target.addLanguage({ code: "en", nativeName: "Changed target" });
  assert.equal(source.translateKey("source-only"), "Source");
  assert.equal(source.getLanguages()[0]?.nativeName, "English");
});

test("copyFrom selects each state category independently in replace mode", () => {
  const source = new Translator({ language: "fi", fallbackLanguage: "sv" });
  source.clearLanguages();
  source.addLanguage({ code: "fi", nativeName: "Suomi" });
  source.setTranslation("greeting", { fi: "Hei" });
  for (let mask = 0; mask < 16; mask++) {
    const options: TranslatorCopyOptions = {
      translations: Boolean(mask & 1),
      languageMetadata: Boolean(mask & 2),
      activeLanguage: Boolean(mask & 4),
      fallbackLanguage: Boolean(mask & 8),
      mode: "replace",
    };
    const target = new Translator({ language: "pt", fallbackLanguage: "de" });
    target.setTranslation("old", { en: "Old" });
    target.copyFrom(source, options);
    assert.deepEqual(
      target.getTranslationData(),
      options.translations
        ? source.getTranslationData()
        : new Map([["old", new Map([["en", "Old"]])]]),
    );
    assert.deepEqual(
      target.getLanguages(),
      options.languageMetadata
        ? source.getLanguages()
        : [{ code: "en", nativeName: "English", englishName: "English" }],
    );
    assert.equal(target.getLanguage(), options.activeLanguage ? "fi" : "pt");
    assert.equal(target.getFallbackLanguage(), options.fallbackLanguage ? "sv" : "de");
  }
});

test("copyFrom replace clears selected empty stores while merge preserves existing data", () => {
  const source = new Translator();
  source.clearLanguages();
  const target = new Translator();
  target.setTranslation("old", { en: "Old" });
  target.copyFrom(source);
  assert.equal(target.getTranslationData().size, 1);
  assert.equal(target.getLanguages().length, 1);
  target.copyFrom(source, { mode: "replace" });
  assert.equal(target.getTranslationData().size, 0);
  assert.deepEqual(target.getLanguages(), []);
});

test("copyFrom commits selected data before notifications and emits once per changed category", () => {
  const source = new Translator({ language: "fi", fallbackLanguage: "sv" });
  source.addLanguage({ code: "fi", nativeName: "Suomi" });
  source.setTranslation("first", { fi: "Ensimmainen" });
  source.setTranslation("second", { sv: "Andra" });
  const target = new Translator();
  const events: string[] = [];
  const observe = (category: string) => {
    events.push(category);
    assert.deepEqual(target.getTranslationData(), source.getTranslationData());
    assert.deepEqual(target.getLanguages(), source.getLanguages());
    assert.equal(target.getLanguage(), "fi");
    assert.equal(target.getFallbackLanguage(), "sv");
    assert.equal(target.translateKey("second"), "Andra");
  };
  target.subscribe(() => observe("active"));
  target.subscribeCatalog(() => observe("catalog"));
  target.subscribeLanguages(() => observe("registry"));
  const options: TranslatorCopyOptions = {
    mode: "replace",
    activeLanguage: true,
    fallbackLanguage: true,
  };
  target.copyFrom(source, options);
  assert.deepEqual(events, ["active", "catalog", "registry"]);
  target.copyFrom(source, options);
  target.copyFrom(target, options);
  target.copyFrom(source, { ...options, mode: "merge" });
  assert.equal(events.length, 3);
});

test("copyFrom preserves fallback order and ignores top-level key order for catalog events", () => {
  const source = new Translator();
  source.setTranslation("second", { en: "Second" });
  source.setTranslation("first", { sv: "Swedish", fi: "Finnish" });
  const target = new Translator({ language: "de", fallbackLanguage: "de" });
  target.setTranslation("first", { fi: "Finnish", sv: "Swedish" });
  target.setTranslation("second", { en: "Second" });
  let changes = 0;
  target.subscribeCatalog(() => changes++);
  target.copyFrom(source);
  assert.equal(target.translateKey("first"), "Finnish");
  assert.equal(changes, 0);
  target.copyFrom(source, { mode: "replace" });
  assert.equal(target.translateKey("first"), "Swedish");
  assert.equal(changes, 1);
  source.clearTranslations();
  source.setTranslation("first", { sv: "Swedish", fi: "Finnish" });
  source.setTranslation("second", { en: "Second" });
  target.copyFrom(source, { mode: "replace" });
  assert.equal(changes, 1);
});

test("copyFrom rejects invalid sources and options before mutation or notification", () => {
  const source = new Translator({ language: "fi", fallbackLanguage: "sv" });
  source.setTranslation("source", { fi: "Source" });
  const target = new Translator();
  target.setTranslation("target", { en: "Target" });
  const data = target.getTranslationData();
  const languages = target.getLanguages();
  let events = 0;
  target.subscribe(() => events++);
  target.subscribeCatalog(() => events++);
  target.subscribeLanguages(() => events++);
  for (const invalid of [null, undefined, {}, Object.create(Translator.prototype)]) {
    assert.throws(() => target.copyFrom(invalid as never), /copy source must be a Translator/);
  }
  for (const invalid of [null, [], "options"]) {
    assert.throws(
      () => target.copyFrom(source, invalid as never),
      /copy options must be a plain object/,
    );
  }
  for (const key of ["translations", "languageMetadata", "activeLanguage", "fallbackLanguage"]) {
    for (const value of [null, 0, "true"]) {
      assert.throws(
        () => target.copyFrom(source, { [key]: value } as never),
        /copy option .* must be a boolean/,
      );
    }
  }
  for (const mode of [null, "replace-all", "ignore"]) {
    assert.throws(() => target.copyFrom(source, { mode } as never), /unsupported copy mode/);
  }
  assert.deepEqual(target.getTranslationData(), data);
  assert.deepEqual(target.getLanguages(), languages);
  assert.equal(target.getLanguage(), "en");
  assert.equal(target.getFallbackLanguage(), "en");
  assert.equal(events, 0);
});

test("copyFrom preserves target policies, callbacks, logger, and fetch implementation", async () => {
  let sourceFetches = 0;
  let targetFetches = 0;
  const sourceLogs: TranslatorLogEntry[] = [];
  const targetLogs: TranslatorLogEntry[] = [];
  const source = new Translator({
    logger: entry => sourceLogs.push(entry),
    fetch: async () => {
      sourceFetches++;
      return { json: async () => bundle({}) };
    },
  });
  source.setTranslation("foreign", { fi: "Hei" });
  const target = new Translator({
    missingTranslationPolicy: "text",
    missingTranslationText: "Target missing",
    fallbackToAnyLanguage: false,
    logger: entry => targetLogs.push(entry),
    fetch: async () => {
      targetFetches++;
      return { json: async () => bundle({ loaded: { en: "Loaded" } }) };
    },
  });
  const failure = new Error("Target listener failure");
  target.subscribeCatalog(() => {
    throw failure;
  });
  const sourceLogCount = sourceLogs.length;
  target.copyFrom(source);
  assert.equal(target.translateKey("foreign"), "Target missing");
  assert.equal(target.translateKey("absent"), "Target missing");
  assert.equal(
    targetLogs.find(entry => entry.event === "catalog-change-listener-failed")?.error,
    failure,
  );
  assert.equal(sourceLogs.length, sourceLogCount);
  await target.loadTranslationFiles(["target.json"]);
  assert.equal(target.translateKey("loaded"), "Loaded");
  assert.equal(targetFetches, 1);
  assert.equal(sourceFetches, 0);
});

test("copyFrom callbacks can mutate state without rollback or duplicate final notifications", () => {
  const source = new Translator({ language: "fi" });
  source.setTranslation("value", { fi: "Copied" });
  source.addLanguage({ code: "fi" });
  const target = new Translator();
  const catalogs: string[] = [];
  const registries: string[][] = [];
  target.subscribe(() => {
    source.setTranslation("value", { fi: "Source changed after snapshot" });
    target.setTranslation("value", { fi: "Callback" });
  });
  target.subscribeCatalog(() => {
    catalogs.push(target.translateKey("value"));
    target.addLanguage({ code: "sv" });
  });
  target.subscribeLanguages(({ languages }) => registries.push(languages.map(info => info.code)));
  target.copyFrom(source, { activeLanguage: true });
  assert.deepEqual(catalogs, ["Callback"]);
  assert.deepEqual(registries, [["en", "fi", "sv"]]);
  assert.equal(target.translateKey("value"), "Callback");
});

test("reentrant copyFrom active-language changes use the existing FIFO transition queue", () => {
  const source = new Translator({ language: "pt", fallbackLanguage: "sv" });
  source.setTranslation("value", { pt: "Copied" });
  const target = new Translator();
  const transitions: string[] = [];
  target.subscribe(event => {
    if (event.language === "fi") {
      target.copyFrom(source, { activeLanguage: true, fallbackLanguage: true });
      assert.equal(target.getLanguage(), "fi");
      assert.equal(target.getFallbackLanguage(), "sv");
      assert.equal(target.translateKey("value", { language: "pt" }), "Copied");
    }
  });
  target.subscribe(event => {
    transitions.push(`${event.previousLanguage}:${event.language}:${target.getLanguage()}`);
  });
  target.setLanguage("fi");
  assert.deepEqual(transitions, ["en:fi:fi", "fi:pt:pt"]);
  assert.equal(target.getLanguage(), "pt");
});

test("catalog subscriptions notify effective mutations synchronously and independently", () => {
  const translator = new Translator();
  const events: TranslationCatalogChangeEvent[] = [];
  const unsubscribe = translator.subscribeCatalog(event => {
    assert.ok(Object.isFrozen(event));
    assert.equal(Reflect.set(event, "revision", 999), false);
    events.push(event);
  });
  assert.throws(() => translator.subscribeCatalog(null as never), /listener must be a function/);
  translator.setTranslation("first", { en: "First" });
  assert.deepEqual(
    events.map(event => event.revision),
    [1],
  );
  translator.setTranslation("first", { en: "First" });
  translator.importTranslations(bundle({ first: { en: "First" } }), { mode: "replace-all" });
  translator.importTranslations(bundle({ first: { en: 4 } }), { mode: "replace-all" });
  translator.importTranslations({});
  translator.setLanguage("fi");
  translator.addLanguage({ code: "fi" });
  translator.setFallbackLanguage("sv");
  translator.setMissingTranslationPolicy("text");
  translator.setMissingTranslationText("missing");
  assert.equal(events.length, 1);
  translator.importTranslations(bundle({ first: { fi: "Hei" }, second: { en: "Second" } }));
  assert.equal(events.length, 2);
  translator.setTranslation("absent", {});
  translator.setTranslation("second", {});
  translator.setTranslation("first", {});
  translator.clearTranslations();
  assert.deepEqual(
    events.map(event => event.revision),
    [1, 2, 3, 4],
  );
  translator.setTranslation("again", { en: "Again" });
  translator.clearTranslations();
  translator.clearTranslations();
  assert.deepEqual(
    events.map(event => event.revision),
    [1, 2, 3, 4, 5, 6],
  );
  unsubscribe();
  unsubscribe();
  translator.setTranslation("unobserved", { en: "Value" });
  assert.equal(events.length, 6);
});

test("catalog comparison includes language fallback order but not unrelated key order", () => {
  const translator = new Translator({ language: "de", fallbackLanguage: "de" });
  translator.setTranslation("first", { fi: "Finnish", sv: "Swedish" });
  translator.setTranslation("second", { en: "English" });
  const revisions: number[] = [];
  translator.subscribeCatalog(event => revisions.push(event.revision));
  translator.importTranslations(
    bundle({ second: { en: "English" }, first: { fi: "Finnish", sv: "Swedish" } }),
    { mode: "replace-all" },
  );
  assert.deepEqual(revisions, []);
  translator.setTranslation("first", { sv: "Swedish", fi: "Finnish" });
  assert.equal(translator.translateKey("first"), "Swedish");
  assert.deepEqual(revisions, [3]);
});

test("reentrant catalog changes coalesce and callback failures cannot prevent the latest event", async () => {
  const errors: unknown[] = [];
  const translator = new Translator({
    logger: entry => {
      if (entry.event === "catalog-change-listener-failed") errors.push(entry.error);
    },
  });
  const failure = new Error("sync failure");
  const asyncFailure = new Error("async failure");
  translator.subscribeCatalog(({ revision }) => {
    if (revision === 1) {
      translator.setTranslation("second", { en: "Second" });
      translator.setTranslation("third", { en: "Third" });
    }
    throw failure;
  });
  translator.subscribeCatalog(async () => {
    throw asyncFailure;
  });
  const revisions: number[] = [];
  translator.subscribeCatalog(({ revision }) => {
    revisions.push(revision);
    if (revision === 3) assert.equal(translator.translateKey("third"), "Third");
  });
  translator.setTranslation("first", { en: "First" });
  assert.deepEqual(revisions, [1, 3]);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(errors, [failure, failure, asyncFailure, asyncFailure]);
});

test("file transactions emit one final catalog event and none for unchanged or failed staging", async () => {
  const translator = new Translator();
  const snapshots: string[][] = [];
  translator.subscribeCatalog(() => snapshots.push([...translator.getTranslationData().keys()]));
  const fetch = async (url: string) => ({ json: async () => bundle({ [url]: { en: url } }) });
  await translator.loadTranslationFiles(["first", "second"], { fetch });
  assert.deepEqual(snapshots, [["first", "second"]]);
  await translator.loadTranslationFiles(["first", "second"], { fetch, mode: "replace-all" });
  assert.equal(snapshots.length, 1);
  await assert.rejects(
    translator.loadTranslationFiles(["first", "bad"], {
      mode: "replace-all",
      fetch: async url => ({
        json: async () =>
          url === "bad"
            ? {
                get "translator-i18n"() {
                  throw new Error("staging failed");
                },
              }
            : bundle({ changed: { en: "Changed" } }),
      }),
    }),
    /staging failed/,
  );
  assert.equal(snapshots.length, 1);
  assert.deepEqual([...translator.getTranslationData().keys()], ["first", "second"]);
});

test("catalog callback registry mutations do not duplicate import or file registry notifications", async () => {
  for (const loadFiles of [false, true]) {
    const translator = new Translator();
    const snapshots: string[][] = [];
    translator.subscribeLanguages(({ languages }) =>
      snapshots.push(languages.map(info => info.code)),
    );
    translator.subscribeCatalog(() => translator.addLanguage({ code: "sv" }));
    const data = {
      "translator-i18n": {
        languages: { fi: {} },
        "multilingual-data": { value: { en: "Value" } },
      },
    };
    if (loadFiles) {
      await translator.loadTranslationFiles(["bundle"], {
        languageMode: "replace",
        fetch: async () => ({ json: async () => data }),
      });
    } else {
      translator.importTranslations(data, { languageMode: "replace" });
    }
    assert.deepEqual(snapshots, [["fi", "sv"]]);
    assert.equal(translator.translateKey("value"), "Value");
  }
});

test("aborted file transactions preserve reason, catalog, registry, and subscriber state", async () => {
  for (const phase of ["entry", "json", "staging"] as const) {
    const controller = new AbortController();
    const reason = { phase };
    const translator = new Translator();
    translator.setTranslation("old", { en: "Old" });
    const notifications: unknown[] = [];
    translator.subscribeCatalog(event => notifications.push(event));
    translator.subscribeLanguages(event => notifications.push(event));
    translator.setLogger(entry => {
      if (entry.event === "translation-imported") notifications.push(entry);
    });
    let requests = 0;
    if (phase === "entry") controller.abort(reason);
    await assert.rejects(
      translator.loadTranslationFiles(["file"], {
        signal: controller.signal,
        mode: "replace-all",
        languageMode: "replace",
        fetch: async () => {
          requests++;
          return {
            json: async () => {
              if (phase === "json") controller.abort(reason);
              return {
                "translator-i18n": {
                  languages: { fi: {} },
                  get "multilingual-data"() {
                    if (phase === "staging") controller.abort(reason);
                    return { new: { en: "New" } };
                  },
                },
              };
            },
          };
        },
      }),
      error => error === reason,
    );
    assert.equal(requests, phase === "entry" ? 0 : 1);
    assert.deepEqual(notifications, []);
    assert.deepEqual([...translator.getTranslationData().keys()], ["old"]);
    assert.deepEqual(
      translator.getLanguages().map(info => info.code),
      ["en"],
    );
  }
});

test("foreign-realm plain records are accepted while class instances remain invalid", () => {
  const translator = new Translator(runInNewContext('({ language: "en" })'));
  const data = runInNewContext(
    '({ "translator-i18n": { languages: { fi: { nativeName: "Suomi" } }, "multilingual-data": { value: { en: ["For", "eign"] } } } })',
  );
  assert.deepEqual(
    translator.importTranslations(data, runInNewContext('({ mode: "merge" })')).issues,
    [],
  );
  assert.equal(translator.translateKey("value"), "Foreign");
  assert.deepEqual(
    translator.setTranslation("direct", runInNewContext('({ en: "Direct" })')).issues,
    [],
  );
  for (const instance of [
    new (class RecordLike {})(),
    runInNewContext("new (class RecordLike {})()"),
  ]) {
    assert.equal(translator.importTranslations(instance).issues[0]?.code, "invalid-root");
    assert.throws(() => translator.setTranslation("value", instance as never), TypeError);
  }
  const nullRecord = Object.assign(Object.create(null), { en: "Null prototype" });
  assert.deepEqual(translator.setTranslation("null", nullRecord).issues, []);
});

test("sparse string arrays are invalid and cannot bypass destructive guards", () => {
  const sparse = ["a", , "b"];
  const inherited = ["a", , "b"];
  Object.setPrototypeOf(
    inherited,
    Object.assign(Object.create(Array.prototype), { 1: "inherited" }),
  );
  for (const value of [sparse, inherited, new Array(2)]) {
    for (const mode of ["merge", "replace-keys", "replace-all"] as const) {
      const translator = new Translator();
      translator.setTranslation("retained", { en: "Old" });
      const events: unknown[] = [];
      translator.subscribeCatalog(event => events.push(event));
      const report = translator.importTranslations(bundle({ retained: { en: value } }), { mode });
      assert.ok(report.issues.some(issue => issue.code === "invalid-value"));
      if (mode !== "merge")
        assert.ok(report.issues.some(issue => issue.code === "destructive-import-aborted"));
      assert.equal(translator.translateKey("retained"), "Old");
      assert.deepEqual(events, []);
    }
  }
});

test("interpolation preserves escaped, nested, malformed semantics with linear suffix scanning", () => {
  const cases = [
    ["{{a}}", "{a}"],
    ["{{{a}}}", "{A}"],
    ["{bad {a}}", "{bad A}"],
    ["{a{a}", "{aA"],
    ["{} { a } {a!}", "{} { a } {a!}"],
    ["{unterminated {{a", "{unterminated {{a"],
    ["{{a", "{a"],
  ];
  for (const [input, expected] of cases) assert.equal(interpolate(input, { a: "A" }), expected);
  const input = "{a".repeat(200_000) + "}";
  assert.equal(interpolate(input, { a: "A" }), "{a".repeat(199_999) + "A");
  const translator = new Translator();
  translator.setTranslation("large", { en: input });
  assert.deepEqual(
    translateRichText(translator, "large", { allowedTags: [], values: { a: "A" } }),
    [{ type: "text", value: "{a".repeat(199_999) + "A" }],
  );
});

test("canonicalizes tags and uses progressive deterministic fallback", () => {
  const translator = new Translator({ language: "zh-Hant-TW", fallbackLanguage: "en-US" });
  translator.importTranslations(
    bundle({ greeting: { "zh-Hant": "您好", zh: "你好", en: "Hello", fi: "Hei" } }),
  );

  assert.equal(translator.getLanguage(), "zh-Hant-TW");
  assert.equal(translator.translateKey("greeting"), "您好");
  assert.equal(translator.translateKey("greeting", { language: "zh-CN" }), "你好");
});

test("falls back to any language by default and supports explicit missing text", () => {
  const permissive = new Translator({ language: "fi", fallbackLanguage: "en" });
  permissive.importTranslations(bundle({ onlyPortuguese: { pt: "Olá" } }));
  assert.equal(permissive.translateKey("onlyPortuguese"), "Olá");

  const strict = new Translator({
    language: "fi",
    fallbackLanguage: "en",
    fallbackToAnyLanguage: false,
    missingTranslationPolicy: "text",
    missingTranslationText: "MISSING",
  });
  strict.importTranslations(bundle({ onlyPortuguese: { pt: "Olá" } }));
  assert.equal(strict.translateKey("onlyPortuguese"), "MISSING");
});

test("imports raw text, replacements, arrays, and interpolation without HTML semantics", () => {
  const translator = new Translator();
  const report = translator.importTranslations(
    bundle({
      raw: {
        en: [
          "<strong>",
          "{name}",
          " & %YEAR%; literal {{name}}; set { a, b }; wrapped {{{name}}}",
          "</strong>",
        ],
      },
    }),
    { replacements: { "%YEAR%": 2026 } },
  );

  assert.deepEqual(report, {
    importedKeys: 1,
    importedValues: 1,
    importedLanguages: 0,
    issues: [],
  });
  assert.equal(
    translator.translateKey("raw", { values: { name: "<Ada>" } }),
    "<strong><Ada> & 2026; literal {name}; set { a, b }; wrapped {<Ada>}</strong>",
  );
});

test("reports malformed data and keeps intentional empty strings", () => {
  const translator = new Translator({ missingTranslationPolicy: "key" });
  const report = translator.importTranslations(
    bundle({
      blank: { en: "" },
      invalidBundle: "nope" as never,
      invalidValue: { en: 4 as never },
      invalidLanguage: { "": "bad" },
    }),
  );

  assert.equal(translator.translateKey("blank"), "");
  assert.equal(report.importedKeys, 1);
  assert.equal(report.issues.length, 3);
});

test("replace mode and returned snapshots do not expose mutable state", () => {
  const translator = new Translator();
  translator.importTranslations(bundle({ first: { en: "First" } }));
  const snapshot = translator.getTranslationData() as Map<string, Map<string, string>>;
  snapshot.get("first")?.set("en", "Changed");
  translator.importTranslations(bundle({ second: { en: "Second" } }), {
    mode: "replace-all",
  });

  assert.equal(translator.translateKey("first"), "");
  assert.equal(translator.translateKey("second"), "Second");
});

test("setTranslation replaces every language for one existing key", () => {
  const translator = new Translator({ language: "fi", fallbackLanguage: "en" });
  translator.setTranslation("greeting", { en: "Hello", fi: "Hei" });
  translator.setTranslation("greeting", { en: "Hi" });

  assert.equal(translator.translateKey("greeting"), "Hi");
  assert.equal(translator.getTranslationData().get("greeting")?.has("fi"), false);
});

test("setTranslation preserves existing data after an invalid replacement", () => {
  const translator = new Translator();
  translator.setTranslation("greeting", { en: "Hello" });

  const report = translator.setTranslation("greeting", { en: 4 as never });

  assert.ok(report.issues.some(issue => issue.code === "destructive-import-aborted"));
  assert.equal(translator.translateKey("greeting"), "Hello");
});

test("builds a large catalog through incremental replacement calls", () => {
  const translator = new Translator();
  for (let index = 0; index < 5_000; index++) {
    translator.setTranslation(`key.${index}`, { en: `Value ${index}`, fi: `Arvo ${index}` });
  }

  assert.equal(translator.getTranslationData().size, 5_000);
  assert.equal(translator.translateKey("key.0"), "Value 0");
  assert.equal(translator.translateKey("key.4999", { language: "fi" }), "Arvo 4999");
});

test("merge, replace-keys, and replace-all have distinct explicit semantics", () => {
  const translator = new Translator();
  translator.importTranslations(
    bundle({ greeting: { en: "Hello", fi: "Hei" }, retained: { en: "Retained" } }),
  );
  translator.importTranslations(bundle({ greeting: { fi: "Terve" } }));
  assert.deepEqual(Object.fromEntries(translator.getTranslationData().get("greeting")!), {
    en: "Hello",
    fi: "Terve",
  });

  translator.importTranslations(bundle({ greeting: { fi: "Moi" } }), {
    mode: "replace-keys",
  });
  assert.deepEqual(Object.fromEntries(translator.getTranslationData().get("greeting")!), {
    fi: "Moi",
  });
  assert.equal(translator.translateKey("retained"), "Retained");

  translator.importTranslations(bundle({ final: { en: "Final" } }), { mode: "replace-all" });
  assert.deepEqual([...translator.getTranslationData().keys()], ["final"]);
});

test("invalid replace-all input does not destroy valid existing translations", () => {
  const translator = new Translator();
  translator.importTranslations(bundle({ retained: { en: "Retained" } }));
  const report = translator.importTranslations(bundle({ broken: { en: 4 as never } }), {
    mode: "replace-all",
  });

  assert.equal(report.issues[0]?.code, "invalid-value");
  assert.equal(translator.translateKey("retained"), "Retained");
});

test("destructive imports with validation issues are rejected before data is removed", () => {
  const translator = new Translator();
  translator.importTranslations(bundle({ retained: { en: "Retained", fi: "Säilytetty" } }));

  for (const mode of ["replace-keys", "replace-all"] as const) {
    const report = translator.importTranslations(
      bundle({ retained: { en: "Changed" }, broken: { en: 4 as never } }),
      { mode },
    );
    assert.equal(report.importedKeys, 0);
    assert.equal(report.importedValues, 0);
    assert.ok(report.issues.some(issue => issue.code === "destructive-import-aborted"));
    assert.deepEqual(Object.fromEntries(translator.getTranslationData().get("retained")!), {
      en: "Retained",
      fi: "Säilytetty",
    });
  }

  const emptyTranslator = new Translator();
  const report = emptyTranslator.importTranslations(
    bundle({ valid: { en: "Valid" }, broken: { en: 4 as never } }),
    { mode: "replace-all" },
  );
  assert.equal(report.importedKeys, 1);
  assert.equal(emptyTranslator.translateKey("valid"), "Valid");
  assert.equal(
    report.issues.some(issue => issue.code === "destructive-import-aborted"),
    false,
  );
});

test("rejects unsupported import modes without changing translations", () => {
  const translator = new Translator();
  translator.importTranslations(bundle({ retained: { en: "Retained", fi: "Säilytetty" } }));

  assert.throws(
    () =>
      translator.importTranslations(bundle({ retained: { en: "Changed" } }), {
        mode: "invalid" as never,
      }),
    /unsupported translation import mode/,
  );
  assert.equal(translator.translateKey("retained", { language: "fi" }), "Säilytetty");
});

test("requires recognized namespaced data and supports one or more language bundles", () => {
  const translator = new Translator({ language: "fi" });
  const invalid = translator.importTranslations({ greeting: { en: "Hello" } });
  assert.equal(invalid.issues[0]?.code, "invalid-root");
  const oldFormat = translator.importTranslations({
    "translator-i18n-data": { greeting: { en: "Hello" } },
  });
  assert.equal(oldFormat.issues[0]?.code, "invalid-root");
  const missingData = translator.importTranslations({ "translator-i18n": { metadata: {} } });
  assert.equal(missingData.issues[0]?.code, "invalid-root");

  translator.importTranslations(
    languageBundle({
      en: { greeting: "Hello", fragments: ["One", " two"] },
      fi: { greeting: "Hei" },
    }),
  );

  assert.equal(translator.translateKey("greeting"), "Hei");
  assert.equal(translator.translateKey("fragments", { language: "en" }), "One two");
});

test("processes mixed bundle forms in namespace property order", () => {
  const translator = new Translator({ language: "fi" });
  const firstReport = translator.importTranslations({
    "translator-i18n": {
      "language-data": {
        fi: { greeting: "Language first", languageOnly: "Vain suomeksi" },
      },
      "multilingual-data": {
        greeting: { en: "Hello", fi: "Multilingual last" },
      },
    },
  });

  assert.deepEqual(firstReport, {
    importedKeys: 2,
    importedValues: 4,
    importedLanguages: 0,
    issues: [],
  });
  assert.equal(translator.translateKey("greeting"), "Multilingual last");
  assert.equal(translator.translateKey("languageOnly"), "Vain suomeksi");

  translator.importTranslations({
    "translator-i18n": {
      "multilingual-data": { greeting: { fi: "Multilingual first" } },
      "language-data": { fi: { greeting: "Language last" } },
    },
  });
  assert.equal(translator.translateKey("greeting"), "Language last");
});

test("reports malformed multilingual and language-oriented data independently", () => {
  const translator = new Translator();
  const malformedBundles = translator.importTranslations({
    "translator-i18n": {
      "multilingual-data": [],
      "language-data": null,
    },
  });
  assert.deepEqual(
    malformedBundles.issues.map(issue => issue.code),
    ["invalid-data-bundle", "invalid-data-bundle"],
  );

  const report = translator.importTranslations({
    "translator-i18n": {
      "multilingual-data": {
        valid: { en: "Valid" },
        invalidKey: "not a language map",
        invalidValue: { en: 1 },
      },
      "language-data": {
        fi: { valid: "Kelvollinen", invalidValue: ["valid", 2] },
        sv: "not a translation map",
        "": { invalidLanguage: "Invalid" },
      },
    },
  });

  assert.equal(translator.translateKey("valid", { language: "fi" }), "Kelvollinen");
  assert.deepEqual(
    report.issues.map(issue => issue.code),
    [
      "invalid-key-bundle",
      "invalid-value",
      "invalid-value",
      "invalid-language-bundle",
      "invalid-language",
    ],
  );
});

test("emits opt-in structured logs and ignores logger failures", () => {
  const entries: Array<{ event: string; level: string }> = [];
  const translator = new Translator({
    fallbackToAnyLanguage: false,
    logger: entry => entries.push({ event: entry.event, level: entry.level }),
  });
  translator.importTranslations(bundle({ greeting: { en: "Hello" } }));
  translator.translateKey("missing");
  assert.deepEqual(entries, [
    { event: "translation-imported", level: "debug" },
    { event: "missing-translation", level: "warn" },
  ]);

  translator.setLogger(() => {
    throw new Error("consumer logger failed");
  });
  assert.doesNotThrow(() => translator.translateKey("still-missing"));
});

test("subscriptions are symmetric and forced refreshes are explicit", () => {
  const translator = new Translator({ language: "en" });
  const events: string[] = [];
  const unsubscribe = translator.subscribe(event =>
    events.push(`${event.language}:${event.forced}`),
  );

  assert.equal(translator.setLanguage("en"), false);
  assert.equal(translator.setLanguage("en", { force: true }), true);
  assert.equal(translator.setLanguage("fi"), true);
  unsubscribe();
  translator.setLanguage("pt");
  assert.deepEqual(events, ["en:true", "fi:false"]);
});

test("validates, observes, imports, and copies explicit language direction", () => {
  const translator = new Translator();
  let changes = 0;
  translator.subscribeLanguages(() => changes++);
  translator.addLanguage({ code: "az_Arab", direction: "rtl" });
  translator.addLanguage({ code: "az-Arab", direction: "rtl" });
  assert.equal(changes, 1);
  assert.deepEqual(translator.getLanguages()[1], { code: "az-Arab", direction: "rtl" });
  assert.ok(Object.isFrozen(translator.getLanguages()[1]));
  translator.addLanguage({ code: "az-Arab", direction: "ltr" });
  assert.equal(changes, 2);
  for (const direction of ["auto", "RTL", "", null, 1]) {
    assert.throws(
      () => translator.addLanguage({ code: "ar", direction: direction as never }),
      /direction/,
    );
    const previous = translator.getLanguages();
    const report = translator.importTranslations(
      {
        "translator-i18n": {
          languages: { ar: { direction: direction as never } },
          "multilingual-data": {},
        },
      },
      { languageMode: "replace" },
    );
    assert.ok(report.issues.some(issue => issue.code === "invalid-language-metadata"));
    assert.ok(report.issues.some(issue => issue.code === "destructive-import-aborted"));
    assert.deepEqual(translator.getLanguages(), previous);
  }
  const report = translator.importTranslations({
    "translator-i18n": {
      languages: { "az-Arab": { direction: "rtl" }, "az-Latn": { direction: "ltr" }, ar: {} },
      "multilingual-data": {},
    },
  });
  assert.deepEqual(report.issues, []);
  assert.equal(changes, 3);
  assert.equal(translator.getLanguages().find(info => info.code === "ar")?.direction, undefined);
  const copy = new Translator();
  copy.copyFrom(translator);
  assert.deepEqual(copy.getLanguages(), translator.getLanguages());
  translator.addLanguage({ code: "az-Arab" });
  assert.equal(changes, 4);
  assert.equal(copy.getLanguages().find(info => info.code === "az-Arab")?.direction, "rtl");
  let copiedChanges = 0;
  copy.subscribeLanguages(() => copiedChanges++);
  copy.copyFrom(translator);
  assert.equal(copiedChanges, 1);
  assert.equal(copy.getLanguages().find(info => info.code === "az-Arab")?.direction, undefined);
  copy.copyFrom(translator);
  assert.equal(copiedChanges, 1);
});

test("language registry mutations are observable and independent of language state and catalogs", () => {
  const translator = new Translator({ language: "fi" });
  translator.importTranslations(bundle({ greeting: { en: "Hello", fi: "Hei" } }));
  const snapshots: string[][] = [];
  const unsubscribe = translator.subscribeLanguages(({ languages }) => {
    assert.ok(Object.isFrozen(languages));
    snapshots.push(languages.map(language => `${language.code}:${language.nativeName ?? ""}`));
  });

  assert.deepEqual(
    translator.getLanguages().map(language => language.code),
    ["en"],
  );
  translator.addLanguage({ code: "fi_FI", nativeName: "Suomi", englishName: "Finnish" });
  translator.addLanguage({ code: "fi-FI", nativeName: "Suomi" });
  assert.deepEqual(translator.getLanguages(), [
    { code: "en", nativeName: "English", englishName: "English" },
    { code: "fi-FI", nativeName: "Suomi" },
  ]);
  assert.ok(Object.isFrozen(translator.getLanguages()));
  assert.ok(Object.isFrozen(translator.getLanguages()[0]));

  assert.equal(translator.removeLanguage("fi_FI"), true);
  assert.equal(translator.removeLanguage("fi-FI"), false);
  assert.equal(translator.getLanguage(), "fi");
  assert.equal(translator.translateKey("greeting"), "Hei");
  translator.clearLanguages();
  assert.deepEqual(translator.getLanguages(), []);
  unsubscribe();
  translator.addLanguage({ code: "pt", nativeName: "Português" });

  assert.deepEqual(snapshots, [
    ["en:English", "fi-FI:Suomi"],
    ["en:English", "fi-FI:Suomi"],
    ["en:English"],
    [],
  ]);
});

test("registers code-only languages and finishes reentrant notifications with current state", () => {
  const translator = new Translator();
  const receivedByLaterListener: string[][] = [];
  let addNestedLanguage = true;
  translator.subscribeLanguages(() => {
    if (!addNestedLanguage) return;
    addNestedLanguage = false;
    translator.addLanguage({ code: "sv" });
  });
  translator.subscribeLanguages(({ languages }) => {
    receivedByLaterListener.push(languages.map(language => language.code));
  });

  translator.addLanguage({ code: "fi" });

  assert.deepEqual(translator.getLanguages(), [
    { code: "en", nativeName: "English", englishName: "English" },
    { code: "fi" },
    { code: "sv" },
  ]);
  assert.deepEqual(receivedByLaterListener, [
    ["en", "fi"],
    ["en", "fi", "sv"],
  ]);
});

test("imports optional language metadata with independent merge, replace, and ignore modes", () => {
  const translator = new Translator();
  const first = translator.importTranslations({
    "translator-i18n": {
      languages: {
        fi: { nativeName: "Suomi", englishName: "Finnish" },
        pt_BR: { nativeName: "Português" },
      },
      "multilingual-data": { greeting: { en: "Hello", fi: "Hei" } },
    },
  });
  assert.equal(first.importedLanguages, 2);
  assert.deepEqual(
    translator.getLanguages().map(language => language.code),
    ["en", "fi", "pt-BR"],
  );

  translator.importTranslations(
    {
      "translator-i18n": {
        languages: { sv: { nativeName: "Svenska" } },
        "multilingual-data": { greeting: { sv: "Hej" } },
      },
    },
    { languageMode: "replace" },
  );
  assert.deepEqual(translator.getLanguages(), [{ code: "sv", nativeName: "Svenska" }]);
  assert.equal(translator.translateKey("greeting", { language: "fi" }), "Hei");

  const ignored = translator.importTranslations(
    {
      "translator-i18n": {
        languages: [] as never,
        "multilingual-data": { farewell: { en: "Bye" } },
      },
    },
    { languageMode: "ignore" },
  );
  assert.equal(ignored.importedLanguages, 0);
  assert.deepEqual(ignored.issues, []);
  assert.deepEqual(translator.getLanguages(), [{ code: "sv", nativeName: "Svenska" }]);
  assert.equal(translator.translateKey("farewell"), "Bye");
});

test("rejects invalid language import modes and protects destructive registry imports", () => {
  const translator = new Translator();
  translator.addLanguage({ code: "fi", nativeName: "Suomi" });

  assert.throws(
    () => translator.importTranslations(bundle({}), { languageMode: "invalid" as never }),
    /unsupported language import mode/,
  );

  const report = translator.importTranslations(
    {
      "translator-i18n": {
        languages: {
          sv: { nativeName: "Svenska" },
          broken: { nativeName: 4 as never },
        },
        "multilingual-data": {},
      },
    },
    { languageMode: "replace" },
  );
  assert.ok(report.issues.some(issue => issue.code === "invalid-language-metadata"));
  assert.ok(report.issues.some(issue => issue.code === "destructive-import-aborted"));
  assert.deepEqual(
    translator.getLanguages().map(language => language.code),
    ["en", "fi"],
  );

  const translationOnly = translator.importTranslations(bundle({ broken: { en: 4 as never } }), {
    languageMode: "replace",
  });
  assert.equal(
    translationOnly.issues.some(issue => issue.code === "destructive-import-aborted"),
    false,
  );
  assert.deepEqual(
    translator.getLanguages().map(language => language.code),
    ["en", "fi"],
  );
});

test("isolates failing subscribers and validates public callback and language metadata", () => {
  const loggedEvents: string[] = [];
  const translator = new Translator({ logger: entry => loggedEvents.push(entry.event) });
  const updates: string[] = [];
  translator.subscribe(() => {
    throw new Error("listener failed");
  });
  translator.subscribe(event => updates.push(event.language));

  assert.equal(translator.setLanguage("fi"), true);
  assert.deepEqual(updates, ["fi"]);
  assert.ok(loggedEvents.includes("language-change-listener-failed"));
  assert.throws(() => translator.subscribe(null as never), /listener must be a function/);
  assert.throws(() => translator.subscribeLanguages(null as never), /listener must be a function/);
  assert.throws(
    () => translator.addLanguage({ code: "pt", nativeName: 123 as never }),
    /nativeName must be a string/,
  );
  assert.throws(
    () => translator.addLanguage({ code: "pt", englishName: 123 as never }),
    /englishName must be a string/,
  );
});

test("file loading preserves duplicate URL positions and rejects HTTP failures atomically", async () => {
  const requested: string[] = [];
  const translator = new Translator({
    fetch: async url => {
      requested.push(url);
      return {
        ok: true,
        json: async () => bundle({ [requested.length]: { en: url } }),
      };
    },
  });
  const reports = await translator.loadTranslationFiles(["same.json", "same.json"]);
  assert.equal(reports.length, 2);
  assert.deepEqual(requested, ["same.json", "same.json"]);

  translator.importTranslations(bundle({ retained: { en: "yes" } }));
  await assert.rejects(
    translator.loadTranslationFiles(["bad.json"], {
      mode: "replace-all",
      fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }),
    }),
  );
  assert.equal(translator.translateKey("retained"), "yes");
});

test("file loading merges both bundle forms in caller order", async () => {
  const translator = new Translator({ language: "fi" });
  const dataByUrl: Record<string, unknown> = {
    "multilingual.json": bundle({ greeting: { en: "Hello", fi: "Hei" } }),
    "language.json": languageBundle({ fi: { greeting: "Terve", extra: ["Lisä", "arvo"] } }),
  };

  const reports = await translator.loadTranslationFiles(["multilingual.json", "language.json"], {
    fetch: async url => ({ ok: true, json: async () => dataByUrl[url] }),
  });

  assert.equal(reports.length, 2);
  assert.equal(translator.translateKey("greeting"), "Terve");
  assert.equal(translator.translateKey("greeting", { language: "en" }), "Hello");
  assert.equal(translator.translateKey("extra"), "Lisäarvo");
});

test("file loading replaces the registry once and restores it after a later thrown import", async () => {
  const translator = new Translator();
  translator.addLanguage({ code: "fi", nativeName: "Suomi" });
  translator.importTranslations(bundle({ retained: { en: "Retained" } }));
  const first = {
    "translator-i18n": {
      languages: { sv: { nativeName: "Svenska" } },
      "multilingual-data": { first: { en: "First" } },
    },
  };
  const second = {
    "translator-i18n": {
      languages: { pt: { nativeName: "Português" } },
      "multilingual-data": { second: { en: "Second" } },
    },
  };

  await translator.loadTranslationFiles(["first.json", "second.json"], {
    languageMode: "replace",
    fetch: async url => ({ ok: true, json: async () => (url === "first.json" ? first : second) }),
  });
  assert.deepEqual(
    translator.getLanguages().map(language => language.code),
    ["sv", "pt"],
  );

  const brokenRoot = {} as Record<string, unknown>;
  Object.defineProperty(brokenRoot, "multilingual-data", {
    enumerable: true,
    get(): never {
      throw new Error("broken parsed object");
    },
  });
  await assert.rejects(
    translator.loadTranslationFiles(["first.json", "broken.json"], {
      mode: "replace-all",
      languageMode: "replace",
      fetch: async url => ({
        ok: true,
        json: async () => (url === "first.json" ? first : { "translator-i18n": brokenRoot }),
      }),
    }),
    /broken parsed object/,
  );
  assert.deepEqual(
    translator.getLanguages().map(language => language.code),
    ["sv", "pt"],
  );
  assert.equal(translator.translateKey("retained"), "Retained");
  assert.equal(translator.translateKey("second"), "Second");
});

test("import replacements insert dollar metacharacters literally", () => {
  const translator = new Translator();
  const replacement = "$& $$ $` $'";
  translator.importTranslations(bundle({ value: { en: "before TOKEN after" } }), {
    replacements: { TOKEN: replacement },
  });
  assert.equal(translator.translateKey("value"), `before ${replacement} after`);
});

test("brace escapes decode with absent, empty, and populated lookup values", () => {
  const translator = new Translator();
  translator.setTranslation("value", { en: "{{name}} {{{name}}} {name} { a, b }" });
  const unresolved = "{name} {{name}} {name} { a, b }";
  assert.equal(translator.translateKey("value"), unresolved);
  assert.equal(translator.translateKey("value", { values: {} }), unresolved);
  assert.equal(translator.translateKey("value", { values: { name: null } }), "{name} {}  { a, b }");
  assert.equal(
    translator.translateKey("value", { values: { name: "Ada" } }),
    "{name} {Ada} Ada { a, b }",
  );
});

test("raw lookup defers both interpolation and brace decoding to downstream parsers", () => {
  const translator = new Translator();
  translator.setTranslation("value", { en: "{{name}} {name}" });
  assert.equal(
    translator.translateKey("value", { interpolate: false, values: { name: "Ada" } }),
    "{{name}} {name}",
  );
  translator.setTranslation("arbitrary", { fi: "{{name}} {name}" });
  assert.equal(translator.translateKey("arbitrary", { interpolate: false }), "{{name}} {name}");
  assert.throws(() => translator.translateKey("value", { interpolate: "no" as never }), TypeError);
});

test("language changes queue every nested transition FIFO with matching active state", () => {
  const translator = new Translator();
  const seen: Array<[string, string, boolean, string]> = [];
  translator.subscribe(event => {
    if (event.language !== "fi") return;
    assert.equal(translator.setLanguage("sv"), true);
    assert.equal(translator.setLanguage("sv"), false);
    assert.equal(translator.setLanguage("pt"), true);
    assert.equal(translator.setLanguage("pt", { force: true }), true);
    assert.equal(translator.getLanguage(), "fi");
    throw new Error("subscriber failure must not discard queued transitions");
  });
  translator.subscribe(event =>
    seen.push([event.previousLanguage, event.language, event.forced, translator.getLanguage()]),
  );
  translator.setLanguage("fi");
  assert.deepEqual(seen, [
    ["en", "fi", false, "fi"],
    ["fi", "sv", false, "sv"],
    ["sv", "pt", false, "pt"],
    ["pt", "pt", true, "pt"],
  ]);
  assert.equal(translator.getLanguage(), "pt");
});

test("event wrappers cannot be changed by earlier subscribers", () => {
  const translator = new Translator();
  let languageEvent!: LanguageChangeEvent;
  let registryEvent!: LanguageRegistryChangeEvent;
  const mutationResults: boolean[] = [];
  const received: unknown[] = [];
  translator.subscribe(event => {
    languageEvent = event;
    mutationResults.push(Reflect.set(event, "language", "corrupted"));
  });
  translator.subscribe(event => received.push(event.language));
  translator.subscribeLanguages(event => {
    registryEvent = event;
    mutationResults.push(Reflect.set(event, "languages", []));
  });
  translator.subscribeLanguages(event => received.push(event.languages.length));
  translator.setLanguage("fi");
  translator.addLanguage({ code: "fi" });
  assert.deepEqual(mutationResults, [false, false]);
  assert.deepEqual(received, ["fi", 2]);
  assert.ok(Object.isFrozen(languageEvent));
  assert.ok(Object.isFrozen(registryEvent));
});

test("logger receives detached frozen import details without freezing the returned report", () => {
  let entry: Readonly<TranslatorLogEntry> | undefined;
  let mutationSucceeded: boolean | undefined;
  const translator = new Translator({
    logger: value => {
      entry = value;
      const issues = value.details?.issues as unknown[];
      mutationSucceeded = Reflect.set(issues, "length", 0);
      throw new Error("logger failure");
    },
  });
  const report = translator.importTranslations(bundle({ bad: { en: 4 } }));
  assert.equal(mutationSucceeded, false);
  assert.ok(Object.isFrozen(entry));
  assert.ok(Object.isFrozen(entry?.details));
  const loggedIssues = entry?.details?.issues as unknown[];
  assert.ok(Object.isFrozen(loggedIssues));
  assert.ok(Object.isFrozen(loggedIssues[0]));
  assert.equal(report.issues.length, 1);
  assert.notEqual(entry?.details?.issues, report.issues);
  report.issues.length = 0;
  assert.equal((entry?.details?.issues as unknown[]).length, 1);
});

test("logger preserves the original error identity", () => {
  const error = new Error("subscriber failure");
  let logged: unknown;
  const translator = new Translator({
    logger: entry => {
      logged = entry.error;
    },
  });
  translator.subscribe(() => {
    throw error;
  });
  translator.setLanguage("fi");
  assert.equal(logged, error);
  assert.equal(Object.isFrozen(error), false);
});

test("observes rejected subscriber and logger promises without delaying later callbacks", async () => {
  const languageError = new Error("async language failure");
  const registryError = new Error("async registry failure");
  const entries: Readonly<TranslatorLogEntry>[] = [];
  const calls: string[] = [];
  const translator = new Translator({
    logger: async entry => {
      entries.push(entry);
      await Promise.resolve();
      throw new Error("async logger failure");
    },
  });
  translator.subscribe(async () => {
    await Promise.resolve();
    throw languageError;
  });
  translator.subscribe(() => {
    calls.push("language");
  });
  translator.subscribeLanguages(async () => {
    await Promise.resolve();
    throw registryError;
  });
  translator.subscribeLanguages(() => {
    calls.push("registry");
  });
  translator.setLanguage("fi");
  translator.addLanguage({ code: "fi" });
  translator.setTranslation("value", { fi: "Value" });
  assert.deepEqual(calls, ["language", "registry"]);
  assert.equal(translator.translateKey("value"), "Value");
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(
    entries.find(entry => entry.event === "language-change-listener-failed")?.error,
    languageError,
  );
  assert.equal(
    entries.find(entry => entry.event === "language-registry-listener-failed")?.error,
    registryError,
  );
});

test("observes foreign thenables and throwing then getters from callbacks", async () => {
  const thenError = new Error("then getter failure");
  const foreignError = new Error("foreign promise failure");
  const entries: Readonly<TranslatorLogEntry>[] = [];
  const translator = new Translator({
    logger: () => ({
      get then() {
        throw thenError;
      },
    }),
  });
  // Non-native callback results must be assimilated rather than checked with instanceof Promise.
  translator.setTranslation("value", { en: "Value" });
  translator.setLogger(entry => {
    entries.push(entry);
  });
  translator.subscribe(() => ({
    get then() {
      throw thenError;
    },
  }));
  translator.subscribeLanguages(() =>
    runInNewContext("Promise.reject(error)", { error: foreignError }),
  );
  translator.setLanguage("fi");
  translator.addLanguage({ code: "fi" });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(
    entries.find(entry => entry.event === "language-change-listener-failed")?.error,
    thenError,
  );
  assert.equal(
    entries.find(entry => entry.event === "language-registry-listener-failed")?.error,
    foreignError,
  );
});

test("both bundle orientations reject empty keys and guard destructive imports", () => {
  for (const data of [
    bundle({ "": { en: "bad" }, good: { en: "good" } }),
    languageBundle({ en: { "": "bad", good: "good" } }),
  ]) {
    const translator = new Translator();
    const report = translator.importTranslations(data);
    assert.equal(report.importedKeys, 1);
    assert.equal(report.importedValues, 1);
    assert.equal(report.issues[0]?.code, "invalid-key");
    assert.equal(translator.getTranslationData().has(""), false);
    translator.setTranslation("retained", { en: "old" });
    const rejected = translator.importTranslations(data, { mode: "replace-all" });
    assert.ok(rejected.issues.some(issue => issue.code === "destructive-import-aborted"));
    assert.equal(translator.translateKey("retained"), "old");
    assert.throws(() => translator.setTranslation("", { en: "bad" }), /non-empty string/);
  }
});

test("setTranslation supports cross-realm and structural ReadonlyMaps without retaining them", () => {
  const foreign = runInNewContext('new Map([["en", "foreign"]])') as Map<string, string>;
  const map = new Map([["en", "structural"]]);
  const structural: ReadonlyMap<string, string> = {
    size: map.size,
    get: map.get.bind(map),
    has: map.has.bind(map),
    entries: map.entries.bind(map),
    keys: map.keys.bind(map),
    values: map.values.bind(map),
    forEach: map.forEach.bind(map),
    [Symbol.iterator]: map[Symbol.iterator].bind(map),
  };
  const translator = new Translator();
  assert.deepEqual(translator.setTranslation("foreign", foreign).issues, []);
  assert.deepEqual(translator.setTranslation("structural", structural).issues, []);
  foreign.set("en", "mutated");
  map.set("en", "mutated");
  assert.equal(translator.translateKey("foreign"), "foreign");
  assert.equal(translator.translateKey("structural"), "structural");
});

test("unsupported direct-update input throws before it can delete an existing key", () => {
  const translator = new Translator();
  translator.setTranslation("retained", { en: "old" });
  for (const input of [null, undefined, [], new Set(), new Date(), 4, "text"]) {
    assert.throws(() => translator.setTranslation("retained", input as never), TypeError);
    assert.equal(translator.translateKey("retained"), "old");
  }
  const malformed = { entries: () => [[4, "bad"]], get: () => undefined, has: () => false };
  assert.throws(() => translator.setTranslation("retained", malformed as never), TypeError);
  assert.equal(translator.translateKey("retained"), "old");
});

test("invalid constructor and setter options throw without changing existing state", () => {
  for (const options of [
    null,
    [],
    { language: null },
    { language: 4 },
    { fallbackLanguage: null },
    { missingTranslationPolicy: "typo" },
    { missingTranslationPolicy: null },
    { missingTranslationText: 4 },
    { missingTranslationText: null },
    { fallbackToAnyLanguage: "yes" },
    { fallbackToAnyLanguage: null },
    { logger: null },
    { fetch: {} },
  ])
    assert.throws(() => new Translator(options as never), TypeError);
  const translator = new Translator({
    missingTranslationPolicy: "text",
    missingTranslationText: "old",
  });
  assert.throws(() => translator.setMissingTranslationPolicy("typo" as never), TypeError);
  assert.throws(() => translator.setMissingTranslationText(4 as never), TypeError);
  assert.throws(() => translator.setLanguage("fi", { force: "yes" as never }), TypeError);
  assert.throws(() => translator.setFallbackLanguage(4 as never), TypeError);
  assert.throws(() => translator.setLogger({} as never), TypeError);
  assert.equal(translator.translateKey("missing"), "old");
  assert.equal(translator.getLanguage(), "en");
  assert.equal(translator.getFallbackLanguage(), "en");
  for (const options of [
    { mode: null },
    { languageMode: null },
    { replacements: [] },
    { replacements: { token: {} } },
  ]) {
    assert.throws(() => translator.importTranslations(bundle({}), options as never), TypeError);
  }
});

test("loader snapshots options, URLs, replacements, fetch, and signal before awaiting", async () => {
  let resolveJson!: (value: unknown) => void;
  const json = new Promise<unknown>(resolve => {
    resolveJson = resolve;
  });
  const originalSignal = new AbortController().signal;
  const requested: string[] = [];
  const replacements = { TOKEN: "original" };
  const options: TranslationLoadOptions = {
    mode: "merge",
    languageMode: "merge",
    replacements,
    signal: originalSignal,
    fetch: async (url, init) => {
      requested.push(url);
      assert.equal(init?.signal, originalSignal);
      return { json: async () => json };
    },
  };
  const translator = new Translator();
  translator.setTranslation("retained", { en: "old" });
  const urls = ["original.json"];
  const loading = translator.loadTranslationFiles(urls, options);
  options.mode = "replace-all";
  options.languageMode = "replace";
  replacements.TOKEN = "mutated";
  options.replacements = { TOKEN: "changed" };
  options.signal = new AbortController().signal;
  options.fetch = async () => {
    throw new Error("changed fetch");
  };
  urls[0] = "changed.json";
  resolveJson({
    "translator-i18n": { languages: { fi: {} }, "multilingual-data": { value: { en: "TOKEN" } } },
  });
  await loading;
  assert.deepEqual(requested, ["original.json"]);
  assert.equal(translator.translateKey("value"), "original");
  assert.equal(translator.translateKey("retained"), "old");
  assert.deepEqual(
    translator.getLanguages().map(language => language.code),
    ["en", "fi"],
  );
});

test("loader commits all files before callbacks and preserves callback writes", async () => {
  const observed: string[][] = [];
  const registries: string[][] = [];
  const translator = new Translator({
    logger: entry => {
      if (entry.event !== "translation-imported") return;
      observed.push([...translator.getTranslationData().keys()]);
      translator.setMissingTranslationText("logger ran");
    },
  });
  translator.subscribeLanguages(event => {
    registries.push(event.languages.map(language => language.code));
    assert.deepEqual(
      event.languages.map(language => language.code),
      ["fi", "sv"],
    );
    assert.equal(translator.translateKey("first"), "first");
    assert.equal(translator.translateKey("second"), "second");
    translator.setTranslation("callback", { en: "retained" });
  });
  await translator.loadTranslationFiles(["first", "second"], {
    mode: "replace-all",
    languageMode: "replace",
    fetch: async url => ({
      json: async () => ({
        "translator-i18n": {
          languages: { [url === "first" ? "fi" : "sv"]: {} },
          "multilingual-data": { [url]: { en: url } },
        },
      }),
    }),
  });
  assert.equal(translator.translateKey("callback"), "retained");
  assert.deepEqual(registries, [["fi", "sv"]]);
  assert.ok(observed.length >= 2);
  assert.ok(observed.every(keys => keys.includes("first") && keys.includes("second")));
});

test("thrown staged imports emit no temporary notifications or logs and preserve live state", async () => {
  const notifications: unknown[] = [];
  const translator = new Translator();
  translator.setTranslation("old", { en: "old" });
  translator.subscribeLanguages(event => {
    notifications.push(event);
    translator.setTranslation("callback", { en: "must never run" });
  });
  translator.setLogger(entry => notifications.push(entry));
  const broken: Record<string, unknown> = {};
  Object.defineProperty(broken, "multilingual-data", {
    enumerable: true,
    get() {
      throw new Error("broken import");
    },
  });
  await assert.rejects(
    translator.loadTranslationFiles(["first", "broken"], {
      mode: "replace-all",
      languageMode: "replace",
      fetch: async url => ({
        json: async () =>
          url === "first"
            ? {
                "translator-i18n": {
                  languages: { fi: {} },
                  "multilingual-data": { first: { en: "first" } },
                },
              }
            : { "translator-i18n": broken },
      }),
    }),
    /broken import/,
  );
  assert.deepEqual(notifications, []);
  assert.equal(translator.translateKey("old"), "old");
  assert.equal(translator.getTranslationData().has("first"), false);
  assert.equal(translator.getTranslationData().has("callback"), false);
  assert.deepEqual(
    translator.getLanguages().map(language => language.code),
    ["en"],
  );
});

test("loader validation issues remain report data and only the first file replaces", async () => {
  const translator = new Translator();
  translator.setTranslation("old", { en: "old" });
  const reports = await translator.loadTranslationFiles(["first", "second"], {
    mode: "replace-all",
    languageMode: "replace",
    fetch: async url => ({
      json: async () =>
        url === "first"
          ? {
              "translator-i18n": {
                languages: { fi: {} },
                "multilingual-data": { first: { en: "first" } },
              },
            }
          : {
              "translator-i18n": {
                languages: { sv: {} },
                "multilingual-data": { second: { en: "second" }, bad: { en: 4 } },
              },
            },
    }),
  });
  assert.equal(reports[1]?.issues[0]?.code, "invalid-value");
  assert.deepEqual([...translator.getTranslationData().keys()], ["first", "second"]);
  assert.deepEqual(
    translator.getLanguages().map(language => language.code),
    ["fi", "sv"],
  );
});

test("loader rejects programmer options before starting requests", async () => {
  const translator = new Translator();
  let requested = false;
  const fetch = async () => {
    requested = true;
    return { json: async () => bundle({}) };
  };
  for (const options of [
    { mode: "invalid" },
    { replacements: { TOKEN: {} } },
    { signal: {} },
    { fetch: {} },
  ]) {
    await assert.rejects(
      translator.loadTranslationFiles(["file"], { fetch, ...options } as never),
      TypeError,
    );
  }
  assert.equal(requested, false);
});

test("core types compile without ambient types and retain native abort/fetch compatibility", async () => {
  const directory = await mkdtemp(join(tmpdir(), "translator-core-types-"));
  const types = fileURLToPath(new URL("../src/types.ts", import.meta.url));
  const index = fileURLToPath(new URL("../src/index.ts", import.meta.url));
  const compiler = resolve(
    dirname(fileURLToPath(import.meta.resolve("typescript/package.json"))),
    "bin/tsc",
  );
  try {
    const imports = `import type { TranslationAbortSignal, TranslatorFetch, LanguageChangeEvent, LanguageRegistryChangeEvent } from ${JSON.stringify(types)};\nimport { Translator } from ${JSON.stringify(index)};\n`;
    await writeFile(
      join(directory, "clean.ts"),
      `${imports}
      declare const signal: TranslationAbortSignal;
      new Translator().loadTranslationFiles([], { signal });
      declare const event: LanguageChangeEvent;
      // @ts-expect-error Events are immutable.
      event.language = "fi";
      declare const registry: LanguageRegistryChangeEvent;
      // @ts-expect-error Registry event wrappers are immutable.
      registry.languages = [];
    `,
    );
    await writeFile(
      join(directory, "native.ts"),
      `${imports}
      const signal: TranslationAbortSignal = new AbortController().signal;
      const nativeSignal: AbortSignal = signal;
      const nativeFetch: TranslatorFetch = fetch;
      new Translator({ fetch }).loadTranslationFiles([], { fetch, signal });
      const wrapper: TranslatorFetch = (input, init) => fetch(input, init);
    `,
    );
    for (const [name, lib] of [
      ["clean", ["ES2022"]],
      ["native", ["ES2022", "DOM"]],
    ] as const) {
      const config = join(directory, `${name}.json`);
      await writeFile(
        config,
        JSON.stringify({
          compilerOptions: {
            strict: true,
            noEmit: true,
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "Bundler",
            allowImportingTsExtensions: true,
            types: [],
            lib,
          },
          files: [`${name}.ts`],
        }),
      );
      try {
        execFileSync(process.execPath, [compiler, "-p", config], { stdio: "pipe" });
      } catch (error) {
        const failure = error as { stdout?: Buffer; stderr?: Buffer };
        assert.fail(`${failure.stdout ?? ""}${failure.stderr ?? ""}`);
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
