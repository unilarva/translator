// SPDX-FileCopyrightText: 2020-2026 Lari Natri <lari.natri@iki.fi>
// SPDX-License-Identifier: Apache-2.0

/**
 * Package-private tests for standalone CI and checksum-verified release artifacts.
 * @packageDocumentation
 * @module release.test
 * @author Lari Natri
 */

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const github = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
const gitlab = readFileSync(new URL("../.gitlab-ci.yml", import.meta.url), "utf8");

test("release publishers are isolated, tokenless, and mutually opt-in", () => {
  const githubPublish = github.split("\n  publish:\n")[1]!;
  const gitlabPublish = gitlab.split("\npublish:\n")[1]!;
  assert.match(github, /tags:\s+- "v\*"/);
  assert.match(githubPublish, /needs: \[validate-minimum, qualify\]/);
  assert.match(githubPublish, /github\.ref_protected/);
  assert.match(githubPublish, /id-token: write/);
  assert.match(githubPublish, /name: npm/);
  assert.match(githubPublish, /vars\.TRANSLATOR_PUBLISH_PROVIDER == 'github'/);
  assert.match(githubPublish, /github\.repository == 'unilarva\/translator'/);
  assert.doesNotMatch(githubPublish, /actions\/checkout|npm ci|npm run build/);
  assert.match(gitlabPublish, /job: candidate\s+artifacts: true/);
  assert.match(gitlabPublish, /GIT_STRATEGY: empty/);
  assert.match(gitlabPublish, /name: npm/);
  assert.match(gitlabPublish, /saas-linux-small-amd64/);
  assert.match(gitlabPublish, /aud: npm:registry\.npmjs\.org/);
  assert.match(gitlabPublish, /aud: sigstore/);
  assert.match(gitlabPublish, /CI_COMMIT_REF_PROTECTED == "true"/);
  assert.match(gitlabPublish, /TRANSLATOR_PUBLISH_PROVIDER == "gitlab"/);
  assert.match(gitlabPublish, /when: manual\s+allow_failure: false/);
  for (const workflow of [github, gitlab]) {
    assert.match(workflow, /npm pack --workspaces=false --pack-destination/);
    assert.doesNotMatch(workflow, /NODE_AUTH_TOKEN|NPM_TOKEN|npm whoami|npm pack --ignore-scripts/);
    assert.match(
      workflow,
      /npm publish .*--access public --provenance .*--registry=https:\/\/registry\.npmjs\.org\//,
    );
  }
  for (const match of github.matchAll(/uses: (\S+)/g)) {
    assert.match(match[1]!, /@[a-f0-9]{40}$/);
  }
});

test("CI qualifies both the minimum runtime and the release runtime", () => {
  const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  assert.match(ci, /node: \[22\.13\.0, 24\]/);
  assert.match(ci, /npm run validate/);
  assert.match(ci, /npm pack --workspaces=false/);
  assert.match(github, /validate-minimum:[\s\S]*node-version: 22\.13\.0[\s\S]*npm run validate/);
  assert.match(gitlab, /NODE_VERSION: \["22\.13\.0", "24"\]/);
  assert.match(gitlab, /npm run validate/);
});

test("all CI and release jobs install the same pinned npm before package operations", () => {
  const ci = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const install = "npm install --global npm@11.15.0 --ignore-scripts";
  for (const workflow of [ci, github]) {
    const jobs = workflow
      .split("\njobs:\n")[1]!
      .split(/^  [\w-]+:\n/gm)
      .slice(1);
    assert.ok(jobs.length > 0);
    for (const job of jobs) {
      assert.ok(job.includes(install), "Each GitHub job must explicitly install pinned npm");
      assert.ok(
        job.indexOf("actions/setup-node@") < job.indexOf(install),
        "Install npm after selecting Node",
      );
      assert.match(job, /npm install --global npm@11\.15\.0 --ignore-scripts\n/);
      for (const operation of ["npm ci", "npm pack", "npm publish", "npm run validate"]) {
        if (job.includes(operation)) assert.ok(job.indexOf(install) < job.indexOf(operation));
      }
    }
  }
  assert.match(
    gitlab,
    /default:[\s\S]*?before_script:\n    - npm install --global npm@11\.15\.0 --ignore-scripts\n    - npm ci/,
  );
  const gitlabPublish = gitlab.split("\npublish:\n")[1]!;
  assert.match(
    gitlabPublish,
    /before_script:\n    - npm install --global npm@11\.15\.0 --ignore-scripts/,
  );
  assert.doesNotMatch(gitlabPublish, /npm ci|npm run build/);
});

test("standalone lockfile matches package release metadata", () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const lock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
  assert.equal(lock.name, manifest.name);
  assert.equal(lock.version, manifest.version);
  assert.equal(lock.packages[""].name, manifest.name);
  assert.equal(lock.packages[""].version, manifest.version);
  assert.deepEqual(lock.packages[""].devDependencies, manifest.devDependencies);
  assert.equal(manifest.repository.type, "git");
  assert.match(manifest.repository.url, /^git\+https:\/\//);
  assert.equal(manifest.publishConfig.access, "public");
  assert.equal(manifest.publishConfig.provenance, true);
});

// Execute the actual artifact-verification blocks, stopping before publication.
const verificationScripts = {
  github: github
    .split("      - name: Verify and publish exact candidate\n")[1]!
    .split("        run: |\n")[1]!
    .split("          npm publish ")[0]!
    .replace(/^ {10}/gm, ""),
  gitlab: gitlab
    .split("\npublish:\n")[1]!
    .split("  script:\n    - |\n")[1]!
    .split("      npm publish ")[0]!
    .replace(/^ {6}/gm, ""),
};

for (const [provider, script] of Object.entries(verificationScripts)) {
  test(`${provider} verifies the exact candidate before publishing`, async t => {
    assert.match(script, /sha256sum --check/);
    assert.match(script, /tar -xOf/);
    assert.doesNotMatch(script, /npm publish/);
    for (const scenario of [
      "valid",
      "corrupt",
      "wrong-tag",
      "wrong-name",
      "multiple",
      "missing",
      "missing-checksum",
      "extra-checksum",
      "old-npm",
    ]) {
      await t.test(scenario, () => {
        const temporary = mkdtempSync(join(tmpdir(), "translator-release-test-"));
        try {
          const candidate = join(temporary, "candidate");
          const fixture = join(temporary, "fixture");
          const bin = join(temporary, "bin");
          mkdirSync(candidate);
          mkdirSync(join(fixture, "package"), { recursive: true });
          mkdirSync(bin);
          writeFileSync(
            join(bin, "npm"),
            `#!/bin/sh\n[ "$1" = "--version" ] || exit 64\nprintf '%s\\n' '${scenario === "old-npm" ? "10.9.0" : "11.15.0"}'\n`,
            { mode: 0o755 },
          );
          writeFileSync(
            join(fixture, "package", "package.json"),
            JSON.stringify({
              name: scenario === "wrong-name" ? "@other/package" : "@unilarva/translator",
              version: "0.2.0",
            }),
          );
          const tarball = join(candidate, "translator.tgz");
          if (scenario !== "missing") {
            execFileSync("tar", ["-czf", tarball, "-C", fixture, "package"]);
            const checksum = createHash("sha256").update(readFileSync(tarball)).digest("hex");
            writeFileSync(`${tarball}.sha256`, `${checksum}  translator.tgz\n`);
            if (scenario === "corrupt") writeFileSync(tarball, "corrupted");
            if (scenario === "multiple") writeFileSync(join(candidate, "extra.tgz"), "extra");
            if (scenario === "missing-checksum") rmSync(`${tarball}.sha256`);
            if (scenario === "extra-checksum")
              writeFileSync(join(candidate, "extra.sha256"), "extra");
          }
          const result = spawnSync("bash", ["-euo", "pipefail", "-c", script], {
            cwd: temporary,
            encoding: "utf8",
            env: {
              ...process.env,
              PATH: `${bin}:${process.env.PATH}`,
              RUNNER_TEMP: temporary,
              CI_PROJECT_DIR: temporary,
              CI_COMMIT_TAG: scenario === "wrong-tag" ? "v0.3.0" : "v0.2.0",
              RELEASE_TAG: scenario === "wrong-tag" ? "v0.3.0" : "v0.2.0",
            },
          });
          assert.ifError(result.error);
          if (scenario === "valid") assert.equal(result.status, 0, result.stderr);
          else assert.notEqual(result.status, 0, `${scenario} candidate must be rejected`);
        } finally {
          rmSync(temporary, { recursive: true, force: true });
        }
      });
    }
  });
}
