import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { runValidationPipeline } from "../scripts/validation-runner.mjs";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function createBatchFixture() {
  return {
    batch_id: "pilot-001",
    target_count: 100,
    completed_count: 1,
    conversations: [
      {
        conversation_id: "conv-01",
        turns: [{ turn_id: "T001" }, { turn_id: "T002" }],
        rater_a: [
          { turn_id: "T001", event_code: "FR_01", severity: 2 },
          { turn_id: "T002", event_code: "CA_01", severity: 1 }
        ],
        rater_b: [
          { turn_id: "T001", event_code: "FR_01", severity: 2 },
          { turn_id: "T002", event_code: "CA_01", severity: 1 }
        ]
      }
    ]
  };
}

test("01 runValidationPipeline injects kappa into metrics", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "validation-runner-"));
  const batchPath = path.join(tmpDir, "batch.json");
  const metricsPath = path.join(tmpDir, "metrics.json");
  fs.writeFileSync(batchPath, JSON.stringify(createBatchFixture(), null, 2), "utf8");
  fs.writeFileSync(
    metricsPath,
    JSON.stringify(
      {
        content_validity: 0.9,
        construct_validity: 0.9,
        criterion_validity: 0.6,
        test_retest: 0.8
      },
      null,
      2
    ),
    "utf8"
  );

  const result = runValidationPipeline({
    batchPath,
    metricsPath,
    targetKappa: 0.61
  });

  assert.equal(typeof result.metrics.inter_rater_reliability, "number");
  assert.equal(result.summary.readiness, "ready");
});

test("02 CLI writes output and enforces readiness", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "validation-runner-"));
  const batchPath = path.join(tmpDir, "batch.json");
  const metricsPath = path.join(tmpDir, "metrics.json");
  const outputPath = path.join(tmpDir, "result.json");

  const weakBatch = {
    ...createBatchFixture(),
    conversations: [
      {
        conversation_id: "conv-01",
        turns: [{ turn_id: "T001" }, { turn_id: "T002" }],
        rater_a: [
          { turn_id: "T001", event_code: "FR_01", severity: 4 },
          { turn_id: "T002", event_code: "CA_01", severity: 0 }
        ],
        rater_b: [
          { turn_id: "T001", event_code: "FR_01", severity: 0 },
          { turn_id: "T002", event_code: "CA_01", severity: 4 }
        ]
      }
    ]
  };

  fs.writeFileSync(batchPath, JSON.stringify(weakBatch, null, 2), "utf8");
  fs.writeFileSync(
    metricsPath,
    JSON.stringify(
      {
        content_validity: 0.9,
        construct_validity: 0.9,
        criterion_validity: 0.6,
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
      "scripts/validation-runner.mjs",
      "--batch",
      batchPath,
      "--metrics",
      metricsPath,
      "--output",
      outputPath,
      "--enforce-all"
    ],
    {
      cwd: ROOT_DIR,
      encoding: "utf8"
    }
  );

  assert.equal(cli.status, 1);
  const report = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  assert.equal(report.summary.readiness, "not_ready");
});
