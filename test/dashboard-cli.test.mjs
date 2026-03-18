import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { listReports, showReport } from "../scripts/dashboard-cli.mjs";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

test("01 listReports collects and sorts report json files", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-cli-"));
  const logsDir = path.join(tmpDir, "logs");
  const outputDir = path.join(tmpDir, "output");
  fs.mkdirSync(logsDir, { recursive: true });
  fs.mkdirSync(outputDir, { recursive: true });

  writeJson(path.join(logsDir, "a-result.json"), {
    generatedAt: "2026-03-05T10:00:00.000Z",
    decision: "GO"
  });
  writeJson(path.join(outputDir, "b-result.json"), {
    generatedAt: "2026-03-05T11:00:00.000Z",
    decision: "NO_GO"
  });

  const result = listReports({
    cwd: tmpDir,
    directories: ["logs", "output"],
    limit: 10
  });

  assert.equal(result.total, 2);
  assert.equal(result.rows[0].id, "b-result");
  assert.equal(result.rows[1].id, "a-result");
});

test("02 listReports skips malformed json and returns warning", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-cli-"));
  const logsDir = path.join(tmpDir, "logs");
  fs.mkdirSync(logsDir, { recursive: true });

  fs.writeFileSync(path.join(logsDir, "broken.json"), "{ bad", "utf8");

  const result = listReports({
    cwd: tmpDir,
    directories: ["logs"]
  });

  assert.equal(result.total, 0);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /Skipped invalid JSON/);
});

test("03 showReport loads report by id", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-cli-"));
  const logsDir = path.join(tmpDir, "logs");
  fs.mkdirSync(logsDir, { recursive: true });

  writeJson(path.join(logsDir, "sample-report.json"), {
    generatedAt: "2026-03-05T12:00:00.000Z",
    decision: "GO"
  });

  const result = showReport({
    cwd: tmpDir,
    directories: ["logs"],
    idOrPath: "sample-report"
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.decision, "GO");
});

test("04 showReport returns not found for missing id", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-cli-"));
  const result = showReport({
    cwd: tmpDir,
    directories: ["logs"],
    idOrPath: "missing"
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /Report not found/);
});

test("05 CLI list and show commands work", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-cli-"));
  const logsDir = path.join(tmpDir, "logs");
  fs.mkdirSync(logsDir, { recursive: true });

  writeJson(path.join(logsDir, "cli-report.json"), {
    generatedAt: "2026-03-05T12:30:00.000Z",
    decision: "GO"
  });

  const list = spawnSync(process.execPath, ["scripts/dashboard-cli.mjs", "list", "--dir", logsDir], {
    cwd: ROOT_DIR,
    encoding: "utf8"
  });

  assert.equal(list.status, 0);
  assert.match(list.stdout, /cli-report/);

  const show = spawnSync(
    process.execPath,
    ["scripts/dashboard-cli.mjs", "show", "--id", "cli-report", "--dir", logsDir],
    {
      cwd: ROOT_DIR,
      encoding: "utf8"
    }
  );

  assert.equal(show.status, 0);
  assert.match(show.stdout, /"decision": "GO"/);
});

test("06 CLI show returns non-zero when report is missing", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-cli-"));
  const logsDir = path.join(tmpDir, "logs");
  fs.mkdirSync(logsDir, { recursive: true });

  const result = spawnSync(
    process.execPath,
    ["scripts/dashboard-cli.mjs", "show", "--id", "missing", "--dir", logsDir],
    {
      cwd: ROOT_DIR,
      encoding: "utf8"
    }
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Report not found/);
});
