import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { runAcsmValidatedRelease } from "../scripts/acsm-validated-release.mjs";

function createAnnotationBatch(mode = "strong") {
  if (mode === "weak") {
    return {
      batch_id: "pilot-001",
      target_count: 100,
      completed_count: 1,
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
  }

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

function createOrchestratorInput() {
  return {
    turns: [
      {
        id: "T1",
        role: "user",
        sourceTrust: "trusted",
        boundaryBypass: false,
        text: "Please provide a concise project status summary."
      },
      {
        id: "T2",
        role: "assistant",
        sourceTrust: "trusted",
        boundaryBypass: false,
        text: "I will keep all details aligned with validated scope."
      }
    ]
  };
}

function createMetrics() {
  return {
    content_validity: 0.9,
    construct_validity: 0.93,
    criterion_validity: 0.62,
    test_retest: 0.8
  };
}

test("01 runAcsmValidatedRelease returns GO when validation and gate pass", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "acsm-validated-release-"));
  const batchPath = path.join(tmpDir, "batch.json");
  const orchestratorInputPath = path.join(tmpDir, "orchestrator-input.json");
  const metricsPath = path.join(tmpDir, "metrics.json");
  const artifactsDir = path.join(tmpDir, "release-artifacts");

  fs.writeFileSync(batchPath, JSON.stringify(createAnnotationBatch("strong"), null, 2), "utf8");
  fs.writeFileSync(orchestratorInputPath, JSON.stringify(createOrchestratorInput(), null, 2), "utf8");
  fs.writeFileSync(metricsPath, JSON.stringify(createMetrics(), null, 2), "utf8");

  const result = runAcsmValidatedRelease({
    annotationBatchPath: batchPath,
    orchestratorInputPath,
    validationMetricsPath: metricsPath,
    artifactDir: artifactsDir,
    releaseGateConfigPath: path.resolve("config/release-gate.validation-artifacts.json")
  });

  assert.equal(result.decision, "GO");
  assert.equal(result.summary.releaseGateDecision, "GO");
  assert.equal(result.summary.validationReadiness, "ready");
  assert.equal(fs.existsSync(path.join(artifactsDir, "acsm-validation-artifacts-index.json")), true);
});

test("02 runAcsmValidatedRelease returns NO_GO when validation is not ready", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "acsm-validated-release-"));
  const batchPath = path.join(tmpDir, "batch.json");
  const orchestratorInputPath = path.join(tmpDir, "orchestrator-input.json");
  const metricsPath = path.join(tmpDir, "metrics.json");
  const artifactsDir = path.join(tmpDir, "release-artifacts");

  fs.writeFileSync(batchPath, JSON.stringify(createAnnotationBatch("weak"), null, 2), "utf8");
  fs.writeFileSync(orchestratorInputPath, JSON.stringify(createOrchestratorInput(), null, 2), "utf8");
  fs.writeFileSync(metricsPath, JSON.stringify(createMetrics(), null, 2), "utf8");

  const result = runAcsmValidatedRelease({
    annotationBatchPath: batchPath,
    orchestratorInputPath,
    validationMetricsPath: metricsPath,
    artifactDir: artifactsDir,
    releaseGateConfigPath: path.resolve("config/release-gate.validation-artifacts.json")
  });

  assert.equal(result.decision, "NO_GO");
  assert.equal(result.summary.releaseGateDecision, "NO_GO");
  assert.equal(result.summary.validationReadiness, "not_ready");
  assert.equal(
    result.releaseGate.findings.some((item) => item.id === "validation-not-ready"),
    true
  );
});

test("03 CLI writes result and release-gate input", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "acsm-validated-release-"));
  const batchPath = path.join(tmpDir, "batch.json");
  const orchestratorInputPath = path.join(tmpDir, "orchestrator-input.json");
  const metricsPath = path.join(tmpDir, "metrics.json");
  const artifactsDir = path.join(tmpDir, "release-artifacts");
  const outputPath = path.join(tmpDir, "validated-release-result.json");
  const releaseGateInputPath = path.join(tmpDir, "release-gate-input.json");

  fs.writeFileSync(batchPath, JSON.stringify(createAnnotationBatch("strong"), null, 2), "utf8");
  fs.writeFileSync(orchestratorInputPath, JSON.stringify(createOrchestratorInput(), null, 2), "utf8");
  fs.writeFileSync(metricsPath, JSON.stringify(createMetrics(), null, 2), "utf8");

  execFileSync(
    "node",
    [
      "scripts/acsm-validated-release.mjs",
      "--annotation-batch",
      batchPath,
      "--orchestrator-input",
      orchestratorInputPath,
      "--validation-metrics",
      metricsPath,
      "--artifact-dir",
      artifactsDir,
      "--release-gate-input-output",
      releaseGateInputPath,
      "--output",
      outputPath
    ],
    {
      cwd: process.cwd(),
      stdio: "pipe"
    }
  );

  assert.equal(fs.existsSync(outputPath), true);
  assert.equal(fs.existsSync(releaseGateInputPath), true);

  const result = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  const releaseGateInput = JSON.parse(fs.readFileSync(releaseGateInputPath, "utf8"));

  assert.equal(result.decision, "GO");
  assert.equal(releaseGateInput.validation.readiness, "ready");
});

test("04 CLI exits non-zero when validated release is blocked", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "acsm-validated-release-"));
  const batchPath = path.join(tmpDir, "batch.json");
  const orchestratorInputPath = path.join(tmpDir, "orchestrator-input.json");
  const metricsPath = path.join(tmpDir, "metrics.json");
  const artifactsDir = path.join(tmpDir, "release-artifacts");
  const outputPath = path.join(tmpDir, "validated-release-result.json");

  fs.writeFileSync(batchPath, JSON.stringify(createAnnotationBatch("weak"), null, 2), "utf8");
  fs.writeFileSync(orchestratorInputPath, JSON.stringify(createOrchestratorInput(), null, 2), "utf8");
  fs.writeFileSync(metricsPath, JSON.stringify(createMetrics(), null, 2), "utf8");

  assert.throws(
    () =>
      execFileSync(
        "node",
        [
          "scripts/acsm-validated-release.mjs",
          "--annotation-batch",
          batchPath,
          "--orchestrator-input",
          orchestratorInputPath,
          "--validation-metrics",
          metricsPath,
          "--artifact-dir",
          artifactsDir,
          "--output",
          outputPath
        ],
        {
          cwd: process.cwd(),
          stdio: "pipe"
        }
      ),
    /Command failed/
  );

  const result = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  assert.equal(result.decision, "NO_GO");
  assert.equal(result.summary.validationReadiness, "not_ready");
});

test("05 CLI exits with usage error when required args are missing", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "acsm-validated-release-"));
  const batchPath = path.join(tmpDir, "batch.json");
  const orchestratorInputPath = path.join(tmpDir, "orchestrator-input.json");

  fs.writeFileSync(batchPath, JSON.stringify(createAnnotationBatch("strong"), null, 2), "utf8");
  fs.writeFileSync(orchestratorInputPath, JSON.stringify(createOrchestratorInput(), null, 2), "utf8");

  assert.throws(
    () =>
      execFileSync(
        "node",
        [
          "scripts/acsm-validated-release.mjs",
          "--annotation-batch",
          batchPath,
          "--orchestrator-input",
          orchestratorInputPath
        ],
        {
          cwd: process.cwd(),
          stdio: "pipe"
        }
      ),
    /Command failed/
  );
});
