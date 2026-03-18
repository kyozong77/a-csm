import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { scanTextForSecrets, scanWorkspace } from "../scripts/security-scan.mjs";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GITLAB_PAT_SAMPLE = "glpat-" + "abcdefghijklmnopqrstuvwxyz012345";
const GENERIC_API_KEY_SAMPLE = "api_key=" + "abcdefghijklmnop123456";
const GENERIC_SECRET_SAMPLE = "secret=" + "abcdefghijklmnopqrstuvwxyz012345";

test("01 detects GitLab PAT in text", () => {
  const findings = scanTextForSecrets(`token=${GITLAB_PAT_SAMPLE}`);
  assert.equal(findings.length > 0, true);
  assert.equal(findings.some((item) => item.ruleId === "gitlab-pat"), true);
});

test("02 detects private key header", () => {
  const findings = scanTextForSecrets("-----BEGIN PRIVATE KEY-----");
  assert.equal(findings.length > 0, true);
  assert.equal(findings[0].ruleId, "private-key-header");
});

test("03 scanWorkspace ignores excluded directories", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "security-scan-"));
  const logsDir = path.join(tmpDir, "logs");
  const srcDir = path.join(tmpDir, "src");
  fs.mkdirSync(logsDir, { recursive: true });
  fs.mkdirSync(srcDir, { recursive: true });

  fs.writeFileSync(path.join(logsDir, "should-ignore.txt"), `token=${GITLAB_PAT_SAMPLE}`, "utf8");
  fs.writeFileSync(path.join(srcDir, "scan-me.txt"), GENERIC_API_KEY_SAMPLE, "utf8");

  const findings = scanWorkspace(tmpDir);
  assert.equal(findings.length, 1);
  assert.match(findings[0].file, /scan-me\.txt/);
});

test("04 CLI exits 1 when finding exists", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "security-scan-"));
  fs.writeFileSync(path.join(tmpDir, "demo.txt"), GENERIC_SECRET_SAMPLE, "utf8");

  const cli = spawnSync(process.execPath, ["scripts/security-scan.mjs", tmpDir], {
    cwd: ROOT_DIR,
    encoding: "utf8"
  });

  assert.equal(cli.status, 1);
  assert.match(cli.stdout, /Secret findings/);
});

test("05 CLI exits 0 when no findings", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "security-scan-"));
  fs.writeFileSync(path.join(tmpDir, "clean.txt"), "hello world", "utf8");

  const cli = spawnSync(process.execPath, ["scripts/security-scan.mjs", tmpDir], {
    cwd: ROOT_DIR,
    encoding: "utf8"
  });

  assert.equal(cli.status, 0);
  assert.match(cli.stdout, /No secret findings/);
});
