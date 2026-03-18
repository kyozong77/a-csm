import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  buildPilotStudyConfig,
  buildValidationFramework,
  confusionMatrix2x2,
  descriptiveStats,
  evaluateValidationStages,
  validatePilotStudyConfig
} from "../scripts/validation-framework.mjs";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("01 buildValidationFramework returns five stages", () => {
  const framework = buildValidationFramework();
  assert.equal(framework.stages.length, 5);
  assert.equal(framework.pilot_study.total_conversations, 100);
});

test("02 pilot study validation fails on mismatched distribution", () => {
  const config = buildPilotStudyConfig({
    total_conversations: 100,
    source_distribution: {
      sharegpt: 20,
      wildchat: 20
    },
    rater_count: 2
  });
  const validation = validatePilotStudyConfig(config);
  assert.equal(validation.is_valid, false);
  assert.match(validation.findings[0], /does not match total_conversations/i);
});

test("03 evaluateValidationStages marks pass/fail/pending", () => {
  const framework = buildValidationFramework();
  const report = evaluateValidationStages(framework, {
    content_validity: 0.81,
    construct_validity: 0.88,
    inter_rater_reliability: 0.7
  });

  assert.equal(report.summary.passed, 2);
  assert.equal(report.summary.failed, 1);
  assert.equal(report.summary.pending, 2);
  assert.equal(report.summary.readiness, "not_ready");
});

test("04 descriptiveStats computes stable summary", () => {
  const stats = descriptiveStats([1, 2, 3, 4]);
  assert.equal(stats.n, 4);
  assert.equal(stats.mean, 2.5);
  assert.equal(stats.median, 2.5);
  assert.equal(stats.min, 1);
  assert.equal(stats.max, 4);
});

test("05 confusionMatrix2x2 computes metrics", () => {
  const matrix = confusionMatrix2x2(8, 2, 2, 8);
  assert.equal(matrix.precision, 0.8);
  assert.equal(matrix.recall, 0.8);
  assert.equal(matrix.accuracy, 0.8);
});

test("06 CLI plan writes framework JSON", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "validation-framework-"));
  const outputPath = path.join(tmpDir, "framework.json");

  const cli = spawnSync(process.execPath, ["scripts/validation-framework.mjs", "plan", "--output", outputPath], {
    cwd: ROOT_DIR,
    encoding: "utf8"
  });

  assert.equal(cli.status, 0);
  const payload = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  assert.equal(payload.stages.length, 5);
});

test("07 CLI evaluate imports IRR report and enforces readiness", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "validation-framework-"));
  const irrPath = path.join(tmpDir, "irr.json");
  fs.writeFileSync(
    irrPath,
    JSON.stringify(
      {
        batch_kappa: 0.7
      },
      null,
      2
    ),
    "utf8"
  );

  const metricsPath = path.join(tmpDir, "metrics.json");
  fs.writeFileSync(
    metricsPath,
    JSON.stringify(
      {
        content_validity: 0.9,
        construct_validity: 0.95,
        criterion_validity: 0.7,
        test_retest: 0.8
      },
      null,
      2
    ),
    "utf8"
  );

  const cli = spawnSync(
    process.execPath,
    [
      "scripts/validation-framework.mjs",
      "evaluate",
      "--metrics",
      metricsPath,
      "--irr-report",
      irrPath,
      "--enforce-all"
    ],
    {
      cwd: ROOT_DIR,
      encoding: "utf8"
    }
  );

  assert.equal(cli.status, 0);
  assert.match(cli.stdout, /empirical_ready/);
});
